/**
 * App.js — Root shell: navigation + view routing
 *
 * Views:
 *   login      → LoginScreen (Google Sign-In)
 *   form       → InspectionForm (new inspection)
 *   processing → InspectionProgress (SSE)
 *   workspace  → InspectionWorkspace (results)
 *   history    → InspectionHistory (list)
 */
import { mount as mountLogin }      from './components/LoginScreen.js';
import { mount as mountForm }       from './components/InspectionForm.js';
import { mount as mountProgress }   from './components/InspectionProgress.js';
import { mount as mountWorkspace }  from './components/InspectionWorkspace.js';
import { mount as mountHistory }    from './components/InspectionHistory.js';
import { mount as mountSpellCheck } from './components/SpellCheckTool.js';
import { getInspection }            from './hooks/useInspection.js';
import { isAuthenticated, saveAuth, clearAuth, getUser } from './hooks/useAuth.js';

let currentView = 'form';
let viewContainer = null;
let rootEl = null;

export function mount(root) {
  rootEl = root;

  if (!isAuthenticated()) {
    showLogin(root);
    return;
  }

  showApp(root);
}

function showLogin(root) {
  root.innerHTML = '';
  const loginContainer = document.createElement('div');
  loginContainer.className = 'min-h-screen';
  root.appendChild(loginContainer);

  mountLogin(loginContainer, {
    onLogin: (data) => {
      saveAuth(data);
      showApp(root);
    }
  });
}

function showApp(root) {
  const user = getUser();

  root.innerHTML = `
    <!-- Top nav bar -->
    <header class="fixed top-0 inset-x-0 z-50 h-12 bg-brand-surface/90 backdrop-blur-md border-b border-white/[0.06] flex items-center px-6">
      <div class="flex items-center gap-3 cursor-pointer" id="nav-home">
        <div class="w-7 h-7 bg-brand-yellow flex items-center justify-center font-display font-black text-brand-bg text-xs">QC</div>
        <span class="font-display font-bold text-white text-sm tracking-wide hidden sm:inline">QC Inspector</span>
      </div>
      <div class="flex-1"></div>
      <nav class="flex items-center gap-1">
        <button class="nav-btn active" data-nav="form">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 2h5l4 4v6a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" stroke-width="1.2"/><path d="M8 2v4h4" stroke="currentColor" stroke-width="1.2"/></svg>
          <span class="hidden md:inline">Nueva</span>
        </button>
        <button class="nav-btn" data-nav="history">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 3h10M2 7h10M2 11h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          <span class="hidden md:inline">Historial</span>
        </button>
        <button class="nav-btn" data-nav="spellcheck">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 7h3l2 5 3-10 2 5h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span class="hidden md:inline">OCR</span>
        </button>
      </nav>
      <div class="flex items-center gap-2 ml-4">
        ${user?.picture ? `<img src="${user.picture}" alt="" class="w-7 h-7 rounded-full" referrerpolicy="no-referrer" />` : ''}
        <button id="btn-logout" class="text-white/50 hover:text-white text-xs font-mono transition-colors" title="Cerrar sesión">Salir</button>
      </div>
    </header>

    <!-- Main content area -->
    <main id="view-container" class="pt-12 min-h-screen bg-brand-bg"></main>
  `;

  viewContainer = root.querySelector('#view-container');

  // Nav buttons
  root.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.nav));
  });
  root.querySelector('#nav-home').addEventListener('click', () => navigate('form'));

  // Logout
  root.querySelector('#btn-logout').addEventListener('click', () => {
    clearAuth();
    showLogin(rootEl);
  });

  // Render initial view
  currentView = 'form';
  renderView();
}

function updateNav() {
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.nav === currentView ||
      (currentView === 'processing' && btn.dataset.nav === 'form') ||
      (currentView === 'workspace' && btn.dataset.nav === 'form') ||
      (currentView === 'spellcheck' && btn.dataset.nav === 'spellcheck'));
  });
}

function navigate(view, data) {
  currentView = view;
  updateNav();
  cleanup();
  renderView(data);
}

function cleanup() {
  if (viewContainer && viewContainer._cleanup) {
    viewContainer._cleanup();
    viewContainer._cleanup = null;
  }
}

function renderView(data) {
  if (!viewContainer) return;
  viewContainer.innerHTML = '';

  switch (currentView) {
    case 'form':
      mountForm(viewContainer, {
        onSuccess: ({ inspectionId }) => {
          navigate('processing', { inspectionId });
        }
      });
      break;

    case 'processing':
      if (!data?.inspectionId) { navigate('form'); return; }
      mountProgress(viewContainer, {
        inspectionId: data.inspectionId,
        onComplete: async (inspection) => {
          navigate('workspace', { inspection });
        },
        onError: () => {
          // Stay on progress view — it shows retry
        }
      });
      break;

    case 'workspace':
      if (!data?.inspection) { navigate('form'); return; }
      mountWorkspace(viewContainer, {
        inspection: data.inspection,
        onNewInspection: () => navigate('form'),
        onHistory: () => navigate('history')
      });
      break;

    case 'history':
      mountHistory(viewContainer, {
        onSelect: async (insp) => {
          if (insp.status === 'inspected') {
            try {
              const full = await getInspection(insp._id);
              navigate('workspace', { inspection: full });
            } catch {
              navigate('workspace', { inspection: insp });
            }
          } else if (insp.status === 'processing') {
            navigate('processing', { inspectionId: insp._id });
          } else {
            navigate('form');
          }
        },
        onNewInspection: () => navigate('form')
      });
      break;

    case 'spellcheck':
      mountSpellCheck(viewContainer, {
        onBack: () => navigate('form')
      });
      break;

    default:
      navigate('form');
  }
}
