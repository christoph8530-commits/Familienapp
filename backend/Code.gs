/**
 * @OnlyCurrentDoc
 * Familienzentrale – Google Apps Script Backend (REST-API für Google Sheets)
 *
 * Berechtigungen: siehe appsscript.json – das Script darf nur DIESES Sheet
 * bearbeiten, Kalender nur LESEN und externe URLs (iCal-Feed) abrufen.
 * Braucht eine spätere Erweiterung mehr, muss der Scope dort ergänzt werden.
 *
 * Einrichtung (Details im README):
 *  1. Mit dem PRIVATEN Familien-Google-Konto ein neues Google Sheet anlegen
 *     (kein Firmen-/Agenturkonto).
 *  2. Erweiterungen → Apps Script → diesen Code einfügen.
 *  3. Funktion setup() einmal ausführen (legt Tabellenblätter + Token an).
 *  4. Bereitstellen → Neue Bereitstellung → Web-App
 *       Ausführen als: Ich · Zugriff: Jeder
 *  5. /exec-URL und Token in der App unter Einstellungen eintragen.
 *
 * Script-Properties (Projekteinstellungen → Script-Properties):
 *  - API_TOKEN    Gemeinsames Familien-Token (wird von setup() erzeugt)
 *  - CALENDAR_ID  Optional: Kalender-ID(s), kommagetrennt (z. B. xyz@group.calendar.google.com, ich@gmail.com)
 *  - ICAL_URL     Optional: iCal-Adresse, falls kein CALENDAR_ID-Zugriff möglich
 *
 * Datenmodell: Ein Tabellenblatt pro Collection, Spalten
 *   id | updatedAt | deleted | json
 * "json" enthält den kompletten Eintrag – neue Felder brauchen keine Schemaänderung.
 */

const COLLECTIONS = ['shopping', 'meals', 'topics', 'contacts', 'sizes', 'checklists', 'trips'];
const HEADER = ['id', 'updatedAt', 'deleted', 'json'];
const TOMBSTONE_DAYS = 30;

/* ---------- Einstiegspunkte ---------- */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.collections) p.collections = String(p.collections).split(',');
  return handle_(p);
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Ungültiges JSON' });
  }
  return handle_(body);
}

function handle_(req) {
  try {
    authorize_(req.token);
    switch (req.action) {
      case 'ping':
        return json_({ ok: true, time: new Date().toISOString() });
      case 'list':
        return json_({ ok: true, items: readCollection_(assertCollection_(req.collection)) });
      case 'sync':
        return json_({ ok: true, data: sync_(req.changes || [], req.collections || COLLECTIONS) });
      case 'calendar':
        return json_(Object.assign({ ok: true }, calendar_(req.from, req.to)));
      default:
        throw new Error('Unbekannte Aktion: ' + req.action);
    }
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

/* ---------- Sicherheit ---------- */

function authorize_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  // Ohne Token bleibt die API zu – die Web-App ist öffentlich erreichbar.
  if (!expected) throw new Error('API_TOKEN fehlt – bitte setup() im Script-Editor ausführen');
  if (token !== expected) throw new Error('Nicht autorisiert (Token prüfen)');
}

function assertCollection_(name) {
  if (COLLECTIONS.indexOf(name) === -1) throw new Error('Unbekannte Collection: ' + name);
  return name;
}

/* ---------- Daten ---------- */

function sync_(changes, collections) {
  const grouped = {};
  changes.forEach(function (c) {
    assertCollection_(c.collection);
    (grouped[c.collection] = grouped[c.collection] || []).push(c.item);
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    Object.keys(grouped).forEach(function (name) { upsertMany_(name, grouped[name]); });
  } finally {
    lock.releaseLock();
  }

  const data = {};
  collections.forEach(function (name) { data[assertCollection_(name)] = readCollection_(name); });
  return data;
}

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:B').setNumberFormat('@'); // IDs und Zeitstempel als Text speichern
    sh.setColumnWidth(4, 600);
  }
  return sh;
}

function readRows_(sh) {
  const last = sh.getLastRow();
  return last < 2 ? [] : sh.getRange(2, 1, last - 1, HEADER.length).getValues();
}

function readCollection_(name) {
  return readRows_(sheet_(name))
    .filter(function (r) { return r[0]; })
    .map(function (r) {
      try { return JSON.parse(r[3]); } catch (err) {
        return { id: String(r[0]), updatedAt: String(r[1]), deleted: r[2] === true, _corrupt: true };
      }
    });
}

function upsertMany_(name, items) {
  const sh = sheet_(name);
  const rows = readRows_(sh);
  const index = {};
  rows.forEach(function (r, i) { index[r[0]] = i; });

  items.forEach(function (item) {
    if (!item || !item.id) return;
    const updatedAt = String(item.updatedAt || new Date().toISOString());
    const row = [String(item.id), updatedAt, item.deleted === true, JSON.stringify(item)];
    const i = index[item.id];
    if (i === undefined) {
      index[item.id] = rows.length;
      rows.push(row);
    } else if (String(rows[i][1]) <= updatedAt) { // Last-Write-Wins
      rows[i] = row;
    }
  });

  if (rows.length) sh.getRange(2, 1, rows.length, HEADER.length).setValues(rows);
}

/* ---------- Kalender ---------- */

function calendar_(from, to) {
  const props = PropertiesService.getScriptProperties();
  const start = from ? new Date(from) : new Date();
  const end = to ? new Date(to) : new Date(start.getTime() + 30 * 864e5);

  // Eine oder mehrere Kalender-IDs, kommagetrennt: "familie@group.calendar.google.com, ich@gmail.com"
  const calendarIds = String(props.getProperty('CALENDAR_ID') || '')
    .split(',').map(function (s) { return s.trim(); }).filter(String);
  if (calendarIds.length) {
    const seen = {};
    const events = [];
    calendarIds.forEach(function (calendarId) {
      const cal = CalendarApp.getCalendarById(calendarId);
      if (!cal) throw new Error('Kalender „' + calendarId + '“ nicht gefunden – ist er für dieses Konto sichtbar?');
      const name = cal.getName();
      const color = cal.getColor();
      cal.getEvents(start, end).forEach(function (ev) {
        const id = ev.getId() + '_' + ev.getStartTime().getTime();
        if (seen[id]) return; // gleicher Termin in mehreren Kalendern
        seen[id] = true;
        events.push({
          id: id,
          title: ev.getTitle(),
          start: ev.getStartTime().toISOString(),
          end: ev.getEndTime().toISOString(),
          allDay: ev.isAllDayEvent(),
          location: ev.getLocation(),
          description: ev.getDescription(),
          calendar: name,
          color: color,
        });
      });
    });
    return { source: 'calendar', events: events };
  }

  const icalUrl = props.getProperty('ICAL_URL');
  if (icalUrl) {
    // Proxy: Google-iCal-Feeds haben keinen CORS-Header, daher Abruf serverseitig.
    const cache = CacheService.getScriptCache();
    let ics = cache.get('ics');
    if (!ics) {
      ics = UrlFetchApp.fetch(icalUrl).getContentText();
      if (ics.length < 95000) cache.put('ics', ics, 300);
    }
    return { source: 'ical', ics: ics };
  }

  throw new Error('Kein Kalender konfiguriert (Script-Property CALENDAR_ID oder ICAL_URL setzen).');
}

/* ---------- Hilfsfunktionen ---------- */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Einmal manuell ausführen: legt alle Tabellenblätter und ein API-Token an. */
function setup() {
  COLLECTIONS.forEach(sheet_);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('API_TOKEN')) {
    props.setProperty('API_TOKEN', Utilities.getUuid().replace(/-/g, '').slice(0, 24));
  }
  Logger.log('Setup fertig. API_TOKEN: ' + props.getProperty('API_TOKEN'));
}

/** Optional per Zeit-Trigger (z. B. wöchentlich): entfernt alte Lösch-Markierungen. */
function purgeDeleted() {
  const cutoff = new Date(Date.now() - TOMBSTONE_DAYS * 864e5).toISOString();
  COLLECTIONS.forEach(function (name) {
    const sh = sheet_(name);
    const rows = readRows_(sh);
    const keep = rows.filter(function (r) { return !(r[2] === true && String(r[1]) < cutoff); });
    if (keep.length === rows.length) return;
    if (rows.length) sh.getRange(2, 1, rows.length, HEADER.length).clearContent();
    if (keep.length) sh.getRange(2, 1, keep.length, HEADER.length).setValues(keep);
  });
}
