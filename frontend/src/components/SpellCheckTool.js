/**
 * SpellCheckTool.js — Standalone OCR & spell-check interface.
 *
 * Allows the user to:
 *   1. Upload an image/PDF (drag-and-drop)
 *   2. Draw SVG rectangles to select OCR regions on the PDF preview
 *   3. Choose languages
 *   4. Run OCR at full resolution and view results in a carousel/slider
 */
import { ocrSpellCheck } from '../hooks/useInspection.js';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

export function mount(container, { onBack }) {
  let file = null;
  let previewSrc = null;
  let zone = null;
  let isDrawing = false;
  let drawStart = null;
  let isProcessing = false;
  let currentSlide = 0;
  let totalSlides = 0;

  container.innerHTML = `
    <div class="max-w-5xl mx-auto px-6 py-12">
      <div class="mb-10">
        <div class="section-label mb-3">Herramienta OCR</div>
        <h1 class="font-display text-4xl font-bold text-white leading-tight">
          Revisión de Ortografía por Zona
        </h1>
        <p class="font-mono text-sm text-white/40 mt-3">
          Carga un PDF o imagen, selecciona el área con el cursor y ejecuta OCR.
        </p>
      </div>

      <!-- File upload -->
      <div class="card mb-6">
        <div class="section-label mb-4">Archivo a Analizar</div>
        <div id="ocr-dropzone" class="drop-zone border-2 border-dashed border-white/15 p-8 text-center cursor-pointer
                    hover:border-brand-yellow/40 transition-all">
          <input type="file" id="ocr-file-input" class="hidden"
                 accept=".pdf,.tiff,.tif,.bmp,.png,.jpg,.jpeg" />
          <div id="ocr-drop-label">
            <svg class="mx-auto mb-3 text-white/30" width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

      <!-- SVG zone selection overlay -->
      <div id="ocr-preview-section" class="card mb-6" style="display:none">
        <div class="flex items-center justify-between mb-3">
          <div>
            <div class="section-label mb-1">Seleccionar Zona (Opcional)</div>
            <p class="font-mono text-xs text-white/40">
              Dibuja un rectángulo sobre la imagen para enfocar el OCR en una zona específica.
            </p>
          </div>
          <button type="button" id="ocr-zone-clear"
                  class="btn-sm border-white/20 text-white/40 hover:text-brand-red" style="display:none">
            ✕ Limpiar zona
          </button>
        </div>
        <div id="ocr-preview-wrapper" class="ocr-svg-wrapper relative border border-brand-yellow/20 bg-black/30 inline-block select-none">
          <img id="ocr-preview-img" class="block" style="max-width:100%;max-height:550px" alt="Vista previa del archivo" draggable="false" />
          <svg id="ocr-svg-overlay" class="absolute inset-0 w-full h-full cursor-crosshair" style="pointer-events:auto">
            <!-- Committed zone rectangle -->
            <rect id="ocr-svg-zone" x="0" y="0" width="0" height="0"
                  fill="rgba(232,255,71,0.10)" stroke="#E8FF47" stroke-width="2"
                  visibility="hidden" />
            <!-- Zone label -->
            <text id="ocr-svg-zone-label" x="0" y="0"
                  fill="#E8FF47" font-size="11" font-weight="bold" font-family="'DM Mono', monospace"
                  visibility="hidden">OCR</text>
            <!-- Temporary drawing rectangle -->
            <rect id="ocr-svg-drawing" x="0" y="0" width="0" height="0"
                  fill="rgba(232,255,71,0.08)" stroke="#E8FF47" stroke-width="2"
                  stroke-dasharray="6 4" visibility="hidden" />
          </svg>
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
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 2h5l2 2h5v10H2V2z" stroke="currentColor" stroke-width="1.5"/>
              <path d="M5 10h6M5 7.5h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            </svg>
            <span id="ocr-run-label">EJECUTAR OCR</span>
          </button>
          <p id="ocr-error" class="font-mono text-xs text-brand-red hidden"></p>
        </div>
      </div>

      <!-- Results carousel -->
      <div id="ocr-results" class="hidden">
        <div class="card mb-6">
          <!-- Carousel navigation header -->
          <div class="flex items-center justify-between mb-4">
            <div class="section-label" id="ocr-carousel-title">Resultados</div>
            <div class="flex items-center gap-2">
              <button type="button" id="ocr-carousel-prev"
                      class="btn-sm border-white/20 text-white/50 hover:text-brand-yellow disabled:opacity-30 disabled:cursor-not-allowed"
                      disabled>
                ← Anterior
              </button>
              <span id="ocr-carousel-indicator" class="font-mono text-xs text-white/40">1 / 3</span>
              <button type="button" id="ocr-carousel-next"
                      class="btn-sm border-white/20 text-white/50 hover:text-brand-yellow disabled:opacity-30 disabled:cursor-not-allowed">
                Siguiente →
              </button>
            </div>
          </div>

          <!-- Dot indicators -->
          <div id="ocr-carousel-dots" class="flex items-center justify-center gap-2 mb-4"></div>

          <!-- Slide container -->
          <div class="ocr-carousel-viewport overflow-hidden" style="max-height:340px">
            <div id="ocr-carousel-track" class="ocr-carousel-track flex transition-transform duration-300 ease-out" style="height:100%">
              <!-- Slide 1: Annotated image -->
              <div class="ocr-carousel-slide flex-shrink-0 w-full" data-slide="0">
                <div class="section-label mb-3 text-xs">Imagen Anotada</div>
                <div class="border border-white/10 bg-black/30 overflow-auto" style="max-height:280px">
                  <img id="ocr-annotated-img" class="block" style="max-width:100%" alt="Resultado OCR con errores ortográficos resaltados" />
                </div>
              </div>

              <!-- Slide 2: Extracted text -->
              <div class="ocr-carousel-slide flex-shrink-0 w-full" data-slide="1">
                <div class="flex items-center justify-between mb-3">
                  <div class="section-label text-xs">Texto Extraído</div>
                  <button type="button" id="ocr-copy-btn" class="btn-sm border-white/20 text-white/50 hover:text-brand-yellow">
                    📋 Copiar
                  </button>
                </div>
                <div id="ocr-text-output"
                     class="bg-brand-card border border-white/10 p-4 font-mono text-sm text-white/80 whitespace-pre-wrap overflow-y-auto"
                     style="max-height:240px">
                </div>
                <p id="ocr-word-count" class="mt-2 font-mono text-[10px] text-white/30"></p>
              </div>

              <!-- Slide 3: Spelling errors -->
              <div class="ocr-carousel-slide flex-shrink-0 w-full" data-slide="2">
                <div class="section-label mb-3 text-xs">Errores Ortográficos</div>
                <div id="ocr-spelling-list" class="space-y-2 overflow-y-auto" style="max-height:280px"></div>
              </div>
            </div>
          </div>
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

  const previewSection = container.querySelector('#ocr-preview-section');
  const previewImgEl = container.querySelector('#ocr-preview-img');
  const svgOverlay = container.querySelector('#ocr-svg-overlay');
  const svgZone = container.querySelector('#ocr-svg-zone');
  const svgZoneLabel = container.querySelector('#ocr-svg-zone-label');
  const svgDrawing = container.querySelector('#ocr-svg-drawing');
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
  const spellingList = container.querySelector('#ocr-spelling-list');

  const carouselTrack = container.querySelector('#ocr-carousel-track');
  const carouselPrev = container.querySelector('#ocr-carousel-prev');
  const carouselNext = container.querySelector('#ocr-carousel-next');
  const carouselIndicator = container.querySelector('#ocr-carousel-indicator');
  const carouselDots = container.querySelector('#ocr-carousel-dots');
  const carouselTitle = container.querySelector('#ocr-carousel-title');

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
    previewSrc = null;
    zone = null;
    fileInput.value = '';
    dropLabel.classList.remove('hidden');
    fileInfo.classList.add('hidden');
    previewSection.style.display = 'none';
    runBtn.disabled = true;
    resultsSection.classList.add('hidden');
  }

  async function loadPreview(f) {
    try {
      const ext = f.name.split('.').pop().toLowerCase();

      if (ext === 'pdf') {
        const ab = await f.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });
        const off = document.createElement('canvas');
        off.width = viewport.width;
        off.height = viewport.height;
        await page.render({ canvasContext: off.getContext('2d'), viewport }).promise;
        previewSrc = off.toDataURL('image/jpeg', 0.9);
      } else {
        previewSrc = URL.createObjectURL(f);
      }

      previewImgEl.onload = () => {
        updateSvgZone();
        previewSection.style.display = '';
      };
      previewImgEl.src = previewSrc;
    } catch (err) {
      console.warn('[SpellCheckTool] Preview failed:', err);
      previewSrc = null;
      previewSection.style.display = 'none';
    }
  }

  // ── SVG zone drawing ──────────────────────────────────────────────────────
  function getSvgCoords(e) {
    const rect = svgOverlay.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    };
  }

  function updateSvgZone() {
    if (zone) {
      const pct = (v) => (v * 100).toFixed(2) + '%';
      svgZone.setAttribute('x', pct(zone.x));
      svgZone.setAttribute('y', pct(zone.y));
      svgZone.setAttribute('width', pct(zone.w));
      svgZone.setAttribute('height', pct(zone.h));
      svgZone.setAttribute('visibility', 'visible');
      svgZoneLabel.setAttribute('x', pct(zone.x));
      svgZoneLabel.setAttribute('y', (zone.y * 100 - 0.5).toFixed(2) + '%');
      svgZoneLabel.setAttribute('visibility', 'visible');
      zoneStatus.textContent = 'Zona seleccionada — OCR se ejecutará solo en esta área.';
      zoneClear.style.display = '';
    } else {
      svgZone.setAttribute('visibility', 'hidden');
      svgZoneLabel.setAttribute('visibility', 'hidden');
      zoneStatus.textContent = 'Sin zona — se analizará la imagen completa a resolución máxima.';
      zoneClear.style.display = 'none';
    }
    svgDrawing.setAttribute('visibility', 'hidden');
  }

  svgOverlay.addEventListener('mousedown', (e) => {
    if (!previewSrc) return;
    e.preventDefault();
    isDrawing = true;
    drawStart = getSvgCoords(e);
  });

  svgOverlay.addEventListener('mousemove', (e) => {
    if (!isDrawing || !drawStart) return;
    e.preventDefault();
    const cur = getSvgCoords(e);
    const x = Math.min(drawStart.x, cur.x);
    const y = Math.min(drawStart.y, cur.y);
    const w = Math.abs(cur.x - drawStart.x);
    const h = Math.abs(cur.y - drawStart.y);
    const pct = (v) => (v * 100).toFixed(2) + '%';
    svgDrawing.setAttribute('x', pct(x));
    svgDrawing.setAttribute('y', pct(y));
    svgDrawing.setAttribute('width', pct(w));
    svgDrawing.setAttribute('height', pct(h));
    svgDrawing.setAttribute('visibility', 'visible');
    // Hide committed zone while drawing
    svgZone.setAttribute('visibility', 'hidden');
    svgZoneLabel.setAttribute('visibility', 'hidden');
  });

  svgOverlay.addEventListener('mouseup', (e) => {
    if (!isDrawing || !drawStart) return;
    isDrawing = false;
    const end = getSvgCoords(e);
    const x = Math.min(drawStart.x, end.x);
    const y = Math.min(drawStart.y, end.y);
    const w = Math.abs(end.x - drawStart.x);
    const h = Math.abs(end.y - drawStart.y);
    if (w > 0.02 && h > 0.02) {
      zone = { x, y, w, h };
    }
    drawStart = null;
    updateSvgZone();
  });

  svgOverlay.addEventListener('mouseleave', () => {
    if (isDrawing) { isDrawing = false; drawStart = null; updateSvgZone(); }
  });

  zoneClear.addEventListener('click', (e) => {
    e.preventDefault();
    zone = null;
    updateSvgZone();
  });

  // ── Carousel ──────────────────────────────────────────────────────────────
  const slideTitles = ['Imagen Anotada', 'Texto Extraído', 'Errores Ortográficos'];

  function goToSlide(index) {
    currentSlide = Math.max(0, Math.min(index, totalSlides - 1));
    carouselTrack.style.transform = `translateX(-${currentSlide * 100}%)`;
    carouselPrev.disabled = currentSlide === 0;
    carouselNext.disabled = currentSlide === totalSlides - 1;
    carouselIndicator.textContent = `${currentSlide + 1} / ${totalSlides}`;
    carouselTitle.textContent = slideTitles[currentSlide] || 'Resultados';
    // Update dot indicators
    carouselDots.querySelectorAll('.ocr-dot').forEach((dot, i) => {
      dot.classList.toggle('bg-brand-yellow', i === currentSlide);
      dot.classList.toggle('bg-white/20', i !== currentSlide);
    });
  }

  function initCarousel(count) {
    totalSlides = count;
    currentSlide = 0;
    carouselDots.innerHTML = Array.from({ length: count }, (_, i) =>
      `<button type="button" class="ocr-dot w-2 h-2 rounded-full transition-colors ${i === 0 ? 'bg-brand-yellow' : 'bg-white/20'}" data-dot="${i}"></button>`
    ).join('');
    goToSlide(0);
  }

  carouselPrev.addEventListener('click', () => goToSlide(currentSlide - 1));
  carouselNext.addEventListener('click', () => goToSlide(currentSlide + 1));
  carouselDots.addEventListener('click', (e) => {
    const dot = e.target.closest('.ocr-dot');
    if (dot) goToSlide(Number(dot.dataset.dot));
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

      // Show results carousel
      resultsSection.classList.remove('hidden');
      initCarousel(3);

      // Slide 1: Annotated image
      if (result.annotatedImage) {
        annotatedImg.src = `data:image/jpeg;base64,${result.annotatedImage}`;
      }

      // Slide 2: Extracted text
      textOutput.textContent = result.fullText || '(Sin texto detectado)';
      const wc = (result.words || []).length;
      wordCount.textContent = `${wc} palabra(s) detectada(s)`;

      // Slide 3: Spelling errors
      const errors = result.spellingErrors || [];
      if (errors.length > 0) {
        spellingList.innerHTML = errors.map((err, i) => `
          <div class="flex items-start gap-3 p-3 border border-brand-red/20 bg-brand-red/5">
            <span class="font-mono text-xs text-brand-red font-bold mt-0.5">${i + 1}</span>
            <div class="flex-1 min-w-0">
              <p class="font-mono text-sm text-white">
                <span class="text-brand-red font-bold">\u00AB${escapeHtml(err.word)}\u00BB</span>
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
