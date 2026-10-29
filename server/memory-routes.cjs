const { validId } = require('./writing-routes.cjs');
function failure(status, message) { return { status, body: { error: message } }; }
function input(value, allowed) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key)) ? value : undefined; }
function clean(value, maximum) { return typeof value === 'string' && value.trim() && value.trim().length <= maximum ? value.trim() : undefined; }
function memoryPublic(memory) { return memory && { ...memory }; }
async function handleMemoryRoute({ route, method, body, userId, repository }) {
  const parts = String(route).split('/').filter(Boolean); if (parts[0] !== 'memories') return failure(404, 'Memory route not found.');
  if (parts.length === 1) {
    if (method === 'GET') return { status: 200, body: { memories: (await repository.memoriesForOwner(userId)).map(memoryPublic) } };
    if (method === 'POST') { const value = input(body, ['type', 'label', 'content', 'sourceConversationId']); const label = clean(value?.label, 160); const content = clean(value?.content, 1800); if (!value || !['explicit_preference', 'project_note', 'stable_fact'].includes(value.type) || !label || !content || value.sourceConversationId !== undefined && !validId(value.sourceConversationId)) return failure(400, 'Memory input is invalid.'); if (value.sourceConversationId && !await repository.conversationForOwner(userId, value.sourceConversationId)) return failure(404, 'Source conversation not found.'); const memory = await repository.createMemory({ userId, type: value.type, label, content, sourceConversationId: value.sourceConversationId }); return { status: 201, body: { memory: memoryPublic(memory) } }; }
    if (method === 'DELETE') return { status: 200, body: { cleared: await repository.clearMemories(userId) } };
    return failure(405, 'Method not allowed.');
  }
  const id = parts[1]; if (!validId(id)) return failure(404, 'Memory not found.');
  if (method === 'GET') { const memory = await repository.memoryForOwner(userId, id); return memory ? { status: 200, body: { memory: memoryPublic(memory) } } : failure(404, 'Memory not found.'); }
  if (method === 'PATCH') { const value = input(body, ['label', 'content', 'enabled']); const label = value?.label === undefined ? undefined : clean(value.label, 160); const content = value?.content === undefined ? undefined : clean(value.content, 1800); if (!value || value.label !== undefined && !label || value.content !== undefined && !content || value.enabled !== undefined && typeof value.enabled !== 'boolean') return failure(400, 'Memory update is invalid.'); const memory = await repository.updateMemory(userId, id, { label, content, enabled: value.enabled }); return memory ? { status: 200, body: { memory: memoryPublic(memory) } } : failure(404, 'Memory not found.'); }
  if (method === 'DELETE') { const memory = await repository.deleteMemory(userId, id); return memory ? { status: 200, body: { deleted: true } } : failure(404, 'Memory not found.'); }
  return failure(405, 'Method not allowed.');
}
module.exports = { handleMemoryRoute };
