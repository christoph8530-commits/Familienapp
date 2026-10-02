/* UI-Hilfsfunktionen: DOM, Escaping, Datum, Toasts, Formular-Sheets */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

/** Nur sichere Link-Schemata zulassen. */
export const safeUrl = url => (/^(https?:|tel:|mailto:)/i.test(String(url || '').trim()) ? url.trim() : '#');

export const icon = (name, cls = '') =>
  `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

/* ---------- Datum ---------- */

export const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

/** "2026-10-15" als lokales Datum lesen (new Date() würde UTC annehmen). */
export const toDate = v =>
  v instanceof Date ? v
    : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00`)
      : new Date(v);

export const weekdayIndex = d => (toDate(d).getDay() + 6) % 7; // 0 = Montag
export const startOfDay = d => { const x = new Date(toDate(d)); x.setHours(0, 0, 0, 0); return x; };
export const addDays = (d, n) => { const x = new Date(toDate(d)); x.setDate(x.getDate() + n); return x; };
export const startOfWeek = d => addDays(startOfDay(d), -weekdayIndex(d));
export const sameDay = (a, b) => toDate(a).toDateString() === toDate(b).toDateString();

export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 864e5 + 1) / 7);
}

export const fmt = (d, opts) => new Intl.DateTimeFormat('de', opts).format(toDate(d));
export const fmtTime = d => fmt(d, { hour: '2-digit', minute: '2-digit' });
export const fmtDate = d => fmt(d, { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtDayLong = d => fmt(d, { weekday: 'long', day: 'numeric', month: 'long' });

export function toInputDateTime(value) {
  const d = toDate(value);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function relativeDay(value) {
  const d = toDate(value);
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 864e5);
  const time = fmtTime(d);
  if (diff === 0) return `Heute, ${time}`;
  if (diff === 1) return `Morgen, ${time}`;
  if (diff === -1) return `Gestern, ${time}`;
  return `${fmt(d, { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

/* ---------- Toasts ---------- */

export function toast(message, { action, onAction, timeout = 3200 } = {}) {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 200); };
  el.querySelector('button')?.addEventListener('click', () => { onAction?.(); close(); });
  host.append(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  if (timeout) setTimeout(close, timeout);
  return close;
}

/* ---------- Formular-Sheets (Bottom Sheet via <dialog>) ---------- */

export function field(f) {
  const id = `f-${f.name}`;
  const attrs = [
    `id="${id}"`, `name="${esc(f.name)}"`,
    f.required ? 'required' : '',
    f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '',
    f.autofocus ? 'autofocus' : '',
    f.inputmode ? `inputmode="${esc(f.inputmode)}"` : '',
    f.disabled ? 'disabled' : '',
  ].filter(Boolean).join(' ');

  if (f.type === 'checkbox') {
    return `<label class="field field-check"><input type="checkbox" class="check" ${attrs} ${f.value ? 'checked' : ''}><span>${esc(f.label)}</span></label>`;
  }

  let control;
  if (f.type === 'textarea') {
    control = `<textarea ${attrs} rows="${f.rows || 3}">${esc(f.value)}</textarea>`;
  } else if (f.type === 'select') {
    const options = f.options.map(o => {
      const opt = typeof o === 'object' ? o : { value: o, label: o };
      const selected = String(opt.value) === String(f.value ?? '') ? 'selected' : '';
      return `<option value="${esc(opt.value)}" ${selected}>${esc(opt.label)}</option>`;
    }).join('');
    control = `<select ${attrs}>${options}</select>`;
  } else {
    control = `<input type="${f.type || 'text'}" ${attrs} value="${esc(f.value)}">`;
  }
  return `<div class="field ${f.half ? 'half' : ''}">
    <label for="${id}">${esc(f.label)}</label>${control}
    ${f.hint ? `<p class="hint">${esc(f.hint)}</p>` : ''}
  </div>`;
}

export function openSheet({ title, body, footer = '', onMount }) {
  const dlg = $('#formDialog');
  dlg.innerHTML = `
    <form class="sheet" novalidate autocomplete="off">
      <header class="sheet-head">
        <h2 tabindex="-1" autofocus>${esc(title)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Schließen">${icon('close')}</button>
      </header>
      <div class="sheet-body">${body}</div>
      ${footer ? `<footer class="sheet-foot">${footer}</footer>` : ''}
    </form>`;
  $$('[data-close]', dlg).forEach(b => b.addEventListener('click', () => dlg.close()));
  if (!dlg.open) dlg.showModal();
  onMount?.(dlg.querySelector('form'), dlg);
  return dlg;
}

/**
 * Generisches Bearbeiten-Formular.
 * fields: [{ name, label, type?, value?, options?, required?, half?, hint?, placeholder? }]
 * onSubmit(values) → false zurückgeben, um das Sheet offen zu lassen.
 */
export function openForm({ title, fields, submitLabel = 'Speichern', onSubmit, onDelete }) {
  return openSheet({
    title,
    body: fields.map(field).join(''),
    footer: `
      ${onDelete ? `<button type="button" class="btn btn-danger" data-delete>${icon('trash', 'icon-sm')} Löschen</button>` : ''}
      <span class="spacer"></span>
      <button type="button" class="btn btn-ghost" data-close>Abbrechen</button>
      <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>`,
    onMount(form, dlg) {
      form.addEventListener('submit', e => {
        e.preventDefault();
        if (!form.reportValidity()) return;
        const values = {};
        for (const f of fields) {
          const el = form.elements[f.name];
          values[f.name] = f.type === 'checkbox' ? el.checked : el.value.trim();
        }
        if (onSubmit(values) !== false) dlg.close();
      });
      form.querySelector('[data-delete]')?.addEventListener('click', () => {
        if (confirm('Wirklich löschen?')) { onDelete(); dlg.close(); }
      });
    },
  });
}
