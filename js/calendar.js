import { api } from './api.js';
import { getSettings } from './config.js';
import { createMockEvents } from './mock-data.js';

/**
 * Kalender (read-only).
 * Reihenfolge der Quellen:
 *  1. ICAL_URL in den Einstellungen → direkt im Browser laden (Feed braucht CORS-Header)
 *  2. Apps-Script-Backend → action "calendar" (CalendarApp oder iCal-Proxy)
 *  3. Demo-Termine
 * Der letzte erfolgreiche Abruf wird für den Offline-Betrieb zwischengespeichert.
 *
 * Event-Format: { id, title, start (ISO), end (ISO), allDay, location?, description? }
 */

const CACHE_KEY = 'famapp:calendar';
const MAX_AGE = 10 * 60 * 1000;
const DAY = 864e5;

let cache = (() => { try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; } })();

export function clearCalendarCache() {
  cache = null;
  localStorage.removeItem(CACHE_KEY);
}

export async function getEvents(from, to, { force = false } = {}) {
  const covers = cache && new Date(cache.from) <= from && new Date(cache.to) >= to;
  if (!force && covers && Date.now() - cache.fetchedAt < MAX_AGE) return cache;

  const rangeFrom = new Date(from.getTime() - 14 * DAY);
  const rangeTo = new Date(to.getTime() + 60 * DAY);
  try {
    const { events, source } = await fetchEvents(rangeFrom, rangeTo);
    cache = { from: rangeFrom.toISOString(), to: rangeTo.toISOString(), events, source, fetchedAt: Date.now() };
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* Speicher voll */ }
    return cache;
  } catch (err) {
    if (cache) return { ...cache, stale: true, error: `Offline-Stand: ${err.message}` };
    return { events: [], source: 'none', error: err.message };
  }
}

async function fetchEvents(from, to) {
  const { icalUrl } = getSettings();
  if (icalUrl) {
    const res = await fetch(icalUrl);
    if (!res.ok) throw new Error(`iCal-Feed: HTTP ${res.status}`);
    return { events: parseICS(await res.text(), from, to), source: 'ical' };
  }
  if (api.isConfigured()) {
    const res = await api.calendar(from.toISOString(), to.toISOString());
    const events = Array.isArray(res.events) ? res.events : parseICS(res.ics || '', from, to);
    return { events, source: 'google' };
  }
  return { events: createMockEvents(), source: 'demo' };
}

/* ---------------------------------------------------------------------------
   Minimaler iCal-Parser (RFC 5545) – deckt die üblichen Google-Feeds ab:
   Einzeltermine, ganztägige Termine, RRULE (DAILY/WEEKLY inkl. BYDAY/MONTHLY/
   YEARLY mit INTERVAL, COUNT, UNTIL), EXDATE und geänderte Einzeltermine
   (RECURRENCE-ID). Zeitzonen mit TZID werden als Gerätezeit interpretiert.
   --------------------------------------------------------------------------- */

const unescapeText = v => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function parseDate(value, params = {}) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0', z] = m;
  return z
    ? new Date(Date.UTC(+y, mo - 1, +d, +h, +mi, +s))
    : new Date(+y, mo - 1, +d, +h, +mi, +s);
}

function parseDuration(v) {
  const m = v.match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const [, w = 0, d = 0, h = 0, mi = 0, s = 0] = m.map(x => Number(x) || 0);
  return ((((w * 7 + d) * 24 + h) * 60 + mi) * 60 + s) * 1000;
}

export function parseICS(text, from, to) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const raw = [];
  let cur = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (cur) raw.push(cur); cur = null; continue; }
    if (!cur) continue;
    const m = line.match(/^([A-Z0-9-]+)((?:;[^:]*)?):(.*)$/);
    if (!m) continue;
    const [, key, paramStr, value] = m;
    const params = Object.fromEntries(paramStr.split(';').filter(Boolean).map(p => p.split('=')));
    switch (key) {
      case 'UID': cur.uid = value; break;
      case 'SUMMARY': cur.title = unescapeText(value); break;
      case 'LOCATION': cur.location = unescapeText(value); break;
      case 'DESCRIPTION': cur.description = unescapeText(value); break;
      case 'STATUS': cur.status = value; break;
      case 'DTSTART':
        cur.start = parseDate(value, params);
        cur.allDay = params.VALUE === 'DATE' || /^\d{8}$/.test(value);
        break;
      case 'DTEND': cur.end = parseDate(value, params); break;
      case 'DURATION': cur.duration = parseDuration(value); break;
      case 'RRULE': cur.rrule = Object.fromEntries(value.split(';').map(p => p.split('='))); break;
      case 'EXDATE': value.split(',').forEach(v => { const d = parseDate(v, params); if (d) cur.exdates.push(d.getTime()); }); break;
      case 'RECURRENCE-ID': cur.recurrenceId = parseDate(value, params); break;
    }
  }

  // Geänderte Einzeltermine ersetzen die ursprüngliche Wiederholung
  const overrides = raw.filter(e => e.recurrenceId);
  for (const o of overrides) {
    const master = raw.find(e => e.uid === o.uid && !e.recurrenceId);
    master?.exdates.push(o.recurrenceId.getTime());
  }

  const out = [];
  for (const ev of raw) {
    if (!ev.start || ev.status === 'CANCELLED') continue;
    const dur = ev.end ? ev.end - ev.start : ev.duration || (ev.allDay ? 864e5 : 0);
    const push = start => {
      if (ev.exdates.includes(start.getTime())) return;
      const end = new Date(start.getTime() + dur);
      if (start < to && (end > from || start >= from)) {
        out.push({
          id: `${ev.uid || ev.title}_${start.getTime()}`,
          title: ev.title || '(ohne Titel)', start: start.toISOString(), end: end.toISOString(),
          allDay: ev.allDay, location: ev.location || '', description: ev.description || '',
        });
      }
    };

    if (!ev.rrule || ev.recurrenceId) { push(ev.start); continue; }
    expandRule(ev, to, push);
  }
  return out;
}

function expandRule(ev, to, push) {
  const { FREQ, BYDAY } = ev.rrule;
  const interval = Number(ev.rrule.INTERVAL) || 1;
  const count = Number(ev.rrule.COUNT) || Infinity;
  const until = ev.rrule.UNTIL ? parseDate(ev.rrule.UNTIL) : null;
  const weekdays = FREQ === 'WEEKLY' && BYDAY
    ? BYDAY.split(',').map(d => ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].indexOf(d.slice(-2))).filter(i => i >= 0).sort()
    : null;

  const step = k => {
    const d = new Date(ev.start);
    if (FREQ === 'DAILY') d.setDate(d.getDate() + k);
    else if (FREQ === 'WEEKLY') d.setDate(d.getDate() + 7 * k);
    else if (FREQ === 'MONTHLY') d.setMonth(d.getMonth() + k);
    else if (FREQ === 'YEARLY') d.setFullYear(d.getFullYear() + k);
    else return null;
    return d;
  };

  let n = 0;
  for (let k = 0; k < 5000; k++) {
    const base = step(k * interval);
    if (!base) return;
    let candidates = [base];
    if (weekdays) {
      const monday = new Date(base);
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      candidates = weekdays.map(wd => { const d = new Date(monday); d.setDate(d.getDate() + wd); return d; });
    }
    for (const d of candidates) {
      if (d < ev.start) continue;
      if ((until && d > until) || d >= to || n >= count) return;
      n++;
      push(d);
    }
  }
}
