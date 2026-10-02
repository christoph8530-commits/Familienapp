import { getSettings } from './config.js';

/**
 * REST-Client für das Google-Apps-Script-Backend (Google Sheets).
 *
 * Alle Aufrufe gehen als POST mit Content-Type "text/plain" an die /exec-URL.
 * Das ist ein "simple request" → der Browser schickt keinen CORS-Preflight
 * (OPTIONS), den Apps Script nicht beantworten könnte. Die Antwort kommt nach
 * einem Redirect von script.googleusercontent.com mit Access-Control-Allow-Origin: *.
 *
 * Request:  { action, token, ...payload }
 * Response: { ok: true, ... } | { ok: false, error: "…" }
 */
export class ApiError extends Error {}

export const api = {
  isConfigured() {
    return Boolean(getSettings().apiUrl);
  },

  async call(action, payload = {}, { timeout = 20_000 } = {}) {
    const { apiUrl, apiToken } = getSettings();
    if (!apiUrl) throw new ApiError('Keine API-URL konfiguriert');

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: apiToken, ...payload }),
        redirect: 'follow',
        signal: ctrl.signal,
      });
      if (!res.ok) throw new ApiError(`HTTP ${res.status}`);
      const json = await res.json().catch(() => { throw new ApiError('Antwort ist kein JSON – ist die Web-App für „Jeder“ freigegeben?'); });
      if (!json.ok) throw new ApiError(json.error || 'Unbekannter API-Fehler');
      return json;
    } catch (err) {
      if (err.name === 'AbortError') throw new ApiError('Zeitüberschreitung');
      if (err instanceof TypeError) throw new ApiError('Netzwerkfehler – URL und Freigabe der Web-App prüfen');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  },

  ping() { return this.call('ping'); },
  list(collection) { return this.call('list', { collection }); },
  /** Schickt lokale Änderungen und erhält den aktuellen Stand aller Collections zurück. */
  sync(changes, collections) { return this.call('sync', { changes, collections }); },
  /** Liefert { events: [...] } (CalendarApp) oder { ics: "…" } (iCal-Proxy). */
  calendar(from, to) { return this.call('calendar', { from, to }); },
};
