const express = require('express');
const router = express.Router();
const db = require('../db');

router.post('/workspace', async function(req, res) {
  try {
    var workspace_id = req.body.workspace_id;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
    // Delete in correct order to respect FK constraints
    var r1 = await db.query('DELETE FROM inbox_threads WHERE workspace_id=$1', [workspace_id]);
    var r2 = await db.query('DELETE FROM list_contacts WHERE list_id IN (SELECT id FROM lists WHERE workspace_id=$1)', [workspace_id]);
    var r3 = await db.query('DELETE FROM list_companies WHERE list_id IN (SELECT id FROM lists WHERE workspace_id=$1)', [workspace_id]);
    var r4 = await db.query('DELETE FROM contacts WHERE workspace_id=$1', [workspace_id]);
    var r5 = await db.query('DELETE FROM lists WHERE workspace_id=$1', [workspace_id]);
    var r6 = await db.query('DELETE FROM opportunity_views WHERE workspace_id=$1', [workspace_id]);
    var r7 = await db.query('DELETE FROM opportunity_companies WHERE workspace_id=$1', [workspace_id]);
    var r8 = await db.query('DELETE FROM opp_contacts WHERE ws=$1', [workspace_id]).catch(()=>({rowCount:0}));
    res.json({
      inbox_threads: r1.rowCount, list_contacts: r2.rowCount, list_companies: r3.rowCount,
      contacts: r4.rowCount, lists: r5.rowCount, opp_views: r6.rowCount,
      opp_companies: r7.rowCount, opp_contacts: r8.rowCount
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
