'use strict';

const Inspection = require('../models/Inspection.model');
const { convertFileToImages } = require('./fileConverter.service');

const COMPARISON_URL = process.env.COMPARISON_URL || 'http://comparison:5000';

function severityToColor(severity) {
  switch (severity) {
    case 'critical': return 'red';
    case 'important': return 'yellow';
    case 'minor': return 'blue';
    default: return 'yellow';
  }
}

function generateSummary(findings, overallSsim) {
  const critical = findings.filter(f => (f.severity || f.severity_suggestion) === 'critical').length;
  const important = findings.filter(f => (f.severity || f.severity_suggestion) === 'important').length;
  const minor = findings.filter(f => (f.severity || f.severity_suggestion) === 'minor').length;

  const parts = [];
  if (findings.length === 0) {
    parts.push('No se detectaron diferencias entre el documento maestro y la muestra.');
    parts.push('La muestra coincide con la referencia.');
  } else {
    parts.push(`Se detectaron ${findings.length} diferencia(s) entre el documento maestro y la muestra.`);
    if (critical > 0) parts.push(`${critical} hallazgo(s) de severidad crítica requieren atención inmediata.`);
    if (important > 0) parts.push(`${important} hallazgo(s) importantes necesitan revisión antes de producción.`);
    if (minor > 0) parts.push(`${minor} hallazgo(s) menores detectados.`);
  }
  parts.push(`Similitud estructural global (SSIM): ${(overallSsim * 100).toFixed(1)}%.`);
  return parts.join(' ');
}

/**
 * Check if the Python comparison engine is available.
 */
async function checkEngine() {
  try {
    const res = await fetch(`${COMPARISON_URL}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Run the full inspection pipeline:
 *   1. Convert master + sample files to images
 *   2. Call Python comparison engine per page (pixel-level diff)
 *   3. Optionally enhance descriptions with GPT-4o
 *   4. Aggregate and save results
 */
async function runFullInspection(inspection, emitProgress) {
  const emit = (stage, message, percent) => {
    emitProgress('progress', { stage, message, percent });
  };

  try {
    await Inspection.findByIdAndUpdate(inspection._id, { status: 'processing', errorMessage: '' });

    // ── Stage 1: Convert master ───────────────────────────────────────────
    emit(1, 'Convirtiendo documento maestro a imágenes…', 5);
    const masterResult = await convertFileToImages(inspection.masterFile.filename);
    await Inspection.findByIdAndUpdate(inspection._id, {
      'masterFile.pageCount': masterResult.pageCount,
      'masterFile.imagesBase64': masterResult.imagesBase64,
      'masterFile.format': masterResult.format
    });

    // ── Stage 2: Convert sample ───────────────────────────────────────────
    emit(2, 'Convirtiendo muestra a imágenes…', 15);
    const sampleResult = await convertFileToImages(inspection.sampleFile.filename);
    await Inspection.findByIdAndUpdate(inspection._id, {
      'sampleFile.pageCount': sampleResult.pageCount,
      'sampleFile.imagesBase64': sampleResult.imagesBase64,
      'sampleFile.format': sampleResult.format
    });

    // ── Check comparison engine ───────────────────────────────────────────
    const engineOk = await checkEngine();
    if (!engineOk) {
      throw new Error('El motor de comparación no está disponible. Verifica que el servicio esté en ejecución.');
    }

    // ── Stage 3: Pixel-level comparison (Python service) ──────────────────
    emit(3, 'Comparación pixel por pixel…', 25);
    const pageCount = Math.min(masterResult.pageCount, sampleResult.pageCount);
    const allFindings = [];
    const diffImages = [];
    const heatmaps = [];
    let masterPalette = [];
    let samplePalette = [];
    let totalSsim = 0;

    for (let p = 0; p < pageCount; p++) {
      const pct = 25 + Math.round((p / Math.max(1, pageCount)) * 35);
      emit(3, `Comparando página ${p + 1} de ${pageCount}…`, pct);

      const zones = (inspection.inspectionZones || [])
        .filter(z => z.page === p + 1)
        .map(z => z.bbox);

      const body = {
        master_image: masterResult.imagesBase64[p],
        sample_image: sampleResult.imagesBase64[p],
        tolerance: inspection.elementTolerance ?? 50,
        accuracy: inspection.accuracyLevel ?? 50,
        zones,
        page: p + 1,
        check_spelling: inspection.checkSpelling ?? false,
        spelling_language: inspection.spellingLanguage ?? 'es'
      };

      const response = await fetch(`${COMPARISON_URL}/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Motor de comparación falló (pág ${p + 1}): ${errText}`);
      }

      const result = await response.json();

      for (const diff of result.differences) {
        allFindings.push({
          page: p + 1,
          type: diff.type,
          severity: null,
          severity_suggestion: diff.severity_suggestion,
          description: diff.description,
          bbox: diff.bbox,
          color: severityToColor(diff.severity_suggestion),
          pixel_diff_percent: diff.pixel_diff_percent,
          color_delta_e: diff.color_delta_e,
          master_crop: diff.master_crop,
          sample_crop: diff.sample_crop,
          comment: '',
          status: 'open'
        });
      }

      diffImages.push(result.diff_image);
      heatmaps.push(result.heatmap);
      totalSsim += result.overall_ssim;

      if (p === 0) {
        masterPalette = result.master_palette;
        samplePalette = result.sample_palette;
      }
    }

    // ── Stage 4: AI Enhancement (optional) ────────────────────────────────
    emit(4, 'Clasificando diferencias…', 65);

    if (process.env.OPENAI_API_KEY && allFindings.length > 0 && allFindings.length <= 25) {
      try {
        const { enhanceWithAI } = require('./openai.service');
        const enhanced = await enhanceWithAI(
          masterResult.imagesBase64[0],
          sampleResult.imagesBase64[0],
          allFindings
        );
        if (enhanced && Array.isArray(enhanced)) {
          for (let i = 0; i < Math.min(allFindings.length, enhanced.length); i++) {
            if (enhanced[i]?.description) {
              allFindings[i].description = enhanced[i].description;
            }
            if (enhanced[i]?.severity_suggestion) {
              allFindings[i].severity_suggestion = enhanced[i].severity_suggestion;
              allFindings[i].color = severityToColor(enhanced[i].severity_suggestion);
            }
          }
        }
      } catch (aiErr) {
        console.warn('[InspectionService] AI enhancement skipped:', aiErr.message);
      }
    }

    // ── Stage 5: Save results ─────────────────────────────────────────────
    emit(5, 'Guardando resultados…', 85);
    const avgSsim = pageCount > 0 ? totalSsim / pageCount : 0;

    const criticalCount = allFindings.filter(f => (f.severity || f.severity_suggestion) === 'critical').length;
    const importantCount = allFindings.filter(f => (f.severity || f.severity_suggestion) === 'important').length;
    const minorCount = allFindings.filter(f => (f.severity || f.severity_suggestion) === 'minor').length;

    let verdict = 'pass';
    if (criticalCount > 0) verdict = 'fail';
    else if (importantCount > 0 || avgSsim < 0.92) verdict = 'review';
    else if (allFindings.length > 0) verdict = 'review';

    const summary = generateSummary(allFindings, avgSsim);

    await Inspection.findByIdAndUpdate(inspection._id, {
      status: 'inspected',
      findings: allFindings,
      diffImages,
      heatmaps,
      analysis: {
        summary,
        totalFindings: allFindings.length,
        criticalCount,
        importantCount,
        minorCount,
        ignoredCount: 0,
        masterPalette,
        samplePalette,
        verdict,
        overallSsim: avgSsim
      }
    });

    emit(5, 'Inspección completada.', 100);
    emitProgress('done', { status: 'done', inspectionId: inspection._id });
  } catch (err) {
    console.error('[InspectionService] Inspection failed:', err.message);
    await Inspection.findByIdAndUpdate(inspection._id, {
      status: 'error',
      errorMessage: err.message
    }).catch(() => {});
    emitProgress('error', { message: err.message });
    throw err;
  }
}

module.exports = { runFullInspection };
