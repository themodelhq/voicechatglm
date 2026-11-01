const { TextDecoder } = require('node:util');
const { XMLParser } = require('fast-xml-parser');
const { parse: parseCsv } = require('csv-parse/sync');
const { imageSize } = require('image-size');
const { readZipParts } = require('./zip.cjs');

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: false, parseTagValue: false });
const asArray = value => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
const textOf = value => {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (!value || typeof value !== 'object') return '';
  if ('#text' in value) return String(value['#text'] ?? '');
  return Object.entries(value).filter(([key]) => !key.startsWith('@_')).map(([, child]) => textOf(child)).join('');
};
function boundedText(value, limit) { const text = value.replace(/\u0000/g, '').trim(); return { text: text.slice(0, limit), truncated: text.length > limit }; }
function result({ text, filename, location = 'document', policy, analysisAvailable = true, notices = [], truncated = false }) {
  const bounded = boundedText(text, policy.maxExtractedCharacters);
  return { text: bounded.text, truncated: truncated || bounded.truncated, analysisAvailable, notices, sources: bounded.text ? [{ filename, location }] : [] };
}
async function extractPdf(buffer, filename, policy, signal) {
  let parser; const abort = () => { void parser?.destroy?.().catch(() => undefined); };
  try {
    throwIfAborted(signal); signal?.addEventListener('abort', abort, { once: true }); const { PDFParse } = await import('pdf-parse'); throwIfAborted(signal); parser = new PDFParse({ data: buffer });
    const info = await parser.getInfo(); const pages = Number(info?.total ?? info?.numpages ?? info?.info?.Pages ?? 0);
    if (pages && pages > policy.maxPdfPages) throw new Error(`PDF exceeds the ${policy.maxPdfPages}-page processing limit.`);
    const output = await parser.getText(); const text = typeof output?.text === 'string' ? output.text : '';
    if (!text.trim()) return result({ text: '', filename, policy, analysisAvailable: false, notices: ['No native text was found. Scanner-approved scanned PDFs are OCRed only through the protected document-processing path.'] });
    return result({ text, filename, location: pages ? `PDF pages 1–${pages}` : 'PDF text', policy });
  } catch (error) { throw new Error(error instanceof Error ? `PDF extraction failed: ${error.message}` : 'PDF extraction failed.'); }
  finally { signal?.removeEventListener('abort', abort); await parser?.destroy?.().catch(() => undefined); }
}
function collectDocxText(node) { return textOf(node).replace(/\s+/g, ' ').trim(); }
async function extractDocx(buffer, filename, policy, signal) {
  const wanted = new Set(['[Content_Types].xml', 'word/document.xml']); const parts = await readZipParts(buffer, wanted, signal);
  if (!parts.has('[Content_Types].xml') || !parts.has('word/document.xml')) throw new Error('The DOCX container is missing required document parts.');
  let document; try { document = xml.parse(parts.get('word/document.xml').toString('utf8')); } catch { throw new Error('DOCX XML could not be parsed.'); }
  const body = document?.['w:document']?.['w:body']; if (!body) throw new Error('DOCX body is missing.');
  const sections = [];
  for (const paragraph of asArray(body['w:p'])) { const value = collectDocxText(paragraph); if (value) sections.push(value); }
  for (const table of asArray(body['w:tbl'])) {
    const rows = asArray(table['w:tr']).map(row => asArray(row['w:tc']).map(cell => collectDocxText(cell)).join(' | ')).filter(Boolean);
    if (rows.length) sections.push(`[Table]\n${rows.join('\n')}`);
  }
  if (!sections.length) throw new Error('DOCX contains no extractable paragraphs or tables.');
  return result({ text: sections.join('\n\n'), filename, location: 'DOCX paragraphs and tables', policy });
}
function decodeText(buffer) { try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { try { return new TextDecoder('utf-16le', { fatal: true }).decode(buffer); } catch { throw new Error('Text uses an unsupported encoding.'); } } }
function extractPlain(buffer, filename, policy, kind) { const text = decodeText(buffer); if (!text.trim()) throw new Error(`${kind} file is empty.`); return result({ text, filename, location: kind === 'markdown' ? 'Markdown document' : 'text document', policy }); }
function extractCsv(buffer, filename, policy) {
  const text = decodeText(buffer); if (!text.trim()) throw new Error('CSV file is empty.');
  let rows; try { rows = parseCsv(text, { bom: true, relax_quotes: false, relax_column_count: false, skip_empty_lines: true, to_line: policy.maxCsvRows + 1, trim: false }); } catch { throw new Error('CSV parsing failed. Check delimiters, quotes, and row structure.'); }
  if (rows.length > policy.maxCsvRows) throw new Error(`CSV exceeds the ${policy.maxCsvRows}-row processing limit.`);
  const maxColumns = Math.max(0, ...rows.map(row => row.length)); if (!maxColumns) throw new Error('CSV contains no rows.'); if (maxColumns > policy.maxCsvColumns) throw new Error(`CSV exceeds the ${policy.maxCsvColumns}-column processing limit.`);
  const rendered = rows.map((row, index) => `Row ${index + 1}: ${row.map(value => String(value)).join(' | ')}`).join('\n');
  return { ...result({ text: rendered, filename, location: `CSV rows 1–${rows.length}`, policy }), structuredCsv: { headers: rows[0].map((value, index) => String(value ?? '').trim() || `column_${index + 1}`), rows: rows.slice(1).map(row => rows[0].map((_, index) => String(row[index] ?? ''))), totalRows: Math.max(0, rows.length - 1), truncated: false } };
}
function columnIndex(cellRef) { const letters = String(cellRef || '').match(/[A-Z]+/i)?.[0] || ''; return [...letters.toUpperCase()].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0); }
function rangeBounds(ref) { const [start = '', end = start] = String(ref || '').split(':'); return { rows: Math.max(Number(start.match(/\d+/)?.[0] || 0), Number(end.match(/\d+/)?.[0] || 0)), columns: Math.max(columnIndex(start), columnIndex(end)) }; }
function xlsxValue(cell, shared) {
  const type = cell?.['@_t']; const raw = cell?.v ?? cell?.['is']?.t ?? '';
  const stored = type === 's' ? textOf(shared[Number(raw)] ?? '') : textOf(raw);
  const formula = textOf(cell?.f); return formula ? `${stored} (formula: ${formula})` : stored;
}
async function extractXlsx(buffer, filename, policy, signal) {
  const wanted = new Set(['[Content_Types].xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml']);
  for (let index = 1; index <= policy.maxWorkbookSheets; index += 1) wanted.add(`xl/worksheets/sheet${index}.xml`);
  const parts = await readZipParts(buffer, wanted, signal);
  if (!parts.has('[Content_Types].xml') || !parts.has('xl/workbook.xml')) throw new Error('The XLSX container is missing required workbook parts.');
  let workbook; let rels = {}; let shared = [];
  try {
    workbook = xml.parse(parts.get('xl/workbook.xml').toString('utf8')); if (parts.has('xl/_rels/workbook.xml.rels')) rels = xml.parse(parts.get('xl/_rels/workbook.xml.rels').toString('utf8'));
    if (parts.has('xl/sharedStrings.xml')) shared = asArray(xml.parse(parts.get('xl/sharedStrings.xml').toString('utf8'))?.sst?.si).map(textOf);
  } catch { throw new Error('XLSX XML could not be parsed.'); }
  const relationships = new Map(asArray(rels?.Relationships?.Relationship).map(item => [item?.['@_Id'], item?.['@_Target']]));
  const sheets = asArray(workbook?.workbook?.sheets?.sheet); if (!sheets.length) throw new Error('XLSX contains no worksheets.'); if (sheets.length > policy.maxWorkbookSheets) throw new Error(`XLSX exceeds the ${policy.maxWorkbookSheets}-worksheet processing limit.`);
  let totalCells = 0; const rendered = []; const sourceLocations = [];
  for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
    const sheet = sheets[sheetIndex]; const name = textOf(sheet?.['@_name']) || `Sheet ${sheetIndex + 1}`; const relation = relationships.get(sheet?.['@_r:id']);
    const target = relation ? `xl/${String(relation).replace(/^\//, '').replace(/^xl\//, '')}` : `xl/worksheets/sheet${sheetIndex + 1}.xml`;
    const part = parts.get(target) || parts.get(`xl/worksheets/sheet${sheetIndex + 1}.xml`); if (!part) throw new Error(`XLSX worksheet “${name}” could not be read.`);
    let sheetXml; try { sheetXml = xml.parse(part.toString('utf8')); } catch { throw new Error(`XLSX worksheet “${name}” is malformed.`); }
    const dimensions = rangeBounds(sheetXml?.worksheet?.dimension?.['@_ref']); if (dimensions.rows > policy.maxWorkbookRows || dimensions.columns > policy.maxWorkbookColumns) throw new Error(`Worksheet “${name}” exceeds configured row or column limits.`);
    const rows = asArray(sheetXml?.worksheet?.sheetData?.row); if (rows.length > policy.maxWorkbookRows) throw new Error(`Worksheet “${name}” exceeds the row limit.`);
    rendered.push(`[Sheet: ${name}]`); let firstRow = 0; let lastRow = 0;
    for (const row of rows) {
      const rowNumber = Number(row?.['@_r'] || 0); const cells = asArray(row?.c); totalCells += cells.length; if (totalCells > policy.maxWorkbookCells) throw new Error('Workbook exceeds the total cell processing limit.');
      const values = cells.map(cell => `${cell?.['@_r'] || '?'}=${xlsxValue(cell, shared)}`).filter(value => !value.endsWith('='));
      if (values.length) { if (!firstRow) firstRow = rowNumber; lastRow = rowNumber; rendered.push(`Row ${rowNumber}: ${values.join(' | ')}`); }
    }
    if (firstRow) sourceLocations.push({ filename, location: `sheet ${name}, rows ${firstRow}–${lastRow}` });
  }
  if (!sourceLocations.length) throw new Error('XLSX contains no populated cells.');
  const output = result({ text: rendered.join('\n'), filename, location: sourceLocations.map(item => item.location).join('; '), policy }); output.sources = sourceLocations; return output;
}
async function extractPptx(buffer, filename, policy, signal) {
  const parts = await readZipParts(buffer, name => name === '[Content_Types].xml' || name === 'ppt/presentation.xml' || /^ppt\/slides\/slide\d+\.xml$/i.test(name), signal);
  if (!parts.has('[Content_Types].xml') || !parts.has('ppt/presentation.xml')) throw new Error('The PPTX container is missing required presentation parts.');
  const slides = [...parts.entries()].filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/i.test(name)).sort((left, right) => Number(left[0].match(/slide(\d+)/i)?.[1] || 0) - Number(right[0].match(/slide(\d+)/i)?.[1] || 0));
  if (!slides.length) throw new Error('PPTX contains no readable slides.');
  if (slides.length > policy.maxPdfPages) throw new Error(`PPTX exceeds the ${policy.maxPdfPages}-slide processing limit.`);
  const rendered = [];
  for (let index = 0; index < slides.length; index += 1) { throwIfAborted(signal); let slide; try { slide = xml.parse(slides[index][1].toString('utf8')); } catch { throw new Error(`PPTX slide ${index + 1} is malformed.`); } const text = textOf(slide).replace(/\s+/g, ' ').trim(); if (text) rendered.push(`[Slide ${index + 1}]\n${text}`); }
  if (!rendered.length) return result({ text: '', filename, location: `PPTX slides 1–${slides.length}`, policy, analysisAvailable: false, notices: ['No extractable slide text was found. Images, speaker notes, macros, and embedded media are not analyzed.'] });
  return result({ text: rendered.join('\n\n'), filename, location: `PPTX slides 1–${slides.length}`, policy });
}
function extractJson(buffer, filename, policy) {
  const raw = decodeText(buffer); let value; try { value = JSON.parse(raw); } catch { throw new Error('JSON parsing failed. Upload valid JSON text.'); }
  const text = JSON.stringify(value, null, 2); if (!text || text === 'undefined') throw new Error('JSON contains no serializable content.');
  return result({ text, filename, location: 'JSON document', policy });
}
function extractImage(buffer, filename, policy) {
  let dimensions; try { dimensions = imageSize(buffer); } catch { throw new Error('Image dimensions could not be read.'); }
  const pixels = Number(dimensions.width || 0) * Number(dimensions.height || 0); if (!dimensions.width || !dimensions.height || pixels > policy.maxImagePixels) throw new Error('Image exceeds safe dimension limits.');
  return result({ text: '', filename, location: `${dimensions.type || 'image'} ${dimensions.width}×${dimensions.height}`, policy, analysisAvailable: false, notices: ['Image validated after scanning. OCR text extraction is performed only through the protected document-processing path.'] });
}
function throwIfAborted(signal) { if (signal?.aborted) throw Object.assign(new Error('File processing was cancelled.'), { code: 'CANCELLED' }); }
async function extractFile(file, policy, signal) {
  throwIfAborted(signal); const { type, buffer, filename } = file; let output;
  if (type === 'pdf') output = await extractPdf(buffer, filename, policy, signal);
  else if (type === 'docx') output = await extractDocx(buffer, filename, policy, signal);
  else if (type === 'text' || type === 'markdown') output = extractPlain(buffer, filename, policy, type);
  else if (type === 'csv') output = extractCsv(buffer, filename, policy);
  else if (type === 'xlsx') output = await extractXlsx(buffer, filename, policy, signal);
  else if (type === 'pptx') output = await extractPptx(buffer, filename, policy, signal);
  else if (type === 'json') output = extractJson(buffer, filename, policy);
  else if (type === 'image') output = extractImage(buffer, filename, policy);
  else throw new Error('Unsupported file type.');
  throwIfAborted(signal); return output;
}
module.exports = { extractFile, extractPdf, extractDocx, extractPptx, extractJson, extractCsv, extractXlsx, extractImage, decodeText };
