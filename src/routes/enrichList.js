const express = require('express');
const router = express.Router();
const db = require('../db');
const { enrichProfile } = require('../unipile');

router.post('/', async function(req, res) {
  try {
    var list_id = req.body.list_id;
    var workspace_id = req.body.workspace_id;
    var offset = parseInt(req.body.offset) || 0;
    if (!list_id || !workspace_id) return res.status(400).json({ error: 'list_id and workspace_id required' });

    var accRes = await db.query('SELECT account_id FROM unipile_accounts WHERE workspace_id=$1 LIMIT 1', [workspace_id]);
    if (!accRes.rows.length) return res.json({ error: 'No LinkedIn account' });
    var accountId = accRes.rows[0].account_id;

    var totalRes = await db.query('SELECT COUNT(*) AS n FROM list_contacts WHERE list_id=$1', [list_id]);
    var total = parseInt(totalRes.rows[0].n);

    var ctRes = await db.query(
      'SELECT c.id, c.li_profile_url, c.first_name, c.last_name, c.profile_data FROM list_contacts lc JOIN contacts c ON c.id=lc.contact_id WHERE lc.list_id=$1 ORDER BY lc.contact_id LIMIT 1 OFFSET $2',
      [list_id, offset]
    );
    if (!ctRes.rows.length) return res.json({ finished: true, total, done: offset });

    var ct = ctRes.rows[0];
    var alreadyDone = ct.first_name && ct.first_name.trim() && ct.profile_data && Object.keys(ct.profile_data || {}).length > 0;
    if (alreadyDone) {
      return res.json({ done: offset + 1, total, contact_id: ct.id, skipped: true, first_name: ct.first_name, last_name: ct.last_name });
    }

    var enrichErrMsg = '';
    var pid = (ct.li_profile_url || '').replace(/https?:\/\/(?:www\.)?linkedin\.com\/in\//, '').replace(/\/+$/, '');
    if (!pid) return res.json({ done: offset + 1, total, contact_id: ct.id, skipped: true, reason: 'no_pid' });

    try {
      var profile = await enrichProfile(accountId, pid);
      if (profile && (profile.member_urn || profile.public_identifier)) {
        // Extract company + title from multiple possible fields
        var company = '', companyUrl = '', title = '';
        // 1. headline as title
        title = profile.headline || '';
        // 2. current_positions (some Unipile responses use this)
        if (profile.current_positions && profile.current_positions[0]) {
          company = profile.current_positions[0].company || '';
          companyUrl = profile.current_positions[0].company_url || '';
          if (!title && profile.current_positions[0].role) title = profile.current_positions[0].role;
        }
        // 3. work_experience — find entry with no end year (current job)
        if (!company && profile.work_experience && profile.work_experience.length) {
          var curr = profile.work_experience.find(function(w){ return !w.end || !w.end.year; });
          if (!curr) curr = profile.work_experience[0]; // fallback: most recent
          if (curr) {
            company = curr.company || '';
            companyUrl = curr.company_url || '';
            if (!title && curr.role) title = curr.role;
          }
        }

        await db.query(
          'UPDATE contacts SET first_name=$1, last_name=$2, title=$3, location=$4, company=$5, li_company_url=$6, member_urn=$7, provider_id=$8, profile_data=$9 WHERE id=$10',
          [
            profile.first_name || '', profile.last_name || '', title,
            profile.location || '', company, companyUrl,
            profile.member_urn || '', profile.provider_id || profile.public_identifier || '',
            JSON.stringify(profile), ct.id
          ]
        );
        return res.json({ done: offset+1, total, contact_id: ct.id, ok: true, first_name: profile.first_name||'', last_name: profile.last_name||'', title, company, location: profile.location||'' });
      }
    } catch (enrichErr) { enrichErrMsg = enrichErr.message || String(enrichErr); }

    return res.json({ done: offset+1, total, contact_id: ct.id, error: 'enrich_failed', detail: enrichErrMsg });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
