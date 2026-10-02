import { getSettings } from './config.js';

/**
 * Einrichtungs-Link für weitere Geräte.
 *
 * Format: https://…/Familienapp/#setup=<base64url({ v, u, t })>
 * Die Daten stehen im Hash (#…) – der wird vom Browser nie an einen Server
 * geschickt, auch nicht an GitHub Pages. Der Link enthält trotzdem den
 * Zugangs-Token und gehört nur in die Familie.
 */
const PREFIX = '#setup=';

const b64urlEncode = text =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlDecode = text =>
  new TextDecoder().decode(Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));

/**
 * Nur echte Apps-Script-Adressen zulassen. Verhindert, dass ein manipulierter
 * Link (oder ein Tippfehler) eure Daten an einen fremden Server schickt.
 */
export function isAllowedApiUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && u.hostname === 'script.google.com') return true;
    return u.hostname === 'localhost' && location.hostname === 'localhost'; // lokale Entwicklung
  } catch {
    return false;
  }
}

export function createSetupLink() {
  const { apiUrl, apiToken } = getSettings();
  const payload = b64urlEncode(JSON.stringify({ v: 1, u: apiUrl, t: apiToken }));
  return `${location.origin}${location.pathname}${PREFIX}${payload}`;
}

export const hasSetupHash = () => location.hash.startsWith(PREFIX);

/**
 * Liest einen Einrichtungs-Link aus der Adresse und entfernt ihn sofort wieder,
 * damit der Token nicht im Browserverlauf stehen bleibt.
 * → { apiUrl, apiToken } | { error } | null
 */
export function takeSetupFromHash() {
  if (!hasSetupHash()) return null;
  const raw = location.hash.slice(PREFIX.length);
  history.replaceState(null, '', `${location.pathname}${location.search}#home`);
  try {
    const data = JSON.parse(b64urlDecode(raw));
    if (!isAllowedApiUrl(data.u) || typeof data.t !== 'string' || !data.t) {
      return { error: 'Dieser Einrichtungs-Link ist ungültig.' };
    }
    return { apiUrl: data.u, apiToken: data.t };
  } catch {
    return { error: 'Dieser Einrichtungs-Link ist beschädigt – bitte neu erzeugen.' };
  }
}

/** QR-Code als SVG – wird lokal erzeugt, der Link verlässt das Gerät dabei nicht. */
export async function qrSvg(text) {
  const { qrcode } = await import('./vendor/qrcode.js');
  const qr = qrcode(0, 'M'); // 0 = Größe automatisch wählen
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true, alt: 'QR-Code zum Verbinden eines weiteren Geräts' });
}
