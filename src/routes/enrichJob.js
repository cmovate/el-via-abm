const express = require('express');
const router = express.Router();
const db = require('../db');
const { enrichProfile } = require('../unipile');

const jobs = {};

async function runEnrichJob(listId, workspaceId) {
  const job = jobs[listId];
  if (!job || !job.running) return;
  try {
    const accRes = await db.query('SELECT account_id FROM unipile_accounts WHERE workspace_id=$1 LIMIT 1', [workspaceId]);
    if (!accRes.rows.length) { job.running = false; job.error = 'no account'; return; }
    const accountId = accRes.rows[0].account_id;
    const ctRes = await db.query(
      'SELECT c.id, c.li_profile_url, c.first_name, c.profile_data FROM list_contacts lc JOIN contacts c ON c.id=lc.contact_id WHERE lc.list_id=$1 ORDER BY lc.contact_id LIMIT 1 OFFSET $2',
      [listId, job.offset]
    );
    if (!ctRes.rows.length) {
      job.running = false; job.finished = true; job.finished_at = new Date().toISOString();
      console.log('[enrichJob] list ' + listId + ' COMPLETE enriched:' + job.enriched + ' skipped:' + job.skipped + ' errors:' + job.errors);
      return;
    }
    const ct = ctRes.rows[0];
    const alreadyDone = ct.first_name && ct.first_name.trim() && ct.profile_data && Object.keys(ct.profile_data || {}).length > 0;
    if (alreadyDone) { job.skipped++; job.offset++; scheduleNext(listId, workspaceId, 100); return; }
    const pid = (ct.li_profile_url || '').replace(/https?:\/\/(?:www\.)?linkedin\.com\/in\//, '').replace(/\/+$/, '');
    if (!pid) { job.offset++; scheduleNext(listId, workspaceId, 100); return; }
    try {
      const profile = await enrichProfile(accountId, pid);
      if (profile && (profile.member_urn || profile.public_identifier)) {
        let company = '', companyUrl = '', title = profile.headline || '';
        if (profile.current_positions && profile.current_positions[0]) {
          company = profile.current_positions[0].company || '';
          companyUrl = profile.current_positions[0].company_url || '';
          if (!title && profile.current_positions[0].role) title = profile.current_positions[0].role;
        }
        if (!company && profile.work_experience && profile.work_experience.length) {
          const curr = profile.work_experience.find(w => !w.end || !w.end.year) || profile.work_experience[0];
          if (curr) { company = curr.company || ''; companyUrl = curr.company_url || ''; if (!title && curr.role) title = curr.role; }
        }
        await db.query(
          'UPDATE contacts SET first_name=$1, last_name=$2, title=$3, location=$4, company=$5, li_company_url=$6, member_urn=$7, provider_id=$8, profile_data=$9 WHERE id=$10',
          [profile.first_name||'', profile.last_name||'', title, profile.location||'', company, companyUrl,
           profile.member_urn||'', profile.provider_id||profile.public_identifier||'', JSON.stringify(profile), ct.id]
        );
        job.enriched++;
        if (job.enriched % 100 === 0) console.log('[enrichJob] list ' + listId + ' offset:' + job.offset + ' enriched:' + job.enriched + ' err:' + job.errors);
      } else { job.errors++; }
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('429')) { console.log('[enrichJob] 429 pausing 60s'); scheduleNext(listId, workspaceId, 60000); return; }
      job.errors++;
    }
    job.offset++;
    scheduleNext(listId, workspaceId, 2000);
  } catch (err) { job.errors++; job.offset++; scheduleNext(listId, workspaceId, 3000); }
}

function scheduleNext(listId, workspaceId, delay) {
  const job = jobs[listId];
  if (!job || !job.running) return;
  job.timer = setTimeout(() => runEnrichJob(listId, workspaceId), delay);
}

router.post('/start', async (req, res) => {
  const { list_id, workspace_id, resume_offset } = req.body;
  if (!list_id || !workspace_id) return res.status(400).json({ error: 'list_id and workspace_id required' });
  if (jobs[list_id] && jobs[list_id].running) return res.json({ message: 'already running', status: jobs[list_id] });
  const totalRes = await db.query('SELECT COUNT(*) AS n FROM list_contacts WHERE list_id=$1', [list_id]);
  const total = parseInt(totalRes.rows[0].n);
  jobs[list_id] = { list_id, workspace_id, running: true, finished: false, offset: parseInt(resume_offset)||0, total, enriched: 0, skipped: 0, errors: 0, started_at: new Date().toISOString() };
  console.log('[enrichJob] starting list ' + list_id + ' offset:' + jobs[list_id].offset + ' total:' + total);
  runEnrichJob(list_id, workspace_id);
  res.json({ message: 'started', status: jobs[list_id] });
});

router.post('/stop', (req, res) => {
  const { list_id } = req.body;
  if (jobs[list_id]) { jobs[list_id].running = false; if (jobs[list_id].timer) clearTimeout(jobs[list_id].timer); }
  res.json({ message: 'stopped', status: jobs[list_id] || null });
});

router.get('/status', (req, res) => {
  const { list_id } = req.query;
  if (list_id && jobs[list_id]) return res.json(jobs[list_id]);
  res.json(Object.values(jobs).map(j => ({ list_id: j.list_id, running: j.running, finished: j.finished, offset: j.offset, total: j.total, enriched: j.enriched, skipped: j.skipped, errors: j.errors, pct: j.total ? Math.round(j.offset/j.total*100)+'%' : '?' })));
});

module.exports = router;
