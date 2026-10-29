const yauzl = require('yauzl');

const MAX_ZIP_ENTRIES = 200;
const MAX_ZIP_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
function readStream(stream, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    stream.on('data', chunk => { size += chunk.length; if (size > limit) { stream.destroy(); reject(new Error('Office document contains an over-limit uncompressed entry.')); } else chunks.push(chunk); });
    stream.on('error', reject); stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
/** Reads selected Office ZIP parts lazily and rejects archive-bomb shaped containers. */
function readZipParts(buffer, wanted, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('Office document processing was cancelled.'), { code: 'CANCELLED' }));
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (openError, zip) => {
      if (openError || !zip) return reject(new Error('The Office container could not be opened.'));
      const parts = new Map(); let entries = 0; let total = 0; let closed = false; let activeStream;
      const abort = () => { try { activeStream?.destroy(Object.assign(new Error('Office document processing was cancelled.'), { code: 'CANCELLED' })); } catch {} finish(Object.assign(new Error('Office document processing was cancelled.'), { code: 'CANCELLED' })); };
      const finish = error => { if (closed) return; closed = true; signal?.removeEventListener('abort', abort); try { zip.close(); } catch {} error ? reject(error) : resolve(parts); };
      signal?.addEventListener('abort', abort, { once: true });
      zip.on('error', () => finish(new Error('The Office container is malformed.')));
      zip.on('entry', entry => {
        entries += 1; total += entry.uncompressedSize || 0;
        if (entries > MAX_ZIP_ENTRIES || total > MAX_ZIP_UNCOMPRESSED_BYTES || /(^|\/)\.\.?($|\/)/.test(entry.fileName)) return finish(new Error('The Office container exceeds safe archive limits.'));
        const selected = typeof wanted === 'function' ? wanted(entry.fileName) : wanted.has(entry.fileName); if (!selected) return zip.readEntry();
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return finish(new Error('A required Office document part could not be read.'));
          activeStream = stream; readStream(stream, MAX_ZIP_UNCOMPRESSED_BYTES).then(value => { activeStream = undefined; if (!closed) { parts.set(entry.fileName, value); zip.readEntry(); } }).catch(finish);
        });
      });
      zip.on('end', () => finish());
      zip.readEntry();
    });
  });
}
module.exports = { readZipParts };
