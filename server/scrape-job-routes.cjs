const { getScrapeJob, advanceScrapeJob } = require('./scrape-jobs.cjs');
function failure(status,error){return {status,body:{error}};}
async function handleScrapeJobRoute({route,method,userId}){
  const parts=String(route||'').split('/').filter(Boolean);
  if(parts.length<2||parts.length>3||parts[0]!=='scrape-jobs'||!/^[0-9a-f-]{36}$/i.test(parts[1])) return failure(404,'Scrape job not found.');
  if(parts.length===3&&parts[2]==='advance'){
    if(method!=='POST') return failure(405,'Method not allowed.');
    const job=await advanceScrapeJob(userId,parts[1]);
    return job?{status:200,body:{job}}:failure(404,'Scrape job not found.');
  }
  if(parts.length!==2||method!=='GET') return failure(405,'Method not allowed.');
  const job=await getScrapeJob(userId,parts[1]);
  return job?{status:200,body:{job}}:failure(404,'Scrape job not found.');
}
module.exports={handleScrapeJobRoute};
