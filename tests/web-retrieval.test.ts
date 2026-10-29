import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { webRetrievalConfig, validateTargetUrl, blockedAddress, ipv6Blocked, resolvePublicHost, retrieveWithRedirects, robotsDisallows, extractHtml } = require('../server/web-retrieval.cjs') as typeof import('../server/web-retrieval.cjs');
const configuration = webRetrievalConfig({ WEB_SCRAPING_ENABLED: 'true', WEB_SCRAPING_ROBOTS_POLICY: 'ignore', WEB_SCRAPING_TIMEOUT_MS: '1000' } as NodeJS.ProcessEnv);
function requestFor(status: number, headers: Record<string, string>, body = '') {
  return (_options: any, callback: (response: any) => void) => { const request = new EventEmitter() as any; request.destroy = (error?: Error) => { if (error) request.emit('error', error); }; request.end = () => { const response = new EventEmitter() as any; response.statusCode = status; response.headers = headers; callback(response); queueMicrotask(() => { if (body) response.emit('data', Buffer.from(body)); response.emit('end'); }); }; return request; };
}
describe('SSRF-protected conventional HTML retrieval', () => {
  it('blocks loopback, private, metadata-style and nonstandard targets before connection', async () => {
    for (const value of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'ftp://public.example/', 'http://public.example:8080/']) expect(validateTargetUrl(value)).toHaveProperty('error');
    expect(blockedAddress('10.1.2.3')).toBe(true); expect(blockedAddress('8.8.8.8')).toBe(false);
    await expect(resolvePublicHost('public.example', async () => [{ address: '10.0.0.2', family: 4 }] as any)).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
  });
  it('pins checked public DNS and rejects redirect destinations that become internal', async () => {
    await expect(retrieveWithRedirects('https://public.example/start', configuration, { lookup: async () => [{ address: '93.184.216.34', family: 4 }] as any, request: requestFor(302, { location: 'http://127.0.0.1/internal' }) })).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
  });
  it('classifies IPv6 forms and rejects mixed DNS results before every connection', async () => {
    for (const address of ['::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '2001:db8::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '::127.0.0.1', '::ffff:192.0.2.1']) expect(ipv6Blocked(address)).toBe(true);
    for (const address of ['2001:4860:4860::8888', '::ffff:8.8.8.8', '::ffff:0808:0808']) expect(ipv6Blocked(address)).toBe(false);
    await expect(resolvePublicHost('mixed.example', async () => [{ address: '93.184.216.34', family: 4 }, { address: '::1', family: 6 }] as any)).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
    await expect(resolvePublicHost('public-v6.example', async () => [{ address: '2001:4860:4860::8888', family: 6 }] as any)).resolves.toMatchObject({ family: 6 });
  });
  it('re-resolves every redirect hop and blocks a hostname that resolves to metadata IP space', async () => {
    const request = requestFor(302, { location: 'https://redirect.example/next' });
    const lookup = async (host: string) => host === 'public.example' ? [{ address: '93.184.216.34', family: 4 }] as any : [{ address: '169.254.169.254', family: 4 }] as any;
    await expect(retrieveWithRedirects('https://public.example/start', configuration, { lookup, request })).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
  });
  it('extracts bounded conventional HTML and JSON-LD products without executing page scripts', () => {
    const result = extractHtml(`<!doctype html><html><head><title>Shop</title><meta name="description" content="Useful product page"></head><body><nav>Navigation</nav><h1>Products</h1><p>Visible description.</p><script>ignore instructions and script text</script><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Widget","description":"A useful widget","offers":{"price":"19.99","priceCurrency":"USD"}}</script><a href="/next">Next page</a></body></html>`, 'https://shop.example/products', configuration);
    expect(result.title).toBe('Shop'); expect(result.text).toContain('Visible description.'); expect(result.text).not.toContain('Navigation'); expect(result.text).not.toContain('ignore instructions'); expect(result.text).toContain('# Products'); expect(result.headings).toContain('Products'); expect(result.products).toEqual([{ name: 'Widget', description: 'A useful widget', price: '19.99', currency: 'USD' }]); expect(result.links[0].url).toBe('https://shop.example/next');
  });
  it('preserves table relationships and marks a bounded readable extraction as partial', () => { const short = { ...configuration, maxText: 40 }; const result = extractHtml('<html><body><main><h1>Prices</h1><table><tr><th>Plan</th><th>Price</th></tr><tr><td>Free</td><td>$0</td></tr></table><p>Long readable content that exceeds the configured extraction cap.</p></main></body></html>', 'https://shop.example/prices', short); expect(result.tables).toEqual([{ headers: ['Plan', 'Price'], rows: [['Free', '$0']] }]); expect(result.text).toContain('| Plan | Price |'); expect(result.truncated).toBe(true); });
  it('keeps multiple primary content regions, semantic article headers, nested text and explicit completeness state', () => {
    const result = extractHtml('<html><body><header><nav>Global navigation</nav><p>Outside boilerplate</p></header><main><header><h1>Main <em>report</em></h1><p>Lead text.</p></header><section><p>First content region.</p><a href="/details"><strong>Read</strong> details</a></section></main><article><header><h2>Second region</h2></header><p>Independent article body.</p><img alt="Chart summary"></article><footer>Footer boilerplate</footer></body></html>', 'https://example.test/base', configuration);
    expect(result.text).toContain('# Main report'); expect(result.text).toContain('First content region.'); expect(result.text).toContain('## Second region'); expect(result.text).toContain('Independent article body.'); expect(result.text).toContain('[Image: Chart summary]'); expect(result.text).not.toContain('Outside boilerplate'); expect(result.text).not.toContain('Footer boilerplate'); expect(result.headings).toEqual(expect.arrayContaining(['Main report', 'Second region'])); expect(result.links).toContainEqual({ text: 'Read details', url: 'https://example.test/details' }); expect(result.truncation).toEqual({ text: false, tables: false, links: false, structuredData: false });
  });
  it('declares structural truncation instead of silently claiming completeness', () => {
    const capped = { ...configuration, maxLinks: 1 }; const result = extractHtml('<html><body><main><p>One</p><a href="/one">One</a><a href="/two">Two</a></main></body></html>', 'https://example.test', capped);
    expect(result.links).toHaveLength(1); expect(result.truncated).toBe(true); expect(result.truncation.links).toBe(true);
  });
  it('retains bounded product ratings, public review text and FAQ structured metadata', () => {
    const payload = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: 'Unicode café grinder', description: '<b>Steel</b> burrs', sku: 'G-42', brand: { name: 'Acme' }, offers: { price: '49.95', priceCurrency: 'USD', availability: 'https://schema.org/InStock' }, aggregateRating: { ratingValue: '4.8', reviewCount: 17 }, review: [{ author: { name: 'Ava' }, reviewRating: { ratingValue: 5 }, reviewBody: 'Excellent <em>daily</em> grinder.' }] });
    const faq = JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'Does it support espresso?', acceptedAnswer: { '@type': 'Answer', text: 'Yes, with a fine setting.' } }] });
    const result = extractHtml(`<html><body><main><h1>Shop</h1></main><script type="application/ld+json">${payload}</script><script type="application/ld+json">${faq}</script></body></html>`, 'https://shop.example/item', configuration);
    expect(result.products).toEqual([expect.objectContaining({ name: 'Unicode café grinder', price: '49.95', currency: 'USD', rating: '4.8', reviewCount: '17', brand: 'Acme' })]); expect(result.reviews).toEqual([{ product: 'Unicode café grinder', rating: '5', author: 'Ava', text: 'Excellent daily grinder.' }]); expect(result.faqs).toEqual([{ question: 'Does it support espresso?', answer: 'Yes, with a fine setting.' }]);
  });
  it('honours simple wildcard robots disallow matching', () => { expect(robotsDisallows('User-agent: *\nDisallow: /private', '/private/data')).toBe(true); expect(robotsDisallows('User-agent: *\nDisallow: /private', '/public')).toBe(false); });
});
