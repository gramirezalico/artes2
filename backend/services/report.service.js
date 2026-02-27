'use strict';

/**
 * Report service — generates an inspection report as a structured JSON
 * that the frontend renders, plus a downloadable annotated image.
 *
 * For a full PDF report, we generate a simple HTML-to-text summary
 * since pdfkit adds complexity. The annotated image IS the visual report.
 */

/**
 * Build a report data object from an inspection.
 * @param {object} inspection - Full inspection document
 * @returns {object} Report data
 */
function buildReportData(inspection) {
  const findings = inspection.findings || [];
  const analysis = inspection.analysis || {};

  const classified = findings.filter(f => f.severity && f.severity !== 'ignore');
  const ignored = findings.filter(f => f.severity === 'ignore');

  const criticals = findings.filter(f => f.severity === 'critical' || (!f.severity && f.status === 'open' && findings.indexOf(f) < findings.length));

  const bySeverity = {
    critical:  findings.filter(f => f.severity === 'critical'),
    important: findings.filter(f => f.severity === 'important'),
    minor:     findings.filter(f => f.severity === 'minor'),
    ignore:    findings.filter(f => f.severity === 'ignore'),
    unclassified: findings.filter(f => !f.severity)
  };

  const byType = {
    typography: findings.filter(f => f.type === 'typography'),
    color:      findings.filter(f => f.type === 'color'),
    graphic:    findings.filter(f => f.type === 'graphic'),
    content:    findings.filter(f => f.type === 'content'),
    layout:     findings.filter(f => f.type === 'layout')
  };

  return {
    metadata: {
      productId: inspection.productId || 'N/A',
      productName: inspection.productName,
      description: inspection.description || '',
      inspectionDate: inspection.createdAt,
      status: inspection.status,
      verdict: analysis.verdict || 'review'
    },
    statistics: {
      totalFindings: findings.length,
      totalClassified: classified.length,
      totalExcluded: ignored.length,
      bySeverity: {
        critical: bySeverity.critical.length,
        important: bySeverity.important.length,
        minor: bySeverity.minor.length,
        ignore: bySeverity.ignore.length,
        unclassified: bySeverity.unclassified.length
      },
      byType: {
        typography: byType.typography.length,
        color: byType.color.length,
        graphic: byType.graphic.length,
        content: byType.content.length,
        layout: byType.layout.length
      }
    },
    summary: analysis.summary || '',
    findings: findings.map((f, idx) => ({
      number: idx + 1,
      page: f.page,
      type: f.type,
      severity: f.severity || f.status,
      description: f.description,
      comment: f.comment || '',
      bbox: f.bbox
    })),
    palettes: {
      master: analysis.masterPalette || [],
      sample: analysis.samplePalette || []
    }
  };
}

module.exports = { buildReportData };
