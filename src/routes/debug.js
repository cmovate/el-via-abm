const express = require('express');
const router  = express.Router();

// GET /api/debug-unipile-profile?identifier=<linkedin-slug>&account_id=<account_id>
router.get('/debug-unipile-profile', async (req, res) => {
  try {
    const { identifier, account_id } = req.query;
    if (!identifier || !account_id) {
      return res.status(400).json({ error: 'identifier and account_id required' });
    }

    const DSN     = process.env.UNIPILE_DSN;
    const API_KEY = process.env.UNIPILE_API_KEY;
    if (!DSN || !API_KEY) return res.status(500).json({ error: 'UNIPILE_DSN / UNIPILE_API_KEY not set in .env' });

    const url = `${DSN}/api/v1/users/${encodeURIComponent(identifier)}?account_id=${encodeURIComponent(account_id)}&linkedin_sections=*&notify=false`;
    console.log('[Debug] Calling:', url);

    const unipileRes = await fetch(url, {
      headers: { 'X-API-KEY': API_KEY, 'accept': 'application/json' }
    });
    const data = await unipileRes.json();

    // Build flat key inventory
    function inventory(obj, prefix) {
      prefix = prefix || '';
      const out = {};
      if (!obj || typeof obj !== 'object') return out;
      for (const k of Object.keys(obj)) {
        const v   = obj[k];
        const key = prefix ? prefix + '.' + k : k;
        if (Array.isArray(v)) {
          out[key] = 'Array(' + v.length + ')';
          if (v.length > 0 && v[0] && typeof v[0] === 'object') Object.assign(out, inventory(v[0], key + '[0]'));
          else if (v.length > 0) out[key + '[0]'] = v[0];
        } else if (v && typeof v === 'object') {
          Object.assign(out, inventory(v, key));
        } else {
          out[key] = v;
        }
      }
      return out;
    }

    const expArray = data.experience || data.experiences || data.positions || data.work_history || [];

    res.json({
      http_status:   unipileRes.status,
      top_level_keys: Object.keys(data),
      field_map:     inventory(data),
      experience_0:  expArray[0] || null,
      contact_info:  data.contact_info || null,
      websites:      data.websites || null,
      headline:      data.headline || null,
      first_name:    data.first_name || null,
      last_name:     data.last_name  || null,
      raw:           data,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Manually trigger engagement scraper (GET for compatibility)
router.get('/run-engagement-scraper', async (req, res) => {
  try {
    const campaign_id = req.query.campaign_id ? parseInt(req.query.campaign_id) : null;
    const engagementScraper = require('../engagementScraper');
    const result = await engagementScraper.run(campaign_id);
    res.json({ success: true, campaign_id, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
