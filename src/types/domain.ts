export type ThemeMode = 'light' | 'dark' | 'system';
export type Density = 'comfortable' | 'compact';
export type AppView = 'chat' | 'agents' | 'knowledge' | 'writing' | 'tools' | 'settings';
export type MessageRole = 'user' | 'assistant' | 'system';
export type CapabilityState = 'available' | 'requires-configuration' | 'coming-soon' | 'unavailable';
export type AgentStatus = 'draft' | 'local-ready';
export type AttachmentState = 'selected' | 'validating' | 'uploading' | 'processing' | 'inspecting' | 'extracting' | 'ready' | 'partial' | 'manifest-only' | 'analyzing' | 'complete' | 'cancelled' | 'expired' | 'failed' | 'unavailable';

export interface ArchiveMemberReference {
  path: string;
  type: string;
  compressedSize: number;
  uncompressedSize: number;
  validation: string;
  extraction: string;
  analysisEligible: boolean;
  reason?: string;
  redacted?: boolean;
}
export interface ArchiveReference {
  inspectedAt: string;
  partial: boolean;
  inspectionAvailable?: boolean;
  contentAnalysisAvailable?: boolean;
  processingStatus?: 'ready' | 'partial' | 'manifest-only' | 'failed' | 'cancelled';
  summary: { totalEntries: number; validatedEntries: number; successfullyExtracted: number; analyzedFiles: number; unsupportedFiles: number; rejectedFiles: number; excludedFiles: number; nestedArchives: number; omittedFiles?: number };
  members: ArchiveMemberReference[];
}
export interface AttachmentReference {
  localId: string;
  fileId?: string;
  filename: string;
  type: string;
  size: number;
  state: AttachmentState;
  error?: string;
  notices?: string[];
  sources?: SourceReference[];
  analysisAvailable?: boolean;
  archive?: ArchiveReference;
}
export interface SourceReference { fileId?: string; filename: string; location: string; truncated?: boolean; }
export interface CitationReference { title: string; url?: string; sourceId?: string; publicationDate?: string; section?: string; page?: number; kind?: 'search' | 'retrieved_page' | 'knowledge'; }
export interface ToolEventReference { id: string; status: 'completed' | 'partial' | 'skipped' | 'failed'; detail: string; }
export interface ArtifactReference { id: string; filename: string; contentType: string; format: string; size: number; checksum?: string; status: 'available' | 'creating' | 'failed' | 'deleted' | 'expired'; preview?: { safePreview?: boolean; label?: string }; createdAt: string; expiresAt?: string; messageId?: string; }

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  status?: 'sending' | 'streaming' | 'complete' | 'partial' | 'error' | 'cancelled';
  error?: string;
  feedback?: 'positive' | 'negative';
  attachments?: AttachmentReference[];
  artifacts?: ArtifactReference[];
  sources?: SourceReference[];
  citations?: CitationReference[];
  toolEvents?: ToolEventReference[];
  route?: string;
  scrapeJobId?: string;
  notices?: string[];
  analysisTruncated?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  /** The stable local agent reference. It is retained if an agent is later deleted. */
  agentId?: string;
  model: string;
  favorite: boolean;
  pinned: boolean;
  archived: boolean;
}

export interface AgentInstructions {
  role: string;
  objectives: string;
  tone: string;
  responseStyle: string;
  outputFormat: string;
  constraints: string;
  clarificationBehavior: string;
  uncertaintyHandling: string;
  safetyBehavior: string;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  purpose: string;
  icon: string;
  accent: string;
  category: string;
  examplePrompts: string[];
  instructions: AgentInstructions;
  maxNewTokens: number;
  capabilityIds: string[];
  status: AgentStatus;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export interface Capability {
  id: string;
  name: string;
  description: string;
  category: string;
  state: CapabilityState;
  requires: string;
  permission: string;
  implemented: boolean;
}

export interface KnowledgeSource {
  id: string;
  name: string;
  type: 'document' | 'text' | 'collection';
  status: 'pending-backend' | 'failed';
  agentIds: string[];
  createdAt: string;
}

export interface Preferences {
  theme: ThemeMode;
  density: Density;
  enterToSend: boolean;
  defaultView: AppView;
  reduceMotion: boolean;
  language: string;
  codeWrap: boolean;
}

export interface ConnectionStatus {
  health: 'unknown' | 'checking' | 'healthy' | 'unavailable';
  ready: 'unknown' | 'checking' | 'ready' | 'unavailable';
  checkedAt?: string;
  detail?: string;
}

/**
 * Version 2 adds a monotonic local revision and timestamp. They make cross-tab
 * conflict handling deterministic and support safe migration from v1.
 */
export interface StorageState {
  version: 2;
  revision: number;
  updatedAt: string;
  conversations: Conversation[];
  agents: Agent[];
  preferences: Preferences;
  drafts: Record<string, string>;
}

export const defaultPreferences: Preferences = {
  theme: 'system',
  density: 'comfortable',
  enterToSend: true,
  defaultView: 'chat',
  reduceMotion: false,
  language: 'English',
  codeWrap: true,
};
