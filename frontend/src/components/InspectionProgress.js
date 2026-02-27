/**
 * InspectionProgress.js — SSE-based progress display during inspection.
 */
import { streamProgress, getInspection } from '../hooks/useInspection.js';

const STAGES = [
  { num: 1, label: 'Convirtiendo documento maestro',       icon: '📄' },
  { num: 2, label: 'Convirtiendo muestra',                 icon: '🔬' },
  { num: 3, label: 'Comparación pixel por pixel',          icon: '🔍' },
  { num: 4, label: 'OCR y revisión de texto multiidioma',  icon: '🗣️' },
  { num: 5, label: 'Clasificación de diferencias',         icon: '🎨' },
  { num: 6, label: 'Generando resultados de inspección',   icon: '📋' }
];

export function mount(container, { inspectionId, onComplete, onError }) {
  let es = null;
  let startTime = Date.now();

  container.innerHTML = `
    <div class="max-w-2xl mx-auto px-6 py-16">
      <div class="text-center mb-12">
        <div class="section-label mb-4">Inspección en Progreso</div>
        <h2 class="font-display text-3xl font-bold text-white">Comparación por Visión Computacional</h2>
        <p class="font-mono text-sm text-white/40 mt-3">El motor de comparación está analizando ambos documentos pixel por pixel</p>
      </div>

      <div class="card">
        <div class="mb-8">
          <div class="flex justify-between items-center mb-2">
            <span class="font-mono text-xs text-white/40 uppercase tracking-widest">Progreso</span>
            <span id="progress-pct" class="font-display font-bold text-brand-yellow text-sm">0%</span>
          </div>
          <div class="h-1 bg-white/10 rounded-full overflow-hidden">
            <div id="progress-bar" class="h-full bg-brand-yellow rounded-full transition-all duration-500 ease-out" style="width:0%"></div>
          </div>
          <div class="flex justify-between items-center mt-2">
            <span id="progress-msg" class="font-mono text-xs text-white/50">Iniciando inspección…</span>
            <span id="elapsed-time" class="font-mono text-xs text-white/30">0s</span>
          </div>
        </div>

        <div class="flex flex-col gap-2" id="stages-list">
          ${STAGES.map(s => `
            <div id="stage-${s.num}" class="flex items-center gap-4 px-4 py-3 border border-white/[0.06] transition-all duration-300" data-status="pending">
              <span class="text-lg w-7 text-center">${s.icon}</span>
              <div class="flex-1"><span class="font-mono text-sm text-white/50 stage-label transition-colors duration-300">${s.label}</span></div>
              <div class="stage-indicator w-4 h-4 flex items-center justify-center"><div class="w-2 h-2 rounded-full bg-white/20"></div></div>
            </div>
          `).join('')}
        </div>
      </div>

      <div id="error-panel" class="hidden mt-6 card border-brand-red/30 bg-brand-red/5">
        <div class="flex items-start gap-3">
          <span class="text-brand-red text-xl">✕</span>
          <div class="flex-1">
            <p class="font-display font-bold text-brand-red">La inspección falló</p>
            <p id="error-msg" class="font-mono text-sm text-white/60 mt-1"></p>
          </div>
        </div>
        <div class="flex gap-3 mt-4">
          <button id="retry-btn" class="btn-secondary text-xs">↺ Reintentar</button>
        </div>
      </div>
    </div>
  `;

  const progressBar = container.querySelector('#progress-bar');
  const progressPct = container.querySelector('#progress-pct');
  const progressMsg = container.querySelector('#progress-msg');
  const elapsedEl = container.querySelector('#elapsed-time');
  const errorPanel = container.querySelector('#error-panel');
  const errorMsg = container.querySelector('#error-msg');
  const retryBtn = container.querySelector('#retry-btn');

  const ticker = setInterval(() => {
    const s = Math.floor((Date.now() - startTime) / 1000);
    elapsedEl.textContent = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }, 1000);

  function setStageStatus(num, status) {
    const el = container.querySelector(`#stage-${num}`);
    if (!el) return;
    const label = el.querySelector('.stage-label');
    const indicator = el.querySelector('.stage-indicator');

    if (status === 'active') {
      el.classList.add('border-brand-yellow/30', 'bg-brand-yellow/[0.03]');
      el.classList.remove('border-white/[0.06]');
      label.classList.add('text-white'); label.classList.remove('text-white/50');
      indicator.innerHTML = `<svg class="animate-spin" width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="rgba(232,255,71,0.3)" stroke-width="2"/><path d="M8 2a6 6 0 016 6" stroke="#E8FF47" stroke-width="2" stroke-linecap="round"/></svg>`;
    } else if (status === 'done') {
      el.classList.remove('border-brand-yellow/30', 'bg-brand-yellow/[0.03]');
      el.classList.add('border-white/[0.06]');
      label.classList.add('text-white/70'); label.classList.remove('text-white/50', 'text-white');
      indicator.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="rgba(46,213,115,0.15)" stroke="rgba(46,213,115,0.4)" stroke-width="1"/><path d="M5 8l2.5 2.5L11 6" stroke="#2ED573" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
  }

  function connect() {
    if (es) es.close();
    es = streamProgress(inspectionId, {
      onProgress(data) {
        const pct = Math.min(100, Math.max(0, Number(data.percent) || 0));
        progressBar.style.width = `${pct}%`;
        progressPct.textContent = `${pct}%`;
        if (data.message) progressMsg.textContent = data.message;
        STAGES.forEach(s => {
          if (s.num < data.stage) setStageStatus(s.num, 'done');
          else if (s.num === data.stage) setStageStatus(s.num, 'active');
        });
      },
      onDone() {
        clearInterval(ticker);
        STAGES.forEach(s => setStageStatus(s.num, 'done'));
        progressBar.style.width = '100%'; progressPct.textContent = '100%';
        progressMsg.textContent = '¡Inspección completada!';
        // Fetch full inspection data before navigating
        setTimeout(async () => {
          try {
            const inspection = await getInspection(inspectionId);
            onComplete(inspection);
          } catch {
            onComplete({ _id: inspectionId });
          }
        }, 600);
      },
      onError(msg) {
        clearInterval(ticker);
        errorMsg.textContent = msg || 'Error desconocido.';
        errorPanel.classList.remove('hidden');
        if (onError) onError(msg);
      }
    });
  }

  retryBtn.addEventListener('click', () => {
    errorPanel.classList.add('hidden');
    startTime = Date.now();
    fetch(`${import.meta.env.VITE_API_URL || ''}/api/inspection/${inspectionId}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      .then(() => connect())
      .catch(e => { errorMsg.textContent = e.message; errorPanel.classList.remove('hidden'); });
  });

  connect();
  container._cleanup = () => { clearInterval(ticker); if (es) { if (typeof es.close === 'function') es.close(); } };
}
