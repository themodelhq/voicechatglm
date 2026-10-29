import type { Conversation } from '../types/domain';

export const id = (): string => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function titleFromMessage(message: string): string {
  const cleaned = message.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'New conversation';
  return cleaned.length > 52 ? `${cleaned.slice(0, 49)}…` : cleaned;
}

export function relativeGroup(iso: string): string {
  const date = new Date(iso); const now = new Date();
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.floor((midnight(now) - midnight(date)) / 86400000);
  if (days <= 0) return 'Today'; if (days === 1) return 'Yesterday'; if (days <= 7) return 'Previous 7 Days'; if (days <= 30) return 'Previous 30 Days'; return 'Older';
}

export function groupConversations(conversations: Conversation[]): Array<[string, Conversation[]]> {
  const map = new Map<string, Conversation[]>();
  for (const conversation of conversations.filter(c => !c.archived).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || +new Date(b.updatedAt) - +new Date(a.updatedAt))) {
    const key = relativeGroup(conversation.updatedAt); map.set(key, [...(map.get(key) ?? []), conversation]);
  }
  return ['Today', 'Yesterday', 'Previous 7 Days', 'Previous 30 Days', 'Older'].flatMap(key => map.has(key) ? [[key, map.get(key)!] as [string, Conversation[]]] : []);
}

export function formatTime(iso: string): string { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso)); }
