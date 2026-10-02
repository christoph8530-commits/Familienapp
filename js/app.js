import { CONFIG, getSettings, saveSettings } from './config.js';
import { api } from './api.js';
import { store, uid } from './store.js';
import { getEvents, clearCalendarCache } from './calendar.js';
import { notifier, startReminderLoop } from './reminders.js';
import {
  $, $$, esc, safeUrl, icon, toast, field, openForm, openSheet, toDate,
  DAYS, weekdayIndex, startOfDay, startOfWeek, addDays, sameDay, isoWeek,
  fmt, fmtTime, fmtDate, fmtDayLong, toInputDateTime, relativeDay,
} from './ui.js';

/* =========================================================================
   Konstanten & Fach-Helfer
   ========================================================================= */

const CATEGORIES = ['Obst & Gemüse', 'Brot & Backwaren', 'Milchprodukte', 'Fleisch & Fisch', 'Vorrat', 'Tiefkühl', 'Getränke', 'Drogerie', 'Sonstiges'];
const SLOTS = ['Frühstück', 'Mittag', 'Abend'];
const REPEAT_LABEL = { none: 'Einmalig', daily: 'Täglich', weekly: 'Wöchentlich', monthly: 'Monatlich' };

// Reihenfolge ist wichtig: spezifische Treffer zuerst (z. B. "Fischstäbchen" → Tiefkühl).
const CATEGORY_HINTS = [
  ['Tiefkühl', ['tiefkühl', 'tk-', 'fischstäbchen', 'glace', 'speiseeis', 'pommes']],
  ['Drogerie', ['zahnpasta', 'zahnbürste', 'shampoo', 'seife', 'windel', 'taschentüch', 'sonnencreme', 'duschgel', 'waschmittel', 'wc-papier', 'toilettenpapier']],
  ['Vorrat', ['nudel', 'spaghetti', 'pasta', 'hörnli', 'reis', 'mehl', 'zucker', 'salz', 'öl', 'essig', 'dose', 'tomatensauce', 'passata', 'kokosmilch', 'curry', 'haferflocken', 'müsli', 'konfitüre', 'marmelade', 'honig', 'apfelmus', 'linsen', 'brühe', 'gewürz']],
  ['Fleisch & Fisch', ['hack', 'fleisch', 'huhn', 'poulet', 'hähnchen', 'schinken', 'wurst', 'speck', 'lachs', 'fisch', 'thunfisch']],
  ['Milchprodukte', ['milch', 'joghurt', 'käse', 'butter', 'rahm', 'sahne', 'quark', 'feta', 'mozzarella', 'parmesan', 'eier']],
  ['Brot & Backwaren', ['brot', 'brötchen', 'zopf', 'toast', 'gipfeli', 'croissant', 'pizzateig', 'wraps', 'tortilla']],
  ['Obst & Gemüse', ['apfel', 'äpfel', 'banane', 'zwiebel', 'knoblauch', 'tomate', 'paprika', 'zucchini', 'karotte', 'rüebli', 'kartoffel', 'salat', 'gurke', 'zitrone', 'beere', 'avocado', 'brokkoli', 'spinat', 'kräuter', 'petersilie', 'basilikum', 'pilz', 'champignon', 'birne', 'trauben']],
  ['Getränke', ['saft', 'wasser', 'sirup', 'tee', 'kaffee', 'bier', 'wein']],
];

const norm = s => String(s || '').trim().toLowerCase();
const bySlot = (a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot);

function guessCategory(name) {
  const n = norm(name);
  for (const [cat, words] of CATEGORY_HINTS) if (words.some(w => n.includes(w))) return cat;
  return 'Sonstiges';
}

const UNIT = '(?:g|kg|ml|l|dl|cl|EL|TL|Stk|Stück|Pck|Packung(?:en)?|Dosen?|Bund|Becher|Prisen?|Scheiben?|Zehen?|Glas|Gläser|Liter|Kopf|Netz|Beutel)';
const QTY_RE = new RegExp(`^((?:\\d+(?:[.,]\\d+)?|½|¼|¾|\\d+/\\d+)(?:\\s*-\\s*\\d+)?\\s*${UNIT}?\\.?)\\s+(.+)$`, 'i');

/** "500 g Spaghetti" → { qty: "500 g", name: "Spaghetti" } */
function parseIngredient(text) {
  const t = text.trim();
  const m = t.match(QTY_RE);
  return m ? { qty: m[1].trim(), name: m[2].trim() } : { qty: '', name: t };
}
const formatIngredient = i => [i.qty, i.name].filter(Boolean).join(' ');

const initials = name => String(name || '?').split(/\s+/).filter(w => /^[A-Za-zÄÖÜäöü]/.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

/** Abreißkalender-Badge: Monat oben, Tag groß darunter. */
const dateBadge = value =>
  `<span class="datebadge" aria-hidden="true"><span>${esc(fmt(value, { month: 'short' }).replace('.', ''))}</span><b>${toDate(value).getDate()}</b></span>`;

/* =========================================================================
   App-Zustand
   ========================================================================= */

const PREFS_KEY = 'famapp:prefs';
const prefs = {
  foodTab: 'plan', familyTab: 'info', calMode: 'week', topicFilter: 'open',
  ...(() => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; } })(),
};
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignorieren */ } };

const state = {
  view: 'home',
  calDate: startOfDay(new Date()),
  cal: { events: [], source: null, loading: true },
  openLists: new Set(),
  focus: null,
  dirty: false,
};

const VIEWS = {
  home: { title: CONFIG.APP_NAME, subtitle: () => 'Euer Familienalltag auf einen Blick', render: renderHome },
  essen: {
    title: 'Essen & Einkauf',
    subtitle: () => `KW ${isoWeek(new Date())} · ${store.all('shopping').filter(i => !i.checked).length} Artikel offen`,
    render: renderFood,
  },
  kalender: { title: 'Kalender', subtitle: () => 'Familientermine (nur lesen)', render: renderCalendar },
  themen: {
    title: 'Themen-Board',
    subtitle: () => `${store.all('topics').filter(t => !t.done).length} offene Besprechungspunkte`,
    render: renderTopics,
  },
  familie: { title: 'Familie', subtitle: () => 'Kind & Alltag · Urlaub & Events', render: renderFamily },
};

/* =========================================================================
   Rendering & Routing
   ========================================================================= */

function render() {
  const v = VIEWS[state.view];
  $('#viewTitle').textContent = v.title;
  $('#viewSubtitle').textContent = v.subtitle?.() ?? '';
  $('#view').innerHTML = v.render();
  state.dirty = false;
  if (state.focus) { $(state.focus)?.focus(); state.focus = null; }
}

/** Re-Render für Hintergrund-Updates – nicht, während jemand in der Ansicht tippt. */
function refresh() {
  const a = document.activeElement;
  if (a?.matches?.('#view input, #view textarea') && a.value) { state.dirty = true; return; }
  render();
}

function route() {
  const v = location.hash.slice(1) || 'home';
  state.view = VIEWS[v] ? v : 'home';
  $$('.tab').forEach(t => t.setAttribute('aria-current', t.dataset.view === state.view ? 'page' : 'false'));
  render();
  window.scrollTo(0, 0);
  if (state.view === 'kalender' || state.view === 'home') ensureCalendar();
}

function renderSync() {
  const btn = $('#syncBtn');
  const labels = { local: 'Lokal', idle: 'Bereit', syncing: 'Sync …', synced: 'Synchron', offline: 'Offline', error: 'Fehler' };
  btn.dataset.status = store.status;
  btn.querySelector('.sync-label').textContent = labels[store.status] || store.status;
  btn.title = store.statusMsg || (store.status === 'local'
    ? 'Demo-/Offline-Modus: Daten nur auf diesem Gerät'
    : store.lastSync ? `Letzter Sync: ${relativeDay(store.lastSync)}` : '');
}

/* =========================================================================
   Ansicht: Start
   ========================================================================= */

function renderHome() {
  const now = new Date();
  const h = now.getHours();
  const greet = h < 11 ? 'Guten Morgen' : h < 18 ? 'Hallo' : 'Guten Abend';
  const todaysMeals = store.all('meals').filter(m => m.day === weekdayIndex(now)).sort(bySlot);
  const openShop = store.all('shopping').filter(i => !i.checked).length;
  const openTopics = store.all('topics').filter(t => !t.done).length;
  const events = eventsBetween(startOfDay(now), addDays(startOfDay(now), 1));
  const trip = nextTrip();

  return `
    <section class="hero">
      <p class="eyebrow">${greet}</p>
      <h2 class="display">${esc(fmtDayLong(now))}</h2>
      <a class="hero-meal" href="#essen" data-action="food-tab" data-tab="plan">
        ${icon('utensils', 'icon-sm')}
        <span>${todaysMeals.length
          ? `Heute auf dem Tisch: <b>${esc(todaysMeals.map(m => m.title).join(' · '))}</b>`
          : 'Für heute ist noch kein Essen geplant.'}</span>
      </a>
    </section>

    <div class="stats">
      <a class="stat" href="#essen" data-action="food-tab" data-tab="list">${icon('cart')}<b>${openShop}</b><span>Einkauf offen</span></a>
      <a class="stat" href="#kalender">${icon('calendar')}<b>${events.length}</b><span>Termine heute</span></a>
      <a class="stat" href="#themen">${icon('topics')}<b>${openTopics}</b><span>Themen offen</span></a>
    </div>

    ${trip ? `
      <a class="card trip trip-teaser" href="#familie" data-action="family-tab" data-tab="trips">
        <div class="trip-hero theme-${esc(trip.theme || 'beach')}">
          <div class="row">${dateBadge(trip.start)}
            <div class="item-main"><div class="trip-kicker">Nächstes Event</div><h3>${esc(trip.title)}</h3></div>
            ${icon('chev-right')}
          </div>
          ${countdownHtml(trip)}
        </div>
      </a>` : ''}

    <section class="card">
      <div class="card-head">${icon('calendar')}<h2>Heute</h2><span class="spacer"></span>
        <a class="btn btn-ghost btn-sm" href="#kalender">Woche ${icon('chev-right', 'icon-sm')}</a></div>
      ${state.cal.loading && !state.cal.events.length ? '<p class="empty">Termine werden geladen …</p>'
        : events.length ? events.map(eventRow).join('') : '<p class="empty">Heute stehen keine Termine an.</p>'}
    </section>

    ${remindersCard()}`;
}

function remindersCard() {
  const list = store.all('reminders').filter(r => !r.done).sort((a, b) => a.at.localeCompare(b.at));
  const perm = notifier.permission;
  return `
    <section class="card">
      <div class="card-head">${icon('bell')}<h2>Erinnerungen</h2><span class="spacer"></span>
        <button class="btn btn-soft btn-sm" data-action="reminder-add">${icon('plus', 'icon-sm')} Neu</button></div>
      ${perm === 'default' ? `
        <div class="banner"><span class="item-main small">Benachrichtigungen erlauben, damit Erinnerungen als Push-Meldung erscheinen.</span>
        <button class="btn btn-primary btn-sm" data-action="notify-enable">Erlauben</button></div>` : ''}
      ${perm === 'denied' ? '<div class="banner warn small">Benachrichtigungen sind blockiert – Erinnerungen erscheinen nur in der App. Android: Website-/App-Einstellungen → Benachrichtigungen.</div>' : ''}
      ${list.length ? `<ul class="list">${list.map(r => `
        <li class="item clickable" data-action="reminder-edit" data-id="${esc(r.id)}">
          <span class="ico-bubble">${icon('clock', 'icon-sm')}</span>
          <div class="item-main">
            <div class="item-title">${esc(r.title)}</div>
            <div class="item-sub">${esc(relativeDay(r.at))}${r.repeat && r.repeat !== 'none' ? ` · ${REPEAT_LABEL[r.repeat]}` : ''}</div>
          </div>
          ${icon('chev-right', 'icon-sm muted')}
        </li>`).join('')}</ul>` : '<p class="empty">Keine anstehenden Erinnerungen.</p>'}
    </section>`;
}

/* =========================================================================
   Ansicht: Essen & Einkauf
   ========================================================================= */

function renderFood() {
  const open = store.all('shopping').filter(i => !i.checked).length;
  const tab = prefs.foodTab;
  return `
    <div class="segmented" role="group" aria-label="Bereich wählen">
      <button data-action="food-tab" data-tab="plan" aria-pressed="${tab === 'plan'}">Wochenplan</button>
      <button data-action="food-tab" data-tab="list" aria-pressed="${tab === 'list'}">Einkaufsliste${open ? ` <span class="count">${open}</span>` : ''}</button>
    </div>
    ${tab === 'plan' ? renderMealPlan() : renderShoppingList()}`;
}

function renderMealPlan() {
  const meals = store.all('meals');
  const today = weekdayIndex(new Date());
  const ingCount = meals.reduce((n, m) => n + (m.ingredients?.length || 0), 0);

  const mealRow = m => `
    <div class="meal">
      <div class="meal-main clickable" data-action="meal-edit" data-id="${esc(m.id)}">
        <div class="slot">${esc(m.slot)}</div>
        <div class="meal-title">${esc(m.title)}</div>
        ${m.ingredients?.length ? `<div class="ingredients">${esc(m.ingredients.map(i => i.name).join(', '))}</div>` : ''}
      </div>
      ${m.ingredients?.length ? `<button class="btn btn-soft btn-sm" data-action="meal-to-list" data-id="${esc(m.id)}"
        aria-label="Zutaten von ${esc(m.title)} auf die Einkaufsliste">${icon('cart', 'icon-sm')} ${m.ingredients.length}</button>` : ''}
    </div>`;

  return `
    <section class="card row">
      <div class="item-main"><b>Ganze Woche einkaufen</b>
        <div class="item-sub">${meals.length} Mahlzeiten · ${ingCount} Zutaten</div></div>
      <button class="btn btn-accent" data-action="week-to-list" ${ingCount ? '' : 'disabled'}>${icon('cart', 'icon-sm')} Auf die Liste</button>
    </section>
    ${DAYS.map((name, i) => {
      const dayMeals = meals.filter(m => m.day === i).sort(bySlot);
      return `
        <section class="card day-card ${i === today ? 'today' : ''}">
          <div class="card-head"><h3>${name}</h3>${i === today ? '<span class="chip chip-primary">Heute</span>' : ''}
            <span class="spacer"></span>
            <button class="icon-btn" data-action="meal-add" data-day="${i}" aria-label="Mahlzeit für ${name} hinzufügen">${icon('plus')}</button></div>
          ${dayMeals.length ? dayMeals.map(mealRow).join('') : '<p class="empty small left">Noch nichts geplant</p>'}
        </section>`;
    }).join('')}`;
}

function renderShoppingList() {
  const items = store.all('shopping');
  const open = items.filter(i => !i.checked);
  const done = items.filter(i => i.checked);
  const catOf = i => (CATEGORIES.includes(i.category) ? i.category : 'Sonstiges');
  const groups = CATEGORIES.map(c => [c, open.filter(i => catOf(i) === c)]).filter(([, l]) => l.length);

  const row = i => `
    <li class="item ${i.checked ? 'done' : ''}">
      <label class="check-wrap"><input type="checkbox" class="check" data-change="shop-toggle" data-id="${esc(i.id)}"
        ${i.checked ? 'checked' : ''} aria-label="${esc(i.name)} abhaken"></label>
      <div class="item-main clickable" data-action="shop-edit" data-id="${esc(i.id)}">
        <div class="item-title">${esc(i.name)}</div>
        ${i.qty || i.source?.title ? `<div class="item-sub">${esc([i.qty, i.source?.title && `für ${i.source.title}`].filter(Boolean).join(' · '))}</div>` : ''}
      </div>
    </li>`;

  return `
    <section class="card">
      <form class="quick-add" data-form="shop-add">
        <input id="shopInput" name="text" placeholder="z. B. 2 l Milch" aria-label="Artikel hinzufügen" required enterkeyhint="done" autocomplete="off">
        <button class="btn btn-primary" aria-label="Hinzufügen">${icon('plus')}</button>
      </form>
    </section>
    ${groups.length ? groups.map(([cat, list]) => `
      <section class="card">
        <div class="card-head"><h3>${esc(cat)}</h3><span class="spacer"></span><span class="chip">${list.length}</span></div>
        <ul class="list">${list.map(row).join('')}</ul>
      </section>`).join('') : '<section class="card empty-state">Alles erledigt – die Liste ist leer.</section>'}
    ${done.length ? `
      <section class="card">
        <div class="card-head"><h3>Im Wagen (${done.length})</h3><span class="spacer"></span>
          <button class="btn btn-ghost btn-sm" data-action="shop-clear-done">${icon('trash', 'icon-sm')} Entfernen</button></div>
        <ul class="list">${done.map(row).join('')}</ul>
      </section>` : ''}`;
}

function addMealsToList(meals) {
  const open = new Set(store.all('shopping').filter(i => !i.checked).map(i => norm(i.name)));
  const toAdd = [];
  let skipped = 0;
  for (const meal of meals) {
    for (const ing of meal?.ingredients || []) {
      const key = norm(ing.name);
      if (!key) continue;
      if (open.has(key)) { skipped++; continue; }
      open.add(key);
      toAdd.push({
        name: ing.name, qty: ing.qty || '', checked: false,
        category: ing.category || guessCategory(ing.name),
        source: { type: 'meal', id: meal.id, title: meal.title },
      });
    }
  }
  const added = store.saveMany('shopping', toAdd);
  const msg = added.length
    ? `${added.length} Zutat${added.length === 1 ? '' : 'en'} hinzugefügt${skipped ? ` · ${skipped} schon auf der Liste` : ''}`
    : 'Alle Zutaten stehen schon auf der Liste';
  toast(msg, added.length ? { action: 'Rückgängig', onAction: () => store.removeMany('shopping', added.map(i => i.id)) } : {});
}

/* =========================================================================
   Ansicht: Kalender
   ========================================================================= */

async function ensureCalendar(force = false) {
  const base = state.view === 'kalender' ? state.calDate : new Date();
  const from = startOfWeek(base);
  const req = (ensureCalendar.req = (ensureCalendar.req || 0) + 1);
  const res = await getEvents(from, addDays(from, 7), { force });
  if (req !== ensureCalendar.req) return;
  state.cal = { ...res, loading: false };
  if (state.view === 'kalender' || state.view === 'home') refresh();
}

function eventsBetween(from, to) {
  return (state.cal.events || [])
    .filter(e => {
      const s = toDate(e.start);
      const en = toDate(e.end || e.start);
      return s < to && (en > from || s >= from);
    })
    .sort((a, b) => (!!b.allDay - !!a.allDay) || toDate(a.start) - toDate(b.start));
}

function eventRow(e) {
  return `
    <div class="event ${e.allDay ? 'allday' : ''}">
      <div class="time">${e.allDay ? 'Ganztags' : `${fmtTime(e.start)}<br><span>${fmtTime(e.end || e.start)}</span>`}</div>
      <div class="item-main">
        <div class="event-title">${esc(e.title)}</div>
        ${e.location ? `<div class="item-sub">${icon('pin', 'icon-xs')} ${esc(e.location)}</div>` : ''}
      </div>
    </div>`;
}

function renderCalendar() {
  const mode = prefs.calMode;
  const d = state.calDate;
  const from = mode === 'week' ? startOfWeek(d) : startOfDay(d);
  const days = mode === 'week' ? 7 : 1;
  const label = mode === 'week'
    ? `${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(addDays(from, 6), { day: 'numeric', month: 'short', year: 'numeric' })}`
    : fmtDayLong(d);
  const sourceLabel = { demo: 'Demo-Daten', google: 'Google Kalender', ical: 'iCal-Feed', none: 'Keine Quelle' }[state.cal.source] || 'Lädt …';

  const dayBlock = date => {
    const evs = eventsBetween(date, addDays(date, 1));
    const today = sameDay(date, new Date());
    return `
      <section class="card day-block ${today ? 'today' : ''}">
        <button class="day-head" data-action="cal-day" data-date="${date.toISOString()}" ${mode === 'day' ? 'disabled' : ''}>
          <span class="num">${date.getDate()}</span><span class="dname">${DAYS[weekdayIndex(date)]}</span>
          ${today ? '<span class="chip chip-primary">Heute</span>' : ''}
        </button>
        ${evs.length ? evs.map(eventRow).join('') : '<p class="empty small left">Keine Termine</p>'}
      </section>`;
  };

  return `
    <div class="segmented" role="group" aria-label="Ansicht">
      <button data-action="cal-mode" data-mode="day" aria-pressed="${mode === 'day'}">Tag</button>
      <button data-action="cal-mode" data-mode="week" aria-pressed="${mode === 'week'}">Woche</button>
    </div>
    <section class="card cal-toolbar">
      <button class="icon-btn" data-action="cal-prev" aria-label="Zurück">${icon('chev-left')}</button>
      <div class="cal-label"><div>${esc(label)}</div><div class="small muted">KW ${isoWeek(from)}</div></div>
      <button class="icon-btn" data-action="cal-next" aria-label="Weiter">${icon('chev-right')}</button>
    </section>
    <div class="row cal-meta">
      <span class="chip">${icon('calendar', 'icon-xs')} ${esc(sourceLabel)}</span>
      ${state.cal.stale ? '<span class="chip chip-warn">Offline-Stand</span>' : ''}
      <span class="spacer"></span>
      <button class="btn btn-ghost btn-sm" data-action="cal-today">Heute</button>
      <button class="icon-btn" data-action="cal-refresh" aria-label="Aktualisieren">${icon('refresh', 'icon-sm')}</button>
    </div>
    ${state.cal.error ? `<div class="banner warn small">${esc(state.cal.error)}</div>` : ''}
    ${Array.from({ length: days }, (_, i) => dayBlock(addDays(from, i))).join('')}
    <p class="small muted center">Termine werden in Google Kalender gepflegt – hier nur Lesezugriff.</p>`;
}

/* =========================================================================
   Ansicht: Themen-Board
   ========================================================================= */

function renderTopics() {
  const f = prefs.topicFilter;
  const all = store.all('topics');
  const openCount = all.filter(t => !t.done).length;
  const list = all
    .filter(t => f === 'all' || (f === 'open' ? !t.done : t.done))
    .sort((a, b) => (a.done - b.done) || String(b.createdAt).localeCompare(String(a.createdAt)));
  const todayStr = new Date().toISOString().slice(0, 10);

  const card = t => `
    <article class="card topic ${t.done ? 'done' : ''}">
      <div class="topic-top">
        <label class="check-wrap"><input type="checkbox" class="check" data-change="topic-toggle" data-id="${esc(t.id)}"
          ${t.done ? 'checked' : ''} aria-label="Als besprochen markieren"></label>
        <div class="item-main clickable" data-action="topic-edit" data-id="${esc(t.id)}">
          <div class="topic-title">${esc(t.title)}</div>
          ${t.description ? `<p class="topic-desc">${esc(t.description)}</p>` : ''}
        </div>
      </div>
      <div class="topic-meta">
        ${t.owner ? `<span class="chip">${icon('user', 'icon-xs')} ${esc(t.owner)}</span>` : ''}
        ${t.dueDate ? `<span class="chip ${!t.done && t.dueDate < todayStr ? 'chip-accent' : ''}">${icon('calendar', 'icon-xs')} ${esc(fmtDate(t.dueDate))}</span>` : ''}
        <span class="chip" title="Synchronisation mit Google Tasks / Keep ist vorbereitet (Feld sync)">
          ${icon('link', 'icon-xs')} ${t.sync?.provider ? esc(t.sync.provider) : 'Tasks-Sync aus'}</span>
      </div>
      <details class="comments">
        <summary>${icon('message', 'icon-sm')} Kommentare (${t.comments?.length || 0}) <span class="chip chip-soon">bald</span></summary>
        <div class="comment-placeholder">
          <p class="small muted">Die Kommentarfunktion folgt in einer späteren Version – das Datenmodell (<code>comments[]</code>) ist bereits vorbereitet.</p>
          <div class="quick-add"><input disabled placeholder="Kommentar schreiben …" aria-label="Kommentar (bald verfügbar)">
            <button class="btn btn-soft" disabled>Senden</button></div>
        </div>
      </details>
    </article>`;

  return `
    <div class="segmented" role="group" aria-label="Filter">
      <button data-action="topic-filter" data-filter="open" aria-pressed="${f === 'open'}">Offen (${openCount})</button>
      <button data-action="topic-filter" data-filter="done" aria-pressed="${f === 'done'}">Besprochen (${all.length - openCount})</button>
      <button data-action="topic-filter" data-filter="all" aria-pressed="${f === 'all'}">Alle</button>
    </div>
    ${list.length ? list.map(card).join('') : '<section class="card empty-state">Keine Themen in dieser Ansicht.</section>'}
    <div class="fab-space"></div>
    <button class="fab" data-action="topic-add" aria-label="Neues Thema">${icon('plus')}</button>`;
}

/* =========================================================================
   Ansicht: Familie (Info-Widget + Urlaubs-/Event-Hub)
   ========================================================================= */

function renderFamily() {
  const tab = prefs.familyTab;
  return `
    <div class="segmented" role="group" aria-label="Bereich wählen">
      <button data-action="family-tab" data-tab="info" aria-pressed="${tab === 'info'}">Kind & Alltag</button>
      <button data-action="family-tab" data-tab="trips" aria-pressed="${tab === 'trips'}">Urlaub & Events</button>
    </div>
    ${tab === 'info' ? renderInfo() : renderTrips()}`;
}

function renderInfo() {
  const sizes = store.all('sizes');
  const persons = [...new Set(sizes.map(s => s.person || 'Kind'))];
  const contacts = store.all('contacts');
  const checklists = store.all('checklists');

  const sizeCards = (persons.length ? persons : ['Kind']).map(p => {
    const list = sizes.filter(s => (s.person || 'Kind') === p);
    const updated = list.map(s => s.updatedAt).sort().pop();
    return `
      <section class="card">
        <div class="card-head"><span class="avatar">${esc(p.slice(0, 1))}</span>
          <div class="item-main"><h2>${esc(p)}</h2><div class="small muted">Aktuelle Größen</div></div>
          <button class="icon-btn" data-action="size-add" data-person="${esc(p)}" aria-label="Größe hinzufügen">${icon('plus')}</button></div>
        ${list.length ? `<div class="size-grid">${list.map(s => `
          <button class="size-tile" data-action="size-edit" data-id="${esc(s.id)}">
            <span class="label">${esc(s.label)}</span><span class="value">${esc(s.value)}</span>
            ${s.note ? `<span class="note">${esc(s.note)}</span>` : ''}
          </button>`).join('')}</div>` : '<p class="empty">Noch keine Größen erfasst.</p>'}
        ${updated ? `<p class="small muted foot-note">Zuletzt aktualisiert: ${esc(fmtDate(updated))}</p>` : ''}
      </section>`;
  }).join('');

  const contactCard = `
    <section class="card">
      <div class="card-head">${icon('phone')}<h2>Wichtige Kontakte</h2><span class="spacer"></span>
        <button class="icon-btn" data-action="contact-add" aria-label="Kontakt hinzufügen">${icon('plus')}</button></div>
      <ul class="list">${contacts.map(c => `
        <li class="item">
          <span class="avatar soft">${esc(initials(c.name))}</span>
          <div class="item-main clickable" data-action="contact-edit" data-id="${esc(c.id)}">
            <div class="item-title">${esc(c.name)}</div>
            <div class="item-sub">${esc([c.role, c.phone].filter(Boolean).join(' · '))}</div>
            ${c.note ? `<div class="item-sub">${esc(c.note)}</div>` : ''}
          </div>
          ${c.address ? `<a class="icon-btn" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}" target="_blank" rel="noopener" aria-label="Adresse in Karten öffnen">${icon('pin', 'icon-sm')}</a>` : ''}
          ${c.phone ? `<a class="icon-btn call" href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}" aria-label="${esc(c.name)} anrufen">${icon('phone', 'icon-sm')}</a>` : ''}
        </li>`).join('')}</ul>
      ${contacts.length ? '' : '<p class="empty">Noch keine Kontakte.</p>'}
    </section>`;

  const checklistCards = checklists.map(cl => {
    const total = cl.items?.length || 0;
    const done = cl.items?.filter(i => i.done).length || 0;
    return `
      <details class="card checklist" id="checklist-${esc(cl.id)}" data-checklist="${esc(cl.id)}" ${state.openLists.has(cl.id) ? 'open' : ''}>
        <summary class="card-head">
          <span class="list-ico">${icon('checklist')}</span>
          <div class="item-main"><h3>${esc(cl.title)}</h3><div class="small muted">${done}/${total} erledigt</div></div>
          ${icon('chev-right', 'icon-sm chev')}
        </summary>
        <div class="progress" role="progressbar" aria-valuenow="${done}" aria-valuemax="${total}"><i style="width:${total ? (done / total) * 100 : 0}%"></i></div>
        <ul class="list">${(cl.items || []).map(it => `
          <li class="item compact ${it.done ? 'done' : ''}">
            <label class="check-row"><input type="checkbox" class="check" data-change="checklist-toggle" data-id="${esc(cl.id)}" data-item="${esc(it.id)}" ${it.done ? 'checked' : ''}>
              <span class="item-title">${esc(it.text)}</span></label>
          </li>`).join('')}</ul>
        <form class="quick-add" data-form="checklist-item-add" data-id="${esc(cl.id)}">
          <input name="text" placeholder="Punkt hinzufügen …" aria-label="Punkt hinzufügen" required autocomplete="off">
          <button class="btn btn-soft" aria-label="Hinzufügen">${icon('plus')}</button>
        </form>
        <div class="row checklist-actions">
          <button class="btn btn-ghost btn-sm" data-action="checklist-reset" data-id="${esc(cl.id)}">${icon('refresh', 'icon-sm')} Alle Haken entfernen</button>
          <span class="spacer"></span>
          <button class="btn btn-ghost btn-sm" data-action="checklist-edit" data-id="${esc(cl.id)}">${icon('edit', 'icon-sm')} Bearbeiten</button>
        </div>
      </details>`;
  }).join('');

  return `
    <h2 class="section-title">Kind & Größen</h2>
    ${sizeCards}
    <h2 class="section-title">Kontakte</h2>
    ${contactCard}
    <h2 class="section-title">Checklisten <button class="btn btn-ghost btn-sm" data-action="checklist-add">${icon('plus', 'icon-sm')} Neu</button></h2>
    ${checklistCards || '<section class="card empty-state">Noch keine Checklisten.</section>'}`;
}

function nextTrip() {
  const now = Date.now();
  return store.all('trips')
    .filter(t => toDate(t.end || t.start).getTime() >= now)
    .sort((a, b) => toDate(a.start) - toDate(b.start))[0];
}

function countdownInner(start, end) {
  const diff = toDate(start) - Date.now();
  if (diff <= 0) {
    return Date.now() < toDate(end || start)
      ? '<p class="countdown-done">Läuft gerade – viel Spaß!</p>'
      : '<p class="countdown-done">Vorbei – hoffentlich war es schön.</p>';
  }
  const s = Math.floor(diff / 1000);
  const parts = [[Math.floor(s / 86400), 'Tage'], [Math.floor((s % 86400) / 3600), 'Std'], [Math.floor((s % 3600) / 60), 'Min'], [s % 60, 'Sek']];
  return parts.map(([v, l], i) => `<div><b>${i ? String(v).padStart(2, '0') : v}</b><span>${l}</span></div>`).join('');
}

const countdownHtml = t =>
  `<div class="countdown" data-countdown="${esc(t.start)}" data-end="${esc(t.end || '')}" aria-label="Countdown">${countdownInner(t.start, t.end)}</div>`;

function tickCountdowns() {
  $$('[data-countdown]').forEach(el => { el.innerHTML = countdownInner(el.dataset.countdown, el.dataset.end); });
}

function renderTrips() {
  const now = Date.now();
  const trips = store.all('trips').sort((a, b) => toDate(a.start) - toDate(b.start));
  const upcoming = trips.filter(t => toDate(t.end || t.start).getTime() >= now);
  const past = trips.filter(t => toDate(t.end || t.start).getTime() < now).reverse();

  const LINK_META = {
    drive: { icon: 'folder', sub: 'Google Drive' },
    photos: { icon: 'image', sub: 'Google Fotos' },
    other: { icon: 'link', sub: 'Link' },
  };

  const card = t => {
    const nights = Math.max(0, Math.round((startOfDay(t.end || t.start) - startOfDay(t.start)) / 864e5));
    const cl = t.checklistId && store.get('checklists', t.checklistId);
    const clDone = cl ? cl.items.filter(i => i.done).length : 0;
    return `
      <article class="card trip">
        <div class="trip-hero theme-${esc(t.theme || 'beach')}">
          <div class="row">${dateBadge(t.start)}<span class="spacer"></span>
            <button class="icon-btn on-dark" data-action="trip-edit" data-id="${esc(t.id)}" aria-label="Bearbeiten">${icon('edit', 'icon-sm')}</button></div>
          <h3>${esc(t.title)}</h3>
          ${t.destination ? `<p class="trip-dest">${icon('pin', 'icon-xs')} ${esc(t.destination)}</p>` : ''}
          <p class="trip-dates">${esc(fmtDate(t.start))}${t.end && !sameDay(t.start, t.end) ? ` – ${esc(fmtDate(t.end))} · ${nights} Nächte` : ` · ${esc(fmtTime(t.start))} Uhr`}</p>
          ${countdownHtml(t)}
        </div>
        <div class="trip-body">
          ${t.links?.length ? `<div class="link-grid">${t.links.map(l => {
            const meta = LINK_META[l.type] || LINK_META.other;
            return `<a class="link-tile ${esc(l.type || 'other')}" href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">
              <span class="ico">${icon(meta.icon)}</span><span><b>${esc(l.label)}</b><small>${meta.sub}</small></span></a>`;
          }).join('')}</div>` : ''}
          ${t.details?.length ? `<dl class="kv">${t.details.map(d => `<dt>${esc(d.label)}</dt><dd>${esc(d.value)}</dd>`).join('')}</dl>` : ''}
          ${cl ? `<button class="btn btn-soft btn-block" data-action="open-checklist" data-id="${esc(cl.id)}">${icon('checklist', 'icon-sm')} ${esc(cl.title)} · ${clDone}/${cl.items.length}</button>` : ''}
          ${t.notes ? `<p class="small muted">${esc(t.notes)}</p>` : ''}
        </div>
      </article>`;
  };

  return `
    ${upcoming.map(card).join('') || '<section class="card empty-state">Keine anstehenden Reisen oder Events.</section>'}
    <button class="btn btn-soft btn-block" data-action="trip-add">${icon('plus', 'icon-sm')} Reise / Event hinzufügen</button>
    ${past.length ? `<h2 class="section-title">Vergangen</h2>${past.map(card).join('')}` : ''}`;
}

/* =========================================================================
   Formulare
   ========================================================================= */

function editShopItem(id) {
  const it = store.get('shopping', id) || {};
  openForm({
    title: id ? 'Artikel bearbeiten' : 'Neuer Artikel',
    fields: [
      { name: 'name', label: 'Artikel', value: it.name, required: true },
      { name: 'qty', label: 'Menge', value: it.qty, placeholder: 'z. B. 500 g', half: true },
      { name: 'category', label: 'Kategorie', type: 'select', value: it.category || 'Sonstiges', options: CATEGORIES, half: true },
    ],
    onSubmit: v => { store.save('shopping', { id, ...v, checked: it.checked ?? false }); },
    onDelete: id ? () => store.remove('shopping', id) : null,
  });
}

function editMeal(id, day = weekdayIndex(new Date())) {
  const m = store.get('meals', id) || { day, slot: 'Abend', ingredients: [] };
  openForm({
    title: id ? 'Mahlzeit bearbeiten' : `Mahlzeit für ${DAYS[day]}`,
    fields: [
      { name: 'title', label: 'Gericht', value: m.title, required: true, placeholder: 'z. B. Gemüselasagne', autofocus: !id },
      { name: 'day', label: 'Tag', type: 'select', value: m.day, half: true, options: DAYS.map((label, value) => ({ value, label })) },
      { name: 'slot', label: 'Mahlzeit', type: 'select', value: m.slot, half: true, options: SLOTS },
      {
        name: 'ingredients', label: 'Zutaten (eine pro Zeile)', type: 'textarea', rows: 6,
        value: (m.ingredients || []).map(formatIngredient).join('\n'),
        placeholder: '500 g Spaghetti\n1 Dose Tomaten\nParmesan',
        hint: 'Menge vorne ist optional – sie wird automatisch erkannt.',
      },
      { name: 'notes', label: 'Notiz / Rezept-Link', value: m.notes },
    ],
    onSubmit: v => {
      const prev = new Map((m.ingredients || []).map(i => [norm(i.name), i]));
      const ingredients = v.ingredients.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
        const p = parseIngredient(line);
        return { ...p, category: prev.get(norm(p.name))?.category || guessCategory(p.name) };
      });
      store.save('meals', { id, title: v.title, day: Number(v.day), slot: v.slot, ingredients, notes: v.notes });
    },
    onDelete: id ? () => store.remove('meals', id) : null,
  });
}

function editTopic(id) {
  const t = store.get('topics', id) || {};
  openForm({
    title: id ? 'Thema bearbeiten' : 'Neues Thema',
    fields: [
      { name: 'title', label: 'Titel', value: t.title, required: true, autofocus: !id, placeholder: 'Worüber wollen wir sprechen?' },
      { name: 'description', label: 'Beschreibung', type: 'textarea', rows: 4, value: t.description },
      { name: 'owner', label: 'Wer bringt es ein?', value: t.owner, half: true, placeholder: 'z. B. Mama' },
      { name: 'dueDate', label: 'Bis wann?', type: 'date', value: t.dueDate, half: true },
    ],
    onSubmit: v => {
      store.save('topics', {
        id, ...v,
        done: t.done ?? false,
        comments: t.comments ?? [],
        sync: t.sync ?? { provider: null, externalId: null, etag: null, lastSyncedAt: null },
      });
    },
    onDelete: id ? () => store.remove('topics', id) : null,
  });
}

function editReminder(id) {
  const r = store.get('reminders', id) || { at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), repeat: 'none' };
  openForm({
    title: id ? 'Erinnerung bearbeiten' : 'Neue Erinnerung',
    fields: [
      { name: 'title', label: 'Woran erinnern?', value: r.title, required: true, autofocus: !id, placeholder: 'z. B. Turnbeutel einpacken' },
      { name: 'at', label: 'Wann?', type: 'datetime-local', value: toInputDateTime(r.at), required: true },
      { name: 'repeat', label: 'Wiederholen', type: 'select', value: r.repeat || 'none', options: Object.entries(REPEAT_LABEL).map(([value, label]) => ({ value, label })) },
      { name: 'note', label: 'Notiz', value: r.note },
    ],
    onSubmit: v => {
      store.save('reminders', { id, title: v.title, at: new Date(v.at).toISOString(), repeat: v.repeat, note: v.note, done: false });
      if (notifier.permission === 'default') notifier.request().then(render);
      toast('Erinnerung gespeichert');
    },
    onDelete: id ? () => store.remove('reminders', id) : null,
  });
}

function editSize(id, person) {
  const s = store.get('sizes', id) || { person: person || 'Kind' };
  openForm({
    title: id ? 'Größe bearbeiten' : 'Größe hinzufügen',
    fields: [
      { name: 'person', label: 'Person', value: s.person, required: true, half: true },
      { name: 'label', label: 'Was?', value: s.label, required: true, half: true, placeholder: 'z. B. Schuhgröße' },
      { name: 'value', label: 'Wert', value: s.value, required: true, placeholder: 'z. B. 29' },
      { name: 'note', label: 'Notiz', value: s.note, placeholder: 'z. B. Marke fällt klein aus' },
    ],
    onSubmit: v => { store.save('sizes', { id, ...v }); },
    onDelete: id ? () => store.remove('sizes', id) : null,
  });
}

function editContact(id) {
  const c = store.get('contacts', id) || {};
  openForm({
    title: id ? 'Kontakt bearbeiten' : 'Neuer Kontakt',
    fields: [
      { name: 'name', label: 'Name', value: c.name, required: true },
      { name: 'role', label: 'Rolle', value: c.role, placeholder: 'z. B. Kinderarzt' },
      { name: 'phone', label: 'Telefon', type: 'tel', value: c.phone, half: true },
      { name: 'email', label: 'E-Mail', type: 'email', value: c.email, half: true },
      { name: 'address', label: 'Adresse', value: c.address },
      { name: 'note', label: 'Notiz', type: 'textarea', rows: 2, value: c.note },
    ],
    onSubmit: v => { store.save('contacts', { id, ...v }); },
    onDelete: id ? () => store.remove('contacts', id) : null,
  });
}

function editChecklist(id) {
  const cl = store.get('checklists', id) || { items: [] };
  openForm({
    title: id ? 'Checkliste bearbeiten' : 'Neue Checkliste',
    fields: [
      { name: 'title', label: 'Titel', value: cl.title, required: true, placeholder: 'z. B. Packliste Skiferien' },
      { name: 'items', label: 'Punkte (einer pro Zeile)', type: 'textarea', rows: 8, value: cl.items.map(i => i.text).join('\n') },
    ],
    onSubmit: v => {
      const prev = new Map(cl.items.map(i => [norm(i.text), i]));
      const items = v.items.split('\n').map(l => l.trim()).filter(Boolean)
        .map(text => prev.get(norm(text)) || { id: uid(), text, done: false });
      const saved = store.save('checklists', { id, title: v.title, items });
      state.openLists.add(saved.id);
    },
    onDelete: id ? () => store.remove('checklists', id) : null,
  });
}

function editTrip(id) {
  const t = store.get('trips', id) || { links: [], details: [], theme: 'beach' };
  const link = type => t.links?.find(l => l.type === type)?.url || '';
  const others = (t.links || []).filter(l => !['drive', 'photos'].includes(l.type));
  openForm({
    title: id ? 'Reise / Event bearbeiten' : 'Neue Reise / Event',
    fields: [
      { name: 'title', label: 'Titel', value: t.title, required: true, placeholder: 'z. B. Herbstferien Tessin' },
      { name: 'theme', label: 'Farbe', type: 'select', value: t.theme, options: [{ value: 'beach', label: 'Blau' }, { value: 'party', label: 'Orange' }, { value: 'mountain', label: 'Dunkelblau' }] },
      { name: 'destination', label: 'Ziel / Ort', value: t.destination },
      { name: 'start', label: 'Start', type: 'datetime-local', value: t.start ? toInputDateTime(t.start) : '', required: true },
      { name: 'end', label: 'Ende', type: 'datetime-local', value: t.end ? toInputDateTime(t.end) : '' },
      { name: 'drive', label: 'Google-Drive-Ordner (Tickets/Dokumente)', type: 'url', value: link('drive'), placeholder: 'https://drive.google.com/drive/folders/…' },
      { name: 'photos', label: 'Geteiltes Google-Fotos-Album', type: 'url', value: link('photos'), placeholder: 'https://photos.app.goo.gl/…' },
      { name: 'otherLinks', label: 'Weitere Links (Titel | URL, je Zeile)', type: 'textarea', rows: 2, value: others.map(l => `${l.label} | ${l.url}`).join('\n') },
      { name: 'details', label: 'Details (Bezeichnung: Wert, je Zeile)', type: 'textarea', rows: 4, value: (t.details || []).map(d => `${d.label}: ${d.value}`).join('\n'), placeholder: 'Hinflug: Sa 06:45 ZRH → LPA' },
      { name: 'checklistId', label: 'Verknüpfte Checkliste', type: 'select', value: t.checklistId || '', options: [{ value: '', label: '— keine —' }, ...store.all('checklists').map(c => ({ value: c.id, label: c.title }))] },
      { name: 'notes', label: 'Notizen', type: 'textarea', rows: 2, value: t.notes },
    ],
    onSubmit: v => {
      const links = [
        v.drive && { type: 'drive', label: link('drive') ? t.links.find(l => l.type === 'drive').label : 'Tickets & Dokumente', url: v.drive },
        v.photos && { type: 'photos', label: link('photos') ? t.links.find(l => l.type === 'photos').label : 'Fotoalbum', url: v.photos },
        ...v.otherLinks.split('\n').map(l => l.split('|').map(s => s.trim())).filter(([, url]) => url).map(([label, url]) => ({ type: 'other', label: label || 'Link', url })),
      ].filter(Boolean);
      const details = v.details.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const i = l.indexOf(':');
        return i > 0 ? { label: l.slice(0, i).trim(), value: l.slice(i + 1).trim() } : { label: 'Info', value: l };
      });
      store.save('trips', {
        id, title: v.title, theme: v.theme, destination: v.destination,
        start: v.start, end: v.end || v.start, links, details, checklistId: v.checklistId || null, notes: v.notes,
      });
    },
    onDelete: id ? () => store.remove('trips', id) : null,
  });
}

function openSettings() {
  const s = getSettings();
  const perm = notifier.permission;
  const permLabel = { granted: 'erlaubt', denied: 'blockiert', default: 'noch nicht gefragt', unsupported: 'nicht unterstützt' }[perm];
  openSheet({
    title: 'Einstellungen',
    body: `
      <h3 class="sheet-section">Google Sheets (Apps Script)</h3>
      ${field({ name: 'apiUrl', label: 'Web-App-URL', type: 'url', value: s.apiUrl, placeholder: 'https://script.google.com/macros/s/…/exec', hint: 'Leer = Demo-/Offline-Modus, Daten nur auf diesem Gerät. Script mit einem privaten Familienkonto bereitstellen.' })}
      ${field({ name: 'apiToken', label: 'Familien-Token', value: s.apiToken, hint: 'Muss der Script-Property API_TOKEN entsprechen.' })}
      <div class="row wrap"><button type="button" class="btn btn-soft btn-sm" data-action="settings-test">Verbindung testen</button>
        <span class="small muted" id="settingsStatus">${store.lastSync ? `Letzter Sync: ${esc(relativeDay(store.lastSync))}` : 'Noch nie synchronisiert'}</span></div>

      <h3 class="sheet-section">Kalender</h3>
      ${field({ name: 'icalUrl', label: 'iCal-URL (optional, direkt)', type: 'url', value: s.icalUrl, placeholder: 'https://…/basic.ics', hint: 'Nur für Feeds mit CORS-Freigabe. Google-Kalender am besten über Apps Script einbinden (CALENDAR_ID).' })}

      <h3 class="sheet-section">Benachrichtigungen</h3>
      <div class="row wrap"><span class="small">Status: <b>${permLabel}</b></span><span class="spacer"></span>
        ${perm === 'default' ? '<button type="button" class="btn btn-soft btn-sm" data-action="notify-enable">Erlauben</button>' : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-action="notify-test">Test senden</button></div>

      <h3 class="sheet-section">Daten</h3>
      <div class="row wrap">
        <button type="button" class="btn btn-soft btn-sm" data-action="data-demo">Demo-Daten laden</button>
        <button type="button" class="btn btn-danger btn-sm" data-action="data-reset">Lokale Daten zurücksetzen</button></div>
      <p class="small muted">${esc(CONFIG.APP_NAME)} v${CONFIG.VERSION} · offline-fähig · ${store.outbox.length} ungesendete Änderung(en)</p>`,
    footer: `<span class="spacer"></span>
      <button type="button" class="btn btn-ghost" data-close>Abbrechen</button>
      <button type="submit" class="btn btn-primary">Speichern</button>`,
    onMount(form, dlg) {
      form.addEventListener('submit', e => {
        e.preventDefault();
        if (!form.reportValidity()) return;
        saveSettings({ apiUrl: form.apiUrl.value.trim(), apiToken: form.apiToken.value.trim(), icalUrl: form.icalUrl.value.trim() });
        clearCalendarCache();
        dlg.close();
        store.setStatus(api.isConfigured() ? 'idle' : 'local');
        store.sync();
        ensureCalendar(true);
        toast('Einstellungen gespeichert');
      });
    },
  });
}

/* =========================================================================
   Event-Delegation
   ========================================================================= */

const actions = {
  'food-tab': el => { prefs.foodTab = el.dataset.tab; savePrefs(); if (state.view === 'essen') render(); },
  'family-tab': el => { prefs.familyTab = el.dataset.tab; savePrefs(); if (state.view === 'familie') render(); },

  'meal-add': el => editMeal(null, Number(el.dataset.day)),
  'meal-edit': el => editMeal(el.dataset.id),
  'meal-to-list': el => addMealsToList([store.get('meals', el.dataset.id)]),
  'week-to-list': () => addMealsToList(store.all('meals')),

  'shop-edit': el => editShopItem(el.dataset.id),
  'shop-clear-done': () => {
    const removed = store.removeMany('shopping', store.all('shopping').filter(i => i.checked).map(i => i.id));
    toast(`${removed.length} Artikel entfernt`, { action: 'Rückgängig', onAction: () => store.restore('shopping', removed) });
  },

  'cal-mode': el => { prefs.calMode = el.dataset.mode; savePrefs(); render(); },
  'cal-prev': () => { state.calDate = addDays(state.calDate, prefs.calMode === 'week' ? -7 : -1); render(); ensureCalendar(); },
  'cal-next': () => { state.calDate = addDays(state.calDate, prefs.calMode === 'week' ? 7 : 1); render(); ensureCalendar(); },
  'cal-today': () => { state.calDate = startOfDay(new Date()); render(); ensureCalendar(); },
  'cal-day': el => { state.calDate = startOfDay(el.dataset.date); prefs.calMode = 'day'; savePrefs(); render(); window.scrollTo(0, 0); },
  'cal-refresh': async () => { toast('Kalender wird aktualisiert …', { timeout: 1500 }); await ensureCalendar(true); },

  'topic-add': () => editTopic(null),
  'topic-edit': el => editTopic(el.dataset.id),
  'topic-filter': el => { prefs.topicFilter = el.dataset.filter; savePrefs(); render(); },

  'reminder-add': () => editReminder(null),
  'reminder-edit': el => editReminder(el.dataset.id),
  'notify-enable': async () => {
    const p = await notifier.request();
    toast(p === 'granted' ? 'Benachrichtigungen aktiviert' : 'Benachrichtigungen nicht erlaubt');
    if ($('#formDialog').open) openSettings(); else render();
  },
  'notify-test': async () => {
    const ok = await notifier.show('Test-Erinnerung', { body: 'So sehen eure Erinnerungen aus.', tag: 'test' });
    if (!ok) toast('Benachrichtigungen sind nicht erlaubt');
  },

  'size-add': el => editSize(null, el.dataset.person),
  'size-edit': el => editSize(el.dataset.id),
  'contact-add': () => editContact(null),
  'contact-edit': el => editContact(el.dataset.id),
  'checklist-add': () => editChecklist(null),
  'checklist-edit': el => editChecklist(el.dataset.id),
  'checklist-reset': el => {
    const cl = store.get('checklists', el.dataset.id);
    store.save('checklists', { id: cl.id, items: cl.items.map(i => ({ ...i, done: false })) });
    toast(`„${cl.title}“ zurückgesetzt – bereit für die nächste Runde`);
  },
  'open-checklist': el => {
    prefs.familyTab = 'info';
    savePrefs();
    state.openLists.add(el.dataset.id);
    render();
    document.getElementById(`checklist-${el.dataset.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  'trip-add': () => editTrip(null),
  'trip-edit': (el, e) => { e.preventDefault(); editTrip(el.dataset.id); },

  settings: () => openSettings(),
  'settings-test': async () => {
    const form = $('#formDialog form');
    const out = $('#settingsStatus');
    saveSettings({ apiUrl: form.apiUrl.value.trim(), apiToken: form.apiToken.value.trim() });
    out.textContent = 'Teste …';
    try {
      const r = await api.ping();
      out.textContent = `Verbunden (Serverzeit ${fmtTime(r.time)})`;
    } catch (err) {
      out.textContent = `Fehler: ${err.message}`;
    }
  },
  'data-demo': () => {
    if (!confirm('Demo-Daten laden? Lokale Einträge werden durch Beispieldaten ersetzt (bei verbundenem Sheet zusätzlich hochgeladen).')) return;
    store.seed();
    if (api.isConfigured()) store.queueAll();
    clearCalendarCache();
    ensureCalendar(true);
    $('#formDialog').close();
    toast('Demo-Daten geladen');
  },
  'data-reset': () => {
    if (!confirm('Alle lokal gespeicherten Daten löschen? (Einstellungen bleiben erhalten, Daten im Google Sheet bleiben unberührt.)')) return;
    store.reset();
    clearCalendarCache();
    ensureCalendar(true);
    $('#formDialog').close();
    toast('Lokale Daten zurückgesetzt');
  },
  sync: () => {
    if (!api.isConfigured()) {
      toast('Demo-Modus – Google-Sheet-API in den Einstellungen hinterlegen', { action: 'Öffnen', onAction: openSettings, timeout: 5000 });
      return;
    }
    store.sync();
    ensureCalendar(true);
  },
  install: async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    $('#installBtn').hidden = true;
  },
};

const changeActions = {
  'shop-toggle': el => store.save('shopping', { id: el.dataset.id, checked: el.checked }),
  'topic-toggle': el => {
    const t = store.save('topics', { id: el.dataset.id, done: el.checked, doneAt: el.checked ? new Date().toISOString() : null });
    if (el.checked) toast(`„${t.title}“ als besprochen markiert`, { action: 'Rückgängig', onAction: () => store.save('topics', { id: t.id, done: false, doneAt: null }) });
  },
  'checklist-toggle': el => {
    const cl = store.get('checklists', el.dataset.id);
    state.openLists.add(cl.id);
    store.save('checklists', { id: cl.id, items: cl.items.map(i => (i.id === el.dataset.item ? { ...i, done: el.checked } : i)) });
  },
};

const formActions = {
  'shop-add': form => {
    const text = form.text.value.trim();
    if (!text) return;
    const p = parseIngredient(text);
    store.save('shopping', { name: p.name, qty: p.qty, category: guessCategory(p.name), checked: false });
    state.focus = '#shopInput';
    render();
  },
  'checklist-item-add': form => {
    const text = form.text.value.trim();
    const cl = store.get('checklists', form.dataset.id);
    if (!text || !cl) return;
    state.openLists.add(cl.id);
    store.save('checklists', { id: cl.id, items: [...cl.items, { id: uid(), text, done: false }] });
    state.focus = `[data-form="checklist-item-add"][data-id="${cl.id}"] input`;
    render();
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (el && !el.disabled) actions[el.dataset.action]?.(el, e);
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (el) changeActions[el.dataset.change]?.(el, e);
});
document.addEventListener('submit', e => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  formActions[form.dataset.form]?.(form);
});
// <details> der Checklisten: geöffnet/geschlossen über Re-Renders hinweg merken
document.addEventListener('toggle', e => {
  const id = e.target.dataset?.checklist;
  if (!id) return;
  if (e.target.open) state.openLists.add(id); else state.openLists.delete(id);
}, true);
document.addEventListener('focusout', () => { setTimeout(() => { if (state.dirty) refresh(); }, 0); });
$('#formDialog').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });

/* =========================================================================
   PWA: Service Worker, Installation, Online-Status
   ========================================================================= */

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstall = e;
  $('#installBtn').hidden = false;
});
window.addEventListener('appinstalled', () => {
  $('#installBtn').hidden = true;
  toast('App installiert');
});

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  const promptUpdate = worker => toast('Neue Version verfügbar', {
    action: 'Aktualisieren', timeout: 0, onAction: () => worker.postMessage({ type: 'SKIP_WAITING' }),
  });

  navigator.serviceWorker.register('./service-worker.js').then(reg => {
    if (reg.waiting && hadController) promptUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(w);
      });
    });
    setInterval(() => reg.update(), 60 * 60 * 1000);
  }).catch(err => console.warn('Service Worker konnte nicht registriert werden:', err));

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
}

/* =========================================================================
   Start
   ========================================================================= */

store.init();
store.addEventListener('change', () => refresh());
store.addEventListener('status', renderSync);
window.addEventListener('hashchange', route);
window.addEventListener('online', () => store.sync());
window.addEventListener('offline', () => store.setStatus(api.isConfigured() ? 'offline' : 'local'));
document.addEventListener('visibilitychange', () => { if (!document.hidden) store.sync(); });

route();
renderSync();
startReminderLoop(r => toast(`Erinnerung: ${r.title}`, { timeout: 8000 }));
setInterval(tickCountdowns, 1000);
setInterval(() => { if (!document.hidden) store.sync(); }, CONFIG.SYNC_INTERVAL_MS);
store.sync();
registerServiceWorker();
