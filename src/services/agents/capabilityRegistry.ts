import type { Capability } from '../../types/domain';

/** Static identifiers only for locally stored agent preferences. Runtime state is obtained
 * from GET /api/capabilities in ToolsWorkspace; this file must never claim availability. */
export const capabilityRegistry: Capability[] = [
  { id: 'chat', name: 'General chat', description: 'Conversation routed to the protected model.', category: 'Core', state: 'requires-configuration', requires: 'Backend model readiness.', permission: 'Authenticated application session.', implemented: true },
  { id: 'web_search', name: 'Web search', description: 'Configured provider search with attributable source metadata.', category: 'Research', state: 'requires-configuration', requires: 'Enabled server-side documented search provider.', permission: 'Authenticated application session.', implemented: true },
  { id: 'website_scraping', name: 'Website retrieval', description: 'SSRF-protected conventional HTML retrieval and extraction.', category: 'Research', state: 'requires-configuration', requires: 'Enabled retrieval policy and successful guarded request.', permission: 'Authenticated application session.', implemented: true },
  { id: 'research_and_synthesis', name: 'Research and synthesis', description: 'Bounded search, permitted retrieval, and grounded synthesis.', category: 'Research', state: 'requires-configuration', requires: 'Enabled web search and model services.', permission: 'Authenticated application session.', implemented: true },
  { id: 'book_writing', name: 'Writing projects', description: 'Saved outlines, chapters, revisions and export.', category: 'Writing', state: 'requires-configuration', requires: 'Enabled PostgreSQL-backed writing workflow and model.', permission: 'Authenticated application session and project ownership.', implemented: true },
  { id: 'file-analysis', name: 'File analysis', description: 'Private document and archive analysis.', category: 'Documents', state: 'requires-configuration', requires: 'Verified production storage, scanner and model gate.', permission: 'Explicit selected file access.', implemented: true },
  { id: 'task_planning', name: 'Task planning', description: 'Bounded plans without arbitrary server execution.', category: 'Core', state: 'requires-configuration', requires: 'Backend model readiness.', permission: 'Authenticated application session.', implemented: true },
  { id: 'knowledge', name: 'Knowledge retrieval', description: 'Ground responses in indexed, approved knowledge.', category: 'Knowledge', state: 'coming-soon', requires: 'Retrieval, indexing, and authorization services.', permission: 'Knowledge source access.', implemented: false },
  { id: 'voice', name: 'Voice interaction', description: 'Speech transcription and playback.', category: 'Voice', state: 'coming-soon', requires: 'Browser support or server voice service.', permission: 'Microphone permission.', implemented: false },
];
export const capabilityById = (id: string): Capability | undefined => capabilityRegistry.find(capability => capability.id === id);
