/**
 * LoginScreen.js — Google Sign-In screen
 */

const API_BASE = import.meta.env.VITE_API_URL || '';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

/**
 * Mount the login screen.
 * @param {HTMLElement} root
 * @param {{ onLogin: (data: { token: string, user: object }) => void }} opts
 */
export function mount(root, { onLogin } = {}) {
  root.innerHTML = `
    <div class="flex items-center justify-center min-h-screen bg-brand-bg">
      <div class="w-full max-w-sm mx-auto p-8 bg-brand-surface rounded-xl border border-white/[0.06]">
        <div class="flex flex-col items-center gap-6">
          <div class="w-12 h-12 bg-brand-yellow flex items-center justify-center font-display font-black text-brand-bg text-lg rounded-lg">QC</div>
          <div class="text-center">
            <h1 class="font-display font-bold text-white text-xl mb-1">QC Inspector</h1>
            <p class="text-white/50 text-sm">Inicia sesión para continuar</p>
          </div>
          <div id="google-signin-btn" class="w-full flex justify-center"></div>
          <p id="login-error" class="text-red-400 text-xs hidden"></p>
        </div>
      </div>
    </div>
  `;

  const errorEl = root.querySelector('#login-error');

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  }

  async function handleCredentialResponse(response) {
    try {
      errorEl.classList.add('hidden');
      const res = await fetch(`${API_BASE}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential })
      });
      const data = await res.json();
      if (!res.ok) {
        showError(data?.error || 'Error al iniciar sesión.');
        return;
      }
      if (onLogin) onLogin(data);
    } catch (err) {
      showError('Error de conexión. Intenta de nuevo.');
    }
  }

  // Wait for Google Identity Services to load
  function initGoogleSignIn() {
    if (!window.google?.accounts?.id) {
      setTimeout(initGoogleSignIn, 200);
      return;
    }

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredentialResponse
    });

    window.google.accounts.id.renderButton(
      root.querySelector('#google-signin-btn'),
      {
        theme: 'filled_black',
        size: 'large',
        width: 300,
        text: 'signin_with',
        shape: 'rectangular',
        logo_alignment: 'left'
      }
    );
  }

  initGoogleSignIn();
}
