'use strict';

/* ---------- Daten ---------- */

const STORAGE_KEY = 'schichtplaner-v1';
const COLORS = ['#2563eb', '#f97316', '#16a34a', '#db2777', '#7c3aed', '#0891b2', '#ca8a04', '#dc2626'];
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const ICS_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

function emptyState() {
  return { version: 1, employers: [], shifts: [], plans: [], settings: { reminder: 60 }, lastBackup: null };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return Object.assign(emptyState(), JSON.parse(raw));
  } catch (e) { /* kaputte Daten -> leer starten */ }
  return emptyState();
}

let state = loadState();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Speichern fehlgeschlagen – bitte Sicherung machen!');
  }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- Datums-Helfer (immer lokale Zeit, Format JJJJ-MM-TT) ---------- */

const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const isoWeekday = s => fromISO(s).getDay() || 7; // 1 = Mo … 7 = So
const addDays = (s, n) => { const d = fromISO(s); d.setDate(d.getDate() + n); return toISO(d); };
const todayISO = () => toISO(new Date());
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

function durationMin(start, end) {
  let d = toMin(end) - toMin(start);
  if (d <= 0) d += 24 * 60; // über Mitternacht
  return d;
}

function fmtHours(min) {
  const h = min / 60;
  return (Number.isInteger(h) ? h : h.toFixed(2).replace(/0$/, '')).toString().replace('.', ',') + ' Std.';
}

const fmtMoney = v => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const fmtDayTitle = s => fromISO(s).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShortDate = s => fromISO(s).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric', year: 'numeric' });
const monthName = (y, m) => new Date(y, m, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

/* ---------- Termine eines Tages ---------- */

// Private Termine (z. B. Zahnarzt) brauchen keinen Arbeitgeber und zählen nicht als Arbeitszeit
const PRIVATE = { id: 'private', name: 'Privat', color: '#64748b', private: true };
const isPrivate = o => o.employerId === PRIVATE.id;
const employerById = id => id === PRIVATE.id ? PRIVATE : state.employers.find(e => e.id === id);

// Private Termine dürfen ohne Ende sein – für Kalender-Export gilt dann 1 Stunde
function endTime(o) {
  if (o.end) return o.end;
  const m = (toMin(o.start) + 60) % 1440;
  return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
}
const workMinutes = list => list.filter(o => !isPrivate(o)).reduce((s, o) => s + durationMin(o.start, o.end), 0);

function occurrencesOn(date) {
  const list = [];
  for (const s of state.shifts) {
    if (s.date === date) list.push({ kind: 'shift', ...s });
  }
  const wd = isoWeekday(date);
  for (const p of state.plans) {
    if (!p.weekdays.includes(wd)) continue;
    if (date < p.from || (p.until && date > p.until)) continue;
    if (p.skips && p.skips.includes(date)) continue;
    list.push({ kind: 'plan', id: p.id, employerId: p.employerId, date, start: p.start, end: p.end, note: p.note || '' });
  }
  return list
    .filter(o => employerById(o.employerId))
    .sort((a, b) => a.start.localeCompare(b.start));
}

/* ---------- Kleine UI-Helfer ---------- */

const $ = id => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children) if (c != null) n.append(c);
  return n;
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function closeOnBackdrop(dialog) {
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
}

/* ---------- Ansichten / Tabs ---------- */

let currentView = 'calendar';
const view = { year: new Date().getFullYear(), month: new Date().getMonth(), selected: todayISO() };
const statsMonth = { year: view.year, month: view.month };

function showView(name) {
  currentView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $('title').textContent = { calendar: 'Schichtplaner', stats: 'Stunden', settings: 'Einstellungen' }[name];
  $('fab').hidden = name !== 'calendar';
  render();
}

function render() {
  if (currentView === 'calendar') renderCalendar();
  if (currentView === 'stats') renderStats();
  if (currentView === 'settings') renderSettings();
}

/* ---------- Kalender ---------- */

function renderCalendar() {
  $('month-label').textContent = monthName(view.year, view.month);
  const grid = $('grid');
  grid.replaceChildren();

  const first = new Date(view.year, view.month, 1);
  const offset = (first.getDay() || 7) - 1;
  const start = new Date(view.year, view.month, 1 - offset);
  const today = todayISO();

  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    if (i === 35 && d.getMonth() !== view.month) break; // 6. Zeile nur wenn nötig
    const iso = toISO(d);
    const occ = occurrencesOn(iso);
    const cell = el('button', {
      class: 'cell' + (d.getMonth() !== view.month ? ' other' : '') + (iso === today ? ' today' : '') + (iso === view.selected ? ' selected' : ''),
      'aria-label': fmtDayTitle(iso) + (occ.length ? `, ${occ.length} Termin(e)` : ''),
      onclick: () => {
        view.selected = iso;
        if (d.getMonth() !== view.month) { view.year = d.getFullYear(); view.month = d.getMonth(); }
        renderCalendar();
      },
    }, el('span', { class: 'num' }, String(d.getDate())));
    occ.slice(0, 2).forEach(o => {
      cell.append(el('span', { class: 'pill', style: `background:${employerById(o.employerId).color}` }, o.start.replace(/^0/, '')));
    });
    if (occ.length > 2) cell.append(el('span', { class: 'more' }, `+${occ.length - 2}`));
    grid.append(cell);
  }

  const legend = $('legend');
  const legendItems = state.shifts.some(isPrivate) ? [...state.employers, PRIVATE] : state.employers;
  legend.replaceChildren(...legendItems.map(e =>
    el('span', {}, el('i', { class: 'dot', style: `background:${e.color}` }), e.name)));

  renderDay();
}

function renderDay() {
  const date = view.selected;
  const occ = occurrencesOn(date);
  $('day-title').textContent = date === todayISO() ? 'Heute, ' + fmtDayTitle(date).split(', ')[1] : fmtDayTitle(date);
  const total = workMinutes(occ);
  $('day-sum').textContent = total ? fmtHours(total) : '';

  const list = $('day-list');
  list.replaceChildren();

  if (!state.employers.length && !occ.length) {
    list.append(el('div', { class: 'card' },
      el('h2', {}, 'Willkommen! 👋'),
      el('p', { class: 'hint' }, 'Leg zuerst deine Arbeitgeber an – jeder bekommt eine eigene Farbe.'),
      el('button', { class: 'btn full', onclick: () => openEmployerDialog() }, 'Ersten Arbeitgeber anlegen')));
    return;
  }
  if (!occ.length) {
    list.append(el('div', { class: 'empty' }, 'Frei – tippe auf + um eine Schicht einzutragen.'));
    return;
  }
  for (const o of occ) {
    const emp = employerById(o.employerId);
    list.append(el('button', { class: 'entry', onclick: () => openShiftDialog(o) },
      el('span', { class: 'stripe', style: `background:${emp.color}` }),
      el('span', { class: 'body' },
        el('span', { class: 'who' }, isPrivate(o) ? o.title : emp.name,
          o.kind === 'plan' ? el('span', { class: 'badge' }, 'fest') : null,
          isPrivate(o) ? el('span', { class: 'badge' }, 'privat') : null),
        el('div', { class: 'when' }, isPrivate(o)
          ? (o.end ? `${o.start} – ${o.end} Uhr` : `${o.start} Uhr`)
          : `${o.start} – ${o.end} Uhr · ${fmtHours(durationMin(o.start, o.end))}`),
        o.note ? el('div', { class: 'note' }, o.note) : null)));
  }
}

/* ---------- Schicht-Dialog ---------- */

let editing = null;        // das gerade bearbeitete Vorkommen (oder null = neu)
let shiftEmployerId = null;

function renderEmployerChips(container, selectedId, onPick, withPrivate = false) {
  const items = withPrivate ? [...state.employers, PRIVATE] : state.employers;
  container.replaceChildren(...items.map(e =>
    el('button', {
      type: 'button',
      class: 'chip' + (e.id === selectedId ? ' active' : ''),
      style: `--c:${e.color}`,
      onclick: () => onPick(e.id),
    }, el('i', { class: 'dot', style: `background:${e.color}` }), e.name)));
}

function recentTimes(employerId) {
  const seen = new Set();
  const out = [];
  const sources = [
    ...state.plans.filter(p => p.employerId === employerId),
    ...state.shifts.filter(s => s.employerId === employerId).slice().reverse(),
  ];
  for (const s of sources) {
    const key = `${s.start}-${s.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= 4) break;
  }
  return out;
}

function pickShiftEmployer(id) {
  shiftEmployerId = id;
  renderEmployerChips($('shift-employers'), id, pickShiftEmployer, true);
  const priv = id === PRIVATE.id;
  $('private-fields').hidden = !priv;
  $('shift-title').required = priv;
  $('shift-end').required = !priv;
  $('end-opt').hidden = !priv;
  $('shift-dialog-title').textContent = (editing ? (priv ? 'Termin' : 'Schicht') + ' bearbeiten' : (priv ? 'Privater Termin' : 'Schicht eintragen'));
  const times = priv ? [] : recentTimes(id);
  $('recent-times').replaceChildren(...times.map(t =>
    el('button', {
      type: 'button', class: 'chip',
      onclick: () => { $('shift-start').value = t.start; $('shift-end').value = t.end; updateShiftPreview(); },
    }, `${t.start}–${t.end}`)));
  // bei neuen Einträgen: Arbeitgeber -> zuletzt genutzte Zeiten vorschlagen, Privat -> leere Felder
  if (!editing) {
    $('shift-start').value = times[0] ? times[0].start : '';
    $('shift-end').value = times[0] ? times[0].end : '';
  }
  updateShiftPreview();
}

function updateShiftPreview() {
  const s = $('shift-start').value, e = $('shift-end').value;
  $('shift-duration').textContent = s && e && shiftEmployerId !== PRIVATE.id
    ? 'Dauer: ' + fmtHours(durationMin(s, e)) + (toMin(e) <= toMin(s) ? ' (bis zum nächsten Tag)' : '')
    : '';
  const link = $('shift-gcal');
  if (s && (e || shiftEmployerId === PRIVATE.id) && shiftEmployerId && $('shift-date').value) {
    link.href = gcalLink({ employerId: shiftEmployerId, date: $('shift-date').value, start: s, end: e, note: $('shift-note').value, title: $('shift-title').value });
    link.hidden = false;
  } else {
    link.hidden = true;
  }
}

function openShiftDialog(occurrence) {
  editing = occurrence || null;
  const o = occurrence || {};
  $('shift-date').value = o.date || view.selected;
  $('shift-start').value = o.start || '';
  $('shift-end').value = o.end || '';
  $('shift-note').value = o.note || '';
  $('shift-title').value = o.title || '';
  $('shift-delete').hidden = !occurrence;
  $('plan-hint').hidden = !(occurrence && occurrence.kind === 'plan');
  // neue Einträge starten beim zuletzt genutzten Arbeitgeber (private Termine überspringen)
  const lastWork = state.shifts.filter(s => !isPrivate(s)).pop();
  const fallback = lastWork && employerById(lastWork.employerId) ? lastWork.employerId
    : (state.employers[0] ? state.employers[0].id : PRIVATE.id);
  pickShiftEmployer(o.employerId || fallback);
  $('shift-dialog').showModal();
}

function skipPlanDate(planId, date) {
  const p = state.plans.find(x => x.id === planId);
  if (!p) return;
  p.skips = p.skips || [];
  if (!p.skips.includes(date)) p.skips.push(date);
}

$('shift-form').addEventListener('submit', e => {
  e.preventDefault();
  const data = {
    employerId: shiftEmployerId,
    date: $('shift-date').value,
    start: $('shift-start').value,
    end: $('shift-end').value,
    note: $('shift-note').value.trim(),
  };
  if (data.employerId === PRIVATE.id) {
    data.title = $('shift-title').value.trim();
    if (!data.title) { toast('Bitte eintragen, was für ein Termin es ist'); return; }
  }
  if (!data.date || !data.start || (!data.end && data.employerId !== PRIVATE.id)) return;
  if (data.start === data.end) { toast('Beginn und Ende sind gleich'); return; }

  if (editing && editing.kind === 'shift') {
    const target = state.shifts.find(s => s.id === editing.id);
    delete target.title;
    Object.assign(target, data);
  } else if (editing && editing.kind === 'plan') {
    const unchanged = ['employerId', 'date', 'start', 'end', 'note', 'title'].every(k => (editing[k] || '') === data[k]);
    if (!unchanged) {
      skipPlanDate(editing.id, editing.date);
      state.shifts.push({ id: uid(), ...data });
    }
  } else {
    state.shifts.push({ id: uid(), ...data });
  }
  save();
  view.selected = data.date;
  const d = fromISO(data.date); view.year = d.getFullYear(); view.month = d.getMonth();
  $('shift-dialog').close();
  toast('Gespeichert');
  render();
});

$('shift-delete').addEventListener('click', () => {
  if (!editing) return;
  if (editing.kind === 'plan') {
    if (!confirm('Diesen einen Termin der festen Wochenzeit entfernen (z. B. Urlaub, krank)?')) return;
    skipPlanDate(editing.id, editing.date);
  } else {
    if (!confirm('Diese Schicht löschen?')) return;
    state.shifts = state.shifts.filter(s => s.id !== editing.id);
  }
  save();
  $('shift-dialog').close();
  toast('Gelöscht');
  render();
});

$('shift-cancel').addEventListener('click', () => $('shift-dialog').close());
['shift-start', 'shift-end', 'shift-date', 'shift-note'].forEach(id => $(id).addEventListener('input', updateShiftPreview));

/* ---------- Arbeitgeber-Dialog ---------- */

let editingEmployer = null;
let employerColor = COLORS[0];

function renderColorPicker() {
  $('employer-colors').replaceChildren(...COLORS.map(c =>
    el('button', {
      type: 'button', class: 'swatch' + (c === employerColor ? ' active' : ''),
      style: `background:${c}`, 'aria-label': 'Farbe ' + c,
      onclick: () => { employerColor = c; renderColorPicker(); },
    })));
}

function openEmployerDialog(emp) {
  editingEmployer = emp || null;
  $('employer-dialog-title').textContent = emp ? 'Arbeitgeber bearbeiten' : 'Neuer Arbeitgeber';
  $('employer-name').value = emp ? emp.name : '';
  $('employer-rate').value = emp && emp.rate ? String(emp.rate).replace('.', ',') : '';
  const used = state.employers.map(e => e.color);
  employerColor = emp ? emp.color : (COLORS.find(c => !used.includes(c)) || COLORS[0]);
  renderColorPicker();
  $('employer-delete').hidden = !emp;
  $('employer-dialog').showModal();
}

$('employer-form').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('employer-name').value.trim();
  if (!name) return;
  const rate = parseFloat(String($('employer-rate').value).replace(',', '.'));
  const data = { name, color: employerColor, rate: isFinite(rate) && rate > 0 ? rate : null };
  if (editingEmployer) Object.assign(editingEmployer, data);
  else state.employers.push({ id: uid(), ...data });
  save();
  $('employer-dialog').close();
  render();
});

$('employer-delete').addEventListener('click', () => {
  const emp = editingEmployer;
  const count = state.shifts.filter(s => s.employerId === emp.id).length + state.plans.filter(p => p.employerId === emp.id).length;
  const msg = count
    ? `„${emp.name}“ löschen? Dabei werden auch ${count} Schicht(en)/Wochenzeit(en) gelöscht.`
    : `„${emp.name}“ löschen?`;
  if (!confirm(msg)) return;
  state.employers = state.employers.filter(x => x.id !== emp.id);
  state.shifts = state.shifts.filter(s => s.employerId !== emp.id);
  state.plans = state.plans.filter(p => p.employerId !== emp.id);
  save();
  $('employer-dialog').close();
  render();
});

$('employer-cancel').addEventListener('click', () => $('employer-dialog').close());

/* ---------- Wochenzeit-Dialog ---------- */

let editingPlan = null;
let planEmployerId = null;
let planDays = [];

function renderPlanDays() {
  $('plan-days').replaceChildren(...WEEKDAYS.map((name, i) =>
    el('button', {
      type: 'button', class: planDays.includes(i + 1) ? 'active' : '',
      onclick: () => {
        planDays = planDays.includes(i + 1) ? planDays.filter(d => d !== i + 1) : [...planDays, i + 1].sort();
        renderPlanDays(); updatePlanLink();
      },
    }, name)));
}

function pickPlanEmployer(id) {
  planEmployerId = id;
  renderEmployerChips($('plan-employers'), id, pickPlanEmployer);
  updatePlanLink();
}

function currentPlanForm() {
  return {
    employerId: planEmployerId, weekdays: planDays,
    start: $('plan-start').value, end: $('plan-end').value,
    from: $('plan-from').value, until: $('plan-until').value || null,
    note: $('plan-note').value.trim(),
  };
}

function updatePlanLink() {
  const p = currentPlanForm();
  const link = $('plan-gcal');
  link.hidden = !(p.employerId && p.weekdays.length && p.start && p.end && p.from);
  if (!link.hidden) link.href = gcalPlanLink(p);
}

function openPlanDialog(plan) {
  if (!state.employers.length) { openEmployerDialog(); return; }
  editingPlan = plan || null;
  $('plan-dialog-title').textContent = plan ? 'Feste Wochenzeit bearbeiten' : 'Neue feste Wochenzeit';
  planDays = plan ? [...plan.weekdays] : [];
  $('plan-start').value = plan ? plan.start : '';
  $('plan-end').value = plan ? plan.end : '';
  $('plan-from').value = plan ? plan.from : todayISO();
  $('plan-until').value = plan && plan.until ? plan.until : '';
  $('plan-note').value = plan ? plan.note || '' : '';
  $('plan-delete').hidden = !plan;
  renderPlanDays();
  pickPlanEmployer(plan ? plan.employerId : state.employers[0].id);
  $('plan-dialog').showModal();
}

$('plan-form').addEventListener('submit', e => {
  e.preventDefault();
  const data = currentPlanForm();
  if (!data.weekdays.length) { toast('Bitte mindestens einen Wochentag wählen'); return; }
  if (data.start === data.end) { toast('Beginn und Ende sind gleich'); return; }
  if (data.until && data.until < data.from) { toast('„Bis“ liegt vor „Ab“'); return; }
  if (editingPlan) Object.assign(editingPlan, data);
  else state.plans.push({ id: uid(), skips: [], ...data });
  save();
  $('plan-dialog').close();
  toast('Gespeichert – erscheint jetzt jede Woche im Kalender');
  render();
});

$('plan-delete').addEventListener('click', () => {
  if (!confirm('Diese feste Wochenzeit komplett löschen? Alle ihre Termine verschwinden aus dem Kalender.')) return;
  state.plans = state.plans.filter(p => p.id !== editingPlan.id);
  save();
  $('plan-dialog').close();
  render();
});

$('plan-cancel').addEventListener('click', () => $('plan-dialog').close());
['plan-start', 'plan-end', 'plan-from', 'plan-until', 'plan-note'].forEach(id => $(id).addEventListener('input', updatePlanLink));

/* ---------- Stunden ---------- */

function renderStats() {
  const { year, month } = statsMonth;
  $('stats-label').textContent = monthName(year, month);
  const days = new Date(year, month + 1, 0).getDate();
  const per = new Map(state.employers.map(e => [e.id, { min: 0, count: 0 }]));
  for (let d = 1; d <= days; d++) {
    for (const o of occurrencesOn(toISO(new Date(year, month, d)))) {
      const p = per.get(o.employerId);
      if (!p) continue; // private Termine zählen nicht
      p.min += durationMin(o.start, o.end);
      p.count++;
    }
  }

  const box = $('stats');
  box.replaceChildren();
  if (!state.employers.length) {
    box.append(el('div', { class: 'empty' }, 'Noch keine Arbeitgeber angelegt.'));
    return;
  }

  const max = Math.max(1, ...[...per.values()].map(p => p.min));
  let totalMin = 0, totalMoney = 0, anyRate = false;
  const card = el('div', { class: 'card' });
  for (const e of state.employers) {
    const p = per.get(e.id);
    totalMin += p.min;
    let money = null;
    if (e.rate) { anyRate = true; money = (p.min / 60) * e.rate; totalMoney += money; }
    card.append(el('div', { class: 'stat-row' },
      el('i', { class: 'dot', style: `background:${e.color}` }),
      el('div', { class: 'grow' },
        el('div', {}, e.name),
        el('small', {}, `${p.count} Termin${p.count === 1 ? '' : 'e'}`),
        el('div', { class: 'bar' }, el('div', { style: `width:${(p.min / max) * 100}%;background:${e.color}` }))),
      el('div', {},
        el('div', { class: 'stat-hours' }, fmtHours(p.min)),
        money != null ? el('div', { class: 'stat-money' }, fmtMoney(money)) : null)));
  }
  box.append(card);
  box.append(el('div', { class: 'card' },
    el('div', { class: 'total' }, el('span', {}, 'Gesamt'), el('span', {}, fmtHours(totalMin))),
    anyRate ? el('div', { class: 'total', style: 'font-weight:500;color:var(--muted);font-size:.95rem;margin-top:4px' },
      el('span', {}, 'Verdienst'), el('span', {}, fmtMoney(totalMoney))) : null));
  if (!anyRate) box.append(el('p', { class: 'hint center' }, 'Tipp: Trag unter Einstellungen einen Stundenlohn ein, dann siehst du hier auch den Verdienst.'));
}

/* ---------- Einstellungen ---------- */

function renderSettings() {
  const el1 = $('employer-list');
  el1.replaceChildren(...state.employers.map(e =>
    el('button', { class: 'list-item', onclick: () => openEmployerDialog(e) },
      el('i', { class: 'dot', style: `background:${e.color};width:18px;height:18px` }),
      el('span', { class: 'grow' }, e.name, e.rate ? el('small', {}, fmtMoney(e.rate) + ' / Std.') : null),
      el('span', { class: 'hint' }, '›'))));
  if (!state.employers.length) el1.append(el('p', { class: 'hint' }, 'Noch keine Arbeitgeber.'));

  const el2 = $('plan-list');
  el2.replaceChildren(...state.plans.filter(p => employerById(p.employerId)).map(p => {
    const emp = employerById(p.employerId);
    const days = p.weekdays.map(d => WEEKDAYS[d - 1]).join(', ');
    const range = 'ab ' + fmtShortDate(p.from) + (p.until ? ' bis ' + fmtShortDate(p.until) : '');
    return el('button', { class: 'list-item', onclick: () => openPlanDialog(p) },
      el('i', { class: 'dot', style: `background:${emp.color};width:18px;height:18px` }),
      el('span', { class: 'grow' }, `${days} · ${p.start}–${p.end}`, el('small', {}, `${emp.name} · ${range}`)),
      el('span', { class: 'hint' }, '›'));
  }));
  if (!state.plans.length) el2.append(el('p', { class: 'hint' }, 'Keine festen Wochenzeiten.'));

  $('reminder').value = String(state.settings.reminder ?? 60);
  $('last-backup').textContent = state.lastBackup
    ? 'Letzte Sicherung: ' + new Date(state.lastBackup).toLocaleDateString('de-DE')
    : 'Noch keine Sicherung gemacht.';
}

$('add-employer').addEventListener('click', () => openEmployerDialog());
$('add-plan').addEventListener('click', () => openPlanDialog());
$('reminder').addEventListener('change', e => { state.settings.reminder = Number(e.target.value); save(); });

/* ---------- Google Kalender & ICS ---------- */

const compact = (date, time) => date.replace(/-/g, '') + 'T' + time.replace(':', '') + '00';

function endDate(o) {
  return toMin(endTime(o)) <= toMin(o.start) ? addDays(o.date, 1) : o.date;
}

function eventTitle(o) {
  if (isPrivate(o)) return (o.title || 'Termin') + (o.note ? ' – ' + o.note : '');
  const emp = employerById(o.employerId);
  return 'Arbeit: ' + (emp ? emp.name : '') + (o.note ? ' – ' + o.note : '');
}

function gcalLink(o) {
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: eventTitle(o),
    dates: compact(o.date, o.start) + '/' + compact(endDate(o), endTime(o)),
    ctz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin',
    details: 'Eingetragen mit dem Schichtplaner',
  });
  return 'https://calendar.google.com/calendar/render?' + q.toString();
}

function firstMatchingDay(p) {
  let d = p.from;
  for (let i = 0; i < 7; i++) {
    if (p.weekdays.includes(isoWeekday(d))) return d;
    d = addDays(d, 1);
  }
  return p.from;
}

function gcalPlanLink(p) {
  const first = firstMatchingDay(p);
  let rule = 'RRULE:FREQ=WEEKLY;BYDAY=' + p.weekdays.map(d => ICS_DAYS[d - 1]).join(',');
  if (p.until) rule += ';UNTIL=' + p.until.replace(/-/g, '') + 'T235959';
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: eventTitle(p),
    dates: compact(first, p.start) + '/' + compact(endDate({ ...p, date: first }), p.end),
    ctz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin',
    recur: rule,
    details: 'Feste Wochenzeit aus dem Schichtplaner',
  });
  return 'https://calendar.google.com/calendar/render?' + q.toString();
}

const icsEscape = s => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

function buildICS(months, reminder) {
  const from = todayISO();
  const t = new Date(); t.setMonth(t.getMonth() + months);
  const until = toISO(t);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Schichtplaner//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  let count = 0;
  for (let d = from; d <= until; d = addDays(d, 1)) {
    for (const o of occurrencesOn(d)) {
      count++;
      lines.push(
        'BEGIN:VEVENT',
        `UID:${o.id}-${o.date}@schichtplaner`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${compact(o.date, o.start)}`,
        `DTEND:${compact(endDate(o), endTime(o))}`,
        `SUMMARY:${icsEscape(eventTitle(o))}`);
      if (reminder > 0) {
        lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(eventTitle(o))}`, `TRIGGER:-PT${reminder}M`, 'END:VALARM');
      }
      lines.push('END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return { text: lines.join('\r\n'), count };
}

async function deliverFile(name, type, text) {
  const file = new File([text], name, { type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(file);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

$('export-ics').addEventListener('click', () => {
  const { text, count } = buildICS(Number($('export-range').value), Number($('reminder').value));
  if (!count) { toast('Im gewählten Zeitraum gibt es keine Schichten'); return; }
  deliverFile(`schichten-${todayISO()}.ics`, 'text/calendar', text);
  toast(`${count} Termin(e) exportiert`);
});

/* ---------- Sicherung ---------- */

$('backup').addEventListener('click', () => {
  state.lastBackup = new Date().toISOString();
  save();
  deliverFile(`schichtplaner-sicherung-${todayISO()}.json`, 'application/json', JSON.stringify(state, null, 2));
  renderSettings();
});

$('restore-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.employers) || !Array.isArray(data.shifts) || !Array.isArray(data.plans)) throw new Error();
    if (!confirm(`Sicherung laden? ${data.employers.length} Arbeitgeber, ${data.shifts.length} Schichten. Die aktuellen Daten werden ersetzt.`)) return;
    state = Object.assign(emptyState(), data);
    save();
    toast('Sicherung wiederhergestellt');
    render();
  } catch (err) {
    toast('Das ist keine gültige Sicherungsdatei');
  }
});

/* ---------- Start ---------- */

document.querySelectorAll('.tabbar button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
$('fab').addEventListener('click', () => openShiftDialog());

function shiftMonth(target, delta) {
  const d = new Date(target.year, target.month + delta, 1);
  target.year = d.getFullYear(); target.month = d.getMonth();
}
$('prev-month').addEventListener('click', () => { shiftMonth(view, -1); renderCalendar(); });
$('next-month').addEventListener('click', () => { shiftMonth(view, 1); renderCalendar(); });
$('month-label').addEventListener('click', () => {
  const n = new Date(); view.year = n.getFullYear(); view.month = n.getMonth(); view.selected = todayISO(); renderCalendar();
});
$('stats-prev').addEventListener('click', () => { shiftMonth(statsMonth, -1); renderStats(); });
$('stats-next').addEventListener('click', () => { shiftMonth(statsMonth, 1); renderStats(); });

// Wischen im Kalender wechselt den Monat
let touchX = null;
$('grid').addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
$('grid').addEventListener('touchend', e => {
  if (touchX == null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 60) { shiftMonth(view, dx < 0 ? 1 : -1); renderCalendar(); }
});

['shift-dialog', 'employer-dialog', 'plan-dialog'].forEach(id => closeOnBackdrop($(id)));

if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

render();
