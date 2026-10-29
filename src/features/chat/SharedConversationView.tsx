import { useEffect, useState } from 'react';
import { SafeMarkdown } from '../../components/SafeMarkdown';
import { Brand, Button, EmptyState, Icon } from '../../components/ui';
import { ApiError, getPublicConversationShare, type ShareMessage, type SharePreview } from '../../services/api/client';

export function SharedConversationView({ token }: { token: string }) {
  const [share, setShare] = useState<SharePreview>();
  const [messages, setMessages] = useState<ShareMessage[]>([]);
  const [error, setError] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setShare(undefined); setMessages([]); setError(undefined);
    void getPublicConversationShare(token, { signal: controller.signal }).then(result => { setShare(result); setMessages(result.messages); }).catch(caught => {
      const unavailable = caught instanceof ApiError && (caught.status === 404 || caught.status === 429);
      const temporary = caught instanceof ApiError && typeof caught.status === 'number' && caught.status >= 500;
      setError(temporary ? 'The shared conversation is temporarily unavailable. Please try again later.' : unavailable ? 'This link is invalid, expired, revoked, or currently unavailable.' : 'This shared conversation is unavailable.');
    });
    return () => controller.abort();
  }, [token]);
  const loadMore = async () => {
    if (!share || share.nextCursor === undefined || loadingMore) return; setLoadingMore(true); setError(undefined);
    try { const page = await getPublicConversationShare(token, { after: share.nextCursor }); setShare(current => current ? { ...current, nextCursor: page.nextCursor, messageCount: page.messageCount, expiresAt: page.expiresAt } : page); setMessages(current => [...current, ...page.messages.filter(item => !current.some(existing => existing.id === item.id))]); }
    catch (caught) { const unavailable = caught instanceof ApiError && (caught.status === 404 || caught.status === 429); setError(unavailable ? 'This link is invalid, expired, revoked, or currently unavailable.' : 'More shared messages could not be loaded.'); }
    finally { setLoadingMore(false); }
  };
  if (error && !share) return <main className="chat-workspace not-found-workspace"><EmptyState title="Shared conversation unavailable" detail={error} /></main>;
  if (!share) return <main className="chat-workspace"><section className="welcome"><Brand /><p>Loading read-only shared conversation…</p></section></main>;
  return <main className="chat-workspace shared-conversation"><header className="chat-header"><div><h1>{share.title}</h1><p><Icon name="external" size={15} /> Read-only shared conversation · {share.messageCount} permitted message{share.messageCount === 1 ? '' : 's'}</p></div></header><div className="notice-banner"><Icon name="info" /><span>{share.artifactPolicy} This link expires {share.expiresAt ? new Date(share.expiresAt).toLocaleString() : 'according to the owner’s published policy'}.</span></div><section className="messages" aria-label="Shared conversation messages">{messages.map(message => <article className={`message ${message.role === 'user' ? 'user' : 'assistant'}`} key={message.id}><div className="message-avatar">{message.role === 'user' ? 'Shared user' : 'V'}</div><div className="message-content"><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time>{message.role === 'user' ? <p>{message.content}</p> : <SafeMarkdown content={message.content} />}</div></article>)}</section>{share.nextCursor !== undefined ? <div className="shared-load-more"><Button variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? 'Loading messages…' : 'Load more shared messages'}</Button></div> : null}{error ? <div className="notice-banner" role="status"><Icon name="warning" /><span>{error}</span></div> : null}</main>;
}
