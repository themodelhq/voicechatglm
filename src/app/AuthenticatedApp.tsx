import { App } from './App';
import { WorkspaceProvider } from './WorkspaceContext';
import { AuthenticationControls, AuthenticationNotice } from '../services/auth/AuthenticationGate';
import { CloudConversationSync } from './CloudConversationSync';

/** Kept separate so App remains independently testable while the hosted root always has first-party session chrome. */
export function AuthenticatedApp() {
  return <WorkspaceProvider><CloudConversationSync /><div className="session-bar"><AuthenticationNotice /><AuthenticationControls /></div><App /></WorkspaceProvider>;
}
