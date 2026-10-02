/**
 * Demo-Daten, damit das Layout sofort sichtbar ist.
 * Feste IDs ("demo-…") verhindern Duplikate, falls die Demo-Daten mehrfach
 * ins Sheet hochgeladen werden.
 */

const now = new Date().toISOString();
const rec = (id, data) => ({ id, createdAt: now, updatedAt: now, ...data });

/** Datum relativ zu heute. */
function inDays(days, h = 0, m = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(h, m, 0, 0);
  return d;
}

/** Datum in der aktuellen Woche (0 = Montag). */
function weekday(i, h = 0, m = 0) {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + i);
  d.setHours(h, m, 0, 0);
  return d;
}

const ing = (qty, name, category) => ({ qty, name, category });

export function createMockData() {
  return {
    shopping: [
      rec('demo-shop-1', { name: 'Milch', qty: '2 l', category: 'Milchprodukte', checked: false }),
      rec('demo-shop-2', { name: 'Bananen', qty: '1 Bund', category: 'Obst & Gemüse', checked: false }),
      rec('demo-shop-3', { name: 'Äpfel', qty: '1 kg', category: 'Obst & Gemüse', checked: false }),
      rec('demo-shop-4', { name: 'Vollkornbrot', qty: '1', category: 'Brot & Backwaren', checked: false }),
      rec('demo-shop-5', { name: 'Joghurt nature', qty: '4 Becher', category: 'Milchprodukte', checked: false }),
      rec('demo-shop-6', { name: 'Kinderzahnpasta', qty: '', category: 'Drogerie', checked: false }),
      rec('demo-shop-7', { name: 'Haferflocken', qty: '500 g', category: 'Vorrat', checked: true }),
      rec('demo-shop-8', { name: 'Sonnencreme LSF 50', qty: '', category: 'Drogerie', checked: false }),
    ],

    // day: 0 = Montag … 6 = Sonntag
    meals: [
      rec('demo-meal-1', { day: 0, slot: 'Abend', title: 'Spaghetti Bolognese', ingredients: [
        ing('500 g', 'Spaghetti', 'Vorrat'), ing('400 g', 'Hackfleisch', 'Fleisch & Fisch'),
        ing('1 Dose', 'Tomaten', 'Vorrat'), ing('1', 'Zwiebel', 'Obst & Gemüse'), ing('', 'Parmesan', 'Milchprodukte'),
      ] }),
      rec('demo-meal-2', { day: 1, slot: 'Abend', title: 'Gemüsecurry mit Reis', ingredients: [
        ing('1 Dose', 'Kokosmilch', 'Vorrat'), ing('300 g', 'Basmatireis', 'Vorrat'),
        ing('2', 'Paprika', 'Obst & Gemüse'), ing('1', 'Zucchini', 'Obst & Gemüse'), ing('2 EL', 'Currypaste', 'Vorrat'),
      ] }),
      rec('demo-meal-3', { day: 2, slot: 'Mittag', title: 'Pfannkuchen mit Apfelmus', ingredients: [
        ing('250 g', 'Mehl', 'Vorrat'), ing('4', 'Eier', 'Milchprodukte'), ing('500 ml', 'Milch', 'Milchprodukte'), ing('1 Glas', 'Apfelmus', 'Vorrat'),
      ] }),
      rec('demo-meal-4', { day: 3, slot: 'Abend', title: 'Ofengemüse mit Feta', ingredients: [
        ing('1 kg', 'Kartoffeln', 'Obst & Gemüse'), ing('3', 'Karotten', 'Obst & Gemüse'), ing('200 g', 'Feta', 'Milchprodukte'),
      ] }),
      rec('demo-meal-5', { day: 4, slot: 'Abend', title: 'Pizza-Abend (selbst belegt)', ingredients: [
        ing('2', 'Pizzateig', 'Brot & Backwaren'), ing('2', 'Mozzarella', 'Milchprodukte'),
        ing('1', 'Tomatensauce', 'Vorrat'), ing('150 g', 'Schinken', 'Fleisch & Fisch'),
      ] }),
      rec('demo-meal-6', { day: 5, slot: 'Mittag', title: 'Fischstäbchen mit Kartoffelstock', ingredients: [
        ing('1 Pck.', 'Fischstäbchen', 'Tiefkühl'), ing('1 kg', 'Kartoffeln', 'Obst & Gemüse'), ing('', 'Butter', 'Milchprodukte'),
      ] }),
      rec('demo-meal-7', { day: 6, slot: 'Frühstück', title: 'Sonntagsbrunch', ingredients: [
        ing('1', 'Zopf', 'Brot & Backwaren'), ing('', 'Konfitüre', 'Vorrat'), ing('6', 'Eier', 'Milchprodukte'),
      ] }),
    ],

    // Datenmodell vorbereitet für spätere Sync mit Google Tasks / Keep (sync-Objekt)
    // und Kommentare (comments-Array).
    topics: [
      rec('demo-topic-1', {
        title: 'Urlaubsbudget Gran Canaria', done: false, owner: 'Alle',
        description: 'Mietwagen ja/nein? Ausflüge: Roque Nublo, Palmitos Park, Dünen von Maspalomas.',
        dueDate: inDays(7).toISOString().slice(0, 10), comments: [],
        sync: { provider: null, externalId: null, etag: null, lastSyncedAt: null },
      }),
      rec('demo-topic-2', {
        title: 'Schwimmkurs für Lina anmelden', done: false, owner: 'Mama',
        description: 'Anmeldeschluss beachten. Dienstag oder Donnerstag nachmittags?',
        dueDate: inDays(3).toISOString().slice(0, 10), comments: [],
        sync: { provider: null, externalId: null, etag: null, lastSyncedAt: null },
      }),
      rec('demo-topic-3', {
        title: 'Weihnachtsgeschenke Großeltern', done: false, owner: 'Papa',
        description: 'Fotobuch vom Sommer? Gemeinsames Basteln am Wochenende.', comments: [],
        sync: { provider: null, externalId: null, etag: null, lastSyncedAt: null },
      }),
      rec('demo-topic-4', {
        title: 'Zahnarzttermin vereinbaren', done: true, owner: 'Papa',
        description: 'Kontrolle für die ganze Familie.', comments: [],
        sync: { provider: null, externalId: null, etag: null, lastSyncedAt: null },
      }),
    ],

    reminders: [
      { id: 'demo-rem-1', title: 'Müll & Altpapier rausstellen', note: 'Abholung morgen früh', at: inDays(1, 19, 0).toISOString(), repeat: 'weekly', done: false },
      { id: 'demo-rem-2', title: 'Schwimmkurs-Anmeldung abschicken', note: '', at: inDays(2, 9, 0).toISOString(), repeat: 'none', done: false },
      { id: 'demo-rem-3', title: 'Online-Check-in Gran Canaria', note: 'Flug ZRH → LPA', at: new Date('2026-10-23T07:00').toISOString(), repeat: 'none', done: false },
    ],

    contacts: [
      rec('demo-contact-1', { name: 'Kinderarztpraxis Dr. Muster', role: 'Kinderarzt', phone: '+41 00 000 00 01', email: 'praxis@example.com', address: 'Musterstrasse 1, 8000 Zürich', note: 'Sprechstunde Mo–Fr 8–12 Uhr' }),
      rec('demo-contact-2', { name: 'Notruf', role: 'Rettungsdienst (EU & CH)', phone: '112', email: '', address: '', note: '' }),
      rec('demo-contact-3', { name: 'Kindergarten Sonnenblume', role: 'Kindergarten', phone: '+41 00 000 00 02', email: 'kiga@example.com', address: '', note: 'Abholung bis 16:30' }),
      rec('demo-contact-4', { name: 'Oma & Opa', role: 'Großeltern', phone: '+41 00 000 00 03', email: '', address: '', note: '' }),
      rec('demo-contact-5', { name: 'Babysitterin Sara', role: 'Babysitting', phone: '+41 00 000 00 04', email: '', address: '', note: 'Mi & Fr abends verfügbar' }),
    ],

    sizes: [
      rec('demo-size-1', { person: 'Lina', label: 'Schuhgröße', value: '28', note: 'Winterstiefel 29' }),
      rec('demo-size-2', { person: 'Lina', label: 'Kleidergröße', value: '110/116', note: '' }),
      rec('demo-size-3', { person: 'Lina', label: 'Hose', value: '110', note: 'eher schmal' }),
      rec('demo-size-4', { person: 'Lina', label: 'Jacke', value: '116', note: '' }),
      rec('demo-size-5', { person: 'Lina', label: 'Kopfumfang', value: '52 cm', note: 'Helm/Mütze' }),
      rec('demo-size-6', { person: 'Lina', label: 'Körpergröße', value: '112 cm', note: '' }),
    ],

    checklists: [
      rec('demo-cl-weekend', { title: 'Packliste Wochenendausflug', items: [
        { id: 'w1', text: 'Wechselkleidung (2 Sets)', done: false },
        { id: 'w2', text: 'Schlafanzug & Kuscheltier', done: false },
        { id: 'w3', text: 'Zahnbürsten', done: false },
        { id: 'w4', text: 'Regenjacke & Gummistiefel', done: false },
        { id: 'w5', text: 'Snacks & Trinkflaschen', done: false },
        { id: 'w6', text: 'Ladekabel & Powerbank', done: false },
        { id: 'w7', text: 'Reiseapotheke', done: false },
      ] }),
      rec('demo-cl-kiga', { title: 'Kindergarten-Tasche', items: [
        { id: 'k1', text: 'Znüni-Box', done: true },
        { id: 'k2', text: 'Trinkflasche', done: true },
        { id: 'k3', text: 'Hausschuhe', done: false },
        { id: 'k4', text: 'Ersatzkleidung', done: false },
      ] }),
      rec('demo-cl-gc', { title: 'Packliste Gran Canaria', items: [
        { id: 'g1', text: 'Reisepässe / ID-Karten', done: false },
        { id: 'g2', text: 'Sonnencreme LSF 50', done: false },
        { id: 'g3', text: 'Badesachen & Schwimmflügel', done: false },
        { id: 'g4', text: 'Sonnenhüte & Sonnenbrillen', done: false },
        { id: 'g5', text: 'Kopfhörer & Tablet fürs Kind', done: false },
        { id: 'g6', text: 'Reiseapotheke & Medikamente', done: false },
        { id: 'g7', text: 'Adapter? (nicht nötig – EU-Stecker)', done: true },
      ] }),
    ],

    trips: [
      rec('demo-trip-gc', {
        title: 'Gran Canaria Urlaub', theme: 'beach',
        destination: 'Maspalomas, Gran Canaria',
        start: '2026-10-24T06:45', end: '2026-11-07T21:30',
        checklistId: 'demo-cl-gc',
        details: [
          { label: 'Hinflug', value: 'Sa 24.10. · 06:45 ZRH → LPA' },
          { label: 'Rückflug', value: 'Sa 07.11. · 16:10 LPA → ZRH' },
          { label: 'Unterkunft', value: 'Ferienwohnung in Meloneras (Platzhalter)' },
          { label: 'Mietwagen', value: 'noch offen' },
        ],
        links: [
          { type: 'drive', label: 'Tickets & Dokumente', url: 'https://drive.google.com/drive/folders/DEINE_ORDNER_ID' },
          { type: 'photos', label: 'Fotoalbum', url: 'https://photos.app.goo.gl/DEIN_ALBUM_LINK' },
        ],
        notes: 'Platzhalter-Links in „Bearbeiten“ durch eure echten Drive-/Fotos-Freigaben ersetzen.',
      }),
      rec('demo-trip-bday', {
        title: 'Linas 6. Geburtstag', theme: 'party',
        destination: 'Indoor-Spielplatz (Platzhalter)',
        start: '2026-11-21T14:00', end: '2026-11-21T18:00',
        checklistId: null,
        details: [
          { label: 'Gäste', value: '8 Kinder' },
          { label: 'Kuchen', value: 'Schokokuchen – Oma backt' },
        ],
        links: [
          { type: 'photos', label: 'Party-Fotos', url: 'https://photos.app.goo.gl/DEIN_ALBUM_LINK' },
        ],
        notes: '',
      }),
    ],
  };
}

/** Demo-Termine, immer relativ zur aktuellen Woche. */
export function createMockEvents() {
  const ev = (id, title, start, end, extra = {}) => ({ id, title, start: start.toISOString(), end: end.toISOString(), allDay: false, ...extra });
  const allDay = (id, title, day) => ev(id, title, weekday(day), weekday(day + 1), { allDay: true });
  return [
    ev('demo-ev-today', 'Turnen', inDays(0, 17, 0), inDays(0, 18, 0), { location: 'Turnhalle' }),
    ev('demo-ev-1', 'Schwimmen', weekday(0, 16, 30), weekday(0, 17, 15), { location: 'Hallenbad' }),
    ev('demo-ev-2', 'Elternabend Kindergarten', weekday(1, 19, 0), weekday(1, 20, 30), { location: 'Kindergarten Sonnenblume' }),
    allDay('demo-ev-3', 'Oma & Opa zu Besuch', 2),
    ev('demo-ev-4', 'Kinderarzt – Vorsorgeuntersuchung', weekday(3, 9, 15), weekday(3, 10, 0), { location: 'Praxis Dr. Muster' }),
    ev('demo-ev-5', 'Kindergeburtstag bei Noah', weekday(4, 15, 0), weekday(4, 17, 30)),
    ev('demo-ev-6', 'Wochenmarkt & Spielplatz', weekday(5, 10, 0), weekday(5, 12, 0)),
    ev('demo-ev-7', 'Brunch mit Freunden', weekday(6, 11, 0), weekday(6, 13, 30)),
    allDay('demo-ev-8', 'Papierabfuhr', 8),
    ev('demo-ev-9', 'Elterngespräch', weekday(9, 8, 0), weekday(9, 8, 30)),
  ];
}
