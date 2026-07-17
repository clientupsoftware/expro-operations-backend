// briefing.routes.js
const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');

const router = express.Router();
router.use(requireAuth);

// Quien puede firmar cada rol del briefing. Ajustable en un solo lugar si hace falta cambiarlo.
const SUPERVISOR_SIGN_ROLES = ['ingeniero', 'coordinador', 'super'];
const MANAGER_SIGN_ROLES = ['coordinador', 'super'];

function canSign(userRole, allowedRoles) {
  return allowedRoles.includes(userRole);
}

// ================= PLANTILLAS =================

// GET /api/briefing/templates - todos ven las plantillas existentes, con sus preguntas
router.get('/templates', async (req, res) => {
  const templatesResult = await pool.query('SELECT * FROM briefing_templates ORDER BY nombre');
  const templates = templatesResult.rows;
  if (templates.length === 0) return res.json([]);

  const itemsResult = await pool.query(`
    SELECT template_id, id, pregunta, orden FROM briefing_template_items ORDER BY orden
  `);

  res.json(templates.map((t) => ({
    ...t,
    items: itemsResult.rows.filter((i) => i.template_id === t.id)
  })));
});

// POST /api/briefing/templates - crear plantilla nueva. items: [{pregunta}]
router.post('/templates', requireRole('coordinador'), async (req, res) => {
  const { nombre, items } = req.body;
  if (!nombre || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'nombre e items (array, al menos 1 pregunta) son requeridos.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const templateResult = await client.query(
      'INSERT INTO briefing_templates (nombre, created_by) VALUES ($1, $2) RETURNING *',
      [nombre, req.user.id]
    );
    const template = templateResult.rows[0];

    let orden = 0;
    for (const item of items) {
      await client.query(
        'INSERT INTO briefing_template_items (template_id, pregunta, orden) VALUES ($1, $2, $3)',
        [template.id, item.pregunta, orden++]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(template);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al crear la plantilla de briefing.' });
  } finally {
    client.release();
  }
});

// PATCH /api/briefing/templates/:id - editar nombre y/o reemplazar las preguntas (reemplazo total, como Kits)
router.patch('/templates/:id', requireRole('coordinador'), async (req, res) => {
  const { id } = req.params;
  const { nombre, items } = req.body;

  if (items !== undefined && (!Array.isArray(items) || items.length === 0)) {
    return res.status(400).json({ error: 'Si mandas items, tiene que ser un array con al menos 1 pregunta.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let template;
    if (nombre !== undefined) {
      const result = await client.query(
        'UPDATE briefing_templates SET nombre = $1 WHERE id = $2 RETURNING *',
        [nombre, id]
      );
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Plantilla no encontrada.' });
      }
      template = result.rows[0];
    }

    if (items !== undefined) {
      await client.query('DELETE FROM briefing_template_items WHERE template_id = $1', [id]);
      let orden = 0;
      for (const item of items) {
        await client.query(
          'INSERT INTO briefing_template_items (template_id, pregunta, orden) VALUES ($1, $2, $3)',
          [id, item.pregunta, orden++]
        );
      }
    }

    if (!template) {
      const current = await client.query('SELECT * FROM briefing_templates WHERE id = $1', [id]);
      if (current.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Plantilla no encontrada.' });
      }
      template = current.rows[0];
    }

    await client.query('COMMIT');
    res.json(template);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al editar la plantilla.' });
  } finally {
    client.release();
  }
});

// DELETE /api/briefing/templates/:id
router.delete('/templates/:id', requireRole('coordinador'), async (req, res) => {
  await pool.query('DELETE FROM briefing_templates WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

// ================= INSTANCIA POR JOB =================

// GET /api/briefing/job/:jobId - el briefing actual de ese Job (o null si todavia no tiene)
router.get('/job/:jobId', async (req, res) => {
  const briefingResult = await pool.query(
    'SELECT * FROM job_briefings WHERE job_id = $1 ORDER BY created_at DESC LIMIT 1',
    [req.params.jobId]
  );
  if (briefingResult.rows.length === 0) return res.json(null);

  const briefing = briefingResult.rows[0];
  const itemsResult = await pool.query(
    'SELECT * FROM job_briefing_items WHERE job_briefing_id = $1 ORDER BY orden',
    [briefing.id]
  );

  res.json({ ...briefing, items: itemsResult.rows });
});

// POST /api/briefing/job/:jobId - crear la instancia para este Job.
// Body: { template_id } para usar una plantilla existente, o
//       { new_template: { nombre, items: [{pregunta}] } } para crear una plantilla nueva y usarla de una.
router.post('/job/:jobId', requireRole('coordinador'), async (req, res) => {
  const { jobId } = req.params;
  const { template_id, new_template } = req.body;

  const existing = await pool.query('SELECT id FROM job_briefings WHERE job_id = $1', [jobId]);
  if (existing.rows.length > 0) {
    return res.status(400).json({ error: 'Este Job ya tiene un Briefing creado.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let templateId = template_id || null;
    let questionItems = [];

    if (new_template) {
      if (!new_template.nombre || !Array.isArray(new_template.items) || new_template.items.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'new_template necesita nombre e items (al menos 1 pregunta).' });
      }
      const templateResult = await client.query(
        'INSERT INTO briefing_templates (nombre, created_by) VALUES ($1, $2) RETURNING id',
        [new_template.nombre, req.user.id]
      );
      templateId = templateResult.rows[0].id;
      let orden = 0;
      for (const item of new_template.items) {
        await client.query(
          'INSERT INTO briefing_template_items (template_id, pregunta, orden) VALUES ($1, $2, $3)',
          [templateId, item.pregunta, orden++]
        );
        questionItems.push({ pregunta: item.pregunta, orden: orden - 1 });
      }
    } else if (template_id) {
      const itemsResult = await client.query(
        'SELECT pregunta, orden FROM briefing_template_items WHERE template_id = $1 ORDER BY orden',
        [template_id]
      );
      if (itemsResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'La plantilla no existe o no tiene preguntas.' });
      }
      questionItems = itemsResult.rows;
    } else {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Mandá template_id o new_template.' });
    }

    const briefingResult = await client.query(
      'INSERT INTO job_briefings (job_id, template_id, created_by) VALUES ($1, $2, $3) RETURNING *',
      [jobId, templateId, req.user.id]
    );
    const briefing = briefingResult.rows[0];

    for (const item of questionItems) {
      await client.query(
        'INSERT INTO job_briefing_items (job_briefing_id, pregunta, orden) VALUES ($1, $2, $3)',
        [briefing.id, item.pregunta, item.orden]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(briefing);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al crear el briefing.' });
  } finally {
    client.release();
  }
});

async function isSigned(client, briefingId) {
  const result = await client.query(
    'SELECT supervisor_signed_at, manager_signed_at FROM job_briefings WHERE id = $1',
    [briefingId]
  );
  if (result.rows.length === 0) return null;
  return !!(result.rows[0].supervisor_signed_at && result.rows[0].manager_signed_at);
}

// PATCH /api/briefing/instance/:id - actualizar items (reemplazo total) y/o comentario_final.
// Bloqueado si el briefing ya tiene las 2 firmas.
router.patch('/instance/:id', requireRole('coordinador'), async (req, res) => {
  const { id } = req.params;
  const { items, comentario_final } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const signed = await isSigned(client, id);
    if (signed === null) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Briefing no encontrado.' });
    }
    if (signed) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Este briefing ya esta firmado por Supervisor y Manager, no se puede editar.' });
    }

    if (comentario_final !== undefined) {
      await client.query('UPDATE job_briefings SET comentario_final = $1, updated_at = now() WHERE id = $2', [comentario_final, id]);
    }

    if (Array.isArray(items)) {
      await client.query('DELETE FROM job_briefing_items WHERE job_briefing_id = $1', [id]);
      let orden = 0;
      for (const item of items) {
        await client.query(
          'INSERT INTO job_briefing_items (job_briefing_id, pregunta, respuesta, comentario, orden) VALUES ($1,$2,$3,$4,$5)',
          [id, item.pregunta, item.respuesta || null, item.comentario || null, orden++]
        );
      }
    }

    await client.query('COMMIT');

    const briefing = (await pool.query('SELECT * FROM job_briefings WHERE id = $1', [id])).rows[0];
    const itemsResult = await pool.query('SELECT * FROM job_briefing_items WHERE job_briefing_id = $1 ORDER BY orden', [id]);
    res.json({ ...briefing, items: itemsResult.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el briefing.' });
  } finally {
    client.release();
  }
});

// POST /api/briefing/instance/:id/sign-supervisor
router.post('/instance/:id/sign-supervisor', async (req, res) => {
  if (!canSign(req.user.role, SUPERVISOR_SIGN_ROLES)) {
    return res.status(403).json({ error: 'Tu rol no puede firmar como Supervisor.' });
  }
  const result = await pool.query(
    'UPDATE job_briefings SET supervisor_signed_by = $1, supervisor_signed_at = now(), updated_at = now() WHERE id = $2 RETURNING *',
    [req.user.id, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Briefing no encontrado.' });
  res.json(result.rows[0]);
});

// POST /api/briefing/instance/:id/sign-manager
router.post('/instance/:id/sign-manager', async (req, res) => {
  if (!canSign(req.user.role, MANAGER_SIGN_ROLES)) {
    return res.status(403).json({ error: 'Tu rol no puede firmar como Manager.' });
  }
  const result = await pool.query(
    'UPDATE job_briefings SET manager_signed_by = $1, manager_signed_at = now(), updated_at = now() WHERE id = $2 RETURNING *',
    [req.user.id, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Briefing no encontrado.' });
  res.json(result.rows[0]);
});

module.exports = router;
