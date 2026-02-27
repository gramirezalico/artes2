/**
 * useAuth.js — Auth state management (token + user stored in localStorage).
 */

const TOKEN_KEY = 'qc_auth_token';
const USER_KEY = 'qc_auth_user';

/** Save auth data after login. */
export function saveAuth({ token, user }) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/** Get the stored JWT token. */
export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || null;
}

/** Get the stored user object. */
export function getUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Check if the user is currently authenticated. */
export function isAuthenticated() {
  const token = getToken();
  if (!token) return false;

  // Basic JWT expiry check (payload is base64url-encoded)
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      clearAuth();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Clear auth data (logout). */
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
