import { api } from './api.js';
import { getSettings } from './config.js';
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
 * - Ausnahme: Listen-Felder aus MERGE_FIELDS (z. B. Checklisten-Punkte) werden
 *   Punkt für Punkt zusammengeführt. So gehen keine Haken verloren, wenn zwei
 *   Handys gleichzeitig in derselben Checkliste abhaken. Dieselbe Logik steckt
 *   in backend/Code.gs (mergeRecord_).
 *
 * Gemeinsames Format jedes Eintrags:
 * { id, createdAt, createdBy?, updatedAt, updatedBy?, deleted?, ...fachliche Felder }
 */
export const SYNCED = ['shopping', 'meals', 'topics', 'contacts', 'sizes', 'checklists', 'trips'];
export const LOCAL_ONLY = ['reminders']; // Erinnerungen sind gerätebezogen (lokale Notifications)
const ALL = [...SYNCED, ...LOCAL_ONLY];
const P = 'famapp:';

const read = (key, fallback) => {
  try { const v = localStorage.getItem(P + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
const write = (key, value) => localStorage.setItem(P + key, JSON.stringify(value));

const isDemoId = id => String(id).startsWith('demo-');

/** Listen-Felder, deren Einträge einzeln (per id + updatedAt) zusammengeführt werden. */
export const MERGE_FIELDS = { checklists: 'items' };

const ts = x => String(x?.updatedAt || '');

/** Führt zwei Fassungen einer Liste zusammen; pro Punkt gewinnt die jüngere Änderung. */
export function mergeItems(older = [], newer = []) {
  const byId = new Map(older.map(i => [i.id, i]));
  const out = newer.map(n => {
    const o = byId.get(n.id);
    byId.delete(n.id);
    return o && ts(o) > ts(n) ? o : n;
  });
  byId.forEach(o => out.push(o)); // nur auf dem anderen Gerät vorhanden → behalten
  return out;
}

/** Führt zwei Fassungen eines Eintrags zusammen (b gewinnt bei Gleichstand). */
export function mergeRecord(c, a, b) {
  const [older, newer] = ts(a) > ts(b) ? [b, a] : [a, b];
  const field = MERGE_FIELDS[c];
  if (!field || !(Array.isArray(a[field]) || Array.isArray(b[field]))) return newer;
  return { ...newer, [field]: mergeItems(older[field] || [], newer[field] || []) };
}

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
    } else {
      // Leerer Start – Demo-Daten gibt es nur auf Wunsch (Einstellungen → Demo-Daten laden).
      ALL.forEach(c => { this.data[c] = []; this.persist(c); });
      write('seeded', true);
    }
    // Mit Backend: Demo-Erinnerungen entfernen – sie sind nur lokal, der Sync würde sie nie ersetzen.
    if (api.isConfigured()) {
      LOCAL_ONLY.forEach(c => {
        if (this.data[c].some(i => isDemoId(i.id))) {
          this.data[c] = this.data[c].filter(i => !isDemoId(i.id));
          this.persist(c);
        }
      });
    }
    this.status = api.isConfigured() ? 'idle' : 'local';
  }

  /** Sind (noch) Demo-Einträge vorhanden? */
  get hasDemo() {
    return ALL.some(c => this.all(c).some(i => isDemoId(i.id)));
  }

  /**
   * Entfernt alle Demo-Einträge.
   * localOnly = true: nur auf dem Gerät löschen, ohne Lösch-Markierungen ins Sheet zu schreiben
   * (beim Verbinden – die Demo-Daten waren nie im Sheet).
   * localOnly = false: Löschung auch ins Sheet übertragen (falls Demo-Daten dort gelandet sind).
   */
  clearDemo(localOnly = false) {
    let n = 0;
    ALL.forEach(c => {
      const ids = this.all(c).filter(i => isDemoId(i.id)).map(i => i.id);
      if (!ids.length) return;
      n += ids.length;
      if (localOnly) {
        this.data[c] = this.data[c].filter(i => !isDemoId(i.id));
        this.outbox = this.outbox.filter(o => !(o.collection === c && isDemoId(o.item.id)));
        write('outbox', this.outbox);
        this.persist(c);
        this.emit(c);
      } else {
        this.removeMany(c, ids);
      }
    });
    return n;
  }

  /** Lädt die Demo-Daten (ersetzt lokale Daten). */
  seed() {
    const mock = createMockData();
    ALL.forEach(c => { this.data[c] = mock[c] || []; this.persist(c); this.emit(c); });
    write('seeded', true);
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
    const by = getSettings().deviceName;
    const prev = idx >= 0 ? list[idx] : { createdAt: now, ...(by && { createdBy: by }) };
    const next = { ...prev, ...item, id, updatedAt: now, ...(by && { updatedBy: by }) };
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
        // Während des Requests lokal Geändertes zusammenführen statt blind zu überschreiben
        const merged = remote.map(i => (pending.has(i.id) ? mergeRecord(c, i, pending.get(i.id)) : i));
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
