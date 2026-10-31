const net = require('node:net');

const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024;

function scannerConfig(env = process.env) {
  const provider = String(env.FILE_SCAN_PROVIDER || 'clamav_tcp').trim().toLowerCase();
  const timeoutMs = Number(env.FILE_SCAN_TIMEOUT_MS || 30_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) return { error: 'malware scanner configuration' };

  if (provider === 'huggingface_space') {
    const rawUrl = typeof env.FILE_SCAN_API_URL === 'string' ? env.FILE_SCAN_API_URL.trim() : '';
    const apiKey = typeof env.FILE_SCAN_API_KEY === 'string' ? env.FILE_SCAN_API_KEY.trim() : '';
    const maxFileBytes = Number(env.FILE_SCAN_MAX_FILE_BYTES || DEFAULT_MAX_FILE_BYTES);
    let url;
    try {
      const parsed = new URL(rawUrl);
      if (!['https:', ...(env.NODE_ENV === 'production' ? [] : ['http:'])].includes(parsed.protocol)
        || parsed.username || parsed.password || parsed.search || parsed.hash) return { error: 'malware scanner configuration' };
      url = parsed.toString().replace(/\/$/, '');
    } catch { return { error: 'malware scanner configuration' }; }
    if (!url || !apiKey || apiKey.length < 24
      || !Number.isInteger(maxFileBytes) || maxFileBytes < 1024 || maxFileBytes > 25 * 1024 * 1024) {
      return { error: 'malware scanner configuration' };
    }
    return { provider, url, apiKey, timeoutMs, maxFileBytes };
  }

  if (provider !== 'clamav_tcp') return { error: 'malware scanner configuration' };
  const production = env.NODE_ENV === 'production';
  const host = typeof env.FILE_SCAN_CLAMAV_HOST === 'string' ? env.FILE_SCAN_CLAMAV_HOST.trim() : '';
  const port = Number(env.FILE_SCAN_CLAMAV_PORT || 3310);
  if (!host || !/^[A-Za-z0-9.-]{1,253}$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return { error: 'malware scanner configuration' };
  if (production && /^(localhost|127\.0\.0\.1|::1)$/i.test(host)) return { error: 'malware scanner configuration' };
  return { provider, host, port, timeoutMs };
}

function scannerCommand(configuration, command, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('Malware scanner operation was cancelled.'), { code: 'CANCELLED' }));
    const socket = net.createConnection({ host: configuration.host, port: configuration.port }); let completed = false; let output = '';
    const abort = () => finish(Object.assign(new Error('Malware scanner operation was cancelled.'), { code: 'CANCELLED' }));
    const finish = (error, result) => { if (completed) return; completed = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); socket.destroy(); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => finish(new Error('Malware scanner operation timed out.')), configuration.timeoutMs); signal?.addEventListener('abort', abort, { once: true });
    socket.once('connect', () => socket.write(`z${command}\0`)); socket.on('data', value => { output += value.toString('utf8'); if (output.includes('\0') || /(?:PONG|ClamAV)/.test(output)) finish(undefined, output); }); socket.once('error', () => finish(new Error('Malware scanner is unavailable.'))); socket.once('end', () => { if (!completed) finish(new Error('Malware scanner returned an invalid response.')); });
  });
}

async function gradioRequest(configuration, pathname, options, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Malware scanner request timed out.')), configuration.timeoutMs);
  try {
    return await fetch(`${configuration.url}${pathname}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'X-API-Key': configuration.apiKey,
        Accept: options.headers?.Accept || 'application/json',
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    if (signal?.aborted) throw Object.assign(new Error('Malware scanner operation was cancelled.'), { code: 'CANCELLED' });
    throw new Error('Malware scanner is unavailable.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

async function readResponseText(response, configuration, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) {
        response.body?.cancel?.().catch?.(() => undefined);
        reject(error);
      } else resolve(value);
    };
    const abort = () => finish(Object.assign(new Error('Malware scanner operation was cancelled.'), { code: 'CANCELLED' }));
    const timer = setTimeout(() => finish(new Error('Malware scanner response timed out.')), configuration.timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();
    response.text().then(value => finish(undefined, value), () => finish(new Error('Malware scanner returned an unreadable response.')));
  });
}

function parseGradioEventStream(source) {
  let currentEvent = '';
  let data = [];
  for (const line of String(source || '').split(/\r?\n/)) {
    if (line.startsWith('event:')) currentEvent = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
    else if (!line.trim() && currentEvent) {
      if (currentEvent === 'complete') {
        let parsed;
        try { parsed = JSON.parse(data.join('\n')); } catch { throw new Error('Malware scanner returned malformed data.'); }
        return Array.isArray(parsed) ? parsed[0] : parsed;
      }
      if (currentEvent === 'error') throw new Error('Malware scanner reported an error.');
      currentEvent = '';
      data = [];
    }
  }
  if (currentEvent === 'complete') {
    let parsed;
    try { parsed = JSON.parse(data.join('\n')); } catch { throw new Error('Malware scanner returned malformed data.'); }
    return Array.isArray(parsed) ? parsed[0] : parsed;
  }
  throw new Error('Malware scanner returned an incomplete response.');
}

async function callGradioApi(configuration, apiName, data, signal) {
  const submitted = await gradioRequest(configuration, `/gradio_api/call/${apiName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  }, signal);
  if (!submitted.ok) throw new Error(`Malware scanner submission failed (HTTP ${submitted.status}).`);
  const submissionText = await readResponseText(submitted, configuration, signal);
  if (submissionText.length > 16 * 1024) throw new Error('Malware scanner submission response exceeded its limit.');
  let submission;
  try { submission = JSON.parse(submissionText); } catch { throw new Error('Malware scanner returned an invalid submission response.'); }
  const eventId = submission?.event_id;
  if (typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(eventId)) throw new Error('Malware scanner did not return a valid event ID.');

  const completed = await gradioRequest(configuration, `/gradio_api/call/${apiName}/${encodeURIComponent(eventId)}`, {
    method: 'GET',
    headers: { Accept: 'text/event-stream' },
  }, signal);
  if (!completed.ok) throw new Error(`Malware scanner result retrieval failed (HTTP ${completed.status}).`);
  const body = await readResponseText(completed, configuration, signal);
  if (body.length > 64 * 1024) throw new Error('Malware scanner response exceeded its limit.');
  return parseGradioEventStream(body);
}

async function probeScanner(configuration, signal) {
  if (configuration.provider === 'huggingface_space') {
    const result = await callGradioApi(configuration, 'scanner_health', [], signal);
    if (result?.status !== 'ready' || result?.engine !== 'clamav'
      || !Number.isInteger(result.max_file_bytes) || result.max_file_bytes < 1) {
      throw new Error('Malware scanner readiness probe returned an invalid response.');
    }
    if (configuration.maxFileBytes > result.max_file_bytes) throw new Error('Render scanner file-size limit exceeds the Hugging Face Space limit.');
    return { signatures: 'available', maxFileBytes: result.max_file_bytes };
  }
  const ping = await scannerCommand(configuration, 'PING', signal); if (!/\bPONG\b/.test(ping)) throw new Error('Malware scanner readiness probe returned an invalid PING response.');
  const version = await scannerCommand(configuration, 'VERSION', signal); const signature = version.match(/\bClamAV\b[^/\0]*\/([0-9]+)/i)?.[1]; if (!signature) throw new Error('Malware scanner did not report an available signature database.');
  return { signatures: 'available' };
}

async function scanBuffer(buffer, configuration, signal) {
  if (configuration.provider === 'huggingface_space') {
    if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
    if (buffer.length > configuration.maxFileBytes) throw Object.assign(new Error('File exceeds the configured malware scanner limit.'), { code: 'FILE_TOO_LARGE' });
    const result = await callGradioApi(configuration, 'scan_file', [buffer.toString('base64')], signal);
    if (result?.status === 'clean' && result.infected === false && result.engine === 'clamav') return { clean: true };
    if (result?.status === 'infected' && result.infected === true && result.engine === 'clamav') return { clean: false };
    throw new Error('Malware scanner returned an invalid scan result.');
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('Scan cancelled.'), { code: 'CANCELLED' }));
    const socket = net.createConnection({ host: configuration.host, port: configuration.port }); let completed = false; let response = ''; const finish = (error, result) => { if (completed) return; completed = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); socket.destroy(); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => finish(new Error('Malware scan timed out.')), configuration.timeoutMs); const abort = () => finish(Object.assign(new Error('Scan cancelled.'), { code: 'CANCELLED' })); signal?.addEventListener('abort', abort, { once: true });
    socket.once('connect', () => { socket.write('zINSTREAM\0'); for (let offset = 0; offset < buffer.length; offset += 64 * 1024) { const chunk = buffer.subarray(offset, Math.min(buffer.length, offset + 64 * 1024)); const length = Buffer.alloc(4); length.writeUInt32BE(chunk.length); socket.write(length); socket.write(chunk); } socket.write(Buffer.alloc(4)); });
    socket.on('data', value => { response += value.toString('utf8'); if (/\bOK\b/.test(response)) finish(undefined, { clean: true }); else if (/\bFOUND\b/.test(response)) finish(undefined, { clean: false }); }); socket.once('error', () => finish(new Error('Malware scanner is unavailable.'))); socket.once('end', () => { if (!completed) finish(new Error('Malware scanner returned an invalid response.')); });
  });
}
module.exports = { scannerConfig, scannerCommand, probeScanner, scanBuffer, parseGradioEventStream, callGradioApi };
