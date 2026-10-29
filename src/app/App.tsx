import { useCallback, useEffect, useState } from 'react';
import type { AppView, Conversation } from '../types/domain';
import { Button, Icon } from '../components/ui';
import { ChatWorkspace } from '../features/chat/ChatWorkspace';
import { AgentsWorkspace } from '../features/agents/AgentsWorkspace';
import { KnowledgeWorkspace } from '../features/knowledge/KnowledgeWorkspace';
import { ToolsWorkspace } from '../features/tools/ToolsWorkspace';
import { WritingWorkspace } from '../features/writing/WritingWorkspace';
import { SettingsWorkspace } from '../features/settings/SettingsWorkspace';
import { SharedConversationView } from '../features/chat/SharedConversationView';
import { Sidebar } from './Sidebar';
import { useWorkspace } from './WorkspaceContext';
import { checkStatus } from '../services/api/client';

interface Route { view: AppView; conversationId?: string; agentId?: string; shareToken?: string; }
const decode = (value: string): string | undefined => { try { return decodeURIComponent(value); } catch { return undefined; } };
function parseRoute(): Route {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const agentId = parts[0] === 'agents' && parts[1] && parts[2] === 'chat' ? decode(parts[1]) : undefined;
  if (parts[0] === 'share' && parts[1] && /^[A-Za-z0-9_-]{32,128}$/.test(parts[1])) return { view: 'chat', shareToken: parts[1] };
  if (agentId) return { view: 'chat', agentId };
  const conversationId = parts[0] === 'chat' && parts[1] ? decode(parts[1]) : undefined;
  if (conversationId) return { view: 'chat', conversationId };
  if (['agents', 'knowledge', 'writing', 'tools', 'settings'].includes(parts[0])) return { view: parts[0] as AppView };
  return { view: 'chat' };
}
function routePath(route: Route): string {
  if (route.shareToken) return `/share/${encodeURIComponent(route.shareToken)}`;
  if (route.agentId) return `/agents/${encodeURIComponent(route.agentId)}/chat`;
  if (route.conversationId) return `/chat/${encodeURIComponent(route.conversationId)}`;
  return route.view === 'chat' ? '/' : `/${route.view}`;
}

export function App() {
  const { state, setConnection, saveAgent, saveDraft, persistenceMessage, dismissPersistenceMessage } = useWorkspace();
  const [route, setRoute] = useState<Route>(parseRoute);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const navigate = useCallback((next: Route, replace = false) => {
    const path = routePath(next);
    if (window.location.pathname !== path) window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
    setRoute(next);
  }, []);
  if (route.shareToken) return <SharedConversationView token={route.shareToken} />;
    const activeView = route.view;
  const activeConversation: Conversation | undefined = route.conversationId ? state.conversations.find(conversation => conversation.id === route.conversationId) : undefined;
  const routeAgent = route.agentId ? state.agents.find(agent => agent.id === route.agentId) : undefined;
  const conversationAgent = activeConversation?.agentId ? state.agents.find(agent => agent.id === activeConversation.agentId) : undefined;
  // Conversation ownership wins after the initial agent route has created it. This survives refresh/sidebar navigation.
  const selectedAgent = activeConversation ? conversationAgent : routeAgent;
  const activeAgentId = activeConversation?.agentId ?? route.agentId;
  const missingAgentId = activeAgentId && !selectedAgent ? activeAgentId : undefined;
  const conversationMissing = Boolean(route.conversationId && !activeConversation);

  useEffect(() => { const listener = () => setRoute(parseRoute()); window.addEventListener('popstate', listener); return () => window.removeEventListener('popstate', listener); }, []);
  useEffect(() => { const onlineListener = () => setOnline(true); const offlineListener = () => setOnline(false); window.addEventListener('online', onlineListener); window.addEventListener('offline', offlineListener); return () => { window.removeEventListener('online', onlineListener); window.removeEventListener('offline', offlineListener); }; }, []);
  useEffect(() => { document.documentElement.dataset.theme = state.preferences.theme; document.documentElement.dataset.density = state.preferences.density; document.documentElement.dataset.reduceMotion = String(state.preferences.reduceMotion); document.documentElement.dataset.codeWrap = String(state.preferences.codeWrap); }, [state.preferences.theme, state.preferences.density, state.preferences.reduceMotion, state.preferences.codeWrap]);
  useEffect(() => { if (window.location.pathname === '/' && state.preferences.defaultView !== 'chat') navigate({ view: state.preferences.defaultView }, true); }, [navigate, state.preferences.defaultView]);
  useEffect(() => {
    let active = true;
    void Promise.all([checkStatus('/live').catch(() => ({ ok: false, detail: 'Network error' })), checkStatus('/ready').catch(() => ({ ok: false, detail: 'Network error' }))]).then(([health, ready]) => {
      if (active) setConnection({ health: health.ok ? 'healthy' : 'unavailable', ready: ready.ok ? 'ready' : 'unavailable', checkedAt: new Date().toISOString(), detail: [health.detail, ready.detail].filter(Boolean).join(' · ') || undefined });
    });
    return () => { active = false; };
  }, [setConnection]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const editable = target.matches('input, textarea, select, [contenteditable="true"]');
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); navigate({ view: 'chat' }); }
      if ((event.metaKey || event.ctrlKey) && event.key === '/' && !editable) { event.preventDefault(); document.getElementById('conversation-search')?.focus(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b' && !editable) { event.preventDefault(); setMobileOpen(true); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  const onStartAgent = (agentId: string) => {
    const agent = state.agents.find(item => item.id === agentId);
    if (agent) saveAgent({ ...agent, lastUsedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    navigate({ view: 'chat', agentId });
  };
  const newChat = () => navigate({ view: 'chat' });

  return <div className="app-shell">
    <Sidebar active={activeView} onNavigate={view => navigate({ view })} activeConversationId={route.conversationId} onSelectConversation={id => navigate({ view: 'chat', conversationId: id })} onNewChat={newChat} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
    <div className="main-column">
      <header className="mobile-header"><Button variant="icon" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Icon name="menu" /></Button><span>VoiceChatGLM</span>{!online && <span className="offline-indicator"><Icon name="offline" /> Offline</span>}</header>
      {persistenceMessage && <div className="persistence-banner" role="alert"><Icon name="warning" /> <span>{persistenceMessage}</span><Button variant="icon" aria-label="Dismiss storage message" onClick={dismissPersistenceMessage}><Icon name="close" /></Button></div>}
      {!online && <div className="offline-banner" role="status"><Icon name="offline" /> You’re offline. Local chats are available, but new model responses need a reachable backend.</div>}
      {activeView === 'chat' && <ChatWorkspace conversationId={route.conversationId} agent={selectedAgent} agentId={activeAgentId} conversationMissing={conversationMissing} missingAgentId={missingAgentId} onSelectConversation={id => navigate({ view: 'chat', conversationId: id })} onNewChat={newChat} onRecoverMissingDraft={draft => { saveDraft('chat:new:default', draft); newChat(); }} onOpenAgents={() => navigate({ view: 'agents' })} />}
      {activeView === 'agents' && <AgentsWorkspace onStartChat={onStartAgent} />}
      {activeView === 'knowledge' && <KnowledgeWorkspace />}
      {activeView === 'writing' && <WritingWorkspace />}
      {activeView === 'tools' && <ToolsWorkspace />}
      {activeView === 'settings' && <SettingsWorkspace />}
    </div>
  </div>;
}
