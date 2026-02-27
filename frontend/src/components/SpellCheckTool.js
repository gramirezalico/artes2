/**
 * SpellCheckTool.js — Standalone OCR & spell-check interface.
 *
 * Allows the user to:
 *   1. Upload an image/PDF
 *   2. Draw a rectangle to select a region (or use the full image)
 *   3. Choose languages
 *   4. Run OCR at full resolution and view extracted text + spelling errors
 */
import { ocrSpellCheck } from '../hooks/useInspection.js';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

export function mount(container, { onBack }) {
  let file = null;
  let previewImg = null;
  let zone = null;
  let isDrawing = false;
  let drawStart = null;
  let isProcessing = false;

  container.innerHTML = `
    <div class="max-w-5xl mx-auto px-6 py-12">
      <div class="mb-10">
        <div class="section-label mb-3">Herramienta OCR</div>
        <h1 class="font-display text-4xl font-bold text-white leading-tight">
          Revisión de Ortografía por Zona
        </h1>
        <p class="font-mono text-sm text-white/40 mt-3">
          Carga una imagen o PDF, selecciona el área a revisar y ejecuta OCR a resolución completa.
        </p>
      </div>

      <!-- File upload -->
      <div class="card mb-6">
        <div class="section-label mb-4">Imagen a Analizar</div>
        <div id="ocr-dropzone" class="drop-zone border-2 border-dashed border-white/15 p-8 text-center cursor-pointer
                    hover:border-brand-yellow/40 transition-all">
          <input type="file" id="ocr-file-input" class="hidden"
                 accept=".pdf,.tiff,.tif,.bmp,.png,.jpg,.jpeg" />
          <div id="ocr-drop-label">
            <svg class="mx-auto mb-3 text-white/30" width="36" height="36" viewBox="0 0 24 24" fill="none">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"
                    stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <p class="font-mono text-sm text-white/50">
              Arrastra o haz clic para cargar — PDF, TIFF, BMP, PNG, JPG
            </p>
            <p class="font-mono text-[10px] text-white/25 mt-1">Máx 50 MB</p>
          </div>
          <div id="ocr-file-info" class="hidden">
            <p class="font-mono text-sm text-brand-yellow" id="ocr-file-name"></p>
            <button type="button" id="ocr-file-clear"
                    class="mt-2 font-mono text-xs text-white/40 hover:text-brand-red transition-colors">
              ✕ Quitar archivo
            </button>
          </div>
        </div>
      </div>

      <!-- Zone selection canvas -->
      <div id="ocr-canvas-section" class="card mb-6" style="display:none">
        <div class="flex items-center justify-between mb-3">
          <div>
            <div class="section-label mb-1">Seleccionar Zona (Opcional)</div>
            <p class="font-mono text-xs text-white/40">
              Dibuja un rectángulo para enfocar el OCR en una zona específica. Si no dibujas zona, se analiza la imagen completa.
            </p>
          </div>
          <button type="button" id="ocr-zone-clear"
                  class="btn-sm border-white/20 text-white/40 hover:text-brand-red" style="display:none">
            ✕ Limpiar zona
          </button>
        </div>
        <div class="relative border border-brand-yellow/20 bg-black/30 overflow-hidden inline-block">
          <canvas id="ocr-canvas" class="block cursor-crosshair" style="max-width:100%;max-height:550px"></canvas>
        </div>
        <div class="mt-2">
          <span id="ocr-zone-status" class="font-mono text-[10px] text-white/30">
            Sin zona — se analizará la imagen completa a resolución máxima.
          </span>
        </div>
      </div>

      <!-- Language + run -->
      <div class="card mb-6">
        <div class="section-label mb-4">Idiomas y Ejecución</div>
        <div class="mb-4">
          <label class="font-mono text-xs text-white/40 mb-3 block">Idiomas para OCR y ortografía (máximo 3):</label>
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2" id="ocr-lang-grid">
            <label class="lang-option flex items-center gap-2 px-3 py-2 border border-white/10 cursor-pointer hover:border-brand-yellow/30 transition-colors select-none">
              <input type="checkbox" name="ocr-lang" value="es" class="ocr-lang-cb accent-brand-yellow" checked />
              <span class="font-mono text-xs text-white/70">🇪🇸 Español</span>
            </label>
            <label class="lang-option flex items-center gap-2 px-3 py-2 border border-white/10 cursor-pointer hover:border-brand-yellow/30 transition-colors select-none">
              <input type="checkbox" name="ocr-lang" value="en" class="ocr-lang-cb accent-brand-yellow" />
              <span class="font-mono text-xs text-white/70">🇬🇧 English</span>
            </label>
            <label class="lang-option flex items-center gap-2 px-3 py-2 border border-white/10 cursor-pointer hover:border-brand-yellow/30 transition-colors select-none">
              <input type="checkbox" name="ocr-lang" value="pt" class="ocr-lang-cb accent-brand-yellow" />
              <span class="font-mono text-xs text-white/70">🇧🇷 Português</span>
            </label>
            <label class="lang-option flex items-center gap-2 px-3 py-2 border border-white/10 cursor-pointer hover:border-brand-yellow/30 transition-colors select-none">
              <input type="checkbox" name="ocr-lang" value="fr" class="ocr-lang-cb accent-brand-yellow" />
              <span class="font-mono text-xs text-white/70">🇫🇷 Français</span>
            </label>
            <label class="lang-option flex items-center gap-2 px-3 py-2 border border-white/10 cursor-pointer hover:border-brand-yellow/30 transition-colors select-none">
              <input type="checkbox" name="ocr-lang" value="de" class="ocr-lang-cb accent-brand-yellow" />
              <span class="font-mono text-xs text-white/70">🇩🇪 Deutsch</span>
            </label>
            <label class="lang-option flex items-center gap-2 px-3 py-2 border border-white/10 cursor-pointer hover:border-brand-yellow/30 transition-colors select-none">
              <input type="checkbox" name="ocr-lang" value="it" class="ocr-lang-cb accent-brand-yellow" />
              <span class="font-mono text-xs text-white/70">🇮🇹 Italiano</span>
            </label>
            <label class="lang-option flex items-center gap-2 px-3 py-2 border border-white/10 cursor-pointer hover:border-brand-yellow/30 transition-colors select-none">
              <input type="checkbox" name="ocr-lang" value="ru" class="ocr-lang-cb accent-brand-yellow" />
              <span class="font-mono text-xs text-white/70">🇷🇺 Русский</span>
            </label>
            <label class="lang-option flex items-center gap-2 px-3 py-2 border border-white/10 cursor-pointer hover:border-brand-yellow/30 transition-colors select-none">
              <input type="checkbox" name="ocr-lang" value="zh" class="ocr-lang-cb accent-brand-yellow" />
              <span class="font-mono text-xs text-white/70">🇨🇳 中文</span>
            </label>
            <label class="lang-option flex items-center gap-2 px-3 py-2 border border-white/10 cursor-pointer hover:border-brand-yellow/30 transition-colors select-none">
              <input type="checkbox" name="ocr-lang" value="ja" class="ocr-lang-cb accent-brand-yellow" />
              <span class="font-mono text-xs text-white/70">🇯🇵 日本語</span>
            </label>
            <label class="lang-option flex items-center gap-2 px-3 py-2 border border-white/10 cursor-pointer hover:border-brand-yellow/30 transition-colors select-none">
              <input type="checkbox" name="ocr-lang" value="ko" class="ocr-lang-cb accent-brand-yellow" />
              <span class="font-mono text-xs text-white/70">🇰🇷 한국어</span>
            </label>
          </div>
          <p id="ocr-lang-selected" class="mt-2 font-mono text-[10px] text-white/30">1 idioma(s) seleccionado(s)</p>
        </div>
        <div class="flex items-center gap-4">
          <button type="button" id="ocr-run-btn" class="btn-primary" disabled>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 2h5l2 2h5v10H2V2z" stroke="currentColor" stroke-width="1.5"/>
              <path d="M5 10h6M5 7.5h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            </svg>
            <span id="ocr-run-label">EJECUTAR OCR</span>
          </button>
          <p id="ocr-error" class="font-mono text-xs text-brand-red hidden"></p>
        </div>
      </div>

      <!-- Results -->
      <div id="ocr-results" class="hidden">
        <!-- Annotated image -->
        <div class="card mb-6">
          <div class="section-label mb-4">Imagen Anotada</div>
          <div class="border border-white/10 bg-black/30 overflow-auto" style="max-height:500px">
            <img id="ocr-annotated-img" class="block" style="max-width:100%" alt="Annotated" />
          </div>
        </div>

        <!-- Extracted text -->
        <div class="card mb-6">
          <div class="flex items-center justify-between mb-4">
            <div class="section-label">Texto Extraído</div>
            <button type="button" id="ocr-copy-btn" class="btn-sm border-white/20 text-white/50 hover:text-brand-yellow">
              📋 Copiar
            </button>
          </div>
          <div id="ocr-text-output"
               class="bg-brand-card border border-white/10 p-4 font-mono text-sm text-white/80 whitespace-pre-wrap max-h-64 overflow-y-auto">
          </div>
          <p id="ocr-word-count" class="mt-2 font-mono text-[10px] text-white/30"></p>
        </div>

        <!-- Spelling errors -->
        <div id="ocr-spelling-section" class="card mb-6 hidden">
          <div class="section-label mb-4">Errores Ortográficos Detectados</div>
          <div id="ocr-spelling-list" class="space-y-2"></div>
        </div>
      </div>
    </div>
  `;

  // ── Elements ──────────────────────────────────────────────────────────────
  const dropzone = container.querySelector('#ocr-dropzone');
  const fileInput = container.querySelector('#ocr-file-input');
  const dropLabel = container.querySelector('#ocr-drop-label');
  const fileInfo = container.querySelector('#ocr-file-info');
  const fileName = container.querySelector('#ocr-file-name');
  const fileClear = container.querySelector('#ocr-file-clear');

  const canvasSection = container.querySelector('#ocr-canvas-section');
  const canvas = container.querySelector('#ocr-canvas');
  const ctx = canvas.getContext('2d');
  const zoneClear = container.querySelector('#ocr-zone-clear');
  const zoneStatus = container.querySelector('#ocr-zone-status');

  const langGrid = container.querySelector('#ocr-lang-grid');
  const langSelected = container.querySelector('#ocr-lang-selected');
  const runBtn = container.querySelector('#ocr-run-btn');
  const runLabel = container.querySelector('#ocr-run-label');
  const errorEl = container.querySelector('#ocr-error');

  const resultsSection = container.querySelector('#ocr-results');
  const annotatedImg = container.querySelector('#ocr-annotated-img');
  const textOutput = container.querySelector('#ocr-text-output');
  const wordCount = container.querySelector('#ocr-word-count');
  const copyBtn = container.querySelector('#ocr-copy-btn');
  const spellingSection = container.querySelector('#ocr-spelling-section');
  const spellingList = container.querySelector('#ocr-spelling-list');

  // ── File handling ─────────────────────────────────────────────────────────
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) setFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) setFile(fileInput.files[0]);
  });
  fileClear.addEventListener('click', (e) => {
    e.stopPropagation();
    clearFile();
  });

  function setFile(f) {
    file = f;
    fileName.textContent = f.name;
    dropLabel.classList.add('hidden');
    fileInfo.classList.remove('hidden');
    runBtn.disabled = false;
    zone = null;
    resultsSection.classList.add('hidden');
    loadPreview(f);
  }

  function clearFile() {
    file = null;
    previewImg = null;
    zone = null;
    fileInput.value = '';
    dropLabel.classList.remove('hidden');
    fileInfo.classList.add('hidden');
    canvasSection.style.display = 'none';
    runBtn.disabled = true;
    resultsSection.classList.add('hidden');
  }

  async function loadPreview(f) {
    try {
      const ext = f.name.split('.').pop().toLowerCase();
      const img = new Image();

      if (ext === 'pdf') {
        const ab = await f.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });
        const off = document.createElement('canvas');
        off.width = viewport.width;
        off.height = viewport.height;
        await page.render({ canvasContext: off.getContext('2d'), viewport }).promise;
        img.src = off.toDataURL('image/jpeg', 0.9);
      } else {
        img.src = URL.createObjectURL(f);
      }

      img.onload = () => {
        previewImg = img;
        sizeCanvas();
        redrawCanvas();
        canvasSection.style.display = '';
      };
    } catch (err) {
      console.warn('[SpellCheckTool] Preview failed:', err);
      previewImg = null;
      canvasSection.style.display = 'none';
    }
  }

  function sizeCanvas() {
    if (!previewImg) return;
    const maxW = Math.min(800, canvasSection.clientWidth - 48);
    const scale = maxW / previewImg.width;
    canvas.width = previewImg.width * scale;
    canvas.height = previewImg.height * scale;
  }

  function redrawCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (previewImg) {
      ctx.drawImage(previewImg, 0, 0, canvas.width, canvas.height);
    }
    if (zone) {
      const x = zone.x * canvas.width;
      const y = zone.y * canvas.height;
      const w = zone.w * canvas.width;
      const h = zone.h * canvas.height;
      ctx.strokeStyle = '#E8FF47';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = 'rgba(232, 255, 71, 0.10)';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#E8FF47';
      ctx.font = 'bold 11px "DM Mono", monospace';
      ctx.fillText('OCR', x + 4, y + 14);
    }
    updateZoneUI();
  }

  function updateZoneUI() {
    if (zone) {
      zoneStatus.textContent = 'Zona seleccionada — OCR se ejecutará solo en esta área.';
      zoneClear.style.display = '';
    } else {
      zoneStatus.textContent = 'Sin zona — se analizará la imagen completa a resolución máxima.';
      zoneClear.style.display = 'none';
    }
  }

  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    };
  }

  canvas.addEventListener('mousedown', (e) => {
    if (!previewImg) return;
    isDrawing = true;
    drawStart = getCanvasCoords(e);
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!isDrawing || !drawStart) return;
    const cur = getCanvasCoords(e);
    zone = null; // Clear while drawing
    redrawCanvas();
    const x = Math.min(drawStart.x, cur.x);
    const y = Math.min(drawStart.y, cur.y);
    const w = Math.abs(cur.x - drawStart.x);
    const h = Math.abs(cur.y - drawStart.y);
    const px = x * canvas.width, py = y * canvas.height;
    const pw = w * canvas.width, ph = h * canvas.height;
    ctx.strokeStyle = '#E8FF47';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(px, py, pw, ph);
    ctx.fillStyle = 'rgba(232, 255, 71, 0.08)';
    ctx.fillRect(px, py, pw, ph);
    ctx.setLineDash([]);
  });

  canvas.addEventListener('mouseup', (e) => {
    if (!isDrawing || !drawStart) return;
    isDrawing = false;
    const end = getCanvasCoords(e);
    const x = Math.min(drawStart.x, end.x);
    const y = Math.min(drawStart.y, end.y);
    const w = Math.abs(end.x - drawStart.x);
    const h = Math.abs(end.y - drawStart.y);
    if (w > 0.02 && h > 0.02) {
      zone = { x, y, w, h };
    }
    drawStart = null;
    redrawCanvas();
  });

  canvas.addEventListener('mouseleave', () => {
    if (isDrawing) { isDrawing = false; drawStart = null; redrawCanvas(); }
  });

  zoneClear.addEventListener('click', (e) => {
    e.preventDefault();
    zone = null;
    redrawCanvas();
  });

  // ── Language grid ─────────────────────────────────────────────────────────
  function getSelectedLanguages() {
    return Array.from(container.querySelectorAll('.ocr-lang-cb:checked')).map(cb => cb.value);
  }

  function updateLangUI() {
    const selected = getSelectedLanguages();
    const count = selected.length;
    langSelected.textContent = `${count} idioma(s) seleccionado(s)`;
    container.querySelectorAll('.ocr-lang-cb').forEach(cb => {
      if (!cb.checked && count >= 3) {
        cb.disabled = true;
        cb.closest('.lang-option').classList.add('opacity-40');
      } else {
        cb.disabled = false;
        cb.closest('.lang-option').classList.remove('opacity-40');
      }
      cb.closest('.lang-option').classList.toggle('border-brand-yellow/40', cb.checked);
      cb.closest('.lang-option').classList.toggle('border-white/10', !cb.checked);
    });
  }
  langGrid.addEventListener('change', updateLangUI);
  updateLangUI();

  // ── Run OCR ───────────────────────────────────────────────────────────────
  runBtn.addEventListener('click', runOcr);

  async function runOcr() {
    if (!file || isProcessing) return;
    isProcessing = true;
    runBtn.disabled = true;
    runLabel.textContent = 'PROCESANDO...';
    errorEl.classList.add('hidden');
    resultsSection.classList.add('hidden');

    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('spellingLanguage', getSelectedLanguages().join(','));
      formData.append('checkSpelling', 'true');
      if (zone) {
        formData.append('zone', JSON.stringify(zone));
      }

      const result = await ocrSpellCheck(formData);

      // Show results
      resultsSection.classList.remove('hidden');

      // Annotated image
      if (result.annotatedImage) {
        annotatedImg.src = `data:image/jpeg;base64,${result.annotatedImage}`;
      }

      // Extracted text
      textOutput.textContent = result.fullText || '(Sin texto detectado)';
      const wc = (result.words || []).length;
      wordCount.textContent = `${wc} palabra(s) detectada(s)`;

      // Spelling errors
      const errors = result.spellingErrors || [];
      if (errors.length > 0) {
        spellingSection.classList.remove('hidden');
        spellingList.innerHTML = errors.map((err, i) => `
          <div class="flex items-start gap-3 p-3 border border-brand-red/20 bg-brand-red/5">
            <span class="font-mono text-xs text-brand-red font-bold mt-0.5">${i + 1}</span>
            <div class="flex-1 min-w-0">
              <p class="font-mono text-sm text-white">
                <span class="text-brand-red font-bold">«${escapeHtml(err.word)}»</span>
                <span class="text-white/30 text-xs ml-2">confianza: ${err.confidence}%</span>
              </p>
              ${err.suggestions && err.suggestions.length > 0
                ? `<p class="font-mono text-xs text-white/40 mt-1">
                    Sugerencias: ${err.suggestions.map(s => `<span class="text-brand-yellow">${escapeHtml(s)}</span>`).join(', ')}
                  </p>`
                : ''}
            </div>
          </div>
        `).join('');
      } else {
        spellingSection.classList.remove('hidden');
        spellingList.innerHTML = `
          <div class="p-4 border border-brand-green/20 bg-brand-green/5 text-center">
            <p class="font-mono text-sm text-brand-green">✓ No se encontraron errores ortográficos</p>
          </div>
        `;
      }
    } catch (err) {
      errorEl.textContent = `Error: ${err.message}`;
      errorEl.classList.remove('hidden');
    } finally {
      isProcessing = false;
      runBtn.disabled = !file;
      runLabel.textContent = 'EJECUTAR OCR';
    }
  }

  // ── Copy text ─────────────────────────────────────────────────────────────
  copyBtn.addEventListener('click', () => {
    const text = textOutput.textContent;
    if (text && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = '✓ Copiado';
        setTimeout(() => { copyBtn.textContent = '📋 Copiar'; }, 2000);
      });
    }
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
