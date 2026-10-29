import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="brand" aria-label="VoiceChatGLM"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>{!compact && <span>VoiceChat<span>GLM</span></span>}</div>;
}

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const glyphs: Record<string, string> = { plus: '+', menu: '☰', chat: '◌', agents: '✦', knowledge: '▤', tools: '⌘', settings: '⚙', search: '⌕', send: '↑', close: '×', more: '⋯', chevron: '›', archive: '⌑', trash: '⌫', star: '☆', starred: '★', edit: '✎', copy: '⧉', retry: '↻', check: '✓', warning: '!', offline: '◒', download: '⇩', info: 'i', external: '↗', back: '←', moon: '◐', sun: '☀', connection: '◉', pin: '⌖', duplicate: '⧉', expand: '↗', mic: '◉', 'thumb-up': '↑', 'thumb-down': '↓' };
  return <span aria-hidden="true" className={`icon icon-${name}`} style={{ fontSize: size }}>{glyphs[name] ?? '•'}</span>;
}

export function Button({ children, variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon' }) {
  return <button className={`button button-${variant} ${className}`} {...props}>{children}</button>;
}

export function StatusBadge({ state, children }: { state: 'available' | 'pending' | 'unavailable' | 'local'; children: ReactNode }) {
  return <span className={`status status-${state}`}><span />{children}</span>;
}

export function Dialog({ title, children, onClose, labelledBy = 'dialog-title' }: { title: string; children: ReactNode; onClose: () => void; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; ref.current?.focus(); const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; document.addEventListener('keydown', handler); return () => { document.removeEventListener('keydown', handler); previous?.focus(); }; }, [onClose]);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} ref={ref}><div className="dialog-head"><h2 id={labelledBy}>{title}</h2><Button variant="icon" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></Button></div>{children}</section></div>;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) { return <div className="empty-state"><div className="empty-orb" aria-hidden="true">✦</div><h2>{title}</h2><p>{detail}</p>{action}</div>; }
