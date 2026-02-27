'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const Inspection = require('../models/Inspection.model');
const { runFullInspection } = require('../services/inspection.service');
const { renderAnnotatedImage } = require('../services/annotator.service');
const { buildReportData } = require('../services/report.service');

const COMPARISON_URL = process.env.COMPARISON_URL || 'http://comparison:5000';

// ─── Rate limiting ───────────────────────────────────────────────────────────
const inspectionRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Espera antes de intentar nuevamente.' }
});

// ─── Multer setup ─────────────────────────────────────────────────────────────
const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10);
const UPLOAD_DIR = path.join(__dirname, '../uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, uuidv4() + ext);
  }
});

const ALLOWED_EXTENSIONS = ['.pdf', '.tiff', '.tif', '.bmp', '.png', '.jpg', '.jpeg'];
const ALLOWED_MIMES = [
  'application/pdf', 'application/x-pdf',
  'image/tiff', 'image/bmp', 'image/x-bmp', 'image/x-ms-bmp',
  'image/png', 'image/jpeg', 'image/jpg'
];

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_MIMES.includes(file.mimetype) || ALLOWED_EXTENSIONS.includes(ext)) {
    cb(null, true);
  } else {
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE',
      `Formato no soportado: "${file.originalname}". Use PDF, TIFF, BMP, PNG o JPG.`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 }
});

function handleMulterError(err, res) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `Archivo demasiado grande. Máximo ${MAX_FILE_SIZE_MB}MB.` });
    }
    return res.status(400).json({ error: err.message });
  }
  return null;
}

// ─── SSE Client Registry ──────────────────────────────────────────────────────
const sseClients = new Map();

function getOrCreateClientSet(id) {
  if (!sseClients.has(id)) sseClients.set(id, new Set());
  return sseClients.get(id);
}

function emitProgress(id, event, data) {
  const clients = sseClients.get(id);
  if (!clients || clients.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch (_) { clients.delete(res); }
  }
}

// ─── POST /api/inspection/upload ──────────────────────────────────────────────
router.post(
  '/upload',
  inspectionRateLimiter,
  (req, res, next) => {
    upload.fields([
      { name: 'masterFile', maxCount: 1 },
      { name: 'sampleFile', maxCount: 1 }
    ])(req, res, (err) => {
      if (err) {
        if (handleMulterError(err, res)) return;
        return next(err);
      }
      next();
    });
  },
  async (req, res, next) => {
    try {
      const { productName, productId, description, elementTolerance, accuracyLevel } = req.body;

      if (!productName || !productName.trim()) {
        return res.status(400).json({ error: 'El nombre del producto es obligatorio.' });
      }

      const masterFile = req.files?.masterFile?.[0];
      const sampleFile = req.files?.sampleFile?.[0];

      if (!masterFile) return res.status(400).json({ error: 'Falta el documento maestro.' });
      if (!sampleFile) return res.status(400).json({ error: 'Falta la muestra.' });

      const elTol = Math.min(100, Math.max(0, parseInt(elementTolerance, 10) || 50));
      const accLvl = Math.min(100, Math.max(0, parseInt(accuracyLevel, 10) || 50));

      const ext = (f) => path.extname(f.originalname).toLowerCase().replace('.', '');

      const inspection = await Inspection.create({
        productName: productName.trim(),
        productId: (productId || '').trim(),
        description: (description || '').trim(),
        elementTolerance: elTol,
        accuracyLevel: accLvl,
        status: 'pending',
        masterFile: {
          filename: masterFile.filename,
          originalName: masterFile.originalname.replace(/[^\w.\-]/g, '_'),
          fileSize: masterFile.size,
          format: ext(masterFile),
          pageCount: 1,
          imagesBase64: []
        },
        sampleFile: {
          filename: sampleFile.filename,
          originalName: sampleFile.originalname.replace(/[^\w.\-]/g, '_'),
          fileSize: sampleFile.size,
          format: ext(sampleFile),
          pageCount: 1,
          imagesBase64: []
        }
      });

      res.status(201).json({
        inspectionId: inspection._id,
        status: inspection.status,
        productName: inspection.productName
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/inspection/:id/start ───────────────────────────────────────────
router.post('/:id/start', inspectionRateLimiter, async (req, res, next) => {
  try {
    const inspection = await Inspection.findById(req.params.id);
    if (!inspection) return res.status(404).json({ error: 'Inspección no encontrada.' });

    if (inspection.status === 'inspected') {
      return res.json({ status: 'inspected', message: 'Inspección ya completada.' });
    }
    if (inspection.status === 'processing') {
      return res.json({ status: 'processing', message: 'Inspección en progreso.' });
    }

    // Parse inspection zones from body if provided
    if (req.body.inspectionZones) {
      try {
        const zones = typeof req.body.inspectionZones === 'string'
          ? JSON.parse(req.body.inspectionZones)
          : req.body.inspectionZones;
        if (Array.isArray(zones)) {
          await Inspection.findByIdAndUpdate(inspection._id, { inspectionZones: zones });
          inspection.inspectionZones = zones;
        }
      } catch (_) { /* ignore invalid zones */ }
    }

    // Parse spelling options
    const updateFields = {};
    if (req.body.checkSpelling !== undefined) {
      updateFields.checkSpelling = !!req.body.checkSpelling;
      inspection.checkSpelling = !!req.body.checkSpelling;
    }
    if (req.body.spellingLanguage) {
      updateFields.spellingLanguage = String(req.body.spellingLanguage);
      inspection.spellingLanguage = String(req.body.spellingLanguage);
    }
    if (req.body.spellingLevel !== undefined) {
      const lvl = Math.min(100, Math.max(0, parseInt(req.body.spellingLevel, 10) || 50));
      updateFields.spellingLevel = lvl;
      inspection.spellingLevel = lvl;
    }
    if (Object.keys(updateFields).length > 0) {
      await Inspection.findByIdAndUpdate(inspection._id, updateFields);
    }

    res.status(202).json({ status: 'processing', message: 'Inspección iniciada.' });

    runFullInspection(inspection, (event, data) => emitProgress(req.params.id, event, data))
      .catch((err) => {
        console.error('[Inspection] Fatal error:', req.params.id, err.message);
        emitProgress(req.params.id, 'error', { message: err.message });
      });
  } catch (err) {
    if (err.name === 'CastError') return res.status(400).json({ error: 'ID inválido.' });
    next(err);
  }
});

// ─── GET /api/inspection/:id/stream (SSE) ─────────────────────────────────────
router.get('/:id/stream', async (req, res) => {
  const { id } = req.params;
  const inspection = await Inspection.findById(id, { status: 1 }).lean().catch(() => null);
  if (!inspection) return res.status(404).json({ error: 'Inspección no encontrada.' });

  if (inspection.status === 'inspected') {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`event: done\ndata: ${JSON.stringify({ status: 'done' })}\n\n`);
    return res.end();
  }

  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(': heartbeat\n\n');

  const clients = getOrCreateClientSet(id);
  clients.add(res);

  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (_) { clearInterval(heartbeat); }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
    if (clients.size === 0) sseClients.delete(id);
  });
});

// ─── GET /api/inspection/:id ──────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const inspection = await Inspection.findById(req.params.id).lean();
    if (!inspection) return res.status(404).json({ error: 'Inspección no encontrada.' });

    // Include first-page thumbnails only
    if (inspection.masterFile?.imagesBase64?.length > 0) {
      inspection.masterFile.thumbnail = inspection.masterFile.imagesBase64[0];
    }
    if (inspection.sampleFile?.imagesBase64?.length > 0) {
      inspection.sampleFile.thumbnail = inspection.sampleFile.imagesBase64[0];
    }
    delete inspection.masterFile?.imagesBase64;
    delete inspection.sampleFile?.imagesBase64;

    res.json(inspection);
  } catch (err) {
    if (err.name === 'CastError') return res.status(400).json({ error: 'ID inválido.' });
    next(err);
  }
});

// ─── PUT /api/inspection/:id/findings/:findingId ──────────────────────────────
// Classify a finding (severity, comment)
router.put('/:id/findings/:findingId', async (req, res, next) => {
  try {
    const { severity, comment } = req.body;

    const update = {};
    if (severity !== undefined) {
      if (!['critical', 'important', 'minor', 'ignore', null].includes(severity)) {
        return res.status(400).json({ error: 'Severidad inválida.' });
      }
      update['findings.$.severity'] = severity;
      update['findings.$.status'] = severity ? 'classified' : 'open';
      // Update color based on severity
      if (severity === 'critical') update['findings.$.color'] = 'red';
      else if (severity === 'important') update['findings.$.color'] = 'yellow';
      else if (severity === 'minor') update['findings.$.color'] = 'blue';
      else if (severity === 'ignore') update['findings.$.color'] = 'green';
    }
    if (comment !== undefined) {
      update['findings.$.comment'] = String(comment).slice(0, 500);
    }

    const result = await Inspection.findOneAndUpdate(
      { _id: req.params.id, 'findings._id': req.params.findingId },
      { $set: update },
      { new: true, lean: true }
    );

    if (!result) return res.status(404).json({ error: 'Hallazgo no encontrado.' });

    // Recalculate analysis counts
    const findings = result.findings || [];
    await Inspection.findByIdAndUpdate(req.params.id, {
      'analysis.criticalCount':  findings.filter(f => f.severity === 'critical').length,
      'analysis.importantCount': findings.filter(f => f.severity === 'important').length,
      'analysis.minorCount':     findings.filter(f => f.severity === 'minor').length,
      'analysis.ignoredCount':   findings.filter(f => f.severity === 'ignore').length
    });

    const updated = result.findings.find(f => f._id.toString() === req.params.findingId);
    res.json({ success: true, finding: updated });
  } catch (err) {
    if (err.name === 'CastError') return res.status(400).json({ error: 'ID inválido.' });
    next(err);
  }
});

// ─── GET /api/inspection/:id/annotated ────────────────────────────────────────
router.get('/:id/annotated', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const inspection = await Inspection.findById(req.params.id, {
      'sampleFile.imagesBase64': 1,
      'sampleFile.originalName': 1,
      'findings': 1,
      'status': 1
    }).lean();

    if (!inspection) return res.status(404).json({ error: 'Inspección no encontrada.' });
    if (inspection.status !== 'inspected') {
      return res.status(400).json({ error: 'Inspección no completada.' });
    }

    const images = inspection.sampleFile?.imagesBase64 || [];
    const pageIdx = page - 1;
    if (pageIdx < 0 || pageIdx >= images.length) {
      return res.status(404).json({ error: `Página ${page} no disponible.` });
    }

    const imageBuffer = Buffer.from(images[pageIdx], 'base64');
    const annotatedBuffer = await renderAnnotatedImage(imageBuffer, inspection.findings || [], page);

    const safeName = (inspection.sampleFile?.originalName || 'muestra')
      .replace(/\.[^.]+$/, '').replace(/[^\w.-]/g, '_');

    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Disposition': `${disposition}; filename="inspeccion_${safeName}_p${page}.jpg"`,
      'Cache-Control': 'no-cache'
    });
    res.send(annotatedBuffer);
  } catch (err) {
    if (err.name === 'CastError') return res.status(400).json({ error: 'ID inválido.' });
    next(err);
  }
});

// ─── GET /api/inspection/:id/report ───────────────────────────────────────────
router.get('/:id/report', async (req, res, next) => {
  try {
    const inspection = await Inspection.findById(req.params.id, {
      'masterFile.imagesBase64': 0,
      'sampleFile.imagesBase64': 0
    }).lean();

    if (!inspection) return res.status(404).json({ error: 'Inspección no encontrada.' });
    if (inspection.status !== 'inspected') {
      return res.status(400).json({ error: 'Inspección no completada.' });
    }

    const report = buildReportData(inspection);
    res.json(report);
  } catch (err) {
    if (err.name === 'CastError') return res.status(400).json({ error: 'ID inválido.' });
    next(err);
  }
});

// ─── GET /api/inspection/:id/report/pdf ───────────────────────────────────────
router.get('/:id/report/pdf', async (req, res, next) => {
  try {
    const inspection = await Inspection.findById(req.params.id).lean();
    if (!inspection) return res.status(404).json({ error: 'Inspección no encontrada.' });
    if (inspection.status !== 'inspected') {
      return res.status(400).json({ error: 'Inspección no completada.' });
    }

    const findings = (inspection.findings || []).map((f, i) => ({
      index: i + 1,
      type: f.type,
      severity: f.severity || f.severity_suggestion || 'minor',
      description: f.description || '',
      page: f.page || 1,
      pixel_diff_percent: f.pixel_diff_percent || 0,
      color_delta_e: f.color_delta_e || 0,
      comment: f.comment || '',
      master_crop: f.master_crop || '',
      sample_crop: f.sample_crop || ''
    }));

    const analysis = inspection.analysis || {};
    const reportBody = {
      product_name: inspection.productName || '',
      product_id: inspection.productId || '',
      description: inspection.description || '',
      date: new Date(inspection.createdAt).toLocaleString('es-ES'),
      verdict: analysis.verdict || 'review',
      overall_ssim: analysis.overallSsim || 0,
      total_findings: analysis.totalFindings || findings.length,
      critical_count: analysis.criticalCount || 0,
      important_count: analysis.importantCount || 0,
      minor_count: analysis.minorCount || 0,
      ignored_count: analysis.ignoredCount || 0,
      summary: analysis.summary || '',
      findings
    };

    const pdfRes = await fetch(`${COMPARISON_URL}/generate-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reportBody)
    });

    if (!pdfRes.ok) {
      const errText = await pdfRes.text().catch(() => 'PDF generation error');
      throw new Error(errText);
    }

    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    const safeName = (inspection.productId || inspection.productName || 'reporte')
      .replace(/[^\w.-]/g, '_').slice(0, 50);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="inspeccion_${safeName}.pdf"`,
      'Content-Length': pdfBuffer.length
    });
    res.send(pdfBuffer);
  } catch (err) {
    if (err.name === 'CastError') return res.status(400).json({ error: 'ID inválido.' });
    next(err);
  }
});

// ─── GET /api/inspection (list) ───────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    const filter = {};

    if (search && search.trim()) {
      filter.$or = [
        { productName: { $regex: search.trim(), $options: 'i' } },
        { productId: { $regex: search.trim(), $options: 'i' } }
      ];
    }

    const skip = (Math.max(1, Number(page)) - 1) * Math.min(100, Number(limit));

    const [inspections, total] = await Promise.all([
      Inspection.find(filter, {
        productName: 1, productId: 1, description: 1, status: 1,
        errorMessage: 1, createdAt: 1, updatedAt: 1,
        'masterFile.originalName': 1, 'masterFile.pageCount': 1, 'masterFile.fileSize': 1, 'masterFile.format': 1,
        'sampleFile.originalName': 1, 'sampleFile.pageCount': 1, 'sampleFile.fileSize': 1, 'sampleFile.format': 1,
        'analysis.verdict': 1, 'analysis.totalFindings': 1, 'analysis.criticalCount': 1,
        'analysis.importantCount': 1, 'analysis.minorCount': 1, 'analysis.ignoredCount': 1
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Math.min(100, Number(limit)))
        .lean(),
      Inspection.countDocuments(filter)
    ]);

    res.json({ inspections, total, page: Number(page) });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/inspection/:id ───────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const inspection = await Inspection.findByIdAndDelete(req.params.id);
    if (!inspection) return res.status(404).json({ error: 'Inspección no encontrada.' });

    const filesToDelete = [
      inspection.masterFile?.filename && path.join(UPLOAD_DIR, inspection.masterFile.filename),
      inspection.sampleFile?.filename && path.join(UPLOAD_DIR, inspection.sampleFile.filename)
    ].filter(Boolean);

    for (const f of filesToDelete) {
      try { fs.unlinkSync(f); } catch (_) {}
    }

    res.json({ success: true });
  } catch (err) {
    if (err.name === 'CastError') return res.status(400).json({ error: 'ID inválido.' });
    next(err);
  }
});

module.exports = router;
