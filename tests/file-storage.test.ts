import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { DEFAULTS } = require('../server/files/policy.cjs') as { DEFAULTS: Record<string, number> };
const { store, getOwned, removeOwned, prune, resetForTests } = require('../server/files/storage.cjs') as { store: (owner: string, uploads: any[], policy: Record<string, number>) => Array<{ id: string }>; getOwned: (owner: string, id: string) => unknown; removeOwned: (owner: string, id: string) => boolean; prune: () => void; resetForTests: () => void };
afterEach(() => { vi.useRealTimers(); resetForTests(); });

describe('temporary file staging ownership and cleanup', () => {
  it('isolates owner-scoped records, invalidates deletion, and prunes expired records', () => {
    vi.useFakeTimers(); const uploaded = store('dev-session:owner-a', [{ filename: 'facts.txt', type: 'text', buffer: Buffer.from('facts'), extraction: { text: 'facts', analysisAvailable: true, notices: [], sources: [{ filename: 'facts.txt', location: 'text document' }], truncated: false } }], { ...DEFAULTS, retentionMs: 60_000 })[0];
    expect(getOwned('dev-session:owner-a', uploaded.id)).toBeDefined(); expect(getOwned('dev-session:owner-b', uploaded.id)).toBeUndefined(); expect(removeOwned('dev-session:owner-b', uploaded.id)).toBe(false); expect(removeOwned('dev-session:owner-a', uploaded.id)).toBe(true); expect(getOwned('dev-session:owner-a', uploaded.id)).toBeUndefined();
    const expiring = store('dev-session:owner-a', [{ filename: 'later.txt', type: 'text', buffer: Buffer.from('later'), extraction: { text: 'later', analysisAvailable: true, notices: [], sources: [], truncated: false } }], { ...DEFAULTS, retentionMs: 60_000 })[0]; vi.advanceTimersByTime(60_001); prune(); expect(getOwned('dev-session:owner-a', expiring.id)).toBeUndefined();
  });
});
