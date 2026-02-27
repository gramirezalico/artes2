/**
 * InspectionWorkspace.js — Full inspection results:
 *   - View modes: Split, Master, Sample, Diff (CV-annotated), Heatmap, Overlay
 *   - Finding rows with master/sample crop thumbnails + metrics
 *   - PDF report download
 *   - Page navigation for multi-page documents
 *   - Severity classification modal
 */
import { classifyFinding } from '../hooks/useInspection.js';

const VERDICT_CONFIG = {
  pass:   { label: '✅ APROBADO', cls: 'verdict-pass' },
  review: { label: '⚠️ REVISAR',  cls: 'verdict-review' },
  fail:   { label: '❌ RECHAZADO', cls: 'verdict-fail' }
};

const SEVERITY_CONFIG = {
  critical:  { label: 'Crítico',    cls: 'severity-critical',  color: '#FF4757', badge: 'badge-red' },
  important: { label: 'Importante', cls: 'severity-important', color: '#E8FF47', badge: 'badge-yellow' },
  minor:     { label: 'Menor',      cls: 'severity-minor',     color: '#5352ED', badge: 'badge-blue' },
  ignore:    { label: 'Ignorar',    cls: 'severity-ignore',    color: '#6B7280', badge: 'badge-muted' }
};

const TYPE_LABELS = {
  typography: 'Tipografía', color: 'Color', graphic: 'Gráfico',
  content: 'Contenido', layout: 'Diseño', spelling: 'Ortografía'
};

export function mount(container, { inspection, onNewInspection, onHistory }) {
  const { findings = [], analysis = {}, productName, productId, description, createdAt,
          masterFile, sampleFile, elementTolerance, accuracyLevel,
          diffImages = [], heatmaps = [] } = inspection;

  const verdict = VERDICT_CONFIG[analysis.verdict] || VERDICT_CONFIG.review;
  const dateStr = createdAt ? new Date(createdAt).toLocaleString('es-ES') : '';
  const ssimPct = analysis.overallSsim ? `${(analysis.overallSsim * 100).toFixed(1)}%` : '—';
  const totalPages = Math.max(masterFile?.pageCount || 1, sampleFile?.pageCount || 1, diffImages.length, 1);

  let activeFindingIdx = -1;
  let viewMode = 'split';
  let zoomLevel = 1;
  let currentPage = 0; // 0-indexed

  container.innerHTML = `
    <div class="flex flex-col h-full animate-fade-in">
      <!-- Header -->
      <div class="bg-brand-surface border-b border-white/[0.06] px-6 py-3">
        <div class="max-w-[1800px] mx-auto flex items-center justify-between gap-4">
          <div class="min-w-0">
            <div class="flex items-center gap-3">
              <h1 class="font-display text-lg font-bold text-white truncate">${esc(productName)}</h1>
              ${productId ? `<span class="badge badge-muted text-[10px]">${esc(productId)}</span>` : ''}
            </div>
            <div class="flex items-center gap-3 mt-1">
              <span class="font-mono text-xs text-white/30">${dateStr}</span>
              <span class="font-mono text-[10px] text-white/25">SSIM: ${ssimPct}</span>
              ${elementTolerance != null ? `<span class="font-mono text-[10px] text-white/20">Tol:${elementTolerance}%</span>` : ''}
              ${accuracyLevel != null ? `<span class="font-mono text-[10px] text-white/20">Acc:${accuracyLevel}%</span>` : ''}
            </div>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <div class="inline-flex px-4 py-2 font-display font-bold text-sm ${verdict.cls}">${verdict.label}</div>
            <button id="btn-pdf" class="btn-secondary text-xs" title="Descargar informe PDF">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 2h5l5 5v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M9 2v5h5" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>
              PDF
            </button>
            <button id="btn-download" class="btn-secondary text-xs border-brand-yellow/30 text-brand-yellow" title="Descargar imagen anotada">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2v9M5 8l3 3 3-3M3 12h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Imagen
            </button>
          </div>
        </div>
      </div>

      <!-- Toolbar -->
      <div class="bg-brand-card border-b border-white/[0.06] px-6 py-2">
        <div class="max-w-[1800px] mx-auto flex items-center justify-between gap-4 flex-wrap">
          <!-- View modes -->
          <div class="flex items-center gap-1">
            <span class="font-mono text-[10px] text-white/30 mr-1">VISTA:</span>
            <button class="toolbar-btn active" data-view="split" title="Maestro | Muestra">M|S</button>
            <button class="toolbar-btn" data-view="master" title="Solo maestro">M</button>
            <button class="toolbar-btn" data-view="sample" title="Solo muestra">S</button>
            <button class="toolbar-btn" data-view="diff" title="Diferencias anotadas (CV)">Diff</button>
            <button class="toolbar-btn" data-view="heatmap" title="Mapa de calor">Heat</button>
            <button class="toolbar-btn" data-view="overlay" title="Superposición">⊞</button>
          </div>

          <!-- Page navigation -->
          ${totalPages > 1 ? `
          <div class="flex items-center gap-1">
            <span class="font-mono text-[10px] text-white/30 mr-1">PÁG:</span>
            <button id="prev-page" class="toolbar-btn text-xs">◀</button>
            <span id="page-indicator" class="font-mono text-xs text-white/50 w-10 text-center">1/${totalPages}</span>
            <button id="next-page" class="toolbar-btn text-xs">▶</button>
          </div>
          ` : ''}

          <!-- Zoom -->
          <div class="flex items-center gap-1">
            <button id="zoom-out" class="toolbar-btn text-xs">−</button>
            <span id="zoom-level" class="font-mono text-xs text-white/50 w-10 text-center">100%</span>
            <button id="zoom-in" class="toolbar-btn text-xs">+</button>
            <button id="zoom-fit" class="toolbar-btn text-xs">Fit</button>
          </div>

          <!-- Finding navigation -->
          <div class="flex items-center gap-1">
            <span class="font-mono text-[10px] text-white/30 mr-1">HALLAZGOS:</span>
            <span id="finding-counter" class="font-mono text-xs text-brand-yellow">${findings.length}</span>
            <button id="prev-finding" class="toolbar-btn text-xs">◀</button>
            <button id="next-finding" class="toolbar-btn text-xs">▶</button>
          </div>
        </div>
      </div>

      <!-- Main content -->
      <div class="flex flex-1 overflow-hidden">
        <!-- Image panels -->
        <div class="flex-1 flex overflow-hidden" id="panels-container">
          <div id="panel-master" class="workspace-panel flex-1 relative overflow-auto">
            <div class="absolute top-2 left-2 z-20 px-2 py-1 bg-black/60 font-mono text-[10px] text-white/60">MAESTRO</div>
            ${masterFile?.thumbnail
              ? `<img id="img-master" src="data:image/jpeg;base64,${masterFile.thumbnail}" class="block" style="transform-origin:0 0" draggable="false"/>`
              : `<div class="flex items-center justify-center h-full text-white/20 font-mono text-sm">Sin imagen</div>`}
          </div>
          <div id="panel-divider" class="w-px bg-white/10 flex-shrink-0"></div>
          <div id="panel-sample" class="workspace-panel flex-1 relative overflow-auto">
            <div class="absolute top-2 left-2 z-20 px-2 py-1 bg-black/60 font-mono text-[10px] text-brand-yellow/80">MUESTRA</div>
            ${sampleFile?.thumbnail
              ? `<div id="sample-img-wrapper" style="position:relative;display:inline-block;transform-origin:0 0"><img id="img-sample" src="data:image/jpeg;base64,${sampleFile.thumbnail}" class="block" draggable="false"/><div id="markers-container" style="position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none"></div></div>`
              : `<div class="flex items-center justify-center h-full text-white/20 font-mono text-sm">Sin imagen</div>`}
          </div>
          <!-- Diff panel (hidden by default) -->
          <div id="panel-diff" class="workspace-panel flex-1 relative overflow-auto hidden">
            <div class="absolute top-2 left-2 z-20 px-2 py-1 bg-black/60 font-mono text-[10px] text-brand-yellow">DIFERENCIAS</div>
            ${diffImages.length > 0
              ? `<img id="img-diff" src="data:image/jpeg;base64,${diffImages[0]}" class="block" style="transform-origin:0 0" draggable="false"/>`
              : `<div class="flex items-center justify-center h-full text-white/20 font-mono text-sm">Sin imagen de diferencias</div>`}
          </div>
          <!-- Heatmap panel (hidden by default) -->
          <div id="panel-heatmap" class="workspace-panel flex-1 relative overflow-auto hidden">
            <div class="absolute top-2 left-2 z-20 px-2 py-1 bg-black/60 font-mono text-[10px] text-orange-400">MAPA DE CALOR</div>
            ${heatmaps.length > 0
              ? `<img id="img-heatmap" src="data:image/jpeg;base64,${heatmaps[0]}" class="block" style="transform-origin:0 0" draggable="false"/>`
              : `<div class="flex items-center justify-center h-full text-white/20 font-mono text-sm">Sin mapa de calor</div>`}
          </div>
        </div>

        <!-- Findings sidebar -->
        <div id="findings-sidebar" class="w-[400px] flex-shrink-0 border-l border-white/[0.06] bg-brand-surface flex flex-col overflow-hidden">
          <div class="px-4 py-3 border-b border-white/[0.06]">
            <div class="flex items-center justify-between">
              <span class="section-label text-[10px]">Hallazgos</span>
              <div class="flex items-center gap-2">
                <span class="badge badge-red text-[10px]">${analysis.criticalCount || 0} crít</span>
                <span class="badge badge-yellow text-[10px]">${analysis.importantCount || 0} imp</span>
                <span class="badge badge-blue text-[10px]">${analysis.minorCount || 0} men</span>
              </div>
            </div>
          </div>
          <div id="findings-list" class="flex-1 overflow-y-auto">
            ${findings.length === 0
              ? `<div class="flex flex-col items-center justify-center py-16 text-center">
                   <svg width="32" height="32" viewBox="0 0 32 32" fill="none" class="mb-3 opacity-20"><circle cx="16" cy="16" r="12" stroke="white" stroke-width="1.5"/><path d="M12 16l3 3 5-5" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                   <p class="font-mono text-sm text-white/30">Sin diferencias detectadas</p>
                   <p class="font-mono text-xs text-white/20 mt-1">La muestra coincide con el maestro</p>
                 </div>`
              : findings.map((f, i) => renderFindingRow(f, i)).join('')}
          </div>
          <div class="px-4 py-3 border-t border-white/[0.06] bg-brand-card">
            <div class="section-label text-[10px] mb-2">Resumen</div>
            <p class="font-mono text-xs text-white/60 leading-relaxed max-h-[80px] overflow-y-auto">${esc(analysis.summary || '')}</p>
          </div>
        </div>
      </div>

      <!-- Bottom bar -->
      <div class="bg-brand-surface border-t border-white/[0.06] px-6 py-3">
        <div class="max-w-[1800px] mx-auto flex items-center justify-between">
          <button id="btn-history" class="btn-secondary text-xs">← Historial</button>
          <button id="btn-new" class="btn-primary text-xs">+ Nueva Inspección</button>
        </div>
      </div>
    </div>

    <!-- Classification modal -->
    <div id="classify-modal" class="modal-overlay" style="display:none">
      <div class="bg-brand-card border border-white/10 p-6 max-w-md w-full mx-4 animate-slide-up">
        <div class="flex items-center justify-between mb-5">
          <h3 class="font-display font-bold text-white text-lg">Clasificar Hallazgo</h3>
          <button id="classify-close" class="text-white/30 hover:text-white text-lg cursor-pointer">✕</button>
        </div>
        <div id="classify-desc" class="p-3 bg-white/[0.03] border border-white/[0.06] mb-4">
          <p class="font-mono text-sm text-white/70"></p>
        </div>
        <div id="classify-crops" class="flex gap-3 mb-5">
          <div class="flex-1 text-center">
            <div class="font-mono text-[10px] text-white/30 mb-1">MAESTRO</div>
            <img id="classify-crop-m" class="w-full h-20 object-contain border border-white/10 bg-black/30" />
          </div>
          <div class="flex-1 text-center">
            <div class="font-mono text-[10px] text-white/30 mb-1">MUESTRA</div>
            <img id="classify-crop-s" class="w-full h-20 object-contain border border-white/10 bg-black/30" />
          </div>
        </div>
        <div class="section-label text-[10px] mb-3">Severidad</div>
        <div class="grid grid-cols-4 gap-2 mb-5">
          <button data-severity="critical" class="btn-sm border-brand-red/40 text-brand-red hover:bg-brand-red/10">Crítico</button>
          <button data-severity="important" class="btn-sm border-brand-yellow/40 text-brand-yellow hover:bg-brand-yellow/10">Importante</button>
          <button data-severity="minor" class="btn-sm border-brand-blue/40 text-brand-blue hover:bg-brand-blue/10">Menor</button>
          <button data-severity="ignore" class="btn-sm border-white/20 text-white/50 hover:bg-white/5">Ignorar</button>
        </div>
        <div class="section-label text-[10px] mb-3">Comentario</div>
        <textarea id="classify-comment" class="input-field h-20 resize-none" placeholder="Comentario opcional…"></textarea>
        <div class="flex justify-end gap-3 mt-5">
          <button id="classify-cancel" class="btn-secondary text-xs">Cancelar</button>
          <button id="classify-save" class="btn-primary text-xs">Guardar</button>
        </div>
      </div>
    </div>
  `;

  // ── Element references ────────────────────────────────────────────────────
  const panelMaster   = container.querySelector('#panel-master');
  const panelSample   = container.querySelector('#panel-sample');
  const panelDiff     = container.querySelector('#panel-diff');
  const panelHeatmap  = container.querySelector('#panel-heatmap');
  const panelDivider  = container.querySelector('#panel-divider');
  const imgMaster     = container.querySelector('#img-master');
  const imgSample     = container.querySelector('#img-sample');
  const imgDiff       = container.querySelector('#img-diff');
  const imgHeatmap    = container.querySelector('#img-heatmap');
  const markersContainer = container.querySelector('#markers-container');
  const findingsList  = container.querySelector('#findings-list');

  // ── View mode switching ───────────────────────────────────────────────────
  container.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      viewMode = btn.dataset.view;
      container.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b === btn));
      updateViewMode();
    });
  });

  function updateViewMode() {
    // Hide all panels first
    panelMaster.classList.add('hidden');
    panelSample.classList.add('hidden');
    panelDiff.classList.add('hidden');
    panelHeatmap.classList.add('hidden');
    panelDivider.classList.add('hidden');

    // Reset overlay styles
    panelMaster.style.position = '';
    panelMaster.style.inset = '';
    panelMaster.style.zIndex = '';
    panelMaster.style.opacity = '';

    switch (viewMode) {
      case 'split':
        panelMaster.classList.remove('hidden');
        panelSample.classList.remove('hidden');
        panelDivider.classList.remove('hidden');
        break;
      case 'master':
        panelMaster.classList.remove('hidden');
        break;
      case 'sample':
        panelSample.classList.remove('hidden');
        break;
      case 'diff':
        panelDiff.classList.remove('hidden');
        break;
      case 'heatmap':
        panelHeatmap.classList.remove('hidden');
        break;
      case 'overlay':
        panelMaster.classList.remove('hidden');
        panelSample.classList.remove('hidden');
        panelMaster.style.position = 'absolute';
        panelMaster.style.inset = '0';
        panelMaster.style.zIndex = '5';
        panelMaster.style.opacity = '0.5';
        break;
    }
  }

  // ── Page navigation ───────────────────────────────────────────────────────
  if (totalPages > 1) {
    const pageIndicator = container.querySelector('#page-indicator');
    container.querySelector('#prev-page').addEventListener('click', () => {
      if (currentPage > 0) { currentPage--; updatePage(); }
    });
    container.querySelector('#next-page').addEventListener('click', () => {
      if (currentPage < totalPages - 1) { currentPage++; updatePage(); }
    });
    function updatePage() {
      pageIndicator.textContent = `${currentPage + 1}/${totalPages}`;
      if (imgDiff && diffImages[currentPage]) {
        imgDiff.src = `data:image/jpeg;base64,${diffImages[currentPage]}`;
      }
      if (imgHeatmap && heatmaps[currentPage]) {
        imgHeatmap.src = `data:image/jpeg;base64,${heatmaps[currentPage]}`;
      }
    }
  }

  // ── Zoom ──────────────────────────────────────────────────────────────────
  const zoomLevelEl = container.querySelector('#zoom-level');

  function applyZoom() {
    const t = `scale(${zoomLevel})`;
    const sampleWrapper = container.querySelector('#sample-img-wrapper');
    [imgMaster, imgDiff, imgHeatmap].forEach(img => {
      if (img) img.style.transform = t;
    });
    if (sampleWrapper) sampleWrapper.style.transform = t;
    else if (imgSample) imgSample.style.transform = t; // fallback: no thumbnail, no wrapper
    zoomLevelEl.textContent = `${Math.round(zoomLevel * 100)}%`;
  }

  container.querySelector('#zoom-in').addEventListener('click', () => { zoomLevel = Math.min(5, zoomLevel + 0.25); applyZoom(); });
  container.querySelector('#zoom-out').addEventListener('click', () => { zoomLevel = Math.max(0.25, zoomLevel - 0.25); applyZoom(); });
  container.querySelector('#zoom-fit').addEventListener('click', () => {
    zoomLevel = 1;
    applyZoom();
    [panelMaster, panelSample, panelDiff, panelHeatmap].forEach(p => p.scrollTo(0, 0));
  });

  // Sync scroll
  let scrollSyncing = false;
  function syncScroll(source, targets) {
    if (scrollSyncing) return;
    scrollSyncing = true;
    targets.forEach(t => { t.scrollTop = source.scrollTop; t.scrollLeft = source.scrollLeft; });
    requestAnimationFrame(() => { scrollSyncing = false; });
  }
  panelMaster.addEventListener('scroll', () => syncScroll(panelMaster, [panelSample]));
  panelSample.addEventListener('scroll', () => syncScroll(panelSample, [panelMaster]));

  // ── Finding markers ───────────────────────────────────────────────────────
  function renderMarkers() {
    if (!markersContainer || !imgSample) return;
    const imgW = imgSample.naturalWidth || imgSample.width || 1;
    const imgH = imgSample.naturalHeight || imgSample.height || 1;

    markersContainer.innerHTML = findings.map((f, i) => {
      const sev = f.severity || f.severity_suggestion || 'minor';
      const sevCls = SEVERITY_CONFIG[sev]?.cls || 'severity-minor';
      const sevColor = SEVERITY_CONFIG[sev]?.color || '#5352ED';
      const isActive = i === activeFindingIdx;
      const x = f.bbox.x * imgW, y = f.bbox.y * imgH;
      const w = f.bbox.w * imgW, h = f.bbox.h * imgH;

      return `
        <div class="finding-marker ${sevCls} ${isActive ? 'active' : ''}"
             data-finding-idx="${i}"
             style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;pointer-events:auto;border-color:${sevColor};background:${sevColor}20"
             title="${esc(f.description)}">
          <span class="finding-marker-label" style="background:${sevColor};color:#fff">${i + 1}</span>
        </div>
      `;
    }).join('');

    markersContainer.querySelectorAll('[data-finding-idx]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        selectFinding(parseInt(el.dataset.findingIdx, 10));
      });
    });
  }

  if (imgSample) {
    if (imgSample.complete) renderMarkers();
    else imgSample.addEventListener('load', renderMarkers);
  }

  // ── Finding selection ─────────────────────────────────────────────────────
  function selectFinding(idx) {
    activeFindingIdx = idx;
    renderMarkers();
    updateFindingsList();

    if (idx >= 0 && idx < findings.length) {
      const f = findings[idx];
      const targetPanel = (viewMode === 'diff') ? panelDiff :
                          (viewMode === 'heatmap') ? panelHeatmap :
                          panelSample;
      const targetImg = (viewMode === 'diff') ? imgDiff :
                        (viewMode === 'heatmap') ? imgHeatmap :
                        imgSample;

      if (targetImg) {
        const imgW = targetImg.naturalWidth || targetImg.width || 1;
        const imgH = targetImg.naturalHeight || targetImg.height || 1;
        const cx = f.bbox.x * imgW + (f.bbox.w * imgW) / 2;
        const cy = f.bbox.y * imgH + (f.bbox.h * imgH) / 2;

        zoomLevel = 2.5;
        applyZoom();

        const panelW = targetPanel.clientWidth;
        const panelH = targetPanel.clientHeight;
        targetPanel.scrollTo({ left: cx * zoomLevel - panelW / 2, top: cy * zoomLevel - panelH / 2, behavior: 'smooth' });

        if (viewMode === 'split') {
          panelMaster.scrollTo({ left: cx * zoomLevel - panelW / 2, top: cy * zoomLevel - panelH / 2, behavior: 'smooth' });
        }
      }
    }

    container.querySelector('#finding-counter').textContent =
      idx >= 0 ? `${idx + 1}/${findings.length}` : `${findings.length}`;
  }

  container.querySelector('#prev-finding').addEventListener('click', () => {
    if (findings.length === 0) return;
    selectFinding(activeFindingIdx <= 0 ? findings.length - 1 : activeFindingIdx - 1);
  });
  container.querySelector('#next-finding').addEventListener('click', () => {
    if (findings.length === 0) return;
    selectFinding(activeFindingIdx >= findings.length - 1 ? 0 : activeFindingIdx + 1);
  });

  // ── Findings list ─────────────────────────────────────────────────────────
  function updateFindingsList() {
    if (findings.length === 0) return;
    findingsList.innerHTML = findings.map((f, i) => renderFindingRow(f, i)).join('');
    wireFindings();
    const activeEl = findingsList.querySelector('.finding-row.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function wireFindings() {
    findingsList.querySelectorAll('.finding-row').forEach(row => {
      row.addEventListener('click', () => selectFinding(parseInt(row.dataset.findingIdx, 10)));
      row.addEventListener('dblclick', () => openClassifyModal(parseInt(row.dataset.findingIdx, 10)));
    });
    findingsList.querySelectorAll('[data-classify-btn]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openClassifyModal(parseInt(btn.dataset.classifyBtn, 10));
      });
    });
  }
  wireFindings();

  // ── Classification modal ──────────────────────────────────────────────────
  const classifyModal = container.querySelector('#classify-modal');
  const classifyDesc = classifyModal.querySelector('#classify-desc p');
  const classifyComment = classifyModal.querySelector('#classify-comment');
  const classifyCropM = classifyModal.querySelector('#classify-crop-m');
  const classifyCropS = classifyModal.querySelector('#classify-crop-s');
  let classifyingIdx = -1;
  let selectedSeverity = null;

  function openClassifyModal(idx) {
    if (idx < 0 || idx >= findings.length) return;
    classifyingIdx = idx;
    const f = findings[idx];

    classifyDesc.textContent = `[${TYPE_LABELS[f.type] || f.type}] ${f.description}`;
    classifyComment.value = f.comment || '';
    selectedSeverity = f.severity || null;

    // Show crops
    classifyCropM.src = f.master_crop ? `data:image/jpeg;base64,${f.master_crop}` : '';
    classifyCropS.src = f.sample_crop ? `data:image/jpeg;base64,${f.sample_crop}` : '';
    classifyCropM.style.display = f.master_crop ? '' : 'none';
    classifyCropS.style.display = f.sample_crop ? '' : 'none';

    classifyModal.querySelectorAll('[data-severity]').forEach(btn => {
      btn.classList.toggle('ring-2', btn.dataset.severity === selectedSeverity);
      btn.classList.toggle('ring-white/40', btn.dataset.severity === selectedSeverity);
    });
    classifyModal.style.display = 'flex';
  }

  function closeClassifyModal() { classifyModal.style.display = 'none'; classifyingIdx = -1; selectedSeverity = null; }

  classifyModal.querySelector('#classify-close').addEventListener('click', closeClassifyModal);
  classifyModal.querySelector('#classify-cancel').addEventListener('click', closeClassifyModal);
  classifyModal.addEventListener('click', (e) => { if (e.target === classifyModal) closeClassifyModal(); });

  classifyModal.querySelectorAll('[data-severity]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedSeverity = btn.dataset.severity;
      classifyModal.querySelectorAll('[data-severity]').forEach(b => {
        b.classList.toggle('ring-2', b === btn);
        b.classList.toggle('ring-white/40', b === btn);
      });
    });
  });

  classifyModal.querySelector('#classify-save').addEventListener('click', async () => {
    if (classifyingIdx < 0) return;
    const f = findings[classifyingIdx];
    const fId = f._id || f.id;
    try {
      await classifyFinding(inspection._id, fId, { severity: selectedSeverity, comment: classifyComment.value.trim() });
      f.severity = selectedSeverity;
      f.comment = classifyComment.value.trim();
      f.status = selectedSeverity ? 'classified' : 'open';
      closeClassifyModal();
      renderMarkers();
      updateFindingsList();
    } catch (err) { alert('Error al clasificar: ' + err.message); }
  });

  // ── PDF download ──────────────────────────────────────────────────────────
  container.querySelector('#btn-pdf').addEventListener('click', async () => {
    const btn = container.querySelector('#btn-pdf');
    const origText = btn.innerHTML;
    btn.innerHTML = '<span class="animate-spin inline-block">⟳</span> Generando…';
    btn.disabled = true;
    try {
      const res = await fetch(`/api/inspection/${inspection._id}/report/pdf`);
      if (!res.ok) throw new Error('Error al generar PDF');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `inspeccion_${(productId || productName || 'reporte').replace(/[^\w.-]/g, '_')}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) { alert(err.message); }
    finally { btn.innerHTML = origText; btn.disabled = false; }
  });

  // ── Download diff image ───────────────────────────────────────────────────
  container.querySelector('#btn-download').addEventListener('click', () => {
    const b64 = diffImages[currentPage];
    if (!b64) { alert('No hay imagen de diferencias para esta página.'); return; }
    const byteChars = atob(b64);
    const byteNums = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
    const blob = new Blob([new Uint8Array(byteNums)], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diferencias_${(productId || productName || 'muestra').replace(/[^\w.-]/g, '_')}_p${currentPage + 1}.jpg`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  });

  // ── Navigation ────────────────────────────────────────────────────────────
  container.querySelector('#btn-new').addEventListener('click', onNewInspection);
  container.querySelector('#btn-history').addEventListener('click', onHistory);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  function handleKey(e) {
    if (classifyModal.style.display !== 'none') { if (e.key === 'Escape') closeClassifyModal(); return; }
    if (e.key === 'ArrowRight' || e.key === 'j') container.querySelector('#next-finding').click();
    else if (e.key === 'ArrowLeft' || e.key === 'k') container.querySelector('#prev-finding').click();
    else if (e.key === '+' || e.key === '=') container.querySelector('#zoom-in').click();
    else if (e.key === '-') container.querySelector('#zoom-out').click();
    else if (e.key === '0') container.querySelector('#zoom-fit').click();
    else if (e.key === 'Enter' && activeFindingIdx >= 0) openClassifyModal(activeFindingIdx);
    else if (e.key === '1') container.querySelector('[data-view="split"]')?.click();
    else if (e.key === '2') container.querySelector('[data-view="diff"]')?.click();
    else if (e.key === '3') container.querySelector('[data-view="heatmap"]')?.click();
  }
  document.addEventListener('keydown', handleKey);
  container._cleanup = () => document.removeEventListener('keydown', handleKey);
}


// ── Helpers ──────────────────────────────────────────────────────────────────

function renderFindingRow(f, i) {
  const sev = f.severity || f.severity_suggestion || 'minor';
  const sevConf = SEVERITY_CONFIG[sev] || SEVERITY_CONFIG.minor;
  const typeLabel = TYPE_LABELS[f.type] || f.type;

  const hasCrops = f.master_crop || f.sample_crop;
  const deltaE = f.color_delta_e ? `ΔE=${f.color_delta_e.toFixed(1)}` : '';
  const pixDiff = f.pixel_diff_percent ? `${f.pixel_diff_percent.toFixed(1)}%` : '';
  const metrics = [deltaE, pixDiff].filter(Boolean).join(' · ');

  return `
    <div class="finding-row" data-finding-idx="${i}">
      <div class="flex-shrink-0">
        <span class="badge ${sevConf.badge} text-[10px]">${i + 1}</span>
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-0.5">
          <span class="font-mono text-[10px] text-white/40 uppercase">${typeLabel}</span>
          <span class="font-mono text-[10px] text-white/20">p.${f.page}</span>
          ${metrics ? `<span class="font-mono text-[10px] text-white/20">${metrics}</span>` : ''}
        </div>
        <p class="font-mono text-xs text-white/70 truncate">${esc(f.description)}</p>
        ${f.comment ? `<p class="font-mono text-[10px] text-white/30 mt-0.5 italic truncate">${esc(f.comment)}</p>` : ''}
        ${hasCrops ? `
          <div class="flex items-center gap-2 mt-1.5">
            ${f.master_crop ? `<img src="data:image/jpeg;base64,${f.master_crop}" class="crop-thumb" alt="M" title="Maestro"/>` : ''}
            <span class="text-white/15 text-[10px]">→</span>
            ${f.sample_crop ? `<img src="data:image/jpeg;base64,${f.sample_crop}" class="crop-thumb" alt="S" title="Muestra"/>` : ''}
          </div>
        ` : ''}
      </div>
      <button data-classify-btn="${i}" class="flex-shrink-0 text-white/20 hover:text-brand-yellow transition-colors p-1" title="Clasificar">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10 1.5l2.5 2.5-8 8H2v-2.5l8-8z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  `;
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
