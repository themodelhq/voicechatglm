const crypto = require('node:crypto');
const { validId } = require('./writing-routes.cjs');

const SHARE_SCOPES = new Set(['selected', 'full']);
const SHARE_EXPIRATION_HOURS = Object.freeze([1, 24, 24 * 7, 24 * 30]);
const PREVIEW_PAGE_SIZE = 50;
const PUBLIC_PAGE_SIZE = 100;
function failure(status, message) { return { status, body: { error: message } }; }
function tokenHash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function newToken() { return crypto.randomBytes(32).toString('base64url'); }
function validInput(value, allowed) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key)) ? value : undefined; }
function validSelection(value) { return Array.isArray(value) && value.length > 0 && value.length <= 1000 && value.every(item => validId(item)) && new Set(value).size === value.length; }
function validPreviewDigest(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function positiveInteger(value, maximum) { const number = Number(value); return Number.isSafeInteger(number) && number >= 0 && number <= maximum ? number : undefined; }
function integerSetting(env, name, fallback, min, max) { if (env[name] === undefined) return fallback; const parsed = Number(env[name]); return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : undefined; }
function expirationLabel(hours) { return hours === 1 ? '1 hour' : hours === 24 ? '24 hours' : hours === 168 ? '7 days' : '30 days'; }

function shareConfig(env = process.env) {
  const enabled = env.CONVERSATION_SHARING_ENABLED === 'true'; const maxHours = Number(env.CONVERSATION_SHARE_MAX_HOURS || 720);
  const maxValid = Number.isInteger(maxHours) && maxHours >= 720 && maxHours <= 8760;
  const createBurstPerMinute = integerSetting(env, 'CONVERSATION_SHARE_CREATE_BURST_PER_MINUTE', 12, 1, 1000);
  const publicBurstPerMinute = integerSetting(env, 'CONVERSATION_SHARE_PUBLIC_BURST_PER_MINUTE', 60, 1, 10000);
  const configured = maxValid && createBurstPerMinute !== undefined && publicBurstPerMinute !== undefined;
  return { implemented: true, configured, enabled, available: enabled && configured, maxHours: maxValid ? maxHours : 720, expirationHours: SHARE_EXPIRATION_HOURS, createBurstPerMinute: createBurstPerMinute || 12, publicBurstPerMinute: publicBurstPerMinute || 60, reason: !enabled ? 'Conversation sharing is disabled by deployment policy.' : !configured ? 'Conversation-sharing expiration or rate-limit configuration is invalid.' : undefined };
}

function inputForShare(value, cfg, { requirePreviewProof = false } = {}) {
  if (!value || !validId(value.conversationId) || !SHARE_SCOPES.has(value.scope)) return undefined;
  const selected = value.selectedMessageIds; if (value.scope === 'selected' && !validSelection(selected)) return undefined; if (value.scope === 'full' && selected !== undefined) return undefined;
  const title = typeof value.title === 'string' && value.title.trim().length <= 240 ? value.title.trim() : undefined;
  const hours = Number(value.expiresInHours); if (!SHARE_EXPIRATION_HOURS.includes(hours) || hours > cfg.maxHours) return undefined;
  const shareVersion = value.expectedShareVersion === undefined ? undefined : positiveInteger(value.expectedShareVersion, Number.MAX_SAFE_INTEGER);
  const previewDigest = value.expectedPreviewDigest;
  if (value.title !== undefined && !title || requirePreviewProof && (shareVersion === undefined || !validPreviewDigest(previewDigest))) return undefined;
  const offset = value.offset === undefined ? 0 : positiveInteger(value.offset, 1_000_000);
  const pageSize = value.pageSize === undefined ? PREVIEW_PAGE_SIZE : positiveInteger(value.pageSize, PREVIEW_PAGE_SIZE);
  if (offset === undefined || pageSize === undefined || pageSize < 1) return undefined;
  return { conversationId: value.conversationId, scope: value.scope, selectedMessageIds: value.scope === 'selected' ? selected : [], title, expiresInHours: hours, expectedShareVersion: shareVersion, expectedPreviewDigest: validPreviewDigest(previewDigest) ? previewDigest : undefined, offset, pageSize };
}

function publicPreview(page, input) {
  return { conversationId: page.conversationId, title: page.title, scope: input.scope, shareVersion: page.shareVersion, previewDigest: page.previewDigest, messages: page.messages, messageCount: page.messageCount, offset: input.offset, nextOffset: input.offset + page.messages.length < page.messageCount ? input.offset + page.messages.length : undefined, expiration: { hours: input.expiresInHours, label: expirationLabel(input.expiresInHours) }, attachments: { included: 0, policy: 'Attachments, uploads, generated artifacts, memory records and knowledge sources are not included or publicly downloadable from a share link.' }, artifactPolicy: 'Private artifacts, uploads, memory records, knowledge sources, system messages, and tool state are not included in a share link.' };
}

async function sharePreview(repository, userId, input) {
  const page = await repository.sharePreviewForOwner({ userId, conversationId: input.conversationId, scope: input.scope, selectedMessageIds: input.selectedMessageIds, title: input.title, offset: input.offset, limit: input.pageSize, expectedShareVersion: input.expectedShareVersion });
  return page?.conflict ? { conflict: true } : page ? publicPreview(page, input) : undefined;
}

async function handleShareRoute({ route, method, body, userId, repository, env = process.env, now = () => new Date() }) {
  const cfg = shareConfig(env); if (!cfg.enabled || !cfg.configured) return failure(503, cfg.reason || 'Conversation sharing is unavailable.'); const parts = String(route).split('/').filter(Boolean); if (parts[0] !== 'shares') return failure(404, 'Share route not found.');
  if (parts[1] === 'preview' && parts.length === 2 && method === 'POST') {
    const raw = validInput(body, ['conversationId', 'scope', 'selectedMessageIds', 'title', 'expiresInHours', 'expectedShareVersion', 'offset', 'pageSize']); const input = raw && inputForShare(raw, cfg); const preview = input && await sharePreview(repository, userId, input);
    if (preview?.conflict) return failure(409, 'The conversation changed while you were reviewing this share. Refresh the preview and confirm again.');
    return preview ? { status: 200, body: { preview } } : failure(404, 'Conversation or explicitly selected messages not found.');
  }
  if (parts.length === 1 && method === 'POST') {
    const raw = validInput(body, ['conversationId', 'scope', 'selectedMessageIds', 'title', 'expiresInHours', 'expectedShareVersion', 'expectedPreviewDigest']); const input = raw && inputForShare(raw, cfg, { requirePreviewProof: true });
    if (!input) return failure(400, 'Share link input is invalid. Choose a supported finite expiration and confirm the current exact preview.');
    const createdAt = now(); if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) return failure(503, 'Share service time is unavailable.');
    const expiresAt = new Date(createdAt.getTime() + input.expiresInHours * 3_600_000); const token = newToken(); const snapshot = await repository.createShareSnapshot({ userId, conversationId: input.conversationId, tokenHash: tokenHash(token), scope: input.scope, selectedMessageIds: input.selectedMessageIds, title: input.title, expiresAt, expectedShareVersion: input.expectedShareVersion, expectedPreviewDigest: input.expectedPreviewDigest });
    if (snapshot?.conflict) return failure(409, 'The conversation changed while you were reviewing this share. Refresh the preview and confirm again.');
    if (!snapshot?.share) return failure(404, 'Conversation or explicitly selected messages not found.');
    return { status: 201, body: { share: snapshot.share, token, path: `/api/share/${token}`, messageCount: snapshot.messageCount, expiration: { hours: input.expiresInHours, label: expirationLabel(input.expiresInHours), expiresAt: snapshot.share.expiresAt } } };
  }
  if (parts[1] === 'conversation' && validId(parts[2]) && parts.length === 3 && method === 'GET') return { status: 200, body: { shares: await repository.shareLinksForOwner(userId, parts[2]) } };
  if (parts.length === 2 && validId(parts[1]) && method === 'DELETE') { const share = await repository.revokeShareLink(userId, parts[1]); return share ? { status: 200, body: { revoked: true } } : failure(404, 'Share link not found.'); }
  return failure(404, 'Share route not found.');
}

async function handlePublicShare({ token, repository, env = process.env, after, limit }) {
  const cfg = shareConfig(env); if (!cfg.enabled || !cfg.configured) return failure(404, 'Shared conversation not found.'); if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) return failure(404, 'Shared conversation not found.');
  const cursor = after === undefined ? -1 : positiveInteger(after, 100_000_000); const pageSize = limit === undefined ? PUBLIC_PAGE_SIZE : positiveInteger(limit, 200);
  if (cursor === undefined || pageSize === undefined || pageSize < 1) return failure(404, 'Shared conversation not found.');
  const shared = await repository.sharedConversationByTokenHash(tokenHash(token), { after: cursor, limit: pageSize });
  return shared ? { status: 200, body: { title: shared.title, scope: shared.share.scope, messages: shared.messages, messageCount: shared.messageCount, nextCursor: shared.nextCursor, expiresAt: shared.share.expiresAt, readOnly: true, attachments: { included: 0, policy: 'Attachments are not included in this link.' }, artifactPolicy: 'Private artifacts, uploads, memory records, knowledge sources, system messages, and tool state are not included in a share link.' } } : failure(404, 'Shared conversation not found.');
}
module.exports = { SHARE_SCOPES, SHARE_EXPIRATION_HOURS, shareConfig, tokenHash, handleShareRoute, handlePublicShare, sharePreview, expirationLabel };
