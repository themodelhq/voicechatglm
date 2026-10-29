import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { WorkspaceProvider } from '../src/app/WorkspaceContext';
import { emptyState, loadState, saveState } from '../src/services/storage/localStore';
import type { Agent, Conversation } from '../src/types/domain';

const mocks = vi.hoisted(() => ({ sendChat: vi.fn(), checkStatus: vi.fn(), uploadFiles: vi.fn(), analyzeFiles: vi.fn(), deleteFile: vi.fn() }));
vi.mock('../src/services/api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/services/api/client')>();
  return { ...actual, sendChat: mocks.sendChat, checkStatus: mocks.checkStatus, uploadFiles: mocks.uploadFiles, analyzeFiles: mocks.analyzeFiles, deleteFile: mocks.deleteFile };
});

const agent: Agent = { id: 'research-agent', name: 'Research guide', description: 'A focused research assistant.', purpose: 'Help plan and assess research questions.', icon: 'R', accent: '#0f766e', category: 'Research', examplePrompts: [], instructions: { role: 'Research guide', objectives: 'Assess evidence', tone: 'Clear', responseStyle: 'Structured', outputFormat: 'Bullets', constraints: 'Do not invent sources', clarificationBehavior: 'Ask when needed', uncertaintyHandling: 'State uncertainty', safetyBehavior: 'Follow safety rules' }, maxNewTokens: 444, capabilityIds: ['chat'], status: 'local-ready', favorite: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const existingConversation: Conversation = { id: 'agent-chat-1', title: 'Evidence review', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', messages: [], agentId: agent.id, model: 'Qwen3-8B', favorite: false, pinned: false, archived: false };

function seed(conversations: Conversation[] = [], agents: Agent[] = [agent]) { const state = emptyState(); state.agents = agents; state.conversations = conversations; expect(saveState(state).ok).toBe(true); }
function renderApp(path: string) { window.history.replaceState({}, '', path); return render(<WorkspaceProvider><App /></WorkspaceProvider>); }

describe('chat route and agent continuity', () => {
  beforeEach(() => { mocks.checkStatus.mockResolvedValue({ ok: true }); mocks.sendChat.mockResolvedValue({ text: 'Verified model response' }); mocks.uploadFiles.mockResolvedValue([]); mocks.analyzeFiles.mockResolvedValue({ response: 'Grounded document answer', sources: [], truncated: false, retention: 'deleted' }); mocks.deleteFile.mockResolvedValue(undefined); });
  afterEach(() => { vi.clearAllMocks(); window.history.replaceState({}, '', '/'); });

  it('stores the selected agent on the first conversation and keeps its instructions after route changes', async () => {
    seed(); const user = userEvent.setup(); const firstView = renderApp(`/agents/${agent.id}/chat`);
    await user.type(screen.getByRole('textbox', { name: 'Message VoiceChatGLM' }), 'Start research');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(mocks.sendChat).toHaveBeenCalledTimes(1));
    const created = loadState().conversations[0];
    expect(created.agentId).toBe(agent.id);
    expect(window.location.pathname).toBe(`/chat/${created.id}`);
    expect(mocks.sendChat).toHaveBeenLastCalledWith(expect.objectContaining({ conversation_id: created.id, max_new_tokens: 444, system_prompt: expect.stringContaining('Role: Research guide') }), expect.any(AbortSignal));
    // This is the same durable state a direct load/sidebar selection resolves from.
    firstView.unmount();
    window.history.replaceState({}, '', `/chat/${created.id}`);
    render(<WorkspaceProvider><App /></WorkspaceProvider>);
    expect(await screen.findByRole('heading', { name: 'Research guide' })).toBeInTheDocument();
  });

  it('uses the persisted conversation agent after direct navigation and sends the same stable conversation ID', async () => {
    seed([existingConversation]); const user = userEvent.setup(); renderApp(`/chat/${existingConversation.id}`);
    expect(await screen.findByRole('heading', { name: 'Research guide' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Message VoiceChatGLM' }), 'Continue the analysis');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(mocks.sendChat).toHaveBeenCalledTimes(1));
    expect(mocks.sendChat).toHaveBeenCalledWith(expect.objectContaining({ conversation_id: existingConversation.id, max_new_tokens: 444, system_prompt: expect.stringContaining('Objectives: Assess evidence') }), expect.any(AbortSignal));
  });

  it('shows a safe not-found state for an invalid conversation route and does not send against it', async () => {
    seed(); const user = userEvent.setup(); renderApp('/chat/stale-or-deleted');
    expect(await screen.findByRole('heading', { name: 'Conversation not found' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message VoiceChatGLM' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Start a new chat/ }));
    expect(window.location.pathname).toBe('/');
    expect(mocks.sendChat).not.toHaveBeenCalled();
  });

  it('does not attach a conversation to a different agent when its original agent is deleted', async () => {
    seed([existingConversation], []); const user = userEvent.setup(); renderApp(`/chat/${existingConversation.id}`);
    expect(await screen.findByText(/linked to a deleted agent/i)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Message VoiceChatGLM' }), 'Continue without agent');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(mocks.sendChat).toHaveBeenCalledTimes(1));
    expect(mocks.sendChat).toHaveBeenCalledWith(expect.objectContaining({ conversation_id: existingConversation.id, max_new_tokens: 768 }), expect.any(AbortSignal));
    expect(mocks.sendChat.mock.calls[0][0]).not.toHaveProperty('system_prompt');
  });

  it('uploads selected document metadata, uses the separate analysis route, and never sends the file through chat', async () => {
    seed([], []); const user = userEvent.setup(); mocks.uploadFiles.mockResolvedValueOnce([{ id: 'file-123', filename: 'notes.txt', type: 'text', size: 5, state: 'ready', analysisAvailable: true, notices: [], sources: [{ location: 'text document' }], expiresAt: '2026-01-01T00:15:00.000Z' }]); mocks.analyzeFiles.mockResolvedValueOnce({ response: 'Grounded document answer', sources: [{ fileId: 'file-123', filename: 'notes.txt', location: 'text document', truncated: false }], truncated: false, retention: 'deleted' });
    renderApp('/'); await user.click(screen.getByRole('button', { name: 'Add to message' })); await user.click(screen.getByRole('menuitem', { name: /Add files/ }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement; await user.upload(input, new File(['facts'], 'notes.txt', { type: 'text/plain' }));
    await waitFor(() => expect(mocks.uploadFiles).toHaveBeenCalledTimes(1)); expect(await screen.findByText('notes.txt')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send message' })); await waitFor(() => expect(mocks.analyzeFiles).toHaveBeenCalledWith(['file-123'], 'Summarize the attached document(s).', expect.any(String), undefined, expect.any(AbortSignal), expect.objectContaining({ clientMessageId: expect.any(String), assistantMessageId: expect.any(String) }))); expect(mocks.sendChat).not.toHaveBeenCalled(); expect(await screen.findByText('Grounded document answer')).toBeInTheDocument(); expect(screen.getByText(/Sources used/)).toBeInTheDocument();
  });

  it('passes validated selected-agent instructions to the document analysis path', async () => {
    seed([], [agent]); const user = userEvent.setup(); mocks.uploadFiles.mockResolvedValueOnce([{ id: 'agent-file', filename: 'brief.txt', type: 'text', size: 5, state: 'ready', analysisAvailable: true, notices: [], sources: [{ location: 'text document' }], expiresAt: '2026-01-01T00:15:00.000Z' }]); mocks.analyzeFiles.mockResolvedValueOnce({ response: 'Agent-grounded response', sources: [], truncated: false, retention: 'deleted' });
    renderApp(`/agents/${agent.id}/chat`); await user.click(screen.getByRole('button', { name: 'Add to message' })); await user.click(screen.getByRole('menuitem', { name: /Add files/ })); const input = document.querySelector('input[type="file"]') as HTMLInputElement; await user.upload(input, new File(['brief'], 'brief.txt', { type: 'text/plain' })); await waitFor(() => expect(mocks.uploadFiles).toHaveBeenCalled()); await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(mocks.analyzeFiles).toHaveBeenCalledWith(['agent-file'], 'Summarize the attached document(s).', expect.any(String), expect.stringContaining('Role: Research guide'), expect.any(AbortSignal), expect.objectContaining({ clientMessageId: expect.any(String), assistantMessageId: expect.any(String) })));
  });

  it('accepts ZIP attachment previews and exposes the inspected manifest without pretending it was fully analyzed', async () => {
    seed([], []); const user = userEvent.setup(); mocks.uploadFiles.mockResolvedValueOnce([{ id: 'zip-file', filename: 'project.zip', type: 'zip', size: 20, state: 'ready', analysisAvailable: true, notices: ['Archive inspection and analysis are partial; review the archive manifest for excluded, unsupported, nested, or failed members.'], sources: [{ location: 'archive manifest' }], expiresAt: '2026-01-01T00:15:00.000Z', archive: { inspectedAt: '2026-01-01T00:00:00.000Z', partial: true, summary: { totalEntries: 2, validatedEntries: 2, successfullyExtracted: 1, analyzedFiles: 1, unsupportedFiles: 1, rejectedFiles: 0, excludedFiles: 0, nestedArchives: 0 }, members: [{ path: 'README.md', type: 'markdown', compressedSize: 2, uncompressedSize: 2, validation: 'accepted', extraction: 'extracted', analysisEligible: true }, { path: 'image.bin', type: 'unsupported', compressedSize: 2, uncompressedSize: 2, validation: 'unsupported', extraction: 'not-read', analysisEligible: false, reason: 'Unsupported archive member type.' }] } }]);
    renderApp('/'); await user.click(screen.getByRole('button', { name: 'Add to message' })); await user.click(screen.getByRole('menuitem', { name: /Add files/ })); const input = document.querySelector('input[type="file"]') as HTMLInputElement; await user.upload(input, new File(['zip'], 'project.zip', { type: 'application/zip' })); expect(await screen.findByText(/Archive inspected: 2 entries/)).toBeInTheDocument(); expect(screen.getByText('project.zip')).toBeInTheDocument();
  });

  it('aborts an in-flight model request when the chat workspace unmounts', async () => {
    const plain: Conversation = { ...existingConversation, id: 'abort-chat', agentId: undefined, title: 'Abort chat' }; seed([plain], []); const user = userEvent.setup(); let signal: AbortSignal | undefined; mocks.sendChat.mockImplementationOnce((_payload: unknown, requestSignal?: AbortSignal) => { signal = requestSignal; return new Promise(() => undefined); }); const view = renderApp(`/chat/${plain.id}`);
    await user.type(await screen.findByRole('textbox', { name: 'Message VoiceChatGLM' }), 'Cancel this request'); await user.click(screen.getByRole('button', { name: 'Send message' })); await waitFor(() => expect(mocks.sendChat).toHaveBeenCalledTimes(1)); expect(signal?.aborted).toBe(false); view.unmount(); expect(signal?.aborted).toBe(true);
  });
  it('prevents duplicate sends while a request is pending and renders a retry after failure', async () => {
    const plain: Conversation = { ...existingConversation, id: 'plain-chat', agentId: undefined, title: 'Plain chat' };
    seed([plain], []); const user = userEvent.setup();
    let resolveRequest: ((value: { text: string }) => void) | undefined;
    mocks.sendChat.mockImplementationOnce(() => new Promise(resolve => { resolveRequest = resolve; }));
    renderApp(`/chat/${plain.id}`);
    const composer = await screen.findByRole('textbox', { name: 'Message VoiceChatGLM' });
    await user.type(composer, 'Only send once');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(mocks.sendChat).toHaveBeenCalledTimes(1);
    resolveRequest?.({ text: 'Done' });
    expect(await screen.findByText('Done')).toBeInTheDocument();

    mocks.sendChat.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce({ text: 'Recovered' });
    await user.type(composer, 'This request fails');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Response unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByText('Recovered')).toBeInTheDocument();
    expect(mocks.sendChat).toHaveBeenCalledTimes(3);
  });
});
