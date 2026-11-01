/* Bounded, deterministic orchestration. Plans are generated from server rules only;
 * model output is never treated as executable instructions. */
const { searchWeb, sourcesForModel } = require('./web-search.cjs'); const { retrievePage } = require('./web-retrieval.cjs');
const MAX_WORKFLOW_STEPS = 8; const MAX_RESEARCH_SOURCES = 5;
function assertNotCancelled(signal) { if (signal?.aborted) throw Object.assign(new Error('The workflow was cancelled.'), { code: 'CANCELLED', status: 499 }); }
function boundedMap(values, concurrency, operation, signal) { return new Promise((resolve, reject) => { const results = new Array(values.length); let next = 0; let active = 0; let done = 0; let rejected = false; const launch = () => { if (done === values.length) return resolve(results); while (active < concurrency && next < values.length && !rejected) { const index = next++; active += 1; Promise.resolve().then(() => { assertNotCancelled(signal); return operation(values[index], index); }).then(value => { results[index] = { ok: true, value }; }).catch(error => { if (signal?.aborted || error?.code === 'CANCELLED') { rejected = true; reject(Object.assign(new Error('The workflow was cancelled.'), { code: 'CANCELLED', status: 499 })); return; } results[index] = { ok: false, error: error?.code || 'RETRIEVAL_FAILED', message: 'This source could not be retrieved.' }; }).finally(() => { active -= 1; done += 1; if (!rejected) launch(); }); } }; launch(); }); }
function researchQuery(message) { return String(message).replace(/\b(search( the web)?|research|online sources?|reliable sources?|find|please|and (then )?(write|draft|create).*)\b/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 500); }
function researchPlan({ message, includeRetrieval }) { const query = researchQuery(message) || String(message).trim(); const steps = [{ id: 'search', operation: 'web_search', inputs: { query }, timeoutMs: 20_000, output: 'search_results', onError: 'stop', cancellable: true }]; if (includeRetrieval) steps.push({ id: 'retrieve', operation: 'website_retrieval', dependsOn: ['search'], timeoutMs: 30_000, output: 'page_extractions', onError: 'partial', cancellable: true }); steps.push({ id: 'synthesize', operation: 'model_synthesis', dependsOn: includeRetrieval ? ['search', 'retrieve'] : ['search'], timeoutMs: 60_000, output: 'grounded_answer', onError: 'stop', cancellable: true }); return { type: 'research_and_synthesis', steps }; }
async function runResearch({ message, searchConfiguration, retrievalConfiguration, signal, fetchImpl, retrievalOptions }) { const plan = researchPlan({ message, includeRetrieval: Boolean(retrievalConfiguration?.enabled && retrievalConfiguration?.configured) }); if (plan.steps.length > MAX_WORKFLOW_STEPS) throw new Error('Workflow plan exceeds the permitted step limit.'); assertNotCancelled(signal); const search = await searchWeb({ query: plan.steps[0].inputs.query, configuration: searchConfiguration, signal, fetchImpl }); if (!search.results.length) return { plan, search, pages: [], partial: true, notices: ['The search provider returned no results for this query.'] }; const candidates = search.results.slice(0, Math.min(2, retrievalConfiguration?.maxPages || 0)); const fetched = plan.steps.some(step => step.operation === 'website_retrieval') ? await boundedMap(candidates, Math.min(2, retrievalConfiguration.concurrency), candidate => retrievePage({ url: candidate.url, configuration: retrievalConfiguration, signal, ...retrievalOptions }), signal) : []; const pages = fetched.filter(item => item.ok).map(item => item.value); const failures = fetched.filter(item => !item.ok); const notices = []; if (!pages.length && fetched.length) notices.push('Search results were found, but no selected page could be retrieved under the configured safety policy.'); if (failures.length) notices.push(`${failures.length} selected source page(s) could not be retrieved.`); return { plan, search, pages, partial: Boolean(failures.length), notices };
}
function canonicalPageUrl(value) { try { const url = new URL(value); url.hash = ''; for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key); return url.toString(); } catch { return undefined; } }
function sameSite(left, right) { try { const a = new URL(left); const b = new URL(right); return a.hostname.toLowerCase() === b.hostname.toLowerCase(); } catch { return false; } }
function crawlPriority(value) { const path = (() => { try { return new URL(value).pathname.toLowerCase(); } catch { return ''; } })(); if (/\/(products?|product-detail|item)\//.test(path)) return 0; if (/\/(collections?|categories|catalog|shop|store|products?)\b/.test(path)) return 1; if (/[?&](page|paged|p)=\d+/i.test(value) || /\/(page|pages)\//.test(path)) return 2; return 3; }
async function runScrape({ urls, retrievalConfiguration, signal, retrievalOptions, onProgress, background = false }) {
  if (!Array.isArray(urls) || !urls.length) throw Object.assign(new Error('Provide at least one HTTP or HTTPS URL to retrieve.'), { code: 'CLARIFICATION_REQUIRED', status: 400 });
  // Synchronous callers retain the strict three-page response budget. Durable
  // background jobs may visit a bounded larger catalogue without holding open
  // the chat request; deployment limits are still respected.
  const configuredPageLimit = Math.max(1, Number(retrievalConfiguration.maxPages) || 100);
  const maxPages = background ? Math.min(100, configuredPageLimit) : 3;
  const maxLinks = Math.max(1, Math.min(20_000, Number(retrievalConfiguration.maxLinks) || 10_000));
  // Discover a bounded number of listing/category pages before visiting products.
  const maxDiscoveryPages = background ? Math.min(20, Math.max(1, Math.ceil(maxPages * 0.2))) : 2;
  const seeds = urls.map(canonicalPageUrl).filter(Boolean);
  const hosts = new Set(seeds.map(value => new URL(value).hostname.toLowerCase()));
  const productQueue = [];
  const productQueued = new Set();
  const discoveryQueue = [...seeds];
  const discoveryQueued = new Set(seeds);
  const visited = new Set();
  const pages = [];
  const failures = [];
  const productUrl = value => {
    try {
      const url = new URL(value); const path = url.pathname.toLowerCase();
      return /(?:^|\/)(?:products?|produits?|product-detail|item|p|artikel|produto)\/(?:[^/]+)(?:\/|$)/.test(path)
        || /[?&](?:product_id|product|sku)=/i.test(url.search);
    } catch { return false; }
  };
  const listingUrl = value => {
    try {
      const url = new URL(value); const path = url.pathname.toLowerCase();
      return /(?:^|\/)(?:collections?|categories|category|catalog|shop|store|products|clothing|men|women|kids|children)(?:\/|$)/.test(path)
        || /[?&](?:page|paged|p)=\d+/i.test(url.search);
    } catch { return false; }
  };
  const enqueueProduct = value => {
    const canonical = canonicalPageUrl(value);
    if (!canonical || !hosts.has(new URL(canonical).hostname.toLowerCase()) || productQueued.has(canonical) || visited.has(canonical)) return;
    if (productQueued.size >= maxLinks) return;
    productQueued.add(canonical); productQueue.push(canonical);
  };
  const enqueueDiscovery = value => {
    const canonical = canonicalPageUrl(value);
    if (!canonical || !hosts.has(new URL(canonical).hostname.toLowerCase()) || discoveryQueued.has(canonical) || visited.has(canonical) || !listingUrl(canonical)) return;
    if (discoveryQueued.size >= maxDiscoveryPages) return;
    discoveryQueued.add(canonical); discoveryQueue.push(canonical);
  };
  let discoveryVisited = 0;
  let productPagesVisited = 0;
  while ((discoveryQueue.length || productQueue.length) && pages.length + failures.length < maxPages) {
    assertNotCancelled(signal);
    // Always finish catalogue discovery before consuming the product queue. This
    // prevents an early batch of products from hiding later category pages.
    const phase = discoveryQueue.length ? 'discovery' : 'products';
    const sourceQueue = phase === 'discovery' ? discoveryQueue : productQueue;
    const batch = [];
    while (sourceQueue.length && batch.length < retrievalConfiguration.concurrency && pages.length + failures.length + batch.length < maxPages) {
      const candidate = sourceQueue.shift();
      if (!candidate || visited.has(candidate)) continue;
      visited.add(candidate); batch.push(candidate);
    }
    if (!batch.length) {
      if (!discoveryQueue.length && !productQueue.length) break;
      continue;
    }
    const results = await boundedMap(batch, retrievalConfiguration.concurrency, url => retrievePage({ url, configuration: retrievalConfiguration, signal, ...retrievalOptions }), signal);
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index]; const requestedUrl = batch[index];
      if (!result.ok) {
        failures.push({ url: requestedUrl, code: result.error, message: result.message, pageType: phase === 'products' ? 'product' : 'discovery' });
        if (phase === 'discovery') discoveryVisited += 1; else productPagesVisited += 1;
        continue;
      }
      const page = result.value; page.pageType = phase === 'products' || productUrl(requestedUrl) ? 'product' : 'discovery';
      pages.push(page);
      if (page.pageType === 'product') productPagesVisited += 1; else discoveryVisited += 1;
      const finalCanonical = canonicalPageUrl(page.finalUrl || page.url);
      if (finalCanonical) {
        visited.add(finalCanonical);
        if (pages.length === 1) hosts.add(new URL(finalCanonical).hostname.toLowerCase());
      }
      // Product objects embedded in category JSON-LD can reveal exact product URLs,
      // even where the store uses non-standard URL paths.
      for (const item of page.products || []) if (item.url && item.url !== requestedUrl) enqueueProduct(item.url);
      for (const link of page.links || []) {
        const canonical = canonicalPageUrl(link.url);
        if (!canonical || !hosts.has(new URL(canonical).hostname.toLowerCase())) continue;
        const parsed = new URL(canonical);
        if (/\\.(?:pdf|zip|png|jpe?g|gif|webp|svg|mp4|mp3|css|js|xml)(?:$|\?)/i.test(parsed.pathname)) continue;
        if (link.productCandidate || productUrl(canonical)) enqueueProduct(canonical);
        else if (phase === 'discovery' && discoveryVisited < maxDiscoveryPages) enqueueDiscovery(canonical);
      }
    }
    await onProgress?.({
      pages, failures,
      crawl: {
        phase: phase === 'discovery' ? 'discovering_catalogue' : 'extracting_products',
        batchSize: batch.length,
        pagesVisited: pages.length + failures.length,
        productRecordsFound: pages.reduce((total, item) => total + (item.products?.length || 0), 0),
        pagesDiscovered: discoveryQueued.size + productQueued.size,
        queuedButNotVisited: discoveryQueue.length + productQueue.length,
        discoveryPagesVisited: discoveryVisited,
        productPagesVisited,
        productUrlsDiscovered: productQueued.size,
        productUrlsRemaining: productQueue.length,
        discoveryPagesRemaining: discoveryQueue.length
      }
    });
  }
  const products = pages.reduce((total, page) => total + (page.products?.length || 0), 0);
  const remaining = discoveryQueue.length + productQueue.length;
  const partial = Boolean(failures.length || remaining || discoveryVisited >= maxDiscoveryPages || pages.length + failures.length >= maxPages);
  const steps = pages.map((page, index) => ({ id: `retrieve_${index + 1}`, operation: 'website_retrieval', inputs: { url: page.requestedUrl || page.url }, output: 'page_extraction', onError: 'partial', cancellable: true }));
  if (!pages.length) throw Object.assign(new Error('No requested page could be retrieved under the configured safety policy.'), { code: failures[0]?.code || 'RETRIEVAL_FAILED', status: 422, failures });
  return {
    plan: { type: 'website_product_catalogue', steps }, pages, failures, partial,
    crawl: {
      phase: 'preparing_workbook',
      seedUrls: seeds, pagesVisited: visited.size, pagesRetrieved: pages.length,
      pagesDiscovered: discoveryQueued.size + productQueued.size,
      queuedButNotVisited: remaining, discoveryPagesVisited: discoveryVisited,
      productPagesVisited, productUrlsDiscovered: productQueued.size,
      productUrlsRemaining: productQueue.length, discoveryPagesRemaining: discoveryQueue.length,
      discoveryPageLimit: maxDiscoveryPages, pageLimit: maxPages, productRecordsFound: products
    }
  };
}
function evidenceForModel({ search, pages }) { const snippets = search?.results?.length ? sourcesForModel(search.results) : ''; const extracted = (pages || []).map((page, index) => `[Retrieved page ${index + 1}: ${page.title || page.url}\nRequested URL: ${page.requestedUrl || page.url}\nFinal URL: ${page.finalUrl || page.url}\nRetrieved: ${page.retrievedAt}\nMethod: ${page.retrievalMethod || 'direct_html'}\nDescription: ${page.description || '(none)'}${page.truncated ? '\nExtraction is partial because the configured text limit was reached.' : ''}\nExtracted conventional HTML text:\n${page.text || '(no extractable text)'}${page.tables?.length ? `\nStructured tables: ${JSON.stringify(page.tables)}` : ''}${page.products?.length ? `\nStructured products: ${JSON.stringify(page.products)}` : ''}]`).join('\n\n'); return [snippets, extracted].filter(Boolean).join('\n\n'); }
module.exports = { MAX_WORKFLOW_STEPS, MAX_RESEARCH_SOURCES, boundedMap, researchQuery, researchPlan, runResearch, runScrape, evidenceForModel };
