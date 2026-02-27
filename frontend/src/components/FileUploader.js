/**
 * FileUploader.js — Drag-and-drop file upload supporting PDF, TIFF, BMP, PNG, JPG.
 */
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

const ACCEPTED = '.pdf,.tiff,.tif,.bmp,.png,.jpg,.jpeg';
const ACCEPTED_MIMES = ['application/pdf', 'image/tiff', 'image/bmp', 'image/png', 'image/jpeg'];
const MAX_SIZE = 50 * 1024 * 1024;

export function mount(container, { label, id, onChange }) {
  let selectedFile = null;

  container.innerHTML = `
    <div class="flex flex-col gap-3">
      <div class="section-label mb-1">${label}</div>
      <input type="file" id="file-input-${id}" accept="${ACCEPTED}" class="hidden" aria-label="${label}" />
      <div id="drop-zone-${id}"
           class="drop-zone relative border-2 border-dashed border-white/20 p-6 text-center
                  cursor-pointer transition-all duration-200 hover:border-white/40
                  hover:bg-white/[0.02] min-h-[180px] flex flex-col items-center justify-center gap-3">
        <div id="drop-idle-${id}" class="flex flex-col items-center gap-3">
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none" class="opacity-30">
            <path d="M6 28V8a2 2 0 012-2h14l8 8v14a2 2 0 01-2 2H8a2 2 0 01-2-2z" stroke="white" stroke-width="1.5" fill="none"/>
            <path d="M20 6v8h8M18 16v8M14 20l4-4 4 4" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div>
            <p class="font-mono text-sm text-white/50">
              Arrastra tu archivo aquí o <span class="text-brand-yellow underline-offset-2 underline">haz clic para seleccionar</span>
            </p>
            <p class="font-mono text-xs text-white/25 mt-1">PDF, TIFF, BMP, PNG, JPG • Máximo 50MB</p>
          </div>
        </div>
        <div id="drop-preview-${id}" class="hidden w-full">
          <canvas id="file-canvas-${id}" class="mx-auto max-h-48 w-auto border border-white/10"></canvas>
          <img id="file-img-${id}" class="hidden mx-auto max-h-48 w-auto border border-white/10 object-contain" alt="Preview" />
          <div class="mt-3 flex items-center justify-between px-1">
            <div>
              <p id="file-name-${id}" class="font-mono text-xs text-white/70 truncate max-w-[180px]"></p>
              <p id="file-info-${id}" class="font-mono text-xs text-white/40 mt-0.5"></p>
            </div>
            <button id="file-remove-${id}" class="text-white/30 hover:text-brand-red transition-colors text-xs font-mono">✕ Quitar</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const dropZone   = container.querySelector(`#drop-zone-${id}`);
  const fileInput  = container.querySelector(`#file-input-${id}`);
  const idleView   = container.querySelector(`#drop-idle-${id}`);
  const previewDiv = container.querySelector(`#drop-preview-${id}`);
  const canvas     = container.querySelector(`#file-canvas-${id}`);
  const imgEl      = container.querySelector(`#file-img-${id}`);
  const nameEl     = container.querySelector(`#file-name-${id}`);
  const infoEl     = container.querySelector(`#file-info-${id}`);
  const removeBtn  = container.querySelector(`#file-remove-${id}`);

  async function renderPreview(file) {
    const ext = file.name.split('.').pop().toLowerCase();

    try {
      if (ext === 'pdf') {
        const ab = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        infoEl.textContent = `${pdf.numPages} pág. · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
        canvas.classList.remove('hidden');
        imgEl.classList.add('hidden');
      } else {
        // Image file — show directly
        const url = URL.createObjectURL(file);
        imgEl.src = url;
        imgEl.classList.remove('hidden');
        canvas.classList.add('hidden');
        infoEl.textContent = `${ext.toUpperCase()} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
      }

      nameEl.textContent = file.name;
      idleView.classList.add('hidden');
      previewDiv.classList.remove('hidden');
    } catch (err) {
      console.error('[FileUploader] Preview error:', err);
      nameEl.textContent = file.name;
      infoEl.textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB — sin vista previa`;
      canvas.classList.add('hidden');
      imgEl.classList.add('hidden');
      idleView.classList.add('hidden');
      previewDiv.classList.remove('hidden');
    }
  }

  function selectFile(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    const validExt = ['pdf', 'tiff', 'tif', 'bmp', 'png', 'jpg', 'jpeg'].includes(ext);
    if (!validExt && !ACCEPTED_MIMES.includes(file.type)) {
      alert(`"${file.name}" no es un formato soportado. Use PDF, TIFF, BMP, PNG o JPG.`);
      return;
    }
    if (file.size > MAX_SIZE) {
      alert(`"${file.name}" supera el límite de 50MB.`);
      return;
    }
    selectedFile = file;
    dropZone.classList.remove('drag-over');
    renderPreview(file);
    onChange(file);
  }

  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation(); e.preventDefault();
    selectedFile = null; fileInput.value = '';
    idleView.classList.remove('hidden');
    previewDiv.classList.add('hidden');
    onChange(null);
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) selectFile(file);
  });

  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', (e) => { if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over'); });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) selectFile(file);
  });

  dropZone.addEventListener('click', (e) => {
    if (selectedFile) return;
    if (e.target === removeBtn || removeBtn.contains(e.target)) return;
    fileInput.click();
  });
}
