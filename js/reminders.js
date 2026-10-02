import { CONFIG } from './config.js';
import { store } from './store.js';

/**
 * Lokale Erinnerungen über die Web Notification API.
 *
 * Android/Chrome erlaubt `new Notification()` nicht – Benachrichtigungen müssen
 * über den Service Worker (registration.showNotification) laufen.
 *
 * Grenze einer rein statischen PWA: Ohne Push-Server gibt es keinen zuverlässigen
 * Wecker im Hintergrund. Erinnerungen werden geprüft, solange die App geöffnet
 * ist oder im Hintergrund noch läuft, und verpasste beim nächsten Öffnen
 * nachgeholt. Für echte Hintergrund-Pushes siehe README (Web Push).
 */
export const notifier = {
  get supported() { return 'Notification' in window; },
  get permission() { return this.supported ? Notification.permission : 'unsupported'; },

  async request() {
    if (!this.supported) return 'unsupported';
    return Notification.requestPermission();
  },

  async show(title, options = {}) {
    if (this.permission !== 'granted') return false;
    const opts = {
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      vibrate: [180, 80, 180],
      lang: 'de',
      ...options,
    };
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) { await reg.showNotification(title, opts); return true; }
    try { new Notification(title, opts); return true; } catch { return false; }
  },
};

export function nextOccurrence(reminder, after = Date.now()) {
  if (!reminder.repeat || reminder.repeat === 'none') return null;
  const t = new Date(reminder.at);
  while (t.getTime() <= after) {
    if (reminder.repeat === 'daily') t.setDate(t.getDate() + 1);
    else if (reminder.repeat === 'weekly') t.setDate(t.getDate() + 7);
    else if (reminder.repeat === 'monthly') t.setMonth(t.getMonth() + 1);
    else return null;
  }
  return t;
}

export function startReminderLoop(onFire) {
  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      for (const r of store.all('reminders')) {
        if (r.done || !r.at || new Date(r.at).getTime() > now) continue;
        const late = now - new Date(r.at).getTime() > 10 * 60 * 1000;
        await notifier.show(r.title, {
          body: [r.note, late ? 'Verpasste Erinnerung' : ''].filter(Boolean).join(' · ') || 'Erinnerung',
          tag: `reminder-${r.id}`,
          requireInteraction: true,
          data: { url: './#home' },
        });
        if (!document.hidden) onFire?.(r);
        const next = nextOccurrence(r, now);
        store.save('reminders', next
          ? { id: r.id, at: next.toISOString(), lastFiredAt: new Date().toISOString() }
          : { id: r.id, done: true, lastFiredAt: new Date().toISOString() });
      }
    } finally {
      running = false;
    }
  };

  check();
  setInterval(check, CONFIG.REMINDER_CHECK_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  return check;
}
