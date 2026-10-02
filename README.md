# Familienzentrale – PWA für die Familienorganisation

Mobile-first Progressive Web App (Vanilla JS, kein Build-Schritt), optimiert für Android und statisch über **GitHub Pages** hostbar. Daten liegen offline-first im Browser und synchronisieren optional über ein **Google Apps Script** mit einem **Google Sheet**.

> ⚠️ **Konto:** Google Sheet, Apps Script und GitHub-Repository mit einem **privaten Konto** anlegen, nicht mit einem Firmenkonto. Die App selbst enthält keine Konto-, Token- oder URL-Angaben. Diese werden auf jedem Gerät in den Einstellungen eingetragen und bleiben lokal im Browser.

## Module

| Tab | Inhalt |
|---|---|
| **Start** | Begrüßung mit heutigem Essen, Kennzahlen, Countdown zum nächsten Event, heutige Termine, Erinnerungen |
| **Essen** | Wochen-Essensplaner (Mo–So, Frühstück/Mittag/Abend) und Einkaufsliste (CRUD, nach Kategorien gruppiert). Zutaten pro Mahlzeit oder für die ganze Woche per Knopfdruck auf die Liste (mit Duplikat-Erkennung und „Rückgängig“) |
| **Kalender** | Tages-/Wochenansicht, nur Lesezugriff, Quelle: Google Kalender (über Apps Script) oder iCal-Feed |
| **Themen** | Besprechungspunkte mit Titel, Beschreibung und Checkbox. Datenmodell vorbereitet für Google Tasks/Keep (`sync`) und Kommentare (`comments[]`), mit Platzhaltern in der UI |
| **Familie** | *Kind & Alltag:* Größen pro Kind, wichtige Kontakte (Anrufen/Karte), wiederverwendbare Checklisten · *Urlaub & Events:* Countdown, Details, Schnellzugriff auf Google Drive und Google Fotos, verknüpfte Packliste |

Erinnerungen: lokale Benachrichtigungen über die Web Notification API (via Service Worker, wie Android es verlangt).

## Ordnerstruktur

```
Familienapp/
├── index.html            App-Shell, Icon-Sprite, Navigation
├── manifest.json         PWA-Manifest (standalone, Theme-Farben, Shortcuts)
├── service-worker.js     Offline-Caching, Notification-Klicks, Push-Vorbereitung
├── .nojekyll             GitHub Pages: Dateien unverändert ausliefern
├── css/style.css         Helles, flaches Design in Blau/Orange (Schriften: Bitter + Source Sans 3)
├── js/
│   ├── app.js            Views, Routing (#hash), Formulare, Event-Delegation
│   ├── config.js         Standardwerte (API-URL, Token, iCal) + Laufzeit-Einstellungen
│   ├── api.js            REST-Client für Apps Script (POST text/plain → kein CORS-Preflight)
│   ├── store.js          Offline-first Speicher + Outbox-Sync (Last-Write-Wins)
│   ├── calendar.js       Kalenderquellen + iCal-Parser (RRULE, EXDATE, ganztägig)
│   ├── reminders.js      Erinnerungs-Loop + Notifications
│   ├── ui.js             DOM-/Datums-Helfer, Toasts, Bottom-Sheet-Formulare
│   └── mock-data.js      Demo-Daten (u. a. „Gran Canaria Urlaub“)
├── icons/                App-Icons (any, maskable, Badge, SVG)
└── backend/
    ├── Code.gs           Google Apps Script (REST-API für Google Sheets + Kalender)
    └── appsscript.json   Script-Manifest mit eng gefassten Berechtigungen
```

## Lokal starten

Service Worker und ES-Module brauchen einen HTTP-Server (kein `file://`):

```bash
npx http-server -p 5173 -c-1
```

oder

```bash
python -m http.server 5173
```

Dann `http://localhost:5173` öffnen. Die App startet leer und zeigt eine Karte „Willkommen – jetzt verbinden“. Unter *Einstellungen → Demo-Daten laden* lassen sich Beispieldaten anzeigen (nur solange die App nicht verbunden ist). Beim Verbinden werden sie automatisch entfernt und nicht ins Sheet geschrieben.

## Deployment auf GitHub Pages

1. Neues Repository unter dem privaten GitHub-Konto anlegen und den Ordnerinhalt pushen.
2. *Settings → Pages → Build and deployment:* „Deploy from a branch“, Branch `main`, Ordner `/ (root)`.
3. Die App läuft unter `https://<benutzer>.github.io/<repo>/`. Alle Pfade sind relativ, Unterpfade funktionieren also.
4. Auf Android in Chrome öffnen → Menü → **„App installieren“** (oder Installieren-Symbol in der App-Leiste).

**Updates:** Bei jeder Änderung `VERSION` in `service-worker.js` hochzählen. Die installierte App zeigt dann „Neue Version verfügbar → Aktualisieren“.

## Backend: Google Apps Script + Google Sheet

> **Tipp bei mehreren angemeldeten Google-Konten:** Die Einrichtung in einem Inkognito-Fenster machen, in dem nur das Konto angemeldet ist, dem das Sheet gehören soll. Sonst öffnet Google den Script-Editor oft mit dem falschen Konto.

1. Mit dem **privaten Konto** ein neues Google Sheet anlegen (z. B. „Familienzentrale DB“).
2. *Erweiterungen → Apps Script* → Inhalt von [`backend/Code.gs`](backend/Code.gs) einfügen und speichern.
3. **Manifest einblenden:** links *⚙ Projekteinstellungen* → Häkchen bei **„Manifestdatei ‚appsscript.json‘ im Editor anzeigen“**. Zurück im *Editor* die Datei `appsscript.json` öffnen, ihren Inhalt komplett durch [`backend/appsscript.json`](backend/appsscript.json) ersetzen und speichern.
4. Funktion **`setup`** auswählen → *Ausführen* → Berechtigungen bestätigen. Die Warnung „Google hat diese App nicht überprüft“ ist bei eigenen Scripts normal: *Erweitert → Weiter zu … (unsicher)*. Google fragt **nur drei Rechte** ab:
   - Tabellen, in denen diese App installiert ist, ansehen und bearbeiten (nur dieses Sheet)
   - Kalender ansehen (nur lesen)
   - Verbindung zu externen Diensten herstellen (für den iCal-Feed)

   `setup` legt pro Collection ein Tabellenblatt an und erzeugt ein `API_TOKEN` (steht im Ausführungsprotokoll).
5. *Bereitstellen → Neue Bereitstellung → Typ: Web-App*
   - Ausführen als: **Ich**
   - Zugriff: **Jeder**
6. Die `/exec`-URL kopieren und in der App unter **Einstellungen (Regler-Symbol) → Web-App-URL** eintragen, dazu das Token. „Verbindung testen“ → „Speichern“.

Nach Code-Änderungen am Script: *Bereitstellen → Bereitstellungen verwalten → Bearbeiten → Neue Version*. Die URL bleibt dabei gleich.

### API

Alle Aufrufe gehen als `POST` mit `Content-Type: text/plain` an die `/exec`-URL. Bei diesem „simple request“ entfällt der CORS-Preflight, den Apps Script nicht beantworten kann.

| `action` | Payload | Antwort |
|---|---|---|
| `ping` | – | `{ ok, time }` |
| `list` | `{ collection }` | `{ ok, items: [...] }` |
| `sync` | `{ changes: [{ collection, item }], collections: [...] }` | `{ ok, data: { shopping: [...], ... } }` |
| `calendar` | `{ from, to }` (ISO) | `{ ok, events: [...] }` oder `{ ok, ics: "..." }` |

Jede Anfrage enthält `token`. Collections: `shopping`, `meals`, `topics`, `contacts`, `sizes`, `checklists`, `trips`. Jedes Tabellenblatt hat die Spalten `id | updatedAt | deleted | json`. Neue Felder brauchen deshalb keine Schemaänderung. Gelöschte Einträge werden markiert (Soft-Delete). `purgeDeleted()` räumt sie nach 30 Tagen auf, z. B. per wöchentlichem Zeit-Trigger.

**Sicherheit:** Das Token steht im Klartext in einer statischen App. Es schützt nur vor zufälligen Zugriffen auf die Web-App-URL. Keine sensiblen Daten (Ausweisnummern, Passwörter usw.) im Sheet speichern.

### Datenmodelle (Auszug)

```js
// shopping
{ id, name, qty, category, checked, source?: { type: 'meal', id, title }, createdAt, updatedAt, deleted? }
// meals – day: 0 = Montag … 6 = Sonntag
{ id, day, slot: 'Frühstück'|'Mittag'|'Abend', title, ingredients: [{ qty, name, category }], notes }
// topics – vorbereitet für Google Tasks/Keep + Kommentare
{ id, title, description, done, doneAt, owner, dueDate,
  comments: [],                                   // später: { id, author, text, createdAt }
  sync: { provider: null, externalId: null, etag: null, lastSyncedAt: null } }
// trips
{ id, title, emoji, theme, destination, start, end, checklistId,
  details: [{ label, value }], links: [{ type: 'drive'|'photos'|'other', label, url }], notes }
// reminders (nur lokal auf dem Gerät)
{ id, title, note, at, repeat: 'none'|'daily'|'weekly'|'monthly', done }
```

## Kalender einbinden

**Variante A – empfohlen (CalendarApp):** Den Familienkalender für das Konto freigeben, unter dem das Script läuft. Dann im Apps Script unter *Projekteinstellungen → Script-Properties* `CALENDAR_ID` setzen (Google Kalender → Einstellungen des Kalenders → „Kalender-ID“). Mehrere Kalender kommagetrennt eintragen, z. B. `abc123@group.calendar.google.com, ich@gmail.com`. Jeder erscheint in seiner Google-Farbe, mit Kalendername am Termin. Wiederholungen löst Google selbst auf.
Mit einer Google-Familiengruppe (Google One) gibt es bereits den gemeinsamen Kalender **„Familie“**. Läuft das Script unter einem Konto der Gruppe, genügt dessen Kalender-ID, eine Freigabe ist nicht nötig.

**Variante B – iCal-Proxy:** Script-Property `ICAL_URL` auf die „Privatadresse im iCal-Format“ setzen. Das Script lädt den Feed serverseitig, denn Google-Feeds senden keinen CORS-Header. Die App parst ihn dann.

**Variante C – direkt:** Ein iCal-Feed *mit* CORS-Header kann in den App-Einstellungen als „iCal-URL“ eingetragen werden. **Google-Kalender-Adressen funktionieren dort nicht** (kein CORS) – dafür Variante A oder B nutzen und das Feld in der App leer lassen.

Ohne Verbindung zeigt der Kalender den Hinweis „Noch kein Kalender verbunden“ (Demo-Termine nur, wenn Demo-Daten geladen sind).

## Erinnerungen – Möglichkeiten und Grenzen

- Benachrichtigungen laufen über `registration.showNotification()`, denn Android-Chrome erlaubt `new Notification()` nicht.
- Eine rein statische PWA hat **keinen zuverlässigen Hintergrund-Wecker**. Erinnerungen werden alle 15 s geprüft, solange die App geöffnet ist oder im Hintergrund noch läuft. Verpasste Erinnerungen meldet die App beim nächsten Öffnen.
- Für Pushes bei geschlossener App braucht es **Web Push** mit Server (VAPID-Schlüssel + Versand, z. B. per Apps-Script-Zeit-Trigger oder Cloud Function). Der Service Worker hat dafür bereits einen `push`-Handler.

## Nächste Schritte (vorbereitet)

- **Kommentare** im Themen-Board: UI-Platzhalter und `comments[]` sind vorhanden.
- **Google Tasks/Keep-Sync:** Feld `sync` pro Thema. Ein Apps-Script-Trigger könnte offene Themen mit der Tasks-API abgleichen (Keep hat keine offizielle Consumer-API).
- Echte Drive-Ordner- und Fotos-Album-Links in „Reise bearbeiten“ eintragen.
