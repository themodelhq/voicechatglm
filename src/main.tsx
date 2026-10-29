import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthenticatedApp } from './app/AuthenticatedApp';
import { AuthenticationProvider } from './services/auth/AuthProvider';
import { AuthenticationGate } from './services/auth/AuthenticationGate';
import './styles/tokens.css';
import './styles/global.css';
import './styles/file-attachments.css';
import './styles/archive.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js'); });
}

createRoot(document.getElementById('root')!).render(<StrictMode><AuthenticationProvider><AuthenticationGate><AuthenticatedApp /></AuthenticationGate></AuthenticationProvider></StrictMode>);
