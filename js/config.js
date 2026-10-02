/**
 * Zentrale Konfiguration.
 * Die Werte hier sind Standardwerte – sie lassen sich zur Laufzeit in den
 * App-Einstellungen (Zahnrad oben rechts) überschreiben und werden dann
 * lokal im Browser gespeichert. So muss für GitHub Pages nichts neu gebaut werden.
 *
 * WICHTIG: Apps Script, Google Sheet und Kalender mit einem privaten
 * Familien-Google-Konto anlegen – nicht mit einem Firmen-/Agenturkonto.
 */
export const CONFIG = {
  VERSION: '1.2.1',
  APP_NAME: 'Familienzentrale',

  // URL der Google-Apps-Script-Web-App (Bereitstellen → Web-App → endet auf /exec).
  // Leer = Demo-/Offline-Modus, alle Daten bleiben auf dem Gerät.
  API_URL: '',

  // Gemeinsames Familien-Token, muss der Script-Property API_TOKEN entsprechen.
  // Hinweis: In einer statischen App ist das Token für jeden sichtbar, der den
  // Quelltext öffnet – es schützt nur vor zufälligen Zugriffen, nicht vor Angriffen.
  API_TOKEN: '',

  // Optional: iCal-Feed, der direkt im Browser geladen wird (nur mit CORS-Header).
  // Google-Kalender-Feeds senden keinen CORS-Header → besser über Apps Script laden
  // (Script-Property CALENDAR_ID oder ICAL_URL, siehe README).
  ICAL_URL: '',

  SYNC_INTERVAL_MS: 60_000,
  REMINDER_CHECK_MS: 15_000,
};

const SETTINGS_KEY = 'famapp:settings';

export function getSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { /* ignorieren */ }
  return {
    apiUrl: saved.apiUrl ?? CONFIG.API_URL,
    apiToken: saved.apiToken ?? CONFIG.API_TOKEN,
    icalUrl: saved.icalUrl ?? CONFIG.ICAL_URL,
  };
}

export function saveSettings(patch) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...getSettings(), ...patch }));
}
