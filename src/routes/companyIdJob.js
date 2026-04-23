const express = require('express');
const router = express.Router();
const db = require('../db');
const { request } = require('../unipile');

const jobs = {};

async function runCompanyIdJob(listId, workspaceId) {
  const job = jobs[listId];
  if (!job || !job.running) return;

  try {
    const accRes = await db.query('SELECT account_id FROM unipile_accounts WHERE workspace_id=$1 LIMIT 1', [workspaceId]);
    if (!accRes.rows.length) { job.running = false; job.error = 'no account'; return; }
    const accountId = accRes.rows[0].account_id;

    // Get next company missing linkedin_id
    const ctRes = await db.query(
      'SELECT lc.id, lc.company_name, lc.li_company_url FROM list_companies lc WHERE lc.list_id=$1 AND (lc.company_linkedin_id IS NULL OR lc.company_linkedin_id=\'\') ORDER BY lc.id LIMIT 1 OFFSET $2',
      [listId, job.offset]
    );

    if (!ctRes.rows.length) {
      job.running = false; job.finished = true; job.finished_at = new Date().toISOString();
      console.log('[companyIdJob] list ' + listId + ' COMPLETE found:' + job.found + ' notFound:' + job.not_found + ' errors:' + job.errors);
      return;
    }

    const row = ctRes.rows[0];
    // Extract slug from LinkedIn URL
    var slug = (row.li_company_url || '').replace(/https?:\/\/(?:www\.)?linkedin\.com\/(?:company|school)\//, '').replace(/[\/\?#].*$/, '').trim();

    if (!slug) { job.offset++; job.not_found++; scheduleNext(listId, workspaceId, 100); return; }

    try {
      const profile = await request('/api/v1/linkedin/company/' + encodeURIComponent(slug) + '?account_id=' + encodeURIComponent(accountId));
      const companyId = profile && (profile.id || (profile.object === 'CompanyProfile' && profile.id));
      if (companyId) {
        await db.query('UPDATE list_companies SET company_linkedin_id=$1 WHERE id=$2', [String(companyId), row.id]);
        job.found++;
        console.log('[companyIdJob] ' + row.company_name + ' => ' + companyId);
      } else {
        job.not_found++;
        console.log('[companyIdJob] no id for: ' + row.company_name + ' slug:' + slug);
      }
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('429')) {
        console.log('[companyIdJob] 429 pausing 60s at offset ' + job.offset);
        scheduleNext(listId, workspaceId, 60000);
        return;
      }
      job.errors++;
      console.log('[companyIdJob] error for ' + row.company_name + ': ' + msg.slice(0,80));
    }

    job.offset++;
    scheduleNext(listId, workspaceId, 2000);

  } catch (err) {
    job.errors++;
    job.offset++;
    scheduleNext(listId, workspaceId, 3000);
  }
}

function scheduleNext(listId, workspaceId, delay) {
  const job = jobs[listId];
  if (!job || !job.running) return;
  job.timer = setTimeout(() => runCompanyIdJob(listId, workspaceId), delay);
}

// POST /api/company-id-job/start
router.post('/start', async (req, res) => {
  const { list_id, workspace_id, resume_offset } = req.body;
  if (!list_id || !workspace_id) return res.status(400).json({ error: 'list_id and workspace_id required' });
  if (jobs[list_id] && jobs[list_id].running) return res.json({ message: 'already running', status: jobs[list_id] });

  const totalRes = await db.query('SELECT COUNT(*) AS n FROM list_companies WHERE list_id=$1 AND (company_linkedin_id IS NULL OR company_linkedin_id=\'\')', [list_id]);
  const total = parseInt(totalRes.rows[0].n);

  jobs[list_id] = { list_id, workspace_id, running: true, finished: false, offset: parseInt(resume_offset)||0, total, found: 0, not_found: 0, errors: 0, started_at: new Date().toISOString() };
  console.log('[companyIdJob] starting list ' + list_id + ' missing:' + total);
  runCompanyIdJob(list_id, workspace_id);
  res.json({ message: 'started', status: jobs[list_id] });
});

// POST /api/company-id-job/stop
router.post('/stop', (req, res) => {
  const { list_id } = req.body;
  if (jobs[list_id]) { jobs[list_id].running = false; if (jobs[list_id].timer) clearTimeout(jobs[list_id].timer); }
  res.json({ message: 'stopped', status: jobs[list_id] || null });
});

// GET /api/company-id-job/status
router.get('/status', (req, res) => {
  const { list_id } = req.query;
  if (list_id && jobs[list_id]) return res.json(jobs[list_id]);
  res.json(Object.values(jobs).map(j => ({ list_id: j.list_id, running: j.running, finished: j.finished, offset: j.offset, total: j.total, found: j.found, not_found: j.not_found, errors: j.errors })));
});

module.exports = router;
