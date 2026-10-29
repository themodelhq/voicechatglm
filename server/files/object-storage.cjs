const { Readable } = require('node:stream');
const { randomUUID } = require('node:crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CopyObjectCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');

function textEnv(env, name) { const value = env[name]; return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function boolEnv(env, name, fallback = false) { if (env[name] === undefined) return fallback; return env[name] === 'true'; }
function safeHttpsEndpoint(value, production) { if (!value) return undefined; try { const url = new URL(value); return (!production || url.protocol === 'https:') && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.toString().replace(/\/$/, '') : undefined; } catch { return undefined; } }
function objectStorageConfig(env = process.env) {
  const production = env.NODE_ENV === 'production'; const bucket = textEnv(env, 'FILE_STORAGE_S3_BUCKET'); const region = textEnv(env, 'FILE_STORAGE_S3_REGION'); const endpoint = safeHttpsEndpoint(textEnv(env, 'FILE_STORAGE_S3_ENDPOINT'), production); const accessKeyId = textEnv(env, 'FILE_STORAGE_S3_ACCESS_KEY_ID'); const secretAccessKey = textEnv(env, 'FILE_STORAGE_S3_SECRET_ACCESS_KEY'); const prefixRaw = textEnv(env, 'FILE_STORAGE_S3_PREFIX') || 'voicechatglm'; const prefix = prefixRaw.replace(/^\/+|\/+$/g, '');
  if (!bucket || !region || !endpoint || !accessKeyId || !secretAccessKey || !/^[a-z0-9][a-z0-9.-]{2,62}$/i.test(bucket) || !/^[A-Za-z0-9!_.*'()\/-]{1,200}$/.test(prefix)) return { error: 'private object storage configuration' };
  if (production && endpoint.startsWith('http:')) return { error: 'private object storage configuration' };
  return { bucket, region, endpoint, accessKeyId, secretAccessKey, prefix, forcePathStyle: boolEnv(env, 'FILE_STORAGE_S3_FORCE_PATH_STYLE', true) };
}
function createObjectStore(configuration) {
  if (configuration?.error) throw new Error('Private object storage configuration is invalid.');
  const client = new S3Client({ region: configuration.region, endpoint: configuration.endpoint, forcePathStyle: configuration.forcePathStyle, credentials: { accessKeyId: configuration.accessKeyId, secretAccessKey: configuration.secretAccessKey } });
  const options = signal => signal ? { abortSignal: signal } : undefined;
  const send = (command, signal) => client.send(command, options(signal));
  const keyFor = suffix => `${configuration.prefix}/${suffix.replace(/^\/+/, '')}`;
  async function put(key, body, contentType = 'application/octet-stream', signal) { await send(new PutObjectCommand({ Bucket: configuration.bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: 'AES256', CacheControl: 'private, no-store' }), signal); }
  async function getBuffer(key, maxBytes = 32 * 1024 * 1024, signal) {
    const result = await send(new GetObjectCommand({ Bucket: configuration.bucket, Key: key }), signal); const body = result.Body; if (!body) throw new Error('Private object is unavailable.');
    const stream = typeof body.transformToByteArray === 'function' ? Readable.from(Buffer.from(await body.transformToByteArray())) : body; const chunks = []; let size = 0;
    const abort = () => stream.destroy?.(Object.assign(new Error('Private object retrieval was cancelled.'), { code: 'CANCELLED' })); signal?.addEventListener('abort', abort, { once: true });
    try { for await (const chunk of stream) { const value = Buffer.from(chunk); size += value.length; if (size > maxBytes) { stream.destroy?.(); throw new Error('Private object exceeds the safe retrieval limit.'); } chunks.push(value); } return Buffer.concat(chunks); }
    finally { signal?.removeEventListener('abort', abort); }
  }
  const remove = (key, signal) => send(new DeleteObjectCommand({ Bucket: configuration.bucket, Key: key }), signal);
  return {
    keyFor,
    // The start-up gate performs a private, unpredictable canary write/read/delete in
    // addition to HeadBucket. It neither lists customer objects nor returns object keys.
    async probe(signal) { await send(new HeadBucketCommand({ Bucket: configuration.bucket }), signal); },
    async verifyReadWriteDelete(signal) { const key = keyFor(`__readiness/${randomUUID()}`); const marker = Buffer.from(`voicechatglm-readiness-${randomUUID()}`, 'utf8'); let stored = false; try { await put(key, marker, 'text/plain; charset=utf-8', signal); stored = true; const received = await getBuffer(key, marker.length + 1, signal); if (!received.equals(marker)) throw new Error('Private object storage readiness read did not match the canary write.'); } finally { if (stored) await remove(key, signal).catch(() => undefined); } },
    async putBuffer(key, buffer, contentType, signal) { await put(key, buffer, contentType, signal); },
    async putJson(key, value, signal) { await put(key, Buffer.from(JSON.stringify(value), 'utf8'), 'application/json', signal); },
    getBuffer,
    async getJson(key, maxBytes, signal) { return JSON.parse((await getBuffer(key, maxBytes, signal)).toString('utf8')); },
    async promote(fromKey, toKey, contentType, signal) { await send(new CopyObjectCommand({ Bucket: configuration.bucket, CopySource: `${encodeURIComponent(configuration.bucket)}/${fromKey.split('/').map(encodeURIComponent).join('/')}`, Key: toKey, ContentType: contentType, MetadataDirective: 'REPLACE', ServerSideEncryption: 'AES256', CacheControl: 'private, no-store' }), signal); await remove(fromKey, signal); },
    async delete(key, signal) { await remove(key, signal); },
  };
}
module.exports = { objectStorageConfig, createObjectStore };
