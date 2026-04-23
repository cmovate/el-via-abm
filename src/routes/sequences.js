/**
 * src/routes/sequences.js
 *
 * Sequences — reusable outreach scripts.
 *
 * GET  /api/workspaces/:wsId/sequences
 * POST /api/workspaces/:wsId/sequences
 * GET  /api/sequences/:id
 * PUT  /api/sequences/:id        (replace all steps)
 * PATCH /api/sequences/:id       (update name/description)
 * DELETE /api/sequences/:id
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');

// GET /api/sequences?workspace_id=
router.get('/', async (req, res) => {
  try {
    const { workspace_id } = req.query;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

    const { rows } = await db.query(`
      SELECT s.*,
        (SELECT COUNT(*) FROM sequence_steps WHERE sequence_id = s.id) AS steps_count,
        (SELECT COUNT(*) FROM campaigns WHERE sequence_id = s.id)      AS campaigns_count
      FROM sequences s
      WHERE s.workspace_id = $1
      ORDER BY s.created_at DESC
    `, [workspace_id]);

    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/sequences
router.post('/', async (req, res) => {
  try {
    const { workspace_id, name, description, steps } = req.body;
    if (!workspace_id || !name?.trim())
      return res.status(400).json({ error: 'workspace_id and name required' });

    const { rows: seq } = await db.query(
      `INSERT INTO sequences (workspace_id, name, description) VALUES ($1,$2,$3) RETURNING *`,
      [workspace_id, name.trim(), description?.trim() || null]
    );
    const sequence = seq[0];

    if (Array.isArray(steps) && steps.length) {
      await insertSteps(sequence.id, steps);
    }

    const full = await loadSequenceFull(sequence.id);
    res.status(201).json(full);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/sequences/:id
router.get('/:id', async (req, res) => {
  try {
    const { workspace_id } = req.query;
    const seq = await requireSequence(req, res, workspace_id);
    if (!seq) return;
    const full = await loadSequenceFull(seq.id);
    res.json(full);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/sequences/:id — update name/description
router.patch('/:id', async (req, res) => {
  try {
    const wsId = req.body?.workspace_id || req.query.workspace_id;
    const seq  = await requireSequence(req, res, wsId);
    if (!seq) return;

    const { name, description } = req.body;
    const sets = [], vals = [seq.id];
    if (name)              { vals.push(name.trim());        sets.push(`name = $${vals.length}`); }
    if (description !== undefined) {
      vals.push(description || null);
      sets.push(`description = $${vals.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    await db.query(`UPDATE sequences SET ${sets.join(',')} WHERE id = $1`, vals);
    res.json(await loadSequenceFull(seq.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/sequences/:id — replace all steps
router.put('/:id', async (req, res) => {
  try {
    const wsId = req.body?.workspace_id || req.query.workspace_id;
    const seq  = await requireSequence(req, res, wsId);
    if (!seq) return;

    const { steps } = req.body;
    if (!Array.isArray(steps)) return res.status(400).json({ error: 'steps[] required' });

    await db.query('DELETE FROM sequence_steps WHERE sequence_id = $1', [seq.id]);
    if (steps.length) await insertSteps(seq.id, steps);

    res.json(await loadSequenceFull(seq.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/sequences/:id
router.delete('/:id', async (req, res) => {
  try {
    const wsId = req.query.workspace_id;
    const seq  = await requireSequence(req, res, wsId);
    if (!seq) return;

    // Check if in use
    const { rows: usage } = await db.query(
      'SELECT id FROM campaigns WHERE sequence_id = $1 LIMIT 1', [seq.id]
    );
    if (usage.length)
      return res.status(409).json({ error: 'Sequence is in use by a campaign' });

    await db.query('DELETE FROM sequences WHERE id = $1', [seq.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function requireSequence(req, res, workspaceId) {
  if (!workspaceId) { res.status(400).json({ error: 'workspace_id required' }); return null; }
  const { rows } = await db.query(
    'SELECT * FROM sequences WHERE id = $1 AND workspace_id = $2',
    [req.params.id, workspaceId]
  );
  if (!rows.length) { res.status(404).json({ error: 'Sequence not found' }); return null; }
  return rows[0];
}

async function insertSteps(sequenceId, steps) {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    await db.query(
      `INSERT INTO sequence_steps (sequence_id, step_index, type, delay_days, variants, conditions)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        sequenceId,
        step.step_index !== undefined ? step.step_index : i,
        step.type || 'message',
        step.delay_days || 0,
        JSON.stringify(step.variants || []),
        step.conditions ? JSON.stringify(step.conditions) : null,
      ]
    );
  }
}

async function loadSequenceFull(sequenceId) {
  const { rows: seqs } = await db.query('SELECT * FROM sequences WHERE id = $1', [sequenceId]);
  if (!seqs.length) return null;
  const seq = seqs[0];
  const { rows: steps } = await db.query(
    'SELECT * FROM sequence_steps WHERE sequence_id = $1 ORDER BY step_index ASC',
    [sequenceId]
  );
  return { ...seq, steps };
}

module.exports = router;
