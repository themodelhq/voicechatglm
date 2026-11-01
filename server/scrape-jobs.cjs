const { randomUUID } = require('node:crypto');
const { getPool } = require('./db/pool.cjs');
const { runScrape } = require('./orchestrator.cjs');
const { webRetrievalConfig } = require('./web-retrieval.cjs');
const { artifactConfig, persistGeneratedArtifact } = require('./artifacts.cjs');
const { createObjectStore } = require('./files/object-storage.cjs');
const WORKER_ID = `scrape-${process.pid}-${randomUUID()}`;
const POLL_MS = 1500;
const LEASE_MS = 300000;
function publicJob(row) {
  return row && { id: row.id, status: row.status, pagesVisited: Number(row.pages_visited || 0), pagesDiscovered: Number(row.pages_discovered || 0), productsFound: Number(row.products_found || 0), failedPages: Number(row.failed_pages || 0), artifactId: row.artifact_id || undefined, progress: row.progress || {}, errorCode: row.error_code || undefined, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at || undefined };
}
async function enqueueScrapeJob({ userId, conversationId, assistantMessageId, urls, message }) {
  const id = randomUUID();
  await getPool().query(`INSERT INTO website_scrape_jobs(id,user_id,conversation_id,assistant_message_id,seed_urls,request_message)
    VALUES($1,$2,$3,$4,$5::jsonb,$6)`, [id,userId,conversationId,assistantMessageId || null,JSON.stringify(urls),String(message).slice(0,12000)]);
  return { id, status: 'queued' };
}
async function getScrapeJob(userId, id) {
  const result = await getPool().query('SELECT * FROM website_scrape_jobs WHERE id=$1 AND user_id=$2',[id,userId]);
  return publicJob(result.rows[0]);
}
async function claimJob() {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`SELECT * FROM website_scrape_jobs
      WHERE (status='queued' OR (status='running' AND lease_expires_at < NOW()))
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
    const row = result.rows[0];
    if (!row) { await client.query('COMMIT'); return undefined; }
    await client.query(`UPDATE website_scrape_jobs SET status='running',worker_id=$2,
      lease_expires_at=NOW()+($3 * INTERVAL '1 millisecond'),
      started_at=COALESCE(started_at,NOW()),updated_at=NOW() WHERE id=$1`,[row.id,WORKER_ID,LEASE_MS]);
    await client.query('COMMIT');
    return row;
  } catch (error) { await client.query('ROLLBACK').catch(()=>undefined); throw error; }
  finally { client.release(); }
}
async function updateProgress(id, workflow) {
  const products = workflow.pages.reduce((sum,page)=>sum+(page.products?.length||0),0);
  await getPool().query(`UPDATE website_scrape_jobs SET pages_visited=$2,pages_discovered=$3,
    products_found=$4,failed_pages=$5,progress=$6::jsonb,lease_expires_at=NOW()+($7 * INTERVAL '1 millisecond'),
    updated_at=NOW() WHERE id=$1 AND status='running' AND worker_id=$8`,
    [id,workflow.pages.length,workflow.crawl?.pagesDiscovered || workflow.pages.length,products,workflow.failures.length,
     JSON.stringify({phase:workflow.crawl?.phase||'retrieving_pages',batchSize:workflow.crawl?.batchSize||0,pagesVisited:workflow.crawl?.pagesVisited||workflow.pages.length,productRecordsFound:workflow.crawl?.productRecordsFound||products,queuedButNotVisited:workflow.crawl?.queuedButNotVisited||0,discoveryPagesVisited:workflow.crawl?.discoveryPagesVisited||0,productPagesVisited:workflow.crawl?.productPagesVisited||0,productUrlsDiscovered:workflow.crawl?.productUrlsDiscovered||0,productUrlsRemaining:workflow.crawl?.productUrlsRemaining||0,discoveryPagesRemaining:workflow.crawl?.discoveryPagesRemaining||0,detectedPlatforms:workflow.crawl?.detectedPlatforms||[],sitemapsVisited:workflow.crawl?.sitemapsVisited||0,sitemapLimitReached:Boolean(workflow.crawl?.sitemapLimitReached),backgroundMode:Boolean(workflow.crawl?.backgroundMode),configuredPageLimit:workflow.crawl?.configuredPageLimit||null,effectivePageLimit:workflow.crawl?.effectivePageLimit||null,discoveryPageLimit:workflow.crawl?.discoveryPageLimit||null,workerId:WORKER_ID}),LEASE_MS,WORKER_ID]);
}
function catalogueRows(workflow) {
  const byIdentity = new Map();
  const clean = value => value === undefined || value === null || String(value).trim() === '' ? undefined : String(value).trim();
  const canonical = value => { try { const url = new URL(value); url.hash = ''; for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key); return url.toString(); } catch { return clean(value); } };
  for (const page of workflow.pages || []) for (const item of page.products || []) {
    const url = canonical(item.url || page.finalUrl || page.url);
    const sku = clean(item.sku);
    const key = url ? `url:${url.toLowerCase()}` : sku ? `sku:${sku.toLowerCase()}` : `name:${clean(item.name || page.title)?.toLowerCase() || randomUUID()}`;
    const existing = byIdentity.get(key) || { name: '', description: '', price: '', currency: '', availability: '', sku: '', brand: '', rating: '', reviewCount: '', url: '', imageUrls: [] };
    // Detail-page values enrich listing-card values; absent values never erase known data.
    for (const field of ['name','description','price','currency','availability','sku','brand','rating','reviewCount']) {
      const value = clean(item[field]);
      if (value && (!existing[field] || page.pageType === 'product' && field !== 'sku')) existing[field] = value;
    }
    if (url && (!existing.url || page.pageType === 'product')) existing.url = url;
    const images = [...(item.imageUrls || []), ...(item.imageUrl ? [item.imageUrl] : [])].map(clean).filter(Boolean);
    existing.imageUrls = [...new Set([...existing.imageUrls, ...images])];
    byIdentity.set(key, existing);
  }
  const rows = [...byIdentity.values()].map(item => [item.name,item.description,item.price,item.currency,item.availability,item.sku,item.brand,item.rating,item.reviewCount,item.url,item.imageUrls.join(' | ')]);
  return [['Product Name','Description','Price','Currency','Availability','SKU','Brand','Rating','Review Count','Product URL','Image URLs'],...rows];
}
async function processJob(job) {
  const env=process.env, cfg=webRetrievalConfig(env);
  if(!cfg.enabled||!cfg.configured) throw Object.assign(new Error('Website retrieval is disabled or misconfigured.'),{code:'CAPABILITY_UNAVAILABLE'});
  const workflow=await runScrape({urls:Array.isArray(job.seed_urls)?job.seed_urls:[],retrievalConfiguration:cfg,background:true,onProgress:snapshot=>updateProgress(job.id,snapshot)});
  await updateProgress(job.id,{...workflow,crawl:{...workflow.crawl,phase:'preparing_workbook'}});
  const rows=catalogueRows(workflow), count=Math.max(0,rows.length-1);
  if(!count) throw Object.assign(new Error('No structured product records were extracted from the retrieved pages.'),{code:'NO_PRODUCTS'});
  const artifacts=artifactConfig(env);
  if(!artifacts.enabled||!artifacts.configured) throw Object.assign(new Error('Private Excel artifact storage is unavailable.'),{code:'ARTIFACT_UNAVAILABLE'});
  const repository=require('./auth.cjs').repositoryFor(env);
  const store=createObjectStore(artifacts.storage);
  const artifact=await persistGeneratedArtifact({repository,store,userId:job.user_id,conversationId:job.conversation_id,messageId:job.assistant_message_id,jobId:job.id,title:'Website Product Catalogue',content:'Website product catalogue',format:'xlsx',rows,expiresAt:new Date(Date.now()+artifacts.retentionMs)});
  const status=workflow.partial?'partial':'completed';
  await getPool().query(`UPDATE website_scrape_jobs SET status=$2,pages_visited=$3,pages_discovered=$4,
    products_found=$5,failed_pages=$6,artifact_id=$7,progress=$8::jsonb,completed_at=NOW(),updated_at=NOW(),
    lease_expires_at=NULL WHERE id=$1 AND worker_id=$9`,
    [job.id,status,workflow.pages.length,workflow.crawl?.pagesDiscovered||workflow.pages.length,count,workflow.failures.length,artifact.id,
     JSON.stringify({phase:'completed',pagesVisited:workflow.pages.length,productRecordsFound:count,queuedButNotVisited:workflow.crawl?.queuedButNotVisited||0,discoveryPagesVisited:workflow.crawl?.discoveryPagesVisited||0,productPagesVisited:workflow.crawl?.productPagesVisited||0,productUrlsDiscovered:workflow.crawl?.productUrlsDiscovered||0,productUrlsRemaining:workflow.crawl?.productUrlsRemaining||0,discoveryPagesRemaining:workflow.crawl?.discoveryPagesRemaining||0,detectedPlatforms:workflow.crawl?.detectedPlatforms||[],sitemapsVisited:workflow.crawl?.sitemapsVisited||0,sitemapLimitReached:Boolean(workflow.crawl?.sitemapLimitReached)}),WORKER_ID]);
  if(job.assistant_message_id) {
    const warning=workflow.partial?` Coverage is partial: ${workflow.crawl?.queuedButNotVisited||0} discovered page(s) were not visited and ${workflow.failures.length} page(s) failed.`:'';
    const content=`The website crawl retrieved ${workflow.pages.length} pages and extracted ${count} product record(s). The Excel workbook is ready.${warning}\n\nThe workbook includes product names, descriptions, prices, SKUs, brands, availability, product URLs and image URLs where exposed by the website.`;
    await repository.updateConversationMessage({userId:job.user_id,conversationId:job.conversation_id,id:job.assistant_message_id,content,status:workflow.partial?'partial':'complete',metadata:{route:'website_scraping',artifacts:[{id:artifact.id,filename:artifact.displayFilename||artifact.filename,format:'xlsx',contentType:artifact.contentType,size:artifact.size,status:artifact.status||'available',checksum:artifact.checksum,preview:artifact.preview,createdAt:artifact.createdAt,expiresAt:artifact.expiresAt,messageId:artifact.messageId}],scrapeJobId:job.id}}).catch(()=>undefined);
  }
}
async function failJob(job,error) {
  const code=String(error?.code||'SCRAPE_FAILED').slice(0,80);
  await getPool().query(`UPDATE website_scrape_jobs SET status='failed',error_code=$2,completed_at=NOW(),
    lease_expires_at=NULL,updated_at=NOW() WHERE id=$1 AND worker_id=$3`,[job.id,code,WORKER_ID]);
  if(job.assistant_message_id) {
    const repository=require('./auth.cjs').repositoryFor(process.env);
    await repository.updateConversationMessage({userId:job.user_id,conversationId:job.conversation_id,id:job.assistant_message_id,content:'The background website crawl could not be completed. You can retry the request. No workbook was created.',status:'error',metadata:{route:'website_scraping',scrapeJobId:job.id,errorCode:code}}).catch(()=>undefined);
  }
}
let active=false, stopped=false, timer;
async function tick() {
  if(active||stopped) return; active=true;
  try { const job=await claimJob(); if(job) { try { await processJob(job); } catch(error) { await failJob(job,error).catch(()=>undefined); } } }
  catch (error) { console.error('[VoiceChatGLM scrape-worker] Queue poll/claim failed; will retry.', { name: error?.name || 'Error', code: error?.code, message: String(error?.message || 'unknown').replace(/[\\r\\n\\t]+/g, ' ').slice(0, 240) }); }
  finally { active=false; }
}
function startScrapeWorker() { if(timer) return ()=>stopScrapeWorker(); stopped=false; console.info('[VoiceChatGLM scrape-worker] Started queue polling.', { pollMs: POLL_MS, leaseMs: LEASE_MS }); timer=setInterval(()=>void tick(),POLL_MS); void tick(); return ()=>stopScrapeWorker(); }
function stopScrapeWorker() { stopped=true; if(timer) clearInterval(timer); timer=undefined; }
module.exports={enqueueScrapeJob,getScrapeJob,startScrapeWorker,stopScrapeWorker,publicJob};
