import { api } from './api.js';
import { createMockData } from './mock-data.js';

/**
 * Offline-first Datenspeicher.
 *
 * - Jede Collection liegt als Array in localStorage (sofort verfügbar, auch offline).
 * - Änderungen landen zusätzlich in einer "Outbox" und werden gebündelt an das
 *   Apps-Script-Backend geschickt (action "sync"). Das Backend antwortet mit dem
 *   aktuellen Stand → Last-Write-Wins über das Feld updatedAt.
 * - Löschen = Soft-Delete (deleted: true), damit andere Geräte es mitbekommen.
 *
 * Gemeinsames Format jedes Eintrags: { id, createdAt, updatedAt, deleted?, ...fachliche Felder }
 */
export const SYNCED = ['shopping', 'meals', 'topics', 'contacts', 'sizes', 'checklists', 'trips'];
export const LOCAL_ONLY = ['reminders']; // Erinnerungen sind gerätebezogen (lokale Notifications)
const ALL = [...SYNCED, ...LOCAL_ONLY];
const P = 'famapp:';

const read = (key, fallback) => {
  try { const v = localStorage.getItem(P + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
const write = (key, value) => localStorage.setItem(P + key, JSON.stringify(value));

export const uid = () =>
  crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

class Store extends EventTarget {
  data = {};
  outbox = read('outbox', []);
  lastSync = read('lastSync', null);
  status = 'local';
  statusMsg = '';

  init() {
    if (read('seeded', false)) {
      ALL.forEach(c => { this.data[c] = read('col:' + c, []); });
    } else if (api.isConfigured()) {
      // Mit Backend: nichts vorbefüllen, der erste Sync holt die Daten aus dem Sheet.
      ALL.forEach(c => { this.data[c] = []; this.persist(c); });
      write('seeded', true);
    } else {
      this.seed();
    }
    this.status = api.isConfigured() ? 'idle' : 'local';
  }

  /** Lädt die Demo-Daten (ersetzt lokale Daten). */
  seed() {
    const mock = createMockData();
    ALL.forEach(c => { this.data[c] = mock[c] || []; this.persist(c); this.emit(c); });
    write('seeded', true);
  }

  /** Schiebt alle lokalen Einträge in die Outbox (z. B. Demo-Daten ins Sheet hochladen). */
  queueAll() {
    SYNCED.forEach(c => this.enqueue(c, this.data[c] || []));
    this.scheduleSync(0);
  }

  reset() {
    Object.keys(localStorage)
      .filter(k => k.startsWith(P) && k !== P + 'settings')
      .forEach(k => localStorage.removeItem(k));
    this.outbox = [];
    this.lastSync = null;
    this.init();
    ALL.forEach(c => this.emit(c));
    this.sync();
  }

  persist(c) { write('col:' + c, this.data[c]); }

  all(c) { return (this.data[c] || []).filter(i => !i.deleted); }
  get(c, id) { return this.all(c).find(i => i.id === id); }

  _put(c, item, now = new Date().toISOString()) {
    const list = (this.data[c] ||= []);
    const id = item.id || uid();
    const idx = list.findIndex(i => i.id === id);
    const prev = idx >= 0 ? list[idx] : { createdAt: now };
    const next = { ...prev, ...item, id, updatedAt: now };
    if (idx >= 0) list[idx] = next; else list.push(next);
    return next;
  }

  save(c, item) {
    const next = this._put(c, item);
    this.commit(c, [next]);
    return next;
  }

  saveMany(c, items) {
    const now = new Date().toISOString();
    const saved = items.map(item => this._put(c, item, now));
    if (saved.length) this.commit(c, saved);
    return saved;
  }

  remove(c, id) { return this.removeMany(c, [id])[0]; }

  removeMany(c, ids) {
    const removed = this.all(c).filter(i => ids.includes(i.id)).map(i => ({ ...i }));
    if (!removed.length) return [];
    if (LOCAL_ONLY.includes(c)) {
      this.data[c] = this.data[c].filter(i => !ids.includes(i.id));
      this.commit(c, []);
    } else {
      const now = new Date().toISOString();
      this.commit(c, ids.map(id => this._put(c, { id, deleted: true }, now)));
    }
    return removed;
  }

  /** Stellt gelöschte Einträge wieder her (Undo). */
  restore(c, items) {
    return this.saveMany(c, items.map(i => ({ ...i, deleted: false })));
  }

  commit(c, items) {
    this.persist(c);
    // Im Demo-Modus nichts vormerken – sonst würden Demo-Daten beim ersten Verbinden ins Sheet wandern.
    if (SYNCED.includes(c) && items.length && api.isConfigured()) {
      this.enqueue(c, items);
      this.scheduleSync();
    }
    this.emit(c);
  }

  enqueue(c, items) {
    const ids = new Set(items.map(i => i.id));
    this.outbox = this.outbox.filter(o => !(o.collection === c && ids.has(o.item.id)));
    items.forEach(item => this.outbox.push({ collection: c, item }));
    write('outbox', this.outbox);
  }

  emit(c) { this.dispatchEvent(new CustomEvent('change', { detail: { collection: c } })); }

  setStatus(status, msg = '') {
    this.status = status;
    this.statusMsg = msg;
    this.dispatchEvent(new CustomEvent('status'));
  }

  scheduleSync(delay = 800) {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.sync(), delay);
  }

  async sync() {
    if (!api.isConfigured()) return this.setStatus('local');
    if (!navigator.onLine) return this.setStatus('offline', `${this.outbox.length} Änderung(en) warten`);
    if (this._syncing) { this._again = true; return; }

    this._syncing = true;
    this.setStatus('syncing');
    const sending = [...this.outbox];
    try {
      const res = await api.sync(sending, SYNCED);
      // Nur die verschickten Einträge entfernen – was währenddessen geändert wurde, bleibt drin.
      this.outbox = this.outbox.filter(o => !sending.includes(o));
      write('outbox', this.outbox);

      for (const c of SYNCED) {
        const remote = res.data?.[c];
        if (!Array.isArray(remote)) continue;
        const pending = new Map(this.outbox.filter(o => o.collection === c).map(o => [o.item.id, o.item]));
        const merged = remote.map(i => pending.get(i.id) || i);
        pending.forEach((item, id) => { if (!merged.some(i => i.id === id)) merged.push(item); });
        this.data[c] = merged;
        this.persist(c);
        this.emit(c);
      }
      this.lastSync = new Date().toISOString();
      write('lastSync', this.lastSync);
      this.setStatus('synced');
    } catch (err) {
      this.setStatus('error', err.message);
    } finally {
      this._syncing = false;
      if (this._again) { this._again = false; this.scheduleSync(); }
    }
  }
}

export const store = new Store();
