import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, type SessionUser, loginAccount, logoutAccount, registerAccount, resetPassword, restoreSession, setSessionProvider } from '../api/client';

type SessionState = 'loading' | 'signed-out' | 'authenticated' | 'session-expired' | 'unavailable';
export interface AuthenticationSession {
  state: SessionState;
  user?: SessionUser;
  displayName?: string;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  resetPassword: (token: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  retry: () => Promise<void>;
}
const AuthenticationContext = createContext<AuthenticationSession | undefined>(undefined);
export function useAuthentication(): AuthenticationSession { const session = useContext(AuthenticationContext); if (!session) throw new Error('AuthenticationProvider is required.'); return session; }

export function AuthenticationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>('loading'); const [user, setUser] = useState<SessionUser>(); const csrf = useRef<string>(); const epoch = useRef(0); const mounted = useRef(true);
  const clear = useCallback((next: SessionState) => { csrf.current = undefined; setSessionProvider(undefined); setUser(undefined); setState(next); }, []);
  const install = useCallback((session: { user: SessionUser; csrfToken: string }) => { csrf.current = session.csrfToken; setUser(session.user); setState('authenticated'); }, []);
  const restore = useCallback(async () => { const requestEpoch = ++epoch.current; setState('loading'); try { const session = await restoreSession(); if (!mounted.current || requestEpoch !== epoch.current) return; session ? install(session) : clear('signed-out'); } catch { if (mounted.current && requestEpoch === epoch.current) clear('unavailable'); } }, [clear, install]);
  useEffect(() => { void restore(); return () => { mounted.current = false; epoch.current += 1; csrf.current = undefined; setSessionProvider(undefined); }; }, [restore]);
  useEffect(() => { if (state !== 'authenticated' || !csrf.current) { setSessionProvider(undefined); return; } setSessionProvider(() => csrf.current, status => { if (!mounted.current) return; clear(status === 401 ? 'session-expired' : 'unavailable'); }); return () => setSessionProvider(undefined); }, [clear, state]);
  const accept = useCallback(async (operation: () => Promise<{ user: SessionUser; csrfToken: string }>) => { const requestEpoch = ++epoch.current; setState('loading'); try { const session = await operation(); if (mounted.current && requestEpoch === epoch.current) install(session); } catch (error) { if (mounted.current && requestEpoch === epoch.current) { setUser(undefined); csrf.current = undefined; setSessionProvider(undefined); setState(error instanceof ApiError && error.status && error.status >= 500 ? 'unavailable' : 'signed-out'); } throw error; } }, [install]);
  const signIn = useCallback((email: string, password: string) => accept(() => loginAccount(email, password)), [accept]);
  const register = useCallback((email: string, password: string, displayName?: string) => accept(() => registerAccount(email, password, displayName)), [accept]);
  const reset = useCallback((token: string, password: string) => accept(() => resetPassword(token, password)), [accept]);
  const signOut = useCallback(async () => { epoch.current += 1; const token = csrf.current; clear('signed-out');
    // A session restore may be pending while the user signs out. Retain only the
    // already-held anti-CSRF value long enough to revoke the server session; epoch
    // prevents that pending response from reinstalling authenticated UI state.
    if (token) { try { await logoutAccount(token); } catch { /* Local state remains signed out; a later refresh repeats server logout safely. */ } }
  }, [clear]);
  const session = useMemo<AuthenticationSession>(() => ({ state, user, displayName: user?.displayName || user?.email, configured: !import.meta.env.PROD || Boolean(import.meta.env.VITE_PROXY_BASE_URL), signIn, register, resetPassword: reset, signOut, retry: restore }), [register, reset, restore, signIn, signOut, state, user]);
  return <AuthenticationContext.Provider value={session}>{children}</AuthenticationContext.Provider>;
}
