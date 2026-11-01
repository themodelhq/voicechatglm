import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { SafeMarkdown } from '../../components/SafeMarkdown';
import { Button, Brand, EmptyState, Icon, StatusBadge } from '../../components/ui';
import { ConversationShareDialog } from './ConversationShareDialog';
import { useWorkspace } from '../../app/WorkspaceContext';
import type { Agent, ArtifactReference, AttachmentReference, Message } from '../../types/domain';
import { analyzeFiles, ApiError, artifactDownloadUrl, deleteFile, listConversationShares, resubmitConversationMessage, revokeConversationShare, sendChat, setConversationMessageFeedback, getScrapeJob, getArtifact, type ShareLink, uploadFiles } from '../../services/api/client';
import { formatTime, id, titleFromMessage } from '../../utils/format';

const MAX_MESSAGE_LENGTH = 12_000;
const MAX_FILE_QUESTION_LENGTH = 6_000;
const MAX_SYSTEM_PROMPT_LENGTH = 16_000;
const MAX_FILES = 3;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;
const acceptedExtensions = new Set(['pdf', 'docx', 'txt', 'md', 'markdown', 'csv', 'xlsx', 'pptx', 'json', 'zip', 'png', 'jpg', 'jpeg', 'webp']);
const prompts = ['Explain a complex topic simply', 'Help me structure a project plan', 'Review an idea with constructive questions'];
const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const extension = (name: string) => name.toLowerCase().split('.').pop() ?? '';

interface ChatWorkspaceProps { conversationId?: string; agent?: Agent; agentId?: string; conversationMissing: boolean; missingAgentId?: string; onSelectConversation: (id: string) => void; onNewChat: () => void; onRecoverMissingDraft: (draft: string) => void; onOpenAgents: () => void; }

export function ChatWorkspace({ conversationId, agent, agentId, conversationMissing, missingAgentId, onSelectConversation, onNewChat, onRecoverMissingDraft, onOpenAgents }: ChatWorkspaceProps) {
  const { state, connection, updateConversations, saveDraft } = useWorkspace();
  const conversation = state.conversations.find(item => item.id === conversationId);
  const draftKey = `chat:${conversationId ?? 'new'}:${agentId ?? 'default'}`;
  const [draft, setDraft] = useState(state.drafts[draftKey] ?? '');
  const [attachments, setAttachments] = useState<AttachmentReference[]>([]);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [composerError, setComposerError] = useState<string>();
  const [shareNotice, setShareNotice] = useState<string>();
  const [shareLinks, setShareLinks] = useState<ShareLink[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const uploads = useRef(new Map<string, AbortController>());
  const requests = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);
  const box = useRef<HTMLTextAreaElement>(null);
  const systemPrompt = useMemo(() => agent ? buildSystemPrompt(agent) : undefined, [agent]);

  useEffect(() => { setDraft(state.drafts[draftKey] ?? ''); setAttachments([]); setComposerError(undefined); }, [draftKey]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; uploads.current.forEach(controller => controller.abort()); requests.current.forEach(controller => controller.abort()); uploads.current.clear(); requests.current.clear(); }; }, []);
  useEffect(() => { box.current?.focus(); }, [conversationId, agentId]);
  useEffect(() => {
    const pendingJobs = (conversation?.messages || []).filter(message => message.scrapeJobId && !message.artifacts?.length && message.status !== 'error');
    if (!pendingJobs.length) return;
    let active = true, checking = false;
    const timer = window.setInterval(async () => {
      if (!active || checking) return; checking = true;
      try {
        for (const message of pendingJobs) {
          const job = await getScrapeJob(message.scrapeJobId!);
          if (!active) return;
          const progress = {
            status: job.status,
            phase: typeof job.progress?.phase === 'string' ? job.progress.phase : undefined,
            pagesVisited: job.pagesVisited,
            pagesDiscovered: job.pagesDiscovered,
            productsFound: job.productsFound,
            failedPages: job.failedPages,
            queuedButNotVisited: Number(job.progress?.queuedButNotVisited || 0),
            discoveryPagesVisited: Number(job.progress?.discoveryPagesVisited || 0),
            productPagesVisited: Number(job.progress?.productPagesVisited || 0),
            productUrlsDiscovered: Number(job.progress?.productUrlsDiscovered || 0),
            productUrlsRemaining: Number(job.progress?.productUrlsRemaining || 0),
            discoveryPagesRemaining: Number(job.progress?.discoveryPagesRemaining || 0),
            batchSize: Number(job.progress?.batchSize || 0)
          } as const;
          updateConversations(items => items.map(item => item.id !== conversationId ? item : { ...item, messages: item.messages.map(entry => entry.id !== message.id || JSON.stringify(entry.scrapeProgress) === JSON.stringify(progress) ? entry : { ...entry, scrapeProgress: progress }) }));
          if (job.status === 'completed' || job.status === 'partial') {
            if (job.artifactId) {
              const artifact = await getArtifact(job.artifactId); if (!active) return;
              updateConversations(items => items.map(item => item.id !== conversationId ? item : { ...item, messages: item.messages.map(entry => entry.id === message.id ? { ...entry, status: job.status === 'partial' ? 'partial' : 'complete', content: `Website crawl finished: ${job.productsFound} product record(s) extracted from ${job.pagesVisited} pages. The Excel workbook is ready.`, scrapeProgress: progress, artifacts: [artifact] } : entry) }));
            }
            window.clearInterval(timer); break;
          }
          if (job.status === 'failed') {
            updateConversations(items => items.map(item => item.id !== conversationId ? item : { ...item, messages: item.messages.map(entry => entry.id === message.id ? { ...entry, status: 'error', content: 'The background website crawl failed. Please retry the request.', scrapeProgress: progress } : entry) }));
            window.clearInterval(timer); break;
          }
        }
      } catch { /* Polling is best-effort; the durable job continues on the server. */ }
      finally { checking = false; }
    }, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [conversationId, conversation?.messages, updateConversations]);

  useEffect(() => { let active = true; if (!conversationId) { setShareLinks([]); return; } void listConversationShares(conversationId).then(links => { if (active) setShareLinks(links); }).catch(() => { if (active) setShareLinks([]); }); return () => { active = false; }; }, [conversationId]);
  const changeDraft = (value: string) => { setDraft(value); saveDraft(draftKey, value); };
  const patchConversation = (targetId: string, pendingId: string, update: (message: Message) => Message) => updateConversations(items => items.map(item => item.id !== targetId ? item : { ...item, updatedAt: new Date().toISOString(), messages: item.messages.map(message => message.id === pendingId ? update(message) : message) }));
  const finishAttachmentState = (targetId: string, stateName: AttachmentReference['state'], attachmentError?: string) => updateConversations(items => items.map(item => item.id !== targetId ? item : { ...item, messages: item.messages.map(message => message.role === 'user' && message.attachments?.some(attachment => attachment.state === 'analyzing') ? { ...message, attachments: message.attachments.map(attachment => ({ ...attachment, state: stateName, ...(attachmentError ? { error: attachmentError } : {}) })) } : message) }));
  const requestAssistant = async (targetId: string, message: string, pendingId: string, userMessageId: string, messageAttachments?: AttachmentReference[]) => {
    const controller = new AbortController(); requests.current.set(pendingId, controller);
    try {
      const fileIds = messageAttachments?.filter(attachment => attachment.fileId).map(attachment => attachment.fileId!) ?? [];
      if (fileIds.length) {
        const result = await analyzeFiles(fileIds, message, targetId, systemPrompt, controller.signal, { clientMessageId: userMessageId, assistantMessageId: pendingId });
        if (!mounted.current || controller.signal.aborted) return;
        patchConversation(targetId, pendingId, entry => ({ ...entry, ...(result.assistant_message_id ? { id: result.assistant_message_id } : {}), content: result.response, status: result.partial ? 'partial' : 'complete', error: undefined, sources: result.sources, analysisTruncated: result.truncated || Boolean(result.partial) }));
        finishAttachmentState(targetId, 'complete');
      } else {
        const result = await sendChat({ message, conversation_id: targetId, client_message_id: userMessageId, assistant_message_id: pendingId, idempotency_key: userMessageId, max_new_tokens: agent?.maxNewTokens ?? 768, ...(systemPrompt ? { system_prompt: systemPrompt } : {}) }, controller.signal);
        if (!mounted.current || controller.signal.aborted) return;
        patchConversation(targetId, pendingId, entry => ({ ...entry, ...(result.assistantMessageId ? { id: result.assistantMessageId } : {}), content: result.text, status: result.partial ? 'partial' : 'complete', error: undefined, ...(result.citations?.length ? { citations: result.citations } : {}), ...(result.toolEvents?.length ? { toolEvents: result.toolEvents } : {}), ...(result.route ? { route: result.route } : {}), ...(result.notices?.length ? { notices: result.notices } : {}), ...(result.artifacts?.length ? { artifacts: result.artifacts } : {}), ...(result.scrapeJobId ? { scrapeJobId: result.scrapeJobId } : {}), ...(result.partial ? { analysisTruncated: true } : {}) }));
      }
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return;
      const friendly = error instanceof ApiError ? error.message : 'The model request failed. Try again.';
      patchConversation(targetId, pendingId, entry => ({ ...entry, content: '', status: 'error', error: friendly }));
      if (messageAttachments?.length) { const expired = error instanceof ApiError && error.status === 404; finishAttachmentState(targetId, expired ? 'failed' : 'ready', expired ? 'The staged attachment expired or was deleted. Attach it again to retry.' : undefined); if (expired) setAttachments(current => current.map(attachment => messageAttachments.some(sent => sent.fileId && sent.fileId === attachment.fileId) ? { ...attachment, state: 'failed', error: 'The staged archive expired or was deleted. Attach it again to retry.' } : attachment)); }
    } finally { requests.current.delete(pendingId); if (mounted.current) setSending(false); }
  };
  const submit = () => {
    const ready = attachments.filter(attachment => (attachment.state === 'ready' || attachment.state === 'partial') && attachment.analysisAvailable && attachment.fileId);
    const content = (draft.trim() || (ready.length ? 'Summarize the attached document(s).' : '')).trim();
    if (!content || sending || content.length > MAX_MESSAGE_LENGTH || conversationMissing) return;
    if (ready.length && content.length > MAX_FILE_QUESTION_LENGTH) { setComposerError(`Document questions must be ${MAX_FILE_QUESTION_LENGTH.toLocaleString()} characters or fewer so source excerpts fit safely.`); return; }
    if (attachments.some(attachment => ['validating', 'uploading', 'processing', 'inspecting', 'extracting', 'analyzing'].includes(attachment.state))) { setComposerError('Wait for selected files to finish processing before sending.'); return; }
    if (attachments.some(attachment => attachment.state === 'manifest-only')) { setComposerError('This archive was inspected only; no supported content is available for analysis. Remove it or attach analyzable content before sending.'); return; }
    if (attachments.some(attachment => attachment.state === 'failed' || attachment.state === 'unavailable' || attachment.state === 'cancelled' || attachment.state === 'expired')) { setComposerError('Remove files with errors before sending.'); return; }
    if (systemPrompt && systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH) { setComposerError('This agent’s instructions exceed the supported request limit. Edit the agent before sending.'); return; }
    if (ready.length && systemPrompt && systemPrompt.length > 12_000) { setComposerError('This agent’s instructions exceed the secure file-analysis limit. Edit the agent before analyzing attachments.'); return; }
    const targetId = conversationId ?? id(); if (conversationId && !conversation) return;
    const timestamp = new Date().toISOString(); const sentAttachments = ready.map(attachment => ({ ...attachment, state: 'analyzing' as const }));
    const user: Message = { id: id(), role: 'user', content, createdAt: timestamp, status: 'complete', ...(sentAttachments.length ? { attachments: sentAttachments } : {}) };
    const pending: Message = { id: id(), role: 'assistant', content: '', createdAt: timestamp, status: 'sending' };
    if (!conversationId) { updateConversations(items => [{ id: targetId, title: titleFromMessage(content), createdAt: timestamp, updatedAt: timestamp, messages: [user, pending], ...(agent ? { agentId: agent.id } : {}), model: 'Qwen3-8B', favorite: false, pinned: false, archived: false }, ...items]); onSelectConversation(targetId); }
    else updateConversations(items => items.map(item => item.id === targetId ? { ...item, updatedAt: timestamp, messages: [...item.messages, user, pending] } : item));
    changeDraft(''); setAttachments(ready.filter(attachment => attachment.type === 'zip').map(attachment => ({ ...attachment, state: attachment.archive?.partial ? 'partial' : 'ready' }))); setComposerError(undefined); setSending(true); void requestAssistant(targetId, content, pending.id, user.id, sentAttachments);
  };
  const retry = (failure: Message) => {
    if (!conversation || sending) return; const position = conversation.messages.findIndex(message => message.id === failure.id); const user = [...conversation.messages.slice(0, position)].reverse().find(message => message.role === 'user'); if (!user) return;
    updateConversations(items => items.map(item => item.id !== conversation.id ? item : { ...item, updatedAt: new Date().toISOString(), messages: item.messages.map(message => message.id === failure.id ? { ...message, status: 'sending', error: undefined, content: '' } : message) })); setSending(true); void requestAssistant(conversation.id, user.content, failure.id, user.id, user.attachments);
  };
  const cancelCurrent = () => { const pending = new Set(requests.current.keys()); requests.current.forEach(controller => controller.abort()); requests.current.clear(); if (pending.size) updateConversations(items => items.map(item => ({ ...item, messages: item.messages.map(message => pending.has(message.id) && message.status === 'sending' ? { ...message, content: '', status: 'cancelled', error: 'The request was cancelled.' } : message) }))); setSending(false); };
  const regenerate = (message: Message) => {
    if (!conversation || sending || message.sources?.length) return; const position = conversation.messages.findIndex(entry => entry.id === message.id); const user = [...conversation.messages.slice(0, position)].reverse().find(entry => entry.role === 'user'); if (!user) return;
    updateConversations(items => items.map(item => item.id !== conversation.id ? item : { ...item, updatedAt: new Date().toISOString(), messages: item.messages.map(entry => entry.id === message.id ? { ...entry, status: 'sending', content: '' } : entry) })); setSending(true); void requestAssistant(conversation.id, user.content, message.id, user.id, user.attachments);
  };
  const editAndResubmit = async (message: Message, replacement: string) => {
    const content = replacement.trim(); if (!conversation || !content || sending || content.length > MAX_MESSAGE_LENGTH || message.attachments?.length) return;
    setSending(true); setComposerError(undefined); try { await resubmitConversationMessage(conversation.id, message.id, content); if (!mounted.current) return; const position = conversation.messages.findIndex(entry => entry.id === message.id); const before = conversation.messages.slice(0, position); const timestamp = new Date().toISOString(); const edited: Message = { ...message, content, createdAt: timestamp, status: 'complete' }; const pending: Message = { id: id(), role: 'assistant', content: '', createdAt: timestamp, status: 'sending' }; updateConversations(items => items.map(item => item.id !== conversation.id ? item : { ...item, title: titleFromMessage(content), updatedAt: timestamp, messages: [...before, edited, pending] })); setEditing(undefined); await requestAssistant(conversation.id, content, pending.id, edited.id); } catch (caught) { if (mounted.current) { setComposerError(caught instanceof Error ? caught.message : 'The saved message could not be resubmitted.'); setSending(false); } }
  };
  const chooseFiles = async (files: File[]) => {
    const total = attachments.reduce((sum, attachment) => sum + attachment.size, 0) + files.reduce((sum, file) => sum + file.size, 0);
    if (!files.length) return; if (attachments.length + files.length > MAX_FILES) { setComposerError(`Select at most ${MAX_FILES} files at a time.`); return; }
    if (files.some(file => !acceptedExtensions.has(extension(file.name)))) { setComposerError('Supported files are PDF, DOCX, PPTX, JSON, TXT, Markdown, CSV, XLSX, ZIP, PNG, JPG, JPEG, and WEBP.'); return; }
    if (files.some(file => file.size > MAX_FILE_BYTES) || total > MAX_TOTAL_BYTES) { setComposerError('Files must be 8 MB or smaller, with a 15 MB total.'); return; }
    const placeholders = files.map(file => ({ localId: id(), filename: file.name, type: file.type || extension(file.name), size: file.size, state: 'validating' as const })); setAttachments(current => [...current, ...placeholders]); setComposerError(undefined);
    const controller = new AbortController(); placeholders.forEach(attachment => uploads.current.set(attachment.localId, controller));
    setAttachments(current => current.map(attachment => placeholders.some(item => item.localId === attachment.localId) ? { ...attachment, state: 'uploading' } : attachment));
    try {
      const uploaded = await uploadFiles(files, controller.signal);
      setAttachments(current => current.map(attachment => { const index = placeholders.findIndex(item => item.localId === attachment.localId); const result = index >= 0 ? uploaded[index] : undefined; if (!result) return attachment; const deferredOcr = ['image', 'pdf'].includes(result.type) && result.processingStatus === 'inspection_completed'; const readyForAnalysis = result.analysisAvailable || deferredOcr; return { ...attachment, fileId: result.id, filename: result.filename, type: result.type, size: result.size, state: result.processingStatus === 'manifest-only' ? 'manifest-only' : result.processingStatus === 'partial' ? 'partial' : readyForAnalysis ? 'ready' : 'unavailable', notices: deferredOcr ? [...result.notices, 'Scanner-approved document: text extraction will run securely when you send.'] : result.notices, ...(readyForAnalysis ? {} : { error: result.inspectionAvailable ? 'Archive inspected successfully, but no supported content was safely extracted for analysis.' : result.notices[0] || 'This file was validated but cannot be analyzed by the configured service.' }), analysisAvailable: readyForAnalysis, sources: result.sources.map(source => ({ filename: result.filename, location: source.location })), ...(result.archive ? { archive: result.archive } : {}) }; }));
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'The file upload failed.'; const unavailable = error instanceof ApiError && (error.status === 501 || error.status === 503);
      setAttachments(current => current.map(attachment => placeholders.some(item => item.localId === attachment.localId) ? { ...attachment, state: error instanceof ApiError && /cancelled/i.test(message) ? 'cancelled' : unavailable ? 'unavailable' : 'failed', error: message } : attachment));
    } finally { placeholders.forEach(attachment => uploads.current.delete(attachment.localId)); }
  };
  const removeAttachment = (attachment: AttachmentReference) => { uploads.current.get(attachment.localId)?.abort(); uploads.current.delete(attachment.localId); setAttachments(current => current.filter(item => item.localId !== attachment.localId)); if (attachment.fileId) void deleteFile(attachment.fileId).catch(() => setComposerError('The local preview was removed. The staging service will clean the temporary file when it expires.')); };
  const modelStatus = connection.ready === 'ready' ? <StatusBadge state="available">Model ready</StatusBadge> : connection.health === 'unavailable' ? <StatusBadge state="unavailable">Backend unavailable</StatusBadge> : <StatusBadge state="pending">Connection unchecked</StatusBadge>;
  const saveFeedback = async (message: Message, value: 'positive' | 'negative') => { if (!conversation) return; updateConversations(items => items.map(item => item.id !== conversation.id ? item : { ...item, messages: item.messages.map(entry => entry.id === message.id ? { ...entry, feedback: value } : entry) })); try { await setConversationMessageFeedback(conversation.id, message.id, value); } catch (caught) { if (mounted.current) setComposerError(caught instanceof Error ? caught.message : 'Feedback could not be saved.'); } };
  const shareConversation = () => { if (!conversation || !conversation.messages.some(message => message.role === 'user' || message.role === 'assistant')) return; setShareOpen(true); };
  const onSharePublished = ({ share, messageCount, expiration }: { share: ShareLink; messageCount: number; expiration: string }) => { setShareLinks(current => [share, ...current]); setShareOpen(false); setShareNotice(`Read-only ${share.scope === 'full' ? 'full-conversation' : 'selected-content'} link for ${messageCount} message${messageCount === 1 ? '' : 's'} was published. It expires in ${expiration}. Copy it from the confirmation dialog, or revoke it from this list.`); };
  const revokeShare = async (share: ShareLink) => { if (!window.confirm('Revoke this read-only share link immediately? Anyone using it will lose access.')) return; try { await revokeConversationShare(share.id); setShareLinks(current => current.map(item => item.id === share.id ? { ...item, revokedAt: new Date().toISOString() } : item)); setShareNotice('The share link was revoked.'); } catch (caught) { setShareNotice(caught instanceof Error ? caught.message : 'The share link could not be revoked.'); } };
  const composer = <Composer value={draft} onChange={changeDraft} onSend={submit} onCancel={cancelCurrent} attachments={attachments} onChooseFiles={chooseFiles} onRemoveAttachment={removeAttachment} sending={sending} enterToSend={state.preferences.enterToSend} error={composerError} textareaRef={box} />;

  if (conversationMissing) return <main className="chat-workspace not-found-workspace"><EmptyState title="Conversation not found" detail="This local conversation may have been deleted, cleared, or opened with an invalid link. No request will be sent using this ID." action={<div className="empty-actions"><Button onClick={onNewChat}><Icon name="plus" /> Start a new chat</Button>{draft.trim() && <Button variant="secondary" onClick={() => onRecoverMissingDraft(draft)}><Icon name="edit" /> Use saved draft</Button>}</div>} /></main>;
  if (missingAgentId && !conversation) return <main className="chat-workspace not-found-workspace"><EmptyState title="Agent unavailable" detail="This agent is not available on this device. It may have been deleted or the link is stale. No agent instructions will be applied." action={<Button onClick={onOpenAgents}><Icon name="agents" /> Open agents</Button>} /></main>;
  if (!conversation) return <main className="chat-workspace"><section className="welcome"><Brand /><h1>{agent ? `Chat with ${agent.name}` : 'How can VoiceChatGLM help?'}</h1><p>{agent ? agent.description : 'A private, local-first workspace connected to your configured Qwen3-8B service.'}</p><div className="welcome-status">{modelStatus}<span>Qwen3-8B</span></div><div className="prompt-grid">{prompts.map(prompt => <button key={prompt} onClick={() => { changeDraft(prompt); box.current?.focus(); }}><Icon name="plus" size={15} />{prompt}</button>)}</div>{!agent && <button className="agent-shortcut" onClick={onOpenAgents}><Icon name="agents" /> Build a focused agent <Icon name="chevron" size={16} /></button>}</section>{composer}</main>;
  return <main className="chat-workspace"><header className="chat-header"><div>{agent ? <><span className="agent-avatar" style={{ background: agent.accent }}>{agent.icon}</span><div><h1>{agent.name}</h1><p>{agent.description}</p></div></> : <><h1>{conversation.title}</h1><p>Qwen3-8B · synchronises to your signed-in account when persistent storage is available</p></>}</div><div className="chat-header-actions">{conversation.messages.length ? <Button variant="secondary" onClick={() => void shareConversation()}><Icon name="external" /> Share</Button> : null}{modelStatus}</div></header>{shareNotice && <div className="notice-banner" role="status"><Icon name="info" /><span>{shareNotice}</span><Button variant="ghost" onClick={() => setShareNotice(undefined)}>Dismiss</Button></div>}{shareLinks.length ? <details className="share-links-panel"><summary>Share links ({shareLinks.filter(link => !link.revokedAt && (!link.expiresAt || new Date(link.expiresAt).getTime() > Date.now())).length} active)</summary><p>Links are explicitly selected-content or full-conversation. Private artifacts, uploads, memory, knowledge sources, system messages, and tool state are never included.</p>{shareLinks.map(link => <div key={link.id}><span><strong>{link.revokedAt ? 'Revoked' : link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now() ? 'Expired' : 'Active'}</strong><small>{link.scope === 'full' ? 'Full eligible conversation' : 'Selected content'} · {link.messageCount} message{link.messageCount === 1 ? '' : 's'} · created {new Date(link.createdAt).toLocaleString()} · expires {new Date(link.expiresAt).toLocaleString()}</small></span>{!link.revokedAt ? <Button variant="ghost" onClick={() => void revokeShare(link)}>Revoke</Button> : null}</div>)}</details> : null}{missingAgentId && <div className="agent-unavailable-note" role="status"><Icon name="warning" /> This chat remains linked to a deleted agent. Its previous instructions are unavailable and will not be sent with new messages.</div>}<section className="messages" aria-live="polite" aria-label="Conversation messages" aria-busy={sending}>{conversation.messages.map(message => <MessageBubble key={message.id} message={message} editing={editing === message.id} onEdit={() => setEditing(message.id)} onCancelEdit={() => setEditing(undefined)} onSaveEdit={value => editAndResubmit(message, value)} onRetry={() => retry(message)} onRegenerate={() => regenerate(message)} onFeedback={value => void saveFeedback(message, value)} />)}</section>{composer}{shareOpen && conversation ? <ConversationShareDialog conversation={conversation} onClose={() => setShareOpen(false)} onPublished={onSharePublished} /> : null}</main>;
}

function MessageBubble({ message, editing, onEdit, onCancelEdit, onSaveEdit, onRetry, onRegenerate, onFeedback }: { message: Message; editing: boolean; onEdit: () => void; onCancelEdit: () => void; onSaveEdit: (value: string) => void; onRetry: () => void; onRegenerate: () => void; onFeedback: (value: 'positive' | 'negative') => void }) {
  const [value, setValue] = useState(message.content); const [copied, setCopied] = useState(false); useEffect(() => setValue(message.content), [message.content]);
  const copy = async () => { try { await navigator.clipboard?.writeText(message.content); setCopied(true); window.setTimeout(() => setCopied(false), 1400); } catch { setCopied(false); } };
  if (message.status === 'sending') return <article className="message assistant"><div className="message-avatar">V</div><div className="thinking"><span /><span /><span /> Generating a response</div></article>;
  if (message.status === 'error' || message.status === 'cancelled') return <article className="message assistant"><div className="message-avatar">V</div><div className="message-content error-message"><strong>{message.status === 'cancelled' ? 'Response cancelled' : 'Response unavailable'}</strong><p>{message.error || (message.status === 'cancelled' ? 'The request was cancelled before completion.' : 'The response could not be completed.')}</p><Button variant="secondary" onClick={onRetry}><Icon name="retry" /> Retry</Button></div></article>;
  return <article className={`message ${message.role}`}><div className="message-avatar">{message.role === 'user' ? 'You' : 'V'}</div><div className="message-content">{editing ? <div className="edit-message"><textarea value={value} onChange={event => setValue(event.target.value)} aria-label="Edit your message" maxLength={MAX_MESSAGE_LENGTH} /><div><Button variant="ghost" onClick={onCancelEdit}>Cancel</Button><Button onClick={() => onSaveEdit(value)}>Save & resend</Button></div></div> : <>{message.role === 'assistant' ? <SafeMarkdown content={message.content} /> : <p>{message.content}</p>}{message.scrapeJobId && message.scrapeProgress ? <ScrapeProgress progress={message.scrapeProgress} /> : null}{message.attachments?.length ? <AttachmentList attachments={message.attachments} compact /> : null}{message.sources?.length ? <aside className="source-list" aria-label="Document sources"><strong>Sources used</strong>{message.sources.map(source => <span key={`${source.fileId}:${source.location}`}>{source.filename} · {source.location}{source.truncated ? ' · excerpt truncated' : ''}</span>)}{message.analysisTruncated && <small>Only bounded excerpts were sent to the text model.</small>}</aside> : null}{message.toolEvents?.length ? <aside className="source-list tool-results" aria-label="Completed capability steps"><strong>Capability activity</strong>{message.toolEvents.map(event => <span key={`${event.id}:${event.detail}`}>{event.id.replace(/_/g, ' ')} · {event.status} · {event.detail}</span>)}</aside> : null}{message.artifacts?.length ? <ArtifactList artifacts={message.artifacts} /> : null}{message.citations?.length ? <aside className="source-list citations" aria-label="Sources"><strong>Sources</strong>{message.citations.map(citation => citation.url ? <a key={citation.url} href={citation.url} target="_blank" rel="noreferrer noopener">{citation.title}{citation.publicationDate ? ` · ${new Date(citation.publicationDate).toLocaleDateString()}` : ''}</a> : <span key={`${citation.sourceId}:${citation.title}`}>{citation.title}{citation.section ? ` · ${citation.section}` : ''}{citation.page ? ` · page ${citation.page}` : ''}</span>)}</aside> : null}{message.notices?.length ? <aside className="source-list tool-results" aria-label="Capability limitations"><strong>Limitations</strong>{message.notices.map(notice => <span key={notice}>{notice}</span>)}</aside> : null}<footer><time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time><Button variant="icon" onClick={() => void copy()} aria-label="Copy message"><Icon name="copy" size={15} />{copied && <span className="tooltip">Copied</span>}</Button>{message.role === 'user' && !message.attachments?.length ? <Button variant="icon" onClick={onEdit} aria-label="Edit and resend message"><Icon name="edit" size={15} /></Button> : null}{message.role === 'assistant' ? <>{!message.sources?.length ? <Button variant="icon" onClick={onRegenerate} aria-label="Regenerate response"><Icon name="retry" size={15} /></Button> : null}<Button variant="icon" aria-pressed={message.feedback === 'positive'} onClick={() => onFeedback('positive')} aria-label="Mark response helpful"><Icon name="thumb-up" size={15} /></Button><Button variant="icon" aria-pressed={message.feedback === 'negative'} onClick={() => onFeedback('negative')} aria-label="Mark response unhelpful"><Icon name="thumb-down" size={15} /></Button></> : null}</footer></>}</div></article>;
}

function ScrapeProgress({ progress }: { progress: NonNullable<Message['scrapeProgress']> }) {
  const phaseLabels: Record<string, string> = {
    discovering_catalogue: 'Discovering catalogue pages',
    extracting_products: 'Visiting product pages and extracting details',
    preparing_workbook: 'Preparing the Excel workbook',
    completed: 'Completed'
  };
  const phase = phaseLabels[progress.phase || ''] || (progress.status === 'queued' ? 'Waiting for a worker to start' : progress.status === 'running' ? 'Retrieving website pages' : progress.status === 'partial' ? 'Completed with partial coverage' : progress.status === 'failed' ? 'Crawl failed' : 'Working');
  const rows = [
    ['Pages visited', progress.pagesVisited ?? 0],
    ['Pages discovered', progress.pagesDiscovered ?? 0],
    ['Product links found', progress.productUrlsDiscovered ?? 0],
    ['Product pages visited', progress.productPagesVisited ?? 0],
    ['Product records extracted', progress.productsFound ?? 0],
    ['Pages still queued', progress.queuedButNotVisited ?? 0],
    ['Pages failed', progress.failedPages ?? 0]
  ] as const;
  return <aside className="source-list tool-results scrape-progress" aria-live="polite" aria-label="Live task progress">
    <strong><span className={progress.status === 'running' || progress.status === 'queued' ? 'progress-pulse' : ''} /> {phase}</strong>
    <div className="scrape-progress-grid">{rows.map(([label, value]) => <span key={label}><b>{value.toLocaleString()}</b><small>{label}</small></span>)}</div>
  </aside>;
}

function ArtifactList({ artifacts }: { artifacts: ArtifactReference[] }) { return <aside className="attachment-list generated-artifacts" aria-label="Generated files">{artifacts.map(artifact => <div className="attachment-card attachment-complete" key={artifact.id}><span className="attachment-file-icon" aria-hidden="true">{artifact.format.toUpperCase().slice(0, 4)}</span><span><strong>{artifact.filename}</strong><small>{formatBytes(artifact.size)} · {artifact.status} · created {formatTime(artifact.createdAt)}</small><details><summary>File details</summary><p>SHA-256: <code>{artifact.checksum ?? 'Recorded by server'}</code></p>{artifact.expiresAt ? <p>Retention until {new Date(artifact.expiresAt).toLocaleString()}</p> : null}</details></span><a className="button secondary" href={artifactDownloadUrl(artifact.id)}>Download</a></div>)}</aside>; }

function AttachmentList({ attachments, onRemove, compact = false }: { attachments: AttachmentReference[]; onRemove?: (attachment: AttachmentReference) => void; compact?: boolean }) { return <div className={`attachment-list ${compact ? 'attachment-list-compact' : ''}`}>{attachments.map(attachment => <div className={`attachment-card attachment-${attachment.state}`} key={attachment.localId}><span className="attachment-file-icon" aria-hidden="true">{extension(attachment.filename).toUpperCase().slice(0, 4)}</span><span><strong>{attachment.filename}</strong><small>{formatBytes(attachment.size)} · {attachment.state}{attachment.notices?.length ? ` · ${attachment.notices[0]}` : ''}</small>{attachment.archive ? <details className="archive-manifest"><summary>{attachment.archive.contentAnalysisAvailable === false ? `Manifest-only inspection: ${attachment.archive.summary.totalEntries} entries · no supported content extracted` : `Archive inspected: ${attachment.archive.summary.totalEntries} entries · ${attachment.archive.summary.analyzedFiles} analyzable${attachment.archive.partial ? ' · partial coverage' : ''}`}</summary><ul>{attachment.archive.members.map(member => <li key={member.path}><code>{member.path}</code><span>{member.type} · {member.validation}/{member.extraction}{member.reason ? ` · ${member.reason}` : ''}{member.redacted ? ' · redacted' : ''}</span></li>)}</ul></details> : null}{attachment.error ? <em role="alert">{attachment.error}</em> : null}</span>{onRemove ? <Button variant="icon" onClick={() => onRemove(attachment)} aria-label={`${['validating', 'uploading', 'processing'].includes(attachment.state) ? 'Cancel' : 'Remove'} ${attachment.filename}`}><Icon name="close" size={16} /></Button> : null}</div>)}</div>; }

function Composer({ value, onChange, onSend, onCancel, attachments, onChooseFiles, onRemoveAttachment, sending, enterToSend, error, textareaRef }: { value: string; onChange: (value: string) => void; onSend: () => void; onCancel: () => void; attachments: AttachmentReference[]; onChooseFiles: (files: File[]) => void; onRemoveAttachment: (attachment: AttachmentReference) => void; sending: boolean; enterToSend: boolean; error?: string; textareaRef: RefObject<HTMLTextAreaElement> }) {
  const [menuOpen, setMenuOpen] = useState(false); const menu = useRef<HTMLDivElement>(null); const fileInput = useRef<HTMLInputElement>(null); const tooLong = value.length > MAX_MESSAGE_LENGTH; const ready = attachments.some(attachment => (attachment.state === 'ready' || attachment.state === 'partial') && attachment.analysisAvailable && attachment.fileId); const busyFiles = attachments.some(attachment => ['validating', 'uploading', 'processing', 'inspecting', 'extracting', 'analyzing'].includes(attachment.state));
  useEffect(() => { const dismiss = (event: MouseEvent) => { if (menu.current && !menu.current.contains(event.target as Node)) setMenuOpen(false); }; const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); }; document.addEventListener('mousedown', dismiss); document.addEventListener('keydown', escape); return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', escape); }; }, []);
  const keyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => { if (enterToSend && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSend(); } };
  return <div className="composer-wrap" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); onChooseFiles(Array.from(event.dataTransfer.files)); }}><input ref={fileInput} className="sr-only" type="file" multiple accept=".pdf,.docx,.pptx,.json,.txt,.md,.markdown,.csv,.xlsx,.zip,.png,.jpg,.jpeg,.webp" onChange={event => { onChooseFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ''; }} />{attachments.length ? <AttachmentList attachments={attachments} onRemove={onRemoveAttachment} /> : null}<div className="composer"><div className="composer-plus" ref={menu}><Button variant="icon" onClick={() => setMenuOpen(open => !open)} aria-label="Add to message" aria-haspopup="menu" aria-expanded={menuOpen}><Icon name="plus" /></Button>{menuOpen ? <div className="composer-menu" role="menu" aria-label="Add to message"><button role="menuitem" onClick={() => { setMenuOpen(false); fileInput.current?.click(); }}><Icon name="plus" /> Add files <small>PDF, DOCX, PPTX, JSON, text, sheets, ZIP archives, or images</small></button><button role="menuitem" disabled title="Knowledge availability is reported in the Knowledge workspace."><Icon name="knowledge" /> Knowledge sources <small>Manage sources in the Knowledge workspace</small></button></div> : null}</div><textarea ref={textareaRef} value={value} onChange={event => onChange(event.target.value)} onKeyDown={keyDown} placeholder="Message VoiceChatGLM…" aria-label="Message VoiceChatGLM" rows={1} maxLength={MAX_MESSAGE_LENGTH + 1} /><div className="composer-actions"><span className={tooLong ? 'limit-error' : ''}>{value.length ? `${value.length.toLocaleString()} / ${MAX_MESSAGE_LENGTH.toLocaleString()}` : enterToSend ? 'Enter to send · Shift+Enter for a new line' : 'Enter adds a new line'}</span>{sending ? <><Button disabled aria-label="Send message"><Icon name="send" /></Button><Button variant="secondary" aria-label="Cancel current request" onClick={onCancel}>Cancel</Button></> : <Button disabled={(!value.trim() && !ready) || tooLong || busyFiles} aria-label="Send message" onClick={onSend}><Icon name="send" /></Button>}</div></div>{(tooLong || error) && <p className="composer-error" role="alert">{error ?? 'Shorten your message before sending.'}</p>}<p className="composer-note">Files are scanned before analysis. PNG, JPEG, WebP, text PDFs, scanned PDFs, and mixed PDFs use bounded server-side text extraction; image/PDF analysis is OCR text only, not visual understanding. ZIP archives are inspected and may be partial. File bytes are never saved in this browser workspace.</p></div>;
}

function buildSystemPrompt(agent: Agent): string { const instructions = agent.instructions; return [instructions.role && `Role: ${instructions.role}`, instructions.objectives && `Objectives: ${instructions.objectives}`, instructions.tone && `Tone: ${instructions.tone}`, instructions.responseStyle && `Response style: ${instructions.responseStyle}`, instructions.outputFormat && `Output format: ${instructions.outputFormat}`, instructions.constraints && `Constraints: ${instructions.constraints}`, instructions.clarificationBehavior && `Clarification behavior: ${instructions.clarificationBehavior}`, instructions.uncertaintyHandling && `Uncertainty handling: ${instructions.uncertaintyHandling}`, instructions.safetyBehavior && `Safety behavior: ${instructions.safetyBehavior}`].filter(Boolean).join('\n'); }
