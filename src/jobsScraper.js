/**
 * src/jobsScraper.js
 * Fetches open tech jobs from LinkedIn for all opportunity companies
 * and caches them in the company_jobs table.
 * Runs on startup (after 2min delay) and every 24h.
 */

const db           = require('./db');
const { getCompanyJobs } = require('./unipile');

const TECH_KEYWORDS = [
  'software','engineer','developer','engineering','technology','technical',
  'data','cloud','devops','qa','quality assurance','testing','tester',
  'cyber','security','infosec','ai','ml','machine learning',
  'artificial intelligence','platform','infrastructure','backend','front-end',
  'frontend','fullstack','full stack','full-stack','architect','mobile',
  'ios','android','python','java','javascript','react','node','database',
  'sql','api','automation','sre','salesforce','erp','crm','it manager',
  'it director','chief technology','cto','vp engineering','vp technology',
  'scrum','agile','product manager','product owner','technical lead',
  'tech lead','systems','network','devsecops','blockchain','embedded',
  'firmware','microservices','kubernetes','docker','r&d','research',
  'scientist','analyst','bi ','business intelligence','it ','digital',
  'information technology','innovation','solution',
];

function isTechJob(job) {
  const text = `${job.title || ''} ${job.description || ''}`.toLowerCase();
  return TECH_KEYWORDS.some(kw => text.includes(kw));
}

async function ensureTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS company_jobs (
      id            SERIAL PRIMARY KEY,
      workspace_id  INTEGER NOT NULL,
      company_name  TEXT NOT NULL,
      company_linkedin_id TEXT,
      job_title     TEXT NOT NULL,
      job_location  TEXT,
      apply_url     TEXT,
      fetched_at    TIMESTAMP DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_company_jobs_workspace
    ON company_jobs (workspace_id, company_name)
  `);
}

async function scrapeWorkspace(workspaceId) {
  const { rows: accs } = await db.query(
    'SELECT account_id FROM unipile_accounts WHERE workspace_id = $1 LIMIT 1',
    [workspaceId]
  );
  if (!accs.length) return;
  const accountId = accs[0].account_id;

  // Read from both list_companies and opportunity_companies
  const { rows: rawCompanies } = await db.query(
    `SELECT DISTINCT lc.company_name, lc.company_linkedin_id
     FROM list_companies lc JOIN lists l ON l.id = lc.list_id
     WHERE l.workspace_id = $1 AND lc.company_name IS NOT NULL AND lc.company_name != ''
     UNION
     SELECT DISTINCT company_name, company_linkedin_id
     FROM opportunity_companies
     WHERE workspace_id = $1 AND company_name IS NOT NULL AND company_name != ''
     ORDER BY company_name`,
    [workspaceId]
  );

  // Parse JSON-encoded company_linkedin_id e.g. {"id":"3090","name":"Check Point"}
  const companies = rawCompanies.map(co => {
    let id = co.company_linkedin_id;
    if (id && typeof id === 'string' && id.trim().startsWith('{')) {
      try { id = JSON.parse(id).id || null; } catch(e) { id = null; }
    }
    return { company_name: co.company_name, company_linkedin_id: id };
  });

  if (!companies.length) return;
  console.log(`[JobsScraper] ws=${workspaceId}: ${companies.length} companies to scan`);

  // Clear old jobs for this workspace
  await db.query('DELETE FROM company_jobs WHERE workspace_id = $1', [workspaceId]);

  let totalInserted = 0;

  for (const co of companies) {
    try {
      const allJobs = await getCompanyJobs(accountId, co.company_linkedin_id, co.company_name);
      let jobs = allJobs.filter(isTechJob);
      if (!jobs.length) jobs = allJobs; // fallback: all jobs if tech filter removes everything

      for (const job of jobs) {
        const title = job.title || job.job_title || '';
        if (!title) continue;
        await db.query(
          `INSERT INTO company_jobs
             (workspace_id, company_name, company_linkedin_id, job_title, job_location, apply_url)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            workspaceId,
            co.company_name,
            co.company_linkedin_id || null,
            title,
            job.location || job.job_location || null,
            job.apply_url || job.job_url || job.url || null,
          ]
        );
        totalInserted++;
      }

      console.log(`[JobsScraper] ws=${workspaceId} "${co.company_name}": ${allJobs.length} total, ${jobs.length} kept`);
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
    } catch (e) {
      console.warn(`[JobsScraper] error for "${co.company_name}": ${e.message}`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`[JobsScraper] ws=${workspaceId} DONE — ${totalInserted} jobs inserted`);
}

async function scrapeAllWorkspaces() {
  try {
    await ensureTable();
    const { rows: workspaces } = await db.query(
      `SELECT DISTINCT workspace_id FROM lists
       UNION
       SELECT DISTINCT workspace_id FROM opportunity_companies`
    );
    console.log(`[JobsScraper] Starting scan for ${workspaces.length} workspace(s)`);
    for (const row of workspaces) {
      await scrapeWorkspace(row.workspace_id);
    }
    console.log('[JobsScraper] All workspaces done');
  } catch (e) {
    console.error('[JobsScraper] scrapeAllWorkspaces error:', e.message);
  }
}

function startJobsScraper() {
  const STARTUP_DELAY = 2 * 60 * 1000;  // 2min after boot
  const INTERVAL      = 24 * 60 * 60 * 1000; // every 24h
  console.log('[JobsScraper] Scheduled — first run in 2min, then every 24h');
  setTimeout(() => scrapeAllWorkspaces().catch(e => console.error('[JobsScraper]', e.message)), STARTUP_DELAY);
  setInterval(() => scrapeAllWorkspaces().catch(e => console.error('[JobsScraper]', e.message)), INTERVAL);
}

module.exports = { startJobsScraper, scrapeAllWorkspaces, scrapeWorkspace };
