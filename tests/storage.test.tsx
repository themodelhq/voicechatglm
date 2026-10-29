import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceProvider, useWorkspace } from '../src/app/WorkspaceContext';
import { emptyState, loadState, parseWorkspace, saveState, storageKey } from '../src/services/storage/localStore';

function Probe() {
  const { state, clearLocalData } = useWorkspace();
  return <><span data-testid="revision">{state.revision}</span><span data-testid="title">{state.conversations[0]?.title ?? 'none'}</span><button onClick={() => clearLocalData()}>Clear</button></>;
}

describe('local workspace storage', () => {
  it('returns safe defaults for malformed stored data', () => {
    localStorage.setItem(storageKey, '{not json');
    const state = loadState();
    expect(state.conversations).toEqual([]);
    expect(state.preferences.theme).toBe('system');
    expect(state.version).toBe(2);
  });
  it('migrates valid v1 records while preserving an agent conversation association', () => {
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, conversations: [{ id: 'chat-1', title: 'Research', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', messages: [], agentId: 'agent-1', model: 'Qwen3-8B', favorite: false, archived: false }], agents: [], preferences: {}, drafts: {} }));
    const loaded = parseWorkspace(localStorage.getItem(storageKey));
    expect(loaded.state.version).toBe(2);
    expect(loaded.state.conversations[0].agentId).toBe('agent-1');
    expect(loaded.state.conversations[0].pinned).toBe(false);
    expect(loaded.warning).toMatch(/migrated/);
  });
  it('filters invalid records and converts interrupted messages into retryable failures', () => {
    const parsed = parseWorkspace(JSON.stringify({ version: 2, revision: 4, updatedAt: '2026-01-01T00:00:00.000Z', conversations: [{ id: 'good', title: 'Good', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', messages: [{ id: 'pending', role: 'assistant', content: '', createdAt: '2026-01-01T00:00:00.000Z', status: 'sending' }, { id: 3 }], model: 'Qwen3-8B', favorite: 'no', pinned: false, archived: false }, { id: 4 }], agents: [{ id: 7 }], preferences: { theme: 'unknown' }, drafts: { ok: 'draft', bad: 3 } }));
    expect(parsed.state.conversations).toHaveLength(1);
    expect(parsed.state.conversations[0].messages[0]).toMatchObject({ status: 'error', error: expect.stringMatching(/interrupted/) });
    expect(parsed.state.agents).toEqual([]);
    expect(parsed.state.preferences.theme).toBe('system');
    expect(parsed.state.drafts).toEqual({ ok: 'draft' });
  });
  it('reports a local storage write failure', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    expect(saveState(emptyState())).toMatchObject({ ok: false, error: expect.stringMatching(/could not save/) });
    spy.mockRestore();
  });
  it('accepts a newer cross-tab storage event and clear writes an empty workspace', async () => {
    const user = userEvent.setup();
    render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    const incoming = { ...emptyState(), revision: 9, updatedAt: '2026-10-10T10:00:00.000Z', conversations: [{ id: 'remote-chat', title: 'From another tab', createdAt: '2026-10-10T10:00:00.000Z', updatedAt: '2026-10-10T10:00:00.000Z', messages: [], model: 'Qwen3-8B', favorite: false, pinned: false, archived: false }] };
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: storageKey, newValue: JSON.stringify(incoming) })); });
    expect(await screen.findByTestId('title')).toHaveTextContent('From another tab');
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByTestId('title')).toHaveTextContent('none');
    expect(loadState().conversations).toEqual([]);
  });
});
