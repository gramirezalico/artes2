'use strict';

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

// pdf2pic for PDF → image conversion
let convertFromPath;
try {
  const { fromPath } = require('pdf2pic');
  convertFromPath = fromPath;
} catch (e) {
  console.warn('[FileConverter] pdf2pic not available — PDF conversion disabled');
}

const UPLOAD_DIR = path.join(__dirname, '../uploads');

const SUPPORTED_FORMATS = {
  '.pdf':  'pdf',
  '.tiff': 'tiff',
  '.tif':  'tiff',
  '.bmp':  'bmp',
  '.png':  'png',
  '.jpg':  'jpg',
  '.jpeg': 'jpg'
};

/**
 * Convert any supported file to an array of base64 JPEG images (one per page).
 * Supports: PDF (multi-page), TIFF (multi-page), BMP, PNG, JPG.
 *
 * @param {string} filename   - Filename in the uploads directory
 * @param {object} options
 * @param {number} options.maxDim   - Max dimension in pixels (default 2048)
 * @param {number} options.quality  - JPEG quality (default 85)
 * @param {number} options.dpi      - DPI for PDF rendering (default 150)
 * @returns {Promise<{ pageCount: number, imagesBase64: string[], format: string }>}
 */
async function convertFileToImages(filename, options = {}) {
  const { maxDim = 2048, quality = 85, dpi = 150 } = options;
  const filePath = path.join(UPLOAD_DIR, filename);
  const ext = path.extname(filename).toLowerCase();
  const format = SUPPORTED_FORMATS[ext];

  if (!format) {
    throw new Error(`Unsupported file format: ${ext}`);
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filename}`);
  }

  let imagesBase64 = [];

  if (format === 'pdf') {
    imagesBase64 = await convertPDF(filePath, { maxDim, quality, dpi });
  } else if (format === 'tiff') {
    imagesBase64 = await convertTIFF(filePath, { maxDim, quality });
  } else {
    // Single image formats: BMP, PNG, JPG
    const b64 = await convertSingleImage(filePath, { maxDim, quality });
    imagesBase64 = [b64];
  }

  return {
    pageCount: imagesBase64.length,
    imagesBase64,
    format
  };
}

/**
 * Convert PDF pages to base64 JPEG using pdf2pic + sharp.
 */
async function convertPDF(filePath, { maxDim, quality, dpi }) {
  if (!convertFromPath) {
    throw new Error('PDF conversion not available (pdf2pic missing)');
  }

  const tmpDir = path.join(UPLOAD_DIR, 'tmp_pdf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
  fs.mkdirSync(tmpDir, { recursive: true });

  const converter = convertFromPath(filePath, {
    density: dpi,
    saveFilename: 'page',
    savePath: tmpDir,
    format: 'png',
    width: maxDim,
    height: maxDim
  });

  // PNG magic bytes: 89 50 4E 47
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4E, 0x47]);

  function isValidPng(buf) {
    return Buffer.isBuffer(buf) && buf.length > 100 && buf.subarray(0, 4).equals(PNG_MAGIC);
  }

  const imagesBase64 = [];

  // Convert pages one-by-one, stop when we get an invalid/empty result
  for (let i = 1; i <= 20; i++) {
    try {
      const result = await converter(i, { responseType: 'buffer' });
      const buf = result?.buffer || result;

      if (!isValidPng(buf)) {
        if (i === 1) throw new Error('Failed to convert first page of PDF');
        break; // No more valid pages
      }

      const jpeg = await sharp(buf)
        .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality, progressive: true })
        .toBuffer();
      imagesBase64.push(jpeg.toString('base64'));
    } catch (err) {
      if (i === 1) throw err;
      break; // No more pages
    }
  }

  // Clean up temp dir
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

  return imagesBase64;
}

/**
 * Convert multi-page TIFF to base64 JPEGs using sharp.
 */
async function convertTIFF(filePath, { maxDim, quality }) {
  const imagesBase64 = [];
  const fileBuffer = fs.readFileSync(filePath);

  // Try extracting pages from TIFF
  for (let page = 0; page < 20; page++) {
    try {
      const jpeg = await sharp(fileBuffer, { page })
        .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality, progressive: true })
        .toBuffer();
      imagesBase64.push(jpeg.toString('base64'));
    } catch {
      if (page === 0) {
        throw new Error('Failed to read TIFF file');
      }
      break; // No more pages
    }
  }

  return imagesBase64;
}

/**
 * Convert a single image (BMP, PNG, JPG) to base64 JPEG.
 */
async function convertSingleImage(filePath, { maxDim, quality }) {
  const jpeg = await sharp(filePath)
    .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, progressive: true })
    .toBuffer();
  return jpeg.toString('base64');
}

module.exports = { convertFileToImages, SUPPORTED_FORMATS };
