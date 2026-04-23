const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

// POST /api/translate-names
// Body: { names: ["Amit","David",...] }
// Returns: { map: { "Amit":"עמית", "David":"דוד", ... } }
router.post('/', async (req, res) => {
  const { names } = req.body;
  if (!Array.isArray(names) || !names.length) {
    return res.json({ map: {} });
  }

  const BATCH = 120;
  const resultMap = {};

  for (let i = 0; i < names.length; i += BATCH) {
    const batch = names.slice(i, i + BATCH);
    const prompt = `Translate these first names from English transliteration to Hebrew script.
Return ONLY a valid JSON object like: {"John":"ג'ון","Amit":"עמית"}
No preamble, no markdown, no extra text.
For non-Hebrew/non-Jewish names use phonetic Hebrew.
Names: ${JSON.stringify(batch)}`;

    try {
      const msg = await client.messages.create({
        model: 'claude-opus-4-5-20251101',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }]
      });
      const text = msg.content[0].text.trim();
      let parsed = {};
      try { parsed = JSON.parse(text); }
      catch(e) {
        const m = text.match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
      }
      Object.assign(resultMap, parsed);
    } catch(e) {
      console.error('translate batch error:', e.message);
    }
  }

  res.json({ map: resultMap });
});

module.exports = router;
