import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationShareDialog } from '../src/features/chat/ConversationShareDialog';

const api = vi.hoisted(() => ({ previewConversationShare: vi.fn(), createConversationShare: vi.fn() }));
vi.mock('../src/services/api/client', async importActual => ({ ...(await importActual<typeof import('../src/services/api/client')>()), ...api }));

const conversation = { id: '00000000-0000-4000-8000-000000000101', title: 'Release discussion', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', model: 'Qwen3-8B', favorite: false, pinned: false, archived: false, messages: [{ id: '00000000-0000-4000-8000-000000000102', role: 'user' as const, content: 'Publish this update.', createdAt: '2026-01-01T00:00:00.000Z', status: 'complete' as const }, { id: '00000000-0000-4000-8000-000000000103', role: 'assistant' as const, content: 'Here is the public response.', createdAt: '2026-01-01T00:01:00.000Z', status: 'complete' as const }] };

describe('explicit finite share publication dialog', () => {
  it('requires a selected scope/expiry preview and only publishes after confirmation', async () => {
    api.previewConversationShare.mockResolvedValue({ conversationId: conversation.id, title: conversation.title, scope: 'selected', shareVersion: 7, previewDigest: 'a'.repeat(64), messageCount: 1, offset: 0, messages: [{ id: conversation.messages[0].id, role: 'user', content: conversation.messages[0].content, createdAt: conversation.messages[0].createdAt }], expiration: { hours: 24, label: '24 hours' }, attachments: { included: 0, policy: 'None' }, artifactPolicy: 'None' });
    api.createConversationShare.mockResolvedValue({ share: { id: '00000000-0000-4000-8000-000000000104', conversationId: conversation.id, scope: 'selected', messageCount: 1, expiresAt: '2026-01-02T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', accessCount: 0 }, token: 'A'.repeat(43), path: `/api/share/${'A'.repeat(43)}`, messageCount: 1, expiration: { hours: 24, label: '24 hours', expiresAt: '2026-01-02T00:00:00.000Z' } });
    const publish = vi.fn(); const user = userEvent.setup(); render(<ConversationShareDialog conversation={conversation} onClose={vi.fn()} onPublished={publish} />);
    expect(screen.getByText(/Anyone who obtains the link/i)).toBeInTheDocument(); expect(screen.getByText(/Attachments accessible: none/i)).toBeInTheDocument(); expect(screen.getByRole('button', { name: /Confirm & publish link/i })).toBeDisabled();
    await user.click(screen.getAllByRole('checkbox')[0]); await user.selectOptions(screen.getByLabelText('Share expiration'), '24'); await user.click(screen.getByRole('button', { name: 'Preview exact content' }));
    expect(api.previewConversationShare).toHaveBeenCalledWith(expect.objectContaining({ scope: 'selected', selectedMessageIds: [conversation.messages[0].id], expiresInHours: 24, offset: 0 })); expect(await screen.findByText('Published content preview')).toBeInTheDocument(); expect(screen.getByLabelText('Exact content preview').textContent).toContain('1 message will be included');
    await user.click(screen.getByRole('button', { name: /Confirm & publish link/i })); expect(api.createConversationShare).toHaveBeenCalledWith(expect.objectContaining({ expiresInHours: 24, expectedShareVersion: 7, expectedPreviewDigest: 'a'.repeat(64), selectedMessageIds: [conversation.messages[0].id] })); expect(publish).toHaveBeenCalledWith(expect.objectContaining({ messageCount: 1, expiration: '24 hours' })); expect(await screen.findByText('Share link published')).toBeInTheDocument(); expect(screen.getByRole('button', { name: /Copy link/i })).toBeEnabled(); expect((screen.getByLabelText('Published share link') as HTMLInputElement).value).toContain('/share/');
  });
});
