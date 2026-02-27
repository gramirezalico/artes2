/**
 * useInspection.js — API wrapper for the QC Inspection backend.
 */
import { getToken } from './useAuth.js';

const API_BASE = import.meta.env.VITE_API_URL || '';

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, {
    headers,
    ...options
  });
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (!res.ok) throw new Error(`Request failed: ${res.status} ${res.statusText}`);
    return null;
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Request failed: ${res.status}`);
  return data;
}

/** Upload master + sample files and create inspection record. */
export async function uploadInspection(formData) {
  const token = getToken();
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/api/inspection/upload`, {
    method: 'POST',
    headers,
    body: formData
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Upload failed');
  return data;
}

/** Start the inspection processing. */
export async function startInspection(inspectionId, opts = {}) {
  const { inspectionZones = [], checkSpelling = false, spellingLanguage = 'es' } = opts;
  return request(`/api/inspection/${inspectionId}/start`, {
    method: 'POST',
    body: JSON.stringify({ inspectionZones, checkSpelling, spellingLanguage })
  });
}

/** Get full inspection result. */
export async function getInspection(inspectionId) {
  return request(`/api/inspection/${inspectionId}`);
}

/** List all inspections. */
export async function listInspections(search = '') {
  const qs = search ? `?search=${encodeURIComponent(search)}` : '';
  const data = await request(`/api/inspection${qs}`);
  return data?.inspections || data || [];
}

/** Delete an inspection. */
export async function deleteInspection(inspectionId) {
  return request(`/api/inspection/${inspectionId}`, { method: 'DELETE' });
}

/** Classify a finding (severity + comment). */
export async function classifyFinding(inspectionId, findingId, { severity, comment }) {
  return request(`/api/inspection/${inspectionId}/findings/${findingId}`, {
    method: 'PUT',
    body: JSON.stringify({ severity, comment })
  });
}

/** Get report data. */
export async function getReport(inspectionId) {
  return request(`/api/inspection/${inspectionId}/report`);
}

/** SSE stream for inspection progress. */
/**
 * SSE stream with auto-reconnect and polling fallback.
 * Returns an object with a close() method.
 */
export function streamProgress(inspectionId, { onProgress, onDone, onError } = {}) {
  const token = getToken();
  const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
  const url = `${API_BASE}/api/inspection/${inspectionId}/stream${tokenParam}`;
  let es = null;
  let closed = false;
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 10;
  let pollTimer = null;

  function cleanup() {
    closed = true;
    if (es) { try { es.close(); } catch (_) {} es = null; }
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  }

  /** Poll the inspection status as fallback when SSE drops */
  async function pollStatus() {
    if (closed) return;
    try {
      const insp = await getInspection(inspectionId);
      if (insp.status === 'inspected') {
        cleanup();
        if (onDone) onDone({ status: 'done' });
        return;
      }
      if (insp.status === 'error') {
        cleanup();
        if (onError) onError(insp.errorMessage || 'Inspection failed');
        return;
      }
      // Still processing — try SSE reconnect or poll again
      if (reconnectAttempts < MAX_RECONNECT) {
        connect();
      } else {
        pollTimer = setTimeout(pollStatus, 3000);
      }
    } catch (_) {
      if (!closed) pollTimer = setTimeout(pollStatus, 3000);
    }
  }

  function connect() {
    if (closed) return;
    if (es) { try { es.close(); } catch (_) {} }
    reconnectAttempts++;
    es = new EventSource(url);

    es.addEventListener('progress', (e) => {
      reconnectAttempts = 0; // Reset on successful communication
      try { if (onProgress) onProgress(JSON.parse(e.data)); } catch (_) {}
    });

    es.addEventListener('done', (e) => {
      cleanup();
      if (onDone) { try { onDone(JSON.parse(e.data)); } catch (_) { onDone({}); } }
    });

    es.addEventListener('error', (e) => {
      cleanup();
      if (onError) {
        try { const d = e.data ? JSON.parse(e.data) : {}; onError(d?.message || 'Inspection failed'); }
        catch (_) { onError('Inspection failed'); }
      }
    });

    es.onerror = () => {
      if (closed) return;
      if (es) { try { es.close(); } catch (_) {} es = null; }
      // Don't immediately error — try reconnecting or polling
      const delay = Math.min(2000 * reconnectAttempts, 10000);
      pollTimer = setTimeout(pollStatus, delay);
    };
  }

  connect();

  return { close: cleanup };
}
