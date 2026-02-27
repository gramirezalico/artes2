/**
 * InspectionForm.js — New inspection form with:
 *   - Product metadata
 *   - File uploads (master + sample)
 *   - Dual-canvas zone selection (draw on master, mirrored on sample)
 *   - Tolerance / accuracy sliders
 *   - Spelling check toggle + language selector
 */
import { mount as mountUploader } from './FileUploader.js';
import { uploadInspection, startInspection } from '../hooks/useInspection.js';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

export function mount(container, { onSuccess }) {
  const files = { master: null, sample: null };
  let isSubmitting = false;
  let zones = [];
  let masterPreviewImg = null;
  let samplePreviewImg = null;

  container.innerHTML = `
    <div class="max-w-5xl mx-auto px-6 py-12">
      <div class="mb-10">
        <div class="section-label mb-3">Nueva Inspección</div>
        <h1 class="font-display text-4xl font-bold text-white leading-tight">
          Control de Calidad de Impresión
        </h1>
        <p class="font-mono text-sm text-white/40 mt-3">
          Carga el documento maestro (referencia) y la muestra a inspeccionar.
        </p>
      </div>

      <form id="inspection-form" novalidate>
        <div class="grid grid-cols-1 gap-8">

          <!-- Product info -->
          <div class="card">
            <div class="section-label mb-5">Información del Producto</div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div>
                <label class="block font-mono text-xs text-white/50 mb-2" for="productId">ID del Producto</label>
                <input type="text" id="productId" name="productId" class="input-field"
                       placeholder="Ej: PKG-2026-0142" maxlength="100" autocomplete="off" />
              </div>
              <div>
                <label class="block font-mono text-xs text-white/50 mb-2" for="productName">Nombre del Producto *</label>
                <input type="text" id="productName" name="productName" class="input-field"
                       placeholder="Ej: Ibuprofeno 400mg Caja x 30" maxlength="300" required autocomplete="off" />
                <p id="productName-error" class="hidden mt-1.5 text-xs text-brand-red font-mono"></p>
              </div>
              <div>
                <label class="block font-mono text-xs text-white/50 mb-2" for="description">Descripción</label>
                <input type="text" id="description" name="description" class="input-field"
                       placeholder="Notas adicionales…" maxlength="1000" autocomplete="off" />
              </div>
            </div>
          </div>

          <!-- File uploads -->
          <div class="card">
            <div class="section-label mb-5">Archivos de Inspección</div>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div id="uploader-master"></div>
              <div class="lg:hidden h-px bg-white/[0.06]"></div>
              <div id="uploader-sample"></div>
            </div>
            <p id="files-error" class="hidden mt-3 text-xs text-brand-red font-mono"></p>
          </div>

          <!-- Dual zone selection (visible when BOTH files are loaded) -->
          <div id="zones-section" class="card" style="display:none">
            <div class="flex items-center justify-between mb-3">
              <div>
                <div class="section-label mb-1">Zonas de Inspección (Opcional)</div>
                <p class="font-mono text-xs text-white/40">
                  Dibuja rectángulos sobre el <strong class="text-brand-yellow">maestro</strong> para definir las áreas a comparar.
                  Las mismas zonas se aplican a ambos documentos.
                </p>
              </div>
              <button type="button" id="zones-clear" class="btn-sm border-white/20 text-white/40 hover:text-brand-red" style="display:none">
                ✕ Limpiar
              </button>
            </div>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <div class="font-mono text-[10px] text-brand-yellow/60 mb-1.5 uppercase tracking-wider flex items-center gap-2">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="1" y="1" width="8" height="8" stroke="currentColor" stroke-width="1" stroke-dasharray="2 1"/></svg>
                  Maestro — Dibuja aquí
                </div>
                <div class="relative border border-brand-yellow/20 bg-black/30 overflow-hidden">
                  <canvas id="zones-canvas-master" class="block cursor-crosshair" style="max-width:100%;max-height:450px"></canvas>
                </div>
              </div>
              <div>
                <div class="font-mono text-[10px] text-white/30 mb-1.5 uppercase tracking-wider">
                  Muestra — Vista previa
                </div>
                <div class="relative border border-white/10 bg-black/30 overflow-hidden">
                  <canvas id="zones-canvas-sample" class="block" style="max-width:100%;max-height:450px"></canvas>
                </div>
              </div>
            </div>
            <div class="mt-2">
              <span id="zones-count" class="font-mono text-[10px] text-white/30">Sin zonas — se comparará el documento completo.</span>
            </div>
          </div>

          <!-- Tolerance / Accuracy sliders -->
          <div class="card">
            <div class="section-label mb-5">Parámetros de Inspección</div>
            <p class="font-mono text-xs text-white/40 mb-6">
              Ajusta la sensibilidad del motor de comparación. Valores más altos = mayor exigencia.
            </p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <div class="flex items-center justify-between mb-3">
                  <label class="font-mono text-xs text-white/50" for="elementTolerance">Tolerancia de Elementos</label>
                  <span id="elementTolerance-value" class="font-mono text-sm font-bold text-brand-yellow">50%</span>
                </div>
                <input type="range" id="elementTolerance" name="elementTolerance"
                       min="0" max="100" value="50" step="5" class="slider-input w-full" />
                <div class="flex justify-between mt-1.5">
                  <span class="font-mono text-[10px] text-white/25">Flexible</span>
                  <span class="font-mono text-[10px] text-white/25">Estricto</span>
                </div>
              </div>
              <div>
                <div class="flex items-center justify-between mb-3">
                  <label class="font-mono text-xs text-white/50" for="accuracyLevel">Precisión / Accuracy</label>
                  <span id="accuracyLevel-value" class="font-mono text-sm font-bold text-brand-yellow">50%</span>
                </div>
                <input type="range" id="accuracyLevel" name="accuracyLevel"
                       min="0" max="100" value="50" step="5" class="slider-input w-full" />
                <div class="flex justify-between mt-1.5">
                  <span class="font-mono text-[10px] text-white/25">Relajado</span>
                  <span class="font-mono text-[10px] text-white/25">Milimétrico</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Spelling check -->
          <div class="card">
            <div class="section-label mb-5">Revisión Ortográfica</div>
            <p class="font-mono text-xs text-white/40 mb-5">
              Extrae el texto con OCR y revisa la ortografía de las palabras detectadas.
              Los errores introducidos en la muestra se marcan como críticos.
            </p>
            <div class="flex items-center gap-6 flex-wrap">
              <label class="flex items-center gap-3 cursor-pointer select-none" for="checkSpelling">
                <div class="spelling-toggle relative w-11 h-6 bg-white/10 rounded-full transition-colors">
                  <input type="checkbox" id="checkSpelling" class="sr-only peer" />
                  <div class="spelling-knob absolute left-0.5 top-0.5 w-5 h-5 bg-white/40 rounded-full
                              peer-checked:translate-x-5 peer-checked:bg-brand-yellow
                              transition-all duration-200"></div>
                </div>
                <span class="font-mono text-sm text-white/70">Activar revisión ortográfica</span>
              </label>
              <div id="spelling-options" class="flex items-center gap-3" style="display:none">
                <label class="font-mono text-xs text-white/40" for="spellingLanguage">Idioma:</label>
                <select id="spellingLanguage" class="input-field w-44 py-2 text-sm">
                  <option value="es" selected>Español</option>
                  <option value="en">English</option>
                  <option value="es,en">Español + English</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Submit -->
          <div class="flex items-center justify-between">
            <p class="font-mono text-xs text-white/30">* Campo obligatorio · Máx 50 MB por archivo</p>
            <button type="submit" id="submit-btn" class="btn-primary">
              <svg id="submit-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 8h12M10 4l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span id="submit-label">INICIAR INSPECCIÓN</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  `;

  // ── File uploaders ──────────────────────────────────────────────────────
  mountUploader(container.querySelector('#uploader-master'), {
    label: 'Documento Maestro (Referencia)',
    id: 'master',
    onChange: (file) => {
      files.master = file;
      if (file) loadPreview(file, 'master');
      else { masterPreviewImg = null; checkShowZones(); }
    }
  });
  mountUploader(container.querySelector('#uploader-sample'), {
    label: 'Muestra a Inspeccionar',
    id: 'sample',
    onChange: (file) => {
      files.sample = file;
      if (file) loadPreview(file, 'sample');
      else { samplePreviewImg = null; checkShowZones(); }
    }
  });

  // ── Zones section ───────────────────────────────────────────────────────
  const zonesSection   = container.querySelector('#zones-section');
  const canvasMaster   = container.querySelector('#zones-canvas-master');
  const canvasSample   = container.querySelector('#zones-canvas-sample');
  const zonesCount     = container.querySelector('#zones-count');
  const zonesClear     = container.querySelector('#zones-clear');
  const ctxM           = canvasMaster.getContext('2d');
  const ctxS           = canvasSample.getContext('2d');

  let isDrawing = false;
  let drawStart = null;

  function checkShowZones() {
    if (masterPreviewImg && samplePreviewImg) {
      sizeCanvases();
      redrawBoth();
      zonesSection.style.display = '';
    } else if (masterPreviewImg) {
      // Show at least the master preview even without sample
      sizeCanvases();
      redrawBoth();
      zonesSection.style.display = '';
    } else {
      zonesSection.style.display = 'none';
      zones = [];
    }
    updateZonesUI();
  }

  function sizeCanvases() {
    const containerW = zonesSection.querySelector('.grid')?.clientWidth || 700;
    const maxCanvasW = Math.min(600, Math.floor((containerW - 16) / 2));

    if (masterPreviewImg) {
      const scaleM = maxCanvasW / masterPreviewImg.width;
      canvasMaster.width = masterPreviewImg.width * scaleM;
      canvasMaster.height = masterPreviewImg.height * scaleM;
    }
    if (samplePreviewImg) {
      const scaleS = maxCanvasW / samplePreviewImg.width;
      canvasSample.width = samplePreviewImg.width * scaleS;
      canvasSample.height = samplePreviewImg.height * scaleS;
    } else if (masterPreviewImg) {
      // Mirror master dimensions so placeholder canvas sizes match
      canvasSample.width = canvasMaster.width;
      canvasSample.height = canvasMaster.height;
    }
  }

  async function loadPreview(file, which) {
    try {
      const ext = file.name.split('.').pop().toLowerCase();
      const img = new Image();

      if (ext === 'pdf') {
        const ab = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });
        const off = document.createElement('canvas');
        off.width = viewport.width;
        off.height = viewport.height;
        await page.render({ canvasContext: off.getContext('2d'), viewport }).promise;
        img.src = off.toDataURL('image/jpeg', 0.9);
      } else {
        img.src = URL.createObjectURL(file);
      }

      img.onload = () => {
        if (which === 'master') masterPreviewImg = img;
        else samplePreviewImg = img;
        checkShowZones();
      };
    } catch (err) {
      console.warn(`[InspectionForm] Preview failed (${which}):`, err);
      if (which === 'master') masterPreviewImg = null;
      else samplePreviewImg = null;
      checkShowZones();
    }
  }

  function redrawBoth() {
    redrawCanvas(ctxM, canvasMaster, masterPreviewImg);
    redrawCanvas(ctxS, canvasSample, samplePreviewImg);
  }

  function redrawCanvas(ctx, canvas, previewImg) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (previewImg) {
      ctx.drawImage(previewImg, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.font = '12px "DM Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Carga el archivo para ver la vista previa', canvas.width / 2, canvas.height / 2);
      ctx.textAlign = 'start';
    }

    // Draw zones
    zones.forEach((z, i) => {
      const x = z.bbox.x * canvas.width;
      const y = z.bbox.y * canvas.height;
      const w = z.bbox.w * canvas.width;
      const h = z.bbox.h * canvas.height;
      ctx.strokeStyle = '#E8FF47';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = 'rgba(232, 255, 71, 0.08)';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#E8FF47';
      ctx.font = 'bold 11px "DM Mono", monospace';
      ctx.fillText(`Z${i + 1}`, x + 4, y + 14);
    });
  }

  function updateZonesUI() {
    if (zones.length === 0) {
      zonesCount.textContent = 'Sin zonas — se comparará el documento completo.';
      zonesClear.style.display = 'none';
    } else {
      zonesCount.textContent = `${zones.length} zona(s) definida(s).`;
      zonesClear.style.display = '';
    }
  }

  function getCanvasCoords(e) {
    const rect = canvasMaster.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    };
  }

  canvasMaster.addEventListener('mousedown', (e) => {
    if (!masterPreviewImg) return;
    isDrawing = true;
    drawStart = getCanvasCoords(e);
  });

  canvasMaster.addEventListener('mousemove', (e) => {
    if (!isDrawing || !drawStart) return;
    const cur = getCanvasCoords(e);
    redrawBoth();
    // Draw in-progress rectangle on BOTH canvases
    const x = Math.min(drawStart.x, cur.x);
    const y = Math.min(drawStart.y, cur.y);
    const w = Math.abs(cur.x - drawStart.x);
    const h = Math.abs(cur.y - drawStart.y);

    [{ ctx: ctxM, cv: canvasMaster }, { ctx: ctxS, cv: canvasSample }].forEach(({ ctx, cv }) => {
      const px = x * cv.width, py = y * cv.height;
      const pw = w * cv.width, ph = h * cv.height;
      ctx.strokeStyle = '#E8FF47';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(px, py, pw, ph);
      ctx.fillStyle = 'rgba(232, 255, 71, 0.06)';
      ctx.fillRect(px, py, pw, ph);
      ctx.setLineDash([]);
    });
  });

  canvasMaster.addEventListener('mouseup', (e) => {
    if (!isDrawing || !drawStart) return;
    isDrawing = false;
    const end = getCanvasCoords(e);

    const x = Math.min(drawStart.x, end.x);
    const y = Math.min(drawStart.y, end.y);
    const w = Math.abs(end.x - drawStart.x);
    const h = Math.abs(end.y - drawStart.y);

    if (w > 0.02 && h > 0.02) {
      zones.push({ page: 1, label: `Zona ${zones.length + 1}`, bbox: { x, y, w, h } });
    }
    drawStart = null;
    redrawBoth();
    updateZonesUI();
  });

  canvasMaster.addEventListener('mouseleave', () => {
    if (isDrawing) { isDrawing = false; drawStart = null; redrawBoth(); }
  });

  zonesClear.addEventListener('click', (e) => {
    e.preventDefault();
    zones = [];
    redrawBoth();
    updateZonesUI();
  });

  // ── Spelling toggle ─────────────────────────────────────────────────────
  const spellCheck    = container.querySelector('#checkSpelling');
  const spellToggle   = container.querySelector('.spelling-toggle');
  const spellOptions  = container.querySelector('#spelling-options');

  spellCheck.addEventListener('change', () => {
    const on = spellCheck.checked;
    spellToggle.style.background = on ? 'rgba(232,255,71,0.2)' : '';
    spellOptions.style.display = on ? '' : 'none';
  });

  // ── Sliders ─────────────────────────────────────────────────────────────
  const elTolSlider = container.querySelector('#elementTolerance');
  const elTolDisplay = container.querySelector('#elementTolerance-value');
  const accSlider = container.querySelector('#accuracyLevel');
  const accDisplay = container.querySelector('#accuracyLevel-value');

  elTolSlider.addEventListener('input', () => { elTolDisplay.textContent = `${elTolSlider.value}%`; });
  accSlider.addEventListener('input', () => { accDisplay.textContent = `${accSlider.value}%`; });

  // ── Form submission ─────────────────────────────────────────────────────
  const form = container.querySelector('#inspection-form');
  const submitBtn = container.querySelector('#submit-btn');
  const submitLabel = container.querySelector('#submit-label');
  const nameInput = container.querySelector('#productName');
  const nameError = container.querySelector('#productName-error');
  const filesError = container.querySelector('#files-error');

  function setError(el, msg) {
    if (msg) { el.textContent = msg; el.classList.remove('hidden'); }
    else { el.textContent = ''; el.classList.add('hidden'); }
  }

  function setLoading(loading) {
    isSubmitting = loading;
    submitBtn.disabled = loading;
    submitLabel.textContent = loading ? 'PROCESANDO...' : 'INICIAR INSPECCIÓN';
    submitBtn.classList.toggle('opacity-70', loading);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    let hasErrors = false;
    const productName = nameInput.value.trim();
    if (!productName) { setError(nameError, 'El nombre del producto es obligatorio.'); nameInput.focus(); hasErrors = true; }
    else setError(nameError, null);

    if (!files.master && !files.sample) { setError(filesError, 'Debes cargar ambos archivos.'); hasErrors = true; }
    else if (!files.master) { setError(filesError, 'Falta el documento maestro.'); hasErrors = true; }
    else if (!files.sample) { setError(filesError, 'Falta la muestra.'); hasErrors = true; }
    else setError(filesError, null);

    if (hasErrors) return;

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('productName', productName);
      formData.append('productId', container.querySelector('#productId').value.trim());
      formData.append('description', container.querySelector('#description').value.trim());
      formData.append('elementTolerance', elTolSlider.value);
      formData.append('accuracyLevel', accSlider.value);
      formData.append('masterFile', files.master);
      formData.append('sampleFile', files.sample);

      const { inspectionId } = await uploadInspection(formData);
      await startInspection(inspectionId, {
        inspectionZones: zones,
        checkSpelling: spellCheck.checked,
        spellingLanguage: container.querySelector('#spellingLanguage').value
      });
      onSuccess({ inspectionId });
    } catch (err) {
      setLoading(false);
      setError(filesError, `Error: ${err.message}`);
    }
  });

  nameInput.addEventListener('input', () => setError(nameError, null));
}
