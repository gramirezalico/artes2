'use strict';

const sharp = require('sharp');

const COLORS = {
  red:    { stroke: 'rgba(255,71,87,0.9)',   fill: 'rgba(255,71,87,0.12)',   text: '#FF4757' },
  green:  { stroke: 'rgba(46,213,115,0.9)',  fill: 'rgba(46,213,115,0.12)',  text: '#2ED573' },
  yellow: { stroke: 'rgba(255,199,0,0.9)',   fill: 'rgba(255,199,0,0.12)',   text: '#FFC700' },
  blue:   { stroke: 'rgba(83,82,237,0.9)',   fill: 'rgba(83,82,237,0.12)',   text: '#5352ED' }
};

const TYPE_ICONS = {
  typography: 'T',
  color:      'C',
  graphic:    'G',
  content:    'X',
  layout:     'L'
};

/**
 * Render findings as colored bounding boxes on the sample image.
 * @param {Buffer}   imageBuffer - The base image (JPEG) as a Buffer
 * @param {object[]} findings    - Array of finding objects with bbox, color, description, type
 * @param {number}   page        - Page number to filter findings for (default 1)
 * @returns {Promise<Buffer>}    - Annotated JPEG buffer
 */
async function renderAnnotatedImage(imageBuffer, findings, page = 1) {
  const pageFindings = findings.filter(f => (f.page || 1) === page);
  if (pageFindings.length === 0) return imageBuffer;

  const metadata = await sharp(imageBuffer).metadata();
  const imgW = metadata.width;
  const imgH = metadata.height;

  const rects = pageFindings.map((f, idx) => {
    const c = COLORS[f.color] || COLORS.red;
    const icon = TYPE_ICONS[f.type] || '?';

    const rx = Math.round(f.bbox.x * imgW);
    const ry = Math.round(f.bbox.y * imgH);
    const rw = Math.round(f.bbox.w * imgW);
    const rh = Math.round(f.bbox.h * imgH);

    const x = Math.max(0, Math.min(rx, imgW - 2));
    const y = Math.max(0, Math.min(ry, imgH - 2));
    const w = Math.max(10, Math.min(rw, imgW - x));
    const h = Math.max(10, Math.min(rh, imgH - y));

    const num = idx + 1;
    const safeDesc = escXml(String(f.description || '').slice(0, 45));
    const labelY = y > 24 ? y - 6 : y + h + 16;
    const labelW = Math.min(safeDesc.length * 7 + 40, imgW - x);

    return `
      <rect x="${x}" y="${y}" width="${w}" height="${h}"
            fill="${c.fill}" stroke="${c.stroke}" stroke-width="3" rx="2"/>
      <rect x="${x}" y="${labelY - 16}" width="${labelW}" height="20"
            fill="${c.stroke}" rx="3" opacity="0.95"/>
      <text x="${x + 4}" y="${labelY - 2}" font-family="Arial,Helvetica,sans-serif" font-size="11"
            font-weight="bold" fill="white">[${icon}${num}] ${safeDesc}</text>
    `;
  }).join('\n');

  const svgOverlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${imgW}" height="${imgH}" viewBox="0 0 ${imgW} ${imgH}">${rects}</svg>`;

  return sharp(imageBuffer)
    .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
    .jpeg({ quality: 92, progressive: true })
    .toBuffer();
}

function escXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

module.exports = { renderAnnotatedImage };
