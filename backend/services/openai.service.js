'use strict';

const OpenAI = require('openai');

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 60_000,
  maxRetries: 1
});

/**
 * Enhance findings descriptions using GPT-4o Vision.
 * The Python comparison engine already detected precise bounding boxes.
 * GPT-4o now acts as a CLASSIFIER — providing human-readable descriptions
 * and refining severity suggestions for each detected difference.
 *
 * @param {string}   masterImageB64  - First page master image (base64)
 * @param {string}   sampleImageB64  - First page sample image (base64)
 * @param {object[]} findings        - Findings from the Python CV engine
 * @returns {Array|null}             - Enhanced descriptions or null
 */
async function enhanceWithAI(masterImageB64, sampleImageB64, findings) {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!findings || findings.length === 0) return [];

  const findingsDesc = findings.map((f, i) =>
    `#${i + 1} [${f.type}] pág.${f.page} (x=${f.bbox.x.toFixed(2)}, y=${f.bbox.y.toFixed(2)}, w=${f.bbox.w.toFixed(2)}, h=${f.bbox.h.toFixed(2)}) — Δpixel: ${f.pixel_diff_percent}%, ΔE=${f.color_delta_e}, sugerida: ${f.severity_suggestion}`
  ).join('\n');

  const content = [
    {
      type: 'text',
      text: `Eres un inspector de control de calidad de impresión. El motor de visión por computadora ya detectó las siguientes diferencias entre el documento maestro (1ra imagen) y la muestra (2da imagen):

${findingsDesc}

Para cada hallazgo detectado, proporciona:
1. Una descripción clara y concisa en español de qué cambió exactamente
2. Tu sugerencia de severidad: "critical" (error regulatorio/legal), "important" (necesita corrección), o "minor" (cosmético)

Devuelve SOLO un JSON con esta estructura:
{"results": [{"description": "texto descriptivo", "severity_suggestion": "critical|important|minor"}, ...]}

IMPORTANTE:
- NO inventes hallazgos adicionales
- Solo describe los ${findings.length} hallazgos ya detectados
- Mantén el mismo orden
- Sé conciso (máximo 100 caracteres por descripción)
- Devuelve SOLO JSON válido sin markdown`
    },
    {
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${masterImageB64}`, detail: 'high' }
    },
    {
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${sampleImageB64}`, detail: 'high' }
    }
  ];

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Eres un inspector de calidad experto. Respondes SOLO con JSON válido.' },
        { role: 'user', content }
      ],
      max_tokens: 4096,
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    const rawText = response.choices[0]?.message?.content || '';
    const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

    let parsed = JSON.parse(jsonText);

    // Handle various wrapper formats
    let results = null;
    if (Array.isArray(parsed)) {
      results = parsed;
    } else if (Array.isArray(parsed.results)) {
      results = parsed.results;
    } else if (Array.isArray(parsed.findings)) {
      results = parsed.findings;
    } else if (Array.isArray(parsed.descriptions)) {
      results = parsed.descriptions;
    } else {
      const vals = Object.values(parsed);
      results = vals.find(v => Array.isArray(v)) || null;
    }

    if (!Array.isArray(results)) return null;

    return results.map(item => ({
      description: typeof item?.description === 'string' ? item.description.slice(0, 200) : null,
      severity_suggestion: ['critical', 'important', 'minor'].includes(item?.severity_suggestion)
        ? item.severity_suggestion : null
    }));
  } catch (err) {
    console.warn('[OpenAI] Enhancement failed:', err.message);
    return null;
  }
}

module.exports = { enhanceWithAI };
