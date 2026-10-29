import type { Agent, AgentInstructions, ArchiveMemberReference, ArchiveReference, AttachmentReference, Conversation, Message, Preferences, SourceReference, StorageState } from '../../types/domain';
import { defaultPreferences } from '../../types/domain';
import { capabilityRegistry } from '../agents/capabilityRegistry';

const KEY = 'voicechatglm.workspace.v1';
const MAX_ID = 200;
const MAX_MESSAGE = 50_000;
const MAX_DRAFT = 12_001;
const MAX_INSTRUCTION_FIELD = 3_000;
const validRoles = new Set(['user', 'assistant', 'system']);
const validStatuses = new Set(['sending', 'streaming', 'complete', 'partial', 'error', 'cancelled']);
const validThemes = new Set(['light', 'dark', 'system']);
const validDensities = new Set(['comfortable', 'compact']);
const validViews = new Set(['chat', 'agents', 'knowledge', 'writing', 'tools', 'settings']);

export const storageEventName = 'voicechatglm:storage';
export interface StorageResult { ok: boolean; error?: string; }
export interface LoadedWorkspace { state: StorageState; warning?: string; }

const now = (): string => new Date().toISOString();
export const emptyState = (): StorageState => ({ version: 2, revision: 0, updatedAt: now(), conversations: [], agents: [], preferences: { ...defaultPreferences }, drafts: {} });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number, fallback = ''): string => typeof value === 'string' && value.length <= max ? value : fallback;
const identifier = (value: unknown): string | undefined => typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_ID ? value : undefined;
const date = (value: unknown, fallback: string): string => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : fallback;
const bool = (value: unknown, fallback = false): boolean => typeof value === 'boolean' ? value : fallback;

function sanitizeSource(value: unknown): SourceReference | undefined {
  if (!isRecord(value) || typeof value.filename !== 'string' || typeof value.location !== 'string') return undefined;
  return { ...(identifier(value.fileId) ? { fileId: identifier(value.fileId) } : {}), filename: text(value.filename, 180).trim(), location: text(value.location, 500).trim(), ...(typeof value.truncated === 'boolean' ? { truncated: value.truncated } : {}) };
}
function sanitizeArchiveMember(value: unknown): ArchiveMemberReference | undefined {
  if (!isRecord(value) || typeof value.path !== 'string' || typeof value.type !== 'string' || typeof value.compressedSize !== 'number' || typeof value.uncompressedSize !== 'number' || typeof value.validation !== 'string' || typeof value.extraction !== 'string' || typeof value.analysisEligible !== 'boolean') return undefined;
  return { path: text(value.path, 500).trim(), type: text(value.type, 80).trim(), compressedSize: Math.max(0, Math.floor(value.compressedSize)), uncompressedSize: Math.max(0, Math.floor(value.uncompressedSize)), validation: text(value.validation, 80).trim(), extraction: text(value.extraction, 80).trim(), analysisEligible: value.analysisEligible, ...(text(value.reason, 350) ? { reason: text(value.reason, 350) } : {}), ...(typeof value.redacted === 'boolean' ? { redacted: value.redacted } : {}) };
}
function sanitizeArchive(value: unknown): ArchiveReference | undefined {
  if (!isRecord(value) || typeof value.inspectedAt !== 'string' || typeof value.partial !== 'boolean' || !Array.isArray(value.members)) return undefined;
  const summary = isRecord(value.summary) ? value.summary : undefined; if (!summary) return undefined;
  const summaryKeys = ['totalEntries', 'validatedEntries', 'successfullyExtracted', 'analyzedFiles', 'unsupportedFiles', 'rejectedFiles', 'excludedFiles', 'nestedArchives', 'omittedFiles'] as const;
  if (summaryKeys.filter(key => key !== 'omittedFiles').some(key => typeof summary[key] !== 'number' || !Number.isFinite(summary[key]))) return undefined;
  const members = value.members.map(sanitizeArchiveMember).filter((item): item is ArchiveMemberReference => Boolean(item)).slice(0, 100);
  const safeSummary = Object.fromEntries(summaryKeys.filter(key => key !== 'omittedFiles').map(key => [key, Math.max(0, Math.floor(summary[key] as number))])) as ArchiveReference['summary']; if (typeof summary.omittedFiles === 'number' && Number.isFinite(summary.omittedFiles)) safeSummary.omittedFiles = Math.max(0, Math.floor(summary.omittedFiles));
  return { inspectedAt: date(value.inspectedAt, now()), partial: value.partial, ...(typeof value.inspectionAvailable === 'boolean' ? { inspectionAvailable: value.inspectionAvailable } : {}), ...(typeof value.contentAnalysisAvailable === 'boolean' ? { contentAnalysisAvailable: value.contentAnalysisAvailable } : {}), ...(value.processingStatus === 'ready' || value.processingStatus === 'partial' || value.processingStatus === 'manifest-only' || value.processingStatus === 'failed' || value.processingStatus === 'cancelled' ? { processingStatus: value.processingStatus } : {}), summary: safeSummary, members };
}
function sanitizeAttachment(value: unknown): AttachmentReference | undefined {
  if (!isRecord(value) || !identifier(value.localId) || typeof value.filename !== 'string' || typeof value.type !== 'string' || typeof value.size !== 'number' || !Number.isFinite(value.size) || typeof value.state !== 'string') return undefined;
  const states = new Set(['selected', 'validating', 'uploading', 'processing', 'inspecting', 'extracting', 'ready', 'partial', 'manifest-only', 'analyzing', 'complete', 'cancelled', 'expired', 'failed', 'unavailable']); if (!states.has(value.state)) return undefined;
  const sources = Array.isArray(value.sources) ? value.sources.map(sanitizeSource).filter((item): item is SourceReference => Boolean(item)) : [];
  return { localId: identifier(value.localId)!, ...(identifier(value.fileId) ? { fileId: identifier(value.fileId) } : {}), filename: text(value.filename, 180).trim(), type: text(value.type, 120).trim(), size: Math.max(0, Math.floor(value.size)), state: value.state as AttachmentReference['state'], ...(text(value.error, 500) ? { error: text(value.error, 500) } : {}), ...(Array.isArray(value.notices) ? { notices: value.notices.filter((item): item is string => typeof item === 'string').slice(0, 10).map(item => item.slice(0, 300)) } : {}), ...(sources.length ? { sources } : {}), ...(typeof value.analysisAvailable === 'boolean' ? { analysisAvailable: value.analysisAvailable } : {}), ...(sanitizeArchive(value.archive) ? { archive: sanitizeArchive(value.archive) } : {}) };
}
function sanitizeMessage(value: unknown): Message | undefined {
  if (!isRecord(value)) return undefined;
  const id = identifier(value.id); const role = typeof value.role === 'string' && validRoles.has(value.role) ? value.role as Message['role'] : undefined;
  if (!id || !role || typeof value.content !== 'string' || value.content.length > MAX_MESSAGE) return undefined;
  const rawStatus = typeof value.status === 'string' && validStatuses.has(value.status) ? value.status as NonNullable<Message['status']> : 'complete';
  // A browser reload cannot resume an in-flight HTTP request. Persist it as an honest retryable failure.
  const interrupted = rawStatus === 'sending';
  return {
    id, role, content: value.content, createdAt: date(value.createdAt, now()),
    status: interrupted ? 'error' : rawStatus,
    ...(interrupted ? { error: 'Generation was interrupted before completion. Retry the request.' } : text(value.error, 500) ? { error: text(value.error, 500) } : {}),
    ...(value.feedback === 'positive' || value.feedback === 'negative' ? { feedback: value.feedback } : {}),
    ...(Array.isArray(value.attachments) ? { attachments: value.attachments.map(sanitizeAttachment).filter((item): item is AttachmentReference => Boolean(item)).slice(0, 3) } : {}),
    ...(Array.isArray(value.sources) ? { sources: value.sources.map(sanitizeSource).filter((item): item is SourceReference => Boolean(item)).slice(0, 3) } : {}),
    ...(typeof value.analysisTruncated === 'boolean' ? { analysisTruncated: value.analysisTruncated } : {}),
  };
}

function sanitizeConversation(value: unknown): Conversation | undefined {
  if (!isRecord(value)) return undefined;
  const id = identifier(value.id); if (!id) return undefined;
  const messages = Array.isArray(value.messages) ? value.messages.map(sanitizeMessage).filter((item): item is Message => Boolean(item)).slice(-500) : [];
  return {
    id,
    title: text(value.title, 200, 'New conversation').trim() || 'New conversation',
    createdAt: date(value.createdAt, now()),
    updatedAt: date(value.updatedAt, now()),
    messages,
    ...(identifier(value.agentId) ? { agentId: identifier(value.agentId) } : {}),
    model: text(value.model, 100, 'Qwen3-8B') || 'Qwen3-8B',
    favorite: bool(value.favorite),
    pinned: bool(value.pinned),
    archived: bool(value.archived),
  };
}

function sanitizeInstructions(value: unknown): AgentInstructions {
  const source = isRecord(value) ? value : {};
  return {
    role: text(source.role, MAX_INSTRUCTION_FIELD), objectives: text(source.objectives, MAX_INSTRUCTION_FIELD), tone: text(source.tone, MAX_INSTRUCTION_FIELD), responseStyle: text(source.responseStyle, MAX_INSTRUCTION_FIELD), outputFormat: text(source.outputFormat, MAX_INSTRUCTION_FIELD), constraints: text(source.constraints, MAX_INSTRUCTION_FIELD), clarificationBehavior: text(source.clarificationBehavior, MAX_INSTRUCTION_FIELD), uncertaintyHandling: text(source.uncertaintyHandling, MAX_INSTRUCTION_FIELD), safetyBehavior: text(source.safetyBehavior, MAX_INSTRUCTION_FIELD),
  };
}
function uniqueStrings(value: unknown, maxLength: number, maxCount: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) if (typeof item === 'string' && item.trim() && item.length <= maxLength) seen.add(item);
  return [...seen].slice(0, maxCount);
}
function sanitizeAgent(value: unknown): Agent | undefined {
  if (!isRecord(value)) return undefined;
  const id = identifier(value.id); if (!id) return undefined;
  return {
    id,
    name: text(value.name, 70).trim(), description: text(value.description, 180).trim(), purpose: text(value.purpose, 1200).trim(),
    icon: text(value.icon, 8, '✦') || '✦', accent: /^#[0-9a-fA-F]{6}$/.test(text(value.accent, 7)) ? text(value.accent, 7) : '#0f766e', category: text(value.category, 40, 'General').trim() || 'General',
    examplePrompts: uniqueStrings(value.examplePrompts, 280, 5), instructions: sanitizeInstructions(value.instructions),
    maxNewTokens: Number.isInteger(value.maxNewTokens) && Number(value.maxNewTokens) >= 32 && Number(value.maxNewTokens) <= 4096 ? Number(value.maxNewTokens) : 768,
    capabilityIds: uniqueStrings(value.capabilityIds, 80, 16).filter(id => capabilityRegistry.some(capability => capability.id === id && capability.implemented)), status: value.status === 'draft' ? 'draft' : 'local-ready', favorite: bool(value.favorite),
    createdAt: date(value.createdAt, now()), updatedAt: date(value.updatedAt, now()), ...(date(value.lastUsedAt, '') ? { lastUsedAt: date(value.lastUsedAt, '') } : {}),
  };
}
function sanitizePreferences(value: unknown): Preferences {
  const source = isRecord(value) ? value : {};
  return {
    theme: typeof source.theme === 'string' && validThemes.has(source.theme) ? source.theme as Preferences['theme'] : defaultPreferences.theme,
    density: typeof source.density === 'string' && validDensities.has(source.density) ? source.density as Preferences['density'] : defaultPreferences.density,
    enterToSend: bool(source.enterToSend, defaultPreferences.enterToSend),
    defaultView: typeof source.defaultView === 'string' && validViews.has(source.defaultView) ? source.defaultView as Preferences['defaultView'] : defaultPreferences.defaultView,
    reduceMotion: bool(source.reduceMotion, defaultPreferences.reduceMotion), language: text(source.language, 40, defaultPreferences.language) || defaultPreferences.language, codeWrap: bool(source.codeWrap, defaultPreferences.codeWrap),
  };
}
function sanitizeDrafts(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const output: Record<string, string> = {};
  for (const [key, draft] of Object.entries(value)) if (key.length <= 300 && typeof draft === 'string' && draft.length <= MAX_DRAFT) output[key] = draft;
  return output;
}
function dedupeById<T extends { id: string }>(items: T[]): T[] { const seen = new Set<string>(); return items.filter(item => !seen.has(item.id) && (seen.add(item.id), true)); }

function migrate(raw: Record<string, unknown>): LoadedWorkspace {
  const timestamp = now();
  const rawVersion = raw.version;
  if (rawVersion !== undefined && rawVersion !== 1 && rawVersion !== 2) return { state: emptyState(), warning: 'Stored workspace data uses an unsupported version and was safely reset.' };
  const conversations = dedupeById(Array.isArray(raw.conversations) ? raw.conversations.map(sanitizeConversation).filter((item): item is Conversation => Boolean(item)) : []);
  const agents = dedupeById(Array.isArray(raw.agents) ? raw.agents.map(sanitizeAgent).filter((item): item is Agent => Boolean(item)) : []);
  const state: StorageState = {
    version: 2,
    revision: Number.isSafeInteger(raw.revision) && Number(raw.revision) >= 0 ? Number(raw.revision) : 0,
    updatedAt: date(raw.updatedAt, timestamp), conversations, agents, preferences: sanitizePreferences(raw.preferences), drafts: sanitizeDrafts(raw.drafts),
  };
  return { state, ...(rawVersion === 1 || rawVersion === undefined ? { warning: 'Local workspace data was migrated to the current format.' } : {}) };
}

export function parseWorkspace(raw: string | null): LoadedWorkspace {
  if (!raw) return { state: emptyState() };
  try { const parsed: unknown = JSON.parse(raw); return isRecord(parsed) ? migrate(parsed) : { state: emptyState(), warning: 'Stored workspace data was invalid and was safely reset.' }; }
  catch { return { state: emptyState(), warning: 'Stored workspace data could not be read and was safely reset.' }; }
}
export function loadWorkspace(): LoadedWorkspace {
  try { return parseWorkspace(localStorage.getItem(KEY)); }
  catch { return { state: emptyState(), warning: 'Browser storage is unavailable. Changes will only last for this session.' }; }
}
/** Legacy convenience export for existing callers. */
export const loadState = (): StorageState => loadWorkspace().state;
export function newerState(left: StorageState, right: StorageState): StorageState { return left.revision > right.revision || left.revision === right.revision && left.updatedAt > right.updatedAt ? left : right; }
export function saveState(state: StorageState): StorageResult {
  try { localStorage.setItem(KEY, JSON.stringify(state)); return { ok: true }; }
  catch { return { ok: false, error: 'Local storage could not save this change. Keep this tab open and free browser storage before continuing.' }; }
}
export function clearWorkspace(): StorageResult {
  try { localStorage.removeItem(KEY); return { ok: true }; }
  catch { return { ok: false, error: 'Local storage could not be cleared. Check your browser storage settings and try again.' }; }
}
export function readStoredWorkspace(): StorageState { return loadWorkspace().state; }
export const storageKey = KEY;

export function downloadExport(state: StorageState): void {
  const blob = new Blob([JSON.stringify({ exportedAt: now(), schemaVersion: state.version, data: state }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `voicechatglm-local-export-${new Date().toISOString().slice(0, 10)}.json`; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(link.href);
}
export function downloadAgentExport(agents: Agent[]): void {
  const blob = new Blob([JSON.stringify({ exportedAt: now(), kind: 'voicechatglm-local-agents', agents }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `voicechatglm-agent-export-${new Date().toISOString().slice(0, 10)}.json`; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(link.href);
}
