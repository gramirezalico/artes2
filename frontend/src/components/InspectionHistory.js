/**
 * InspectionHistory.js — Inspection list with search, verdict badges, counts
 */
import { listInspections, deleteInspection } from '../hooks/useInspection.js';

const VERDICT_LABELS = {
  pass:   { text: 'Aprobado',  cls: 'verdict-pass' },
  review: { text: 'En Revisión', cls: 'verdict-review' },
  fail:   { text: 'Rechazado', cls: 'verdict-fail' }
};

export function mount(container, { onSelect, onNewInspection }) {
  container.innerHTML = `
    <div class="max-w-5xl mx-auto px-6 py-12 animate-fade-in">
      <div class="flex items-center justify-between mb-8">
        <div>
          <h1 class="font-display text-2xl font-bold text-white mb-1">Historial de Inspecciones</h1>
          <p class="font-mono text-xs text-white/30">Busca y consulta inspecciones anteriores</p>
        </div>
        <button id="btn-new" class="btn-primary text-sm">+ Nueva Inspección</button>
      </div>

      <!-- Search -->
      <div class="relative mb-6">
        <svg class="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.3"/><path d="M11 11l3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        <input id="search" type="text" class="input-field pl-9" placeholder="Buscar por nombre, ID de producto…" />
      </div>

      <!-- List -->
      <div id="list-container" class="flex flex-col gap-2">
        <div class="flex items-center justify-center py-20 text-white/20 font-mono text-sm">
          Cargando…
        </div>
      </div>
    </div>
  `;

  const listContainer = container.querySelector('#list-container');
  const searchInput = container.querySelector('#search');
  let inspections = [];
  let debounceTimer = null;

  container.querySelector('#btn-new').addEventListener('click', onNewInspection);

  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => loadList(searchInput.value.trim()), 300);
  });

  async function loadList(search = '') {
    try {
      const data = await listInspections(search);
      inspections = data;
      renderList();
    } catch (err) {
      listContainer.innerHTML = `<div class="text-brand-red font-mono text-sm py-8 text-center">Error al cargar: ${esc(err.message)}</div>`;
    }
  }

  function renderList() {
    if (inspections.length === 0) {
      listContainer.innerHTML = `
        <div class="flex flex-col items-center py-20 text-center">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" class="mb-4 opacity-15"><rect x="8" y="4" width="24" height="32" rx="2" stroke="white" stroke-width="1.5"/><path d="M14 14h12M14 20h12M14 26h6" stroke="white" stroke-width="1.3" stroke-linecap="round"/></svg>
          <p class="font-mono text-sm text-white/25">No hay inspecciones</p>
          <p class="font-mono text-xs text-white/15 mt-1">Inicia una nueva inspección para comenzar</p>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = inspections.map(insp => {
      const verdict = VERDICT_LABELS[insp.analysis?.verdict] || { text: insp.status, cls: '' };
      const date = new Date(insp.createdAt).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
      const fc = insp.analysis?.criticalCount || 0;
      const fi = insp.analysis?.importantCount || 0;
      const fm = insp.analysis?.minorCount || 0;
      const ft = insp.analysis?.totalFindings || (fc + fi + fm + (insp.analysis?.ignoredCount || 0));
      const isReady = insp.status === 'inspected';

      return `
        <div class="inspection-row group flex items-center gap-4 p-4 bg-brand-card border border-white/[0.06] hover:border-white/10 transition-colors cursor-pointer" data-id="${insp._id}">
          <!-- Status indicator -->
          <div class="w-2 h-2 flex-shrink-0 ${isReady ? (insp.analysis?.verdict === 'pass' ? 'bg-green-400' : insp.analysis?.verdict === 'fail' ? 'bg-brand-red' : 'bg-brand-yellow') : 'bg-white/20'}" style="border-radius: 50%"></div>

          <!-- Product info -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-3 mb-0.5">
              <span class="font-display font-bold text-sm text-white truncate">${esc(insp.productName)}</span>
              ${insp.productId ? `<span class="badge badge-muted text-[10px]">${esc(insp.productId)}</span>` : ''}
            </div>
            <div class="flex items-center gap-3">
              <span class="font-mono text-[10px] text-white/25">${date}</span>
              <span class="font-mono text-[10px] text-white/20">${esc(insp.masterFile?.originalName || '?')}</span>
            </div>
          </div>

          <!-- Counts -->
          ${isReady ? `
            <div class="flex items-center gap-2 flex-shrink-0">
              <span class="font-mono text-[10px] text-white/30">${ft} difs</span>
              ${fc ? `<span class="badge badge-red text-[10px]">${fc}</span>` : ''}
              ${fi ? `<span class="badge badge-yellow text-[10px]">${fi}</span>` : ''}
              ${fm ? `<span class="badge badge-blue text-[10px]">${fm}</span>` : ''}
            </div>
          ` : `
            <span class="font-mono text-[10px] text-white/25">${insp.status === 'processing' ? 'Procesando…' : insp.status === 'error' ? 'Error' : 'Pendiente'}</span>
          `}

          <!-- Verdict -->
          <div class="flex-shrink-0 w-24 text-center">
            ${isReady
              ? `<span class="inline-block px-3 py-1 font-display text-xs font-bold ${verdict.cls}">${verdict.text}</span>`
              : ''
            }
          </div>

          <!-- Delete -->
          <button class="delete-btn flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-white/20 hover:text-brand-red p-1" data-delete="${insp._id}" title="Eliminar">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 4h8M5.5 4V3a1 1 0 011-1h1a1 1 0 011 1v1M4.5 4l.5 7.5a1 1 0 001 .5h2a1 1 0 001-.5L9.5 4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      `;
    }).join('');

    // Wire events
    listContainer.querySelectorAll('[data-id]').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.delete-btn')) return;
        const id = row.dataset.id;
        const insp = inspections.find(i => i._id === id);
        if (insp) onSelect(insp);
      });
    });

    listContainer.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.delete;
        if (!confirm('¿Eliminar esta inspección?')) return;
        try {
          await deleteInspection(id);
          inspections = inspections.filter(i => i._id !== id);
          renderList();
        } catch (err) {
          alert('Error al eliminar: ' + err.message);
        }
      });
    });
  }

  // Initial load
  loadList();
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
