import { useMemo, useState } from 'react';
import { Button, Dialog, Icon } from '../../components/ui';
import type { Conversation } from '../../types/domain';
import { ApiError, createConversationShare, previewConversationShare, type ConversationShareScope, type ShareLink, type SharePreview } from '../../services/api/client';

const EXPIRATIONS = [
  { hours: 1 as const, label: '1 hour' },
  { hours: 24 as const, label: '24 hours' },
  { hours: 168 as const, label: '7 days' },
  { hours: 720 as const, label: '30 days' },
];

interface Props {
  conversation: Conversation;
  onClose: () => void;
  onPublished: (result: { share: ShareLink; messageCount: number; expiration: string }) => void;
}

export function ConversationShareDialog({ conversation, onClose, onPublished }: Props) {
  const eligible = useMemo(() => conversation.messages.filter(message => message.role === 'user' || message.role === 'assistant'), [conversation.messages]);
  const [scope, setScope] = useState<ConversationShareScope>('selected');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expiresInHours, setExpiresInHours] = useState<1 | 24 | 168 | 720>(24);
  const [preview, setPreview] = useState<SharePreview>();
  const [reviewing, setReviewing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string>();
  const [published, setPublished] = useState<{ url: string; messageCount: number; expiration: string }>();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const selected = new Set(selectedIds);
  const invalidatePreview = () => { setPreview(undefined); setError(undefined); };
  const setShareScope = (value: ConversationShareScope) => { setScope(value); invalidatePreview(); };
  const toggleMessage = (id: string) => { setSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]); invalidatePreview(); };
  const previewInput = (offset = 0) => ({ conversationId: conversation.id, scope, ...(scope === 'selected' ? { selectedMessageIds: selectedIds } : {}), expiresInHours, ...(preview?.shareVersion !== undefined ? { expectedShareVersion: preview.shareVersion } : {}), offset, pageSize: 50 } as const);
  const review = async (offset = 0) => {
    if (scope === 'selected' && !selectedIds.length) { setError('Select at least one user or assistant message before reviewing a selected-content link.'); return; }
    setReviewing(true); setError(undefined);
    try { setPreview(await previewConversationShare(previewInput(offset))); }
    catch (caught) { setPreview(undefined); setError(caught instanceof ApiError ? caught.message : 'The share preview could not be loaded.'); }
    finally { setReviewing(false); }
  };
  const publish = async () => {
    if (!preview || preview.shareVersion === undefined || !preview.previewDigest) return;
    setPublishing(true); setError(undefined);
    try {
      const result = await createConversationShare({ conversationId: conversation.id, scope, ...(scope === 'selected' ? { selectedMessageIds: selectedIds } : {}), expiresInHours, expectedShareVersion: preview.shareVersion, expectedPreviewDigest: preview.previewDigest });
      const url = `${window.location.origin}/share/${result.token}`;
      setPublished({ url, messageCount: result.messageCount, expiration: result.expiration.label });
      onPublished({ share: result.share, messageCount: result.messageCount, expiration: result.expiration.label });
    } catch (caught) {
      setPreview(undefined);
      setError(caught instanceof ApiError ? caught.message : 'The share link could not be published.');
    } finally { setPublishing(false); }
  };
  const copyPublishedLink = async () => {
    if (!published) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(published.url);
      setCopyState('copied');
    } catch { setCopyState('failed'); }
  };
  if (published) return <Dialog title="Share link published" onClose={onClose} labelledBy="conversation-share-title">
    <p role="status">The read-only link was saved for {published.messageCount} message{published.messageCount === 1 ? '' : 's'} and expires in {published.expiration}.</p>
    <label className="share-expiration-label">Share link<input aria-label="Published share link" readOnly value={published.url} onFocus={event => event.currentTarget.select()} /></label>
    <p className="section-help">Anyone with this bearer link can read only the reviewed snapshot until it expires or you revoke it. Attachments and private account data are not included.</p>
    {copyState === 'copied' ? <p role="status">Link copied to the clipboard.</p> : null}
    {copyState === 'failed' ? <p className="field-error" role="alert">Clipboard access was unavailable. Select and copy the link manually.</p> : null}
    <div className="dialog-actions"><Button variant="secondary" onClick={() => void copyPublishedLink()}><Icon name="copy" /> Copy link</Button><Button onClick={onClose}>Done</Button></div>
  </Dialog>;
  const first = (preview?.offset || 0) + 1;
  const last = preview ? (preview.offset || 0) + preview.messages.length : 0;
  return <Dialog title="Review conversation share" onClose={onClose} labelledBy="conversation-share-title">
    <p className="section-help">Choose exactly what can be read, review the permitted text, and set when access ends. Anyone who obtains the link can read only this published scope until it expires or you revoke it.</p>
    <section className="share-review-section">
      <h3>Conversation</h3><p><strong>{conversation.title}</strong></p>
      <fieldset className="share-scope-options"><legend>Share type</legend>
        <label><input type="radio" name="share-scope" checked={scope === 'selected'} onChange={() => setShareScope('selected')} /> Selected content</label>
        <label><input type="radio" name="share-scope" checked={scope === 'full'} onChange={() => setShareScope('full')} /> Full eligible conversation</label>
      </fieldset>
      {scope === 'selected' ? <div className="share-message-picker" aria-label="Eligible messages to share">{eligible.map((message, index) => <label key={message.id}><input type="checkbox" checked={selected.has(message.id)} onChange={() => toggleMessage(message.id)} /> <span><strong>{index + 1}. {message.role === 'user' ? 'You' : 'VoiceChatGLM'}</strong><small>{message.content.replace(/\s+/g, ' ').slice(0, 180) || '(empty message)'}</small></span></label>)}</div> : <p>All eligible user and assistant messages, in their original order, will be included. System messages, tool state, hidden reasoning and internal metadata are excluded.</p>}
    </section>
    <section className="share-review-section">
      <h3>Expiration</h3>
      <label className="share-expiration-label">This link expires <select aria-label="Share expiration" value={expiresInHours} onChange={event => { setExpiresInHours(Number(event.target.value) as 1 | 24 | 168 | 720); invalidatePreview(); }}>{EXPIRATIONS.map(option => <option key={option.hours} value={option.hours}>{option.label}</option>)}</select> after publication.</label>
      <p className="section-help">Permanent links are not offered. Expired or revoked links return an unavailable response even before scheduled cleanup runs.</p>
    </section>
    <section className="share-review-section share-privacy-summary"><h3>Attachments and private data</h3><p><strong>Attachments accessible: none.</strong> Uploaded files, generated artifacts, memory, knowledge sources, system prompts, tool payloads, credentials and internal debugging data are never included in this share.</p></section>
    <div className="dialog-actions"><Button variant="secondary" onClick={() => void review(0)} disabled={reviewing || publishing}>{reviewing ? 'Loading preview…' : 'Preview exact content'}</Button></div>
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    {preview ? <section className="share-preview" aria-label="Exact content preview"><h3>Published content preview</h3><p><strong>{preview.messageCount}</strong> message{preview.messageCount === 1 ? '' : 's'} will be included. Showing {first}–{last}.</p><div className="share-preview-messages">{preview.messages.map((message, index) => <article key={message.id}><strong>{(preview.offset || 0) + index + 1}. {message.role === 'user' ? 'You' : 'VoiceChatGLM'}</strong><time>{new Date(message.createdAt).toLocaleString()}</time><p>{message.content}</p></article>)}</div>{preview.messageCount > preview.messages.length ? <div className="share-preview-pagination"><Button variant="ghost" disabled={!preview.offset || reviewing} onClick={() => void review(Math.max(0, (preview.offset || 0) - 50))}>Previous messages</Button><Button variant="ghost" disabled={preview.nextOffset === undefined || reviewing} onClick={() => void review(preview.nextOffset || 0)}>Next messages</Button></div> : null}<p className="section-help">The published link is an immutable snapshot of this reviewed conversation version. If the conversation changes before publication, creation is stopped and you must review it again.</p></section> : null}
    <div className="dialog-actions"><Button variant="ghost" onClick={onClose} disabled={publishing}>Cancel</Button><Button onClick={() => void publish()} disabled={!preview?.previewDigest || publishing}>{publishing ? 'Publishing…' : <><Icon name="external" /> Confirm & publish link</>}</Button></div>
  </Dialog>;
}
