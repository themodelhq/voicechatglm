import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { classifyIntent, routeChat } = require('../server/intent-router.cjs') as typeof import('../server/intent-router.cjs');

describe('central deterministic intent router', () => {
  it('keeps ordinary questions on the normal model path without invoking a tool', async () => {
    expect(classifyIntent('Explain how neural networks work.').intent).toBe('general_chat'); const result = await routeChat({ message: 'Explain how neural networks work.', request: { message: 'Explain how neural networks work.', max_new_tokens: 256 }, userId: 'owner', repository: {}, callModel: async () => { throw new Error('should not run during route selection'); }, env: {} }); expect(result).toMatchObject({ type: 'model', route: 'general_chat' });
  });
  it('distinguishes tool questions, missing targets, explicit searches, and unsafe arbitrary actions', () => {
    expect(classifyIntent('Can you search the web?').intent).toBe('general_chat'); expect(classifyIntent('Scrape the website and compare the results.')).toMatchObject({ intent: 'clarification_required' }); expect(classifyIntent('Search the web for current open source models.')).toMatchObject({ intent: 'web_search' }); expect(classifyIntent('Extract listed prices from https://shop.example/products.')).toMatchObject({ intent: 'website_scraping' }); expect(classifyIntent('Research this topic with sources and write a report.').intent).toBe('research_and_synthesis'); expect(classifyIntent('Help me write a 20-chapter paranormal romance novel.').intent).toBe('book_writing'); expect(classifyIntent('Run a bash command on the server.').intent).toBe('unsupported_capability');
  });
  it('returns an honest capability-unavailable error rather than silently falling back to ordinary chat', async () => {
    await expect(routeChat({ message: 'Search the web for source-grounded news.', request: { message: 'Search the web for source-grounded news.', max_new_tokens: 256 }, userId: 'owner', repository: {}, callModel: async () => ({ status: 200, body: { response: 'not used' } }), env: { WEB_SEARCH_ENABLED: 'false' } })).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 503 });
  });

  it('automatically routes naturally phrased questions about current office holders to live search', () => {
    expect(classifyIntent('Who is the president of the United States of America?')).toMatchObject({ intent: 'web_search', currentInformation: true });
    expect(classifyIntent('Who is the current president of Nigeria?')).toMatchObject({ intent: 'web_search', currentInformation: true });
  });
  it('automatically routes other time-sensitive questions without an explicit search instruction', () => {
    expect(classifyIntent('What are the latest developments in the conflict?')).toMatchObject({ intent: 'web_search', currentInformation: true, searchTopic: 'news' });
    expect(classifyIntent('What is the current exchange rate for USD to NGN?')).toMatchObject({ intent: 'web_search', currentInformation: true });
    expect(classifyIntent('What is the price of gold?')).toMatchObject({ intent: 'web_search', currentInformation: true });
    expect(classifyIntent('Did Arsenal win?')).toMatchObject({ intent: 'web_search', currentInformation: true });
    expect(classifyIntent('Explain electric current in a circuit.').intent).toBe('general_chat');
  });
  it('does not silently fall back to stale model knowledge when live search is unavailable for a current question', async () => {
    await expect(routeChat({ message: 'Who is the president of the United States of America?', request: { message: 'Who is the president of the United States of America?', max_new_tokens: 256 }, userId: 'owner', repository: {}, callModel: async () => ({ status: 200, body: { response: 'stale answer' } }), env: { WEB_SEARCH_ENABLED: 'false' } })).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 503 });
  });

});
