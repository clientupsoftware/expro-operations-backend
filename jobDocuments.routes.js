// jobDocuments.routes.js
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { uploadFile, getDownloadUrl, deleteFile } = require('./storageService');

const router = express.Router();
router.use(requireAuth);

// En memoria: el archivo pasa directo a R2, nunca se guarda en el disco del backend.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }); // 25 MB por archivo

// GET /api/jobs/:jobId/documents
router.get('/:jobId/documents', async (req, res) => {
  const result = await pool.query(
    `SELECT job_documents.*, users.name AS uploaded_by_name
     FROM job_documents
     LEFT JOIN users ON users.id = job_documents.uploaded_by
     WHERE job_id = $1 ORDER BY created_at DESC`,
    [req.params.jobId]
  );
  res.json(result.rows);
});

// POST /api/jobs/:jobId/documents - multipart/form-data: file, nombre, descripcion
router.post('/:jobId/documents', upload.single('file'), async (req, res) => {
  const { jobId } = req.params;
  const { nombre, descripcion } = req.body;
  if (!req.file) return res.status(400).json({ error: 'file es requerido.' });
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });

  const uniqueSuffix = crypto.randomBytes(8).toString('hex');
  const safeFileName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storageKey = `jobs/${jobId}/${uniqueSuffix}-${safeFileName}`;

  try {
    await uploadFile({ key: storageKey, buffer: req.file.buffer, contentType: req.file.mimetype });

    const result = await pool.query(
      `INSERT INTO job_documents (job_id, nombre, descripcion, storage_key, file_name, file_size, content_type, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [jobId, nombre, descripcion || null, storageKey, req.file.originalname, req.file.size, req.file.mimetype, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al subir el documento. Revisar la configuracion de R2.' });
  }
});

// GET /api/jobs/:jobId/documents/:id/download - devuelve una URL firmada temporal (1 hora)
router.get('/:jobId/documents/:id/download', async (req, res) => {
  const result = await pool.query(
    'SELECT storage_key, file_name FROM job_documents WHERE id = $1 AND job_id = $2',
    [req.params.id, req.params.jobId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Documento no encontrado.' });

  try {
    const url = await getDownloadUrl(result.rows[0].storage_key);
    res.json({ url, file_name: result.rows[0].file_name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar el link de descarga.' });
  }
});

// DELETE /api/jobs/:jobId/documents/:id
router.delete('/:jobId/documents/:id', async (req, res) => {
  const result = await pool.query(
    'SELECT storage_key FROM job_documents WHERE id = $1 AND job_id = $2',
    [req.params.id, req.params.jobId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Documento no encontrado.' });

  try {
    await deleteFile(result.rows[0].storage_key);
  } catch (err) {
    console.error('No se pudo borrar el archivo de R2 (se borra igual el registro):', err.message);
  }

  await pool.query('DELETE FROM job_documents WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

module.exports = router;
