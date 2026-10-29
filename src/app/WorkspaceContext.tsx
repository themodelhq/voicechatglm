import { createContext, useCallback, useContext, useMemo, useRef, useState, useEffect, type ReactNode } from 'react';
import type { Agent, ConnectionStatus, Conversation, Preferences, StorageState } from '../types/domain';
import { clearWorkspace, emptyState, loadWorkspace, newerState, parseWorkspace, readStoredWorkspace, saveState, storageKey } from '../services/storage/localStore';

interface WorkspaceContextValue {
  state: StorageState;
  connection: ConnectionStatus;
  persistenceMessage?: string;
  updateConversations: (updater: (items: Conversation[]) => Conversation[]) => void;
  saveAgent: (agent: Agent) => void;
  removeAgent: (id: string) => void;
  updatePreferences: (next: Partial<Preferences>) => void;
  saveDraft: (key: string, value: string) => void;
  setConnection: (status: ConnectionStatus) => void;
  clearLocalData: () => boolean;
  dismissPersistenceMessage: () => void;
}
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const initial = useRef(loadWorkspace());
  const stateRef = useRef<StorageState>(initial.current.state);
  const [state, setState] = useState<StorageState>(initial.current.state);
  const [connection, setConnection] = useState<ConnectionStatus>({ health: 'unknown', ready: 'unknown' });
  const [persistenceMessage, setPersistenceMessage] = useState<string | undefined>(initial.current.warning);

  const commit = useCallback((updater: (current: StorageState) => StorageState) => {
    // Reconcile a newer write from another tab before applying a local mutation.
    const base = newerState(readStoredWorkspace(), stateRef.current);
    const candidate = updater(base);
    const next: StorageState = { ...candidate, version: 2, revision: base.revision + 1, updatedAt: new Date().toISOString() };
    stateRef.current = next;
    setState(next);
    const saved = saveState(next);
    setPersistenceMessage(saved.ok ? undefined : saved.error);
    return saved.ok;
  }, []);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      // A remove operation is an intentional workspace clear in another tab.
      const incoming = event.newValue === null ? { ...emptyState(), revision: stateRef.current.revision + 1 } : parseWorkspace(event.newValue).state;
      const winner = newerState(incoming, stateRef.current);
      if (winner !== stateRef.current) { stateRef.current = winner; setState(winner); }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const updateConversations = useCallback((updater: (items: Conversation[]) => Conversation[]) => { void commit(current => ({ ...current, conversations: updater(current.conversations) })); }, [commit]);
  const saveAgent = useCallback((agent: Agent) => { void commit(current => ({ ...current, agents: current.agents.some(item => item.id === agent.id) ? current.agents.map(item => item.id === agent.id ? agent : item) : [agent, ...current.agents] })); }, [commit]);
  const removeAgent = useCallback((id: string) => {
    // Keep conversation.agentId as a durable record. A deleted agent is rendered as unavailable, never replaced by another agent.
    void commit(current => ({ ...current, agents: current.agents.filter(agent => agent.id !== id) }));
  }, [commit]);
  const updatePreferences = useCallback((next: Partial<Preferences>) => { void commit(current => ({ ...current, preferences: { ...current.preferences, ...next } })); }, [commit]);
  const saveDraft = useCallback((key: string, value: string) => { void commit(current => ({ ...current, drafts: { ...current.drafts, [key]: value } })); }, [commit]);
  const clearLocalData = useCallback(() => {
    const removed = clearWorkspace();
    if (!removed.ok) { setPersistenceMessage(removed.error); return false; }
    const current = stateRef.current;
    const cleared: StorageState = { ...emptyState(), revision: current.revision + 1, updatedAt: new Date().toISOString() };
    stateRef.current = cleared; setState(cleared);
    const saved = saveState(cleared);
    setPersistenceMessage(saved.ok ? undefined : 'Local data was cleared, but the empty workspace could not be recorded for other tabs.');
    return true;
  }, []);
  const dismissPersistenceMessage = useCallback(() => setPersistenceMessage(undefined), []);

  const value = useMemo(() => ({ state, connection, persistenceMessage, updateConversations, saveAgent, removeAgent, updatePreferences, saveDraft, setConnection, clearLocalData, dismissPersistenceMessage }), [state, connection, persistenceMessage, updateConversations, saveAgent, removeAgent, updatePreferences, saveDraft, clearLocalData, dismissPersistenceMessage]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext); if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider'); return value;
}
