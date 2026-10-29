const net = require('node:net');

function scannerConfig(env = process.env) {
  const production = env.NODE_ENV === 'production'; const host = typeof env.FILE_SCAN_CLAMAV_HOST === 'string' ? env.FILE_SCAN_CLAMAV_HOST.trim() : ''; const port = Number(env.FILE_SCAN_CLAMAV_PORT || 3310); const timeoutMs = Number(env.FILE_SCAN_TIMEOUT_MS || 30_000);
  if (!host || !/^[A-Za-z0-9.-]{1,253}$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) return { error: 'malware scanner configuration' };
  if (production && /^(localhost|127\.0\.0\.1|::1)$/i.test(host)) return { error: 'malware scanner configuration' };
  return { host, port, timeoutMs };
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
async function probeScanner(configuration, signal) {
  const ping = await scannerCommand(configuration, 'PING', signal); if (!/\bPONG\b/.test(ping)) throw new Error('Malware scanner readiness probe returned an invalid PING response.');
  const version = await scannerCommand(configuration, 'VERSION', signal); const signature = version.match(/\bClamAV\b[^/\0]*\/([0-9]+)/i)?.[1]; if (!signature) throw new Error('Malware scanner did not report an available signature database.');
  return { signatures: 'available' };
}
function scanBuffer(buffer, configuration, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('Scan cancelled.'), { code: 'CANCELLED' }));
    const socket = net.createConnection({ host: configuration.host, port: configuration.port }); let completed = false; let response = ''; const finish = (error, result) => { if (completed) return; completed = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); socket.destroy(); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => finish(new Error('Malware scan timed out.')), configuration.timeoutMs); const abort = () => finish(Object.assign(new Error('Scan cancelled.'), { code: 'CANCELLED' })); signal?.addEventListener('abort', abort, { once: true });
    socket.once('connect', () => { socket.write('zINSTREAM\0'); for (let offset = 0; offset < buffer.length; offset += 64 * 1024) { const chunk = buffer.subarray(offset, Math.min(buffer.length, offset + 64 * 1024)); const length = Buffer.alloc(4); length.writeUInt32BE(chunk.length); socket.write(length); socket.write(chunk); } socket.write(Buffer.alloc(4)); });
    socket.on('data', value => { response += value.toString('utf8'); if (/\bOK\b/.test(response)) finish(undefined, { clean: true }); else if (/\bFOUND\b/.test(response)) finish(undefined, { clean: false }); }); socket.once('error', () => finish(new Error('Malware scanner is unavailable.'))); socket.once('end', () => { if (!completed) finish(new Error('Malware scanner returned an invalid response.')); });
  });
}
module.exports = { scannerConfig, scannerCommand, probeScanner, scanBuffer };
