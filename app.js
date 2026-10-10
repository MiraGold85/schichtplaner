'use strict';

/* ---------- Daten ---------- */

const STORAGE_KEY = 'schichtplaner-v1';
const COLORS = ['#2563eb', '#f97316', '#16a34a', '#db2777', '#7c3aed', '#0891b2', '#ca8a04', '#dc2626'];
const MINIJOB_LIMIT = 603; // Minijob-Grenze 2026 (Vorschlag, in der App änderbar)
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
  importIndex = null;
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
const employerById = id => id === PRIVATE.id ? PRIVATE : state.employers.find(e => e.id === id);
// Private Kategorien (z. B. „Pferde“) sind wie Arbeitgeber gespeichert, aber mit private: true – zählen nie als Arbeit
const isCat = emp => !!(emp && emp.private);
const isPrivate = o => isCat(employerById(o.employerId));
const workEmployers = () => state.employers.filter(e => !e.private);
const categories = () => state.employers.filter(e => e.private);

// Private Termine dürfen ohne Ende sein – für Kalender-Export gilt dann 1 Stunde
function endTime(o) {
  if (o.end) return o.end;
  const m = (toMin(o.start) + 60) % 1440;
  return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
}
// Minuten, die ein Eintrag zählt: Arbeitszeit oder Gutschrift (Urlaub, Krank, Feiertag)
// Arbeitszeit ohne Pause
const netMin = o => Math.max(0, durationMin(o.start, o.end) - (o.pause || 0));
const occMinutes = o => o.credit != null ? o.credit : (o.start && o.end ? netMin(o) : 0);

// Pause in Minuten aus einem Eingabefeld (leer = keine)
const readPause = id => Math.max(0, Math.round(Number(String($(id).value).replace(',', '.')))) || 0;
const writePause = (id, min) => { $(id).value = min ? String(min) : ''; };

// Schnellknöpfe für die Pause
function setupPauseChips(chipsId, inputId, onChange) {
  $(chipsId).replaceChildren(...[0, 15, 30, 45, 60].map(m =>
    el('button', { type: 'button', class: 'chip', onclick: () => { writePause(inputId, m); onChange(); } }, m ? `${m} Min.` : 'keine')));
}
const isCredit = o => o.kind === 'absence' || o.kind === 'holiday';
const workMinutes = list => list.filter(o => !isPrivate(o)).reduce((s, o) => s + occMinutes(o), 0);
const ABSENCE_LABEL = { urlaub: 'Urlaub', krank: 'Krank' };

/* ---------- Feiertage ---------- */

const REGIONS = {
  BW: 'Baden-Württemberg', BY: 'Bayern', BE: 'Berlin', BB: 'Brandenburg', HB: 'Bremen', HH: 'Hamburg',
  HE: 'Hessen', MV: 'Mecklenburg-Vorpommern', NI: 'Niedersachsen', NW: 'Nordrhein-Westfalen',
  RP: 'Rheinland-Pfalz', SL: 'Saarland', SN: 'Sachsen', ST: 'Sachsen-Anhalt', SH: 'Schleswig-Holstein', TH: 'Thüringen',
};

function easterSunday(y) { // Gaußsche Osterformel (gregorianisch)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return toISO(new Date(y, month - 1, day));
}

const holidayCache = new Map();
function holidaysOf(year, region) {
  const key = year + region;
  if (holidayCache.has(key)) return holidayCache.get(key);
  const E = easterSunday(year);
  const fix = (m, d) => `${year}-${pad(m)}-${pad(d)}`;
  const inR = list => list.split(' ').includes(region);
  const days = [
    [fix(1, 1), 'Neujahr'],
    [addDays(E, -2), 'Karfreitag'],
    [addDays(E, 1), 'Ostermontag'],
    [fix(5, 1), 'Tag der Arbeit'],
    [addDays(E, 39), 'Christi Himmelfahrt'],
    [addDays(E, 50), 'Pfingstmontag'],
    [fix(10, 3), 'Tag der Deutschen Einheit'],
    [fix(12, 25), '1. Weihnachtstag'],
    [fix(12, 26), '2. Weihnachtstag'],
  ];
  if (inR('BW BY ST')) days.push([fix(1, 6), 'Heilige Drei Könige']);
  if (inR('BE MV')) days.push([fix(3, 8), 'Frauentag']);
  if (inR('BB')) days.push([E, 'Ostersonntag'], [addDays(E, 49), 'Pfingstsonntag']);
  if (inR('BW BY HE NW RP SL')) days.push([addDays(E, 60), 'Fronleichnam']);
  if (inR('SL')) days.push([fix(8, 15), 'Mariä Himmelfahrt']);
  if (inR('TH')) days.push([fix(9, 20), 'Weltkindertag']);
  if (inR('BB HB HH MV NI SN ST SH TH')) days.push([fix(10, 31), 'Reformationstag']);
  if (inR('BW BY NW RP SL')) days.push([fix(11, 1), 'Allerheiligen']);
  if (inR('SN')) { // Buß- und Bettag: Mittwoch vor dem 23. November
    const d = new Date(year, 10, 22);
    while (d.getDay() !== 3) d.setDate(d.getDate() - 1);
    days.push([toISO(d), 'Buß- und Bettag']);
  }
  const map = new Map(days);
  holidayCache.set(key, map);
  return map;
}

function holidayName(date) {
  const region = state.settings.region;
  return region ? holidaysOf(Number(date.slice(0, 4)), region).get(date) || null : null;
}

function occurrencesOn(date) {
  const list = [];
  const absent = new Set();
  for (const s of state.shifts) {
    if (s.date !== date) continue;
    if (s.absence) { list.push({ kind: 'absence', ...s }); absent.add(s.employerId); }
    else list.push({ kind: 'shift', ...s });
  }
  const wd = isoWeekday(date);
  const holiday = holidayName(date);
  for (const p of state.plans) {
    if (!p.weekdays.includes(wd)) continue;
    if (date < p.from || (p.until && date > p.until)) continue;
    if (p.skips && p.skips.includes(date)) continue;
    if (absent.has(p.employerId)) continue; // Urlaub/Krank ersetzt die feste Schicht
    const base = {
      id: p.id, employerId: p.employerId, date, start: p.start, end: p.end, pause: p.pause || 0, note: p.note || '',
      travel: p.travel || 0, back: p.back || 0,
    };
    // Feiertag: feste Schicht entfällt, die Stunden werden gutgeschrieben
    if (holiday && !isCat(employerById(p.employerId))) list.push({ ...base, kind: 'holiday', holiday, credit: netMin(base) });
    else list.push({ ...base, kind: 'plan' });
  }
  return list
    .filter(o => employerById(o.employerId))
    .sort((a, b) => (isCredit(a) ? '' : a.start).localeCompare(isCredit(b) ? '' : b.start));
}

/* ---------- Geburtstage ---------- */

function birthdaysOn(date) {
  const md = date.slice(5);
  const year = Number(date.slice(0, 4));
  const leap = new Date(year, 1, 29).getMonth() === 1;
  return (state.birthdays || []).filter(b => {
    const bmd = b.date.slice(5);
    return bmd === md || (!leap && bmd === '02-29' && md === '02-28');
  }).map(b => ({ ...b, age: b.showAge ? year - Number(b.date.slice(0, 4)) : null }));
}

/* ---------- Importierte Kalender (z. B. Abfuhrkalender) ---------- */

let importIndex = null; // Datum -> [{ title, time, source }], wird nach jeder Änderung neu aufgebaut
function importsOn(date) {
  if (!importIndex) {
    importIndex = new Map();
    for (const imp of state.imports || []) {
      for (const ev of imp.events) {
        if (!importIndex.has(ev.d)) importIndex.set(ev.d, []);
        importIndex.get(ev.d).push({ title: ev.t, time: ev.time || null, source: imp.name });
      }
    }
    for (const list of importIndex.values()) list.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  }
  return importIndex.get(date) || [];
}

function eventIcon(title) {
  const t = title.toLowerCase();
  if (/rest/.test(t)) return '⚫';
  if (/bio/.test(t)) return '🟤';
  if (/gelb|wertstoff|verpack/.test(t)) return '🟡';
  if (/papier|pappe|blau/.test(t)) return '🔵';
  if (/glas/.test(t)) return '🟢';
  if (/sperr/.test(t)) return '🛋️';
  if (/schadstoff|problem/.test(t)) return '☣️';
  if (/grün|baum|strauch|weihnacht/.test(t)) return '🌲';
  return '📌';
}

const icsUnescape = v => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

// Liest eine .ics-Datei: Einzeltermine und einfache Wiederholungen (täglich/wöchentlich/monatlich/jährlich)
function parseICS(text) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let cur = null, calName = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = { ex: [] }; continue; }
    if (line === 'END:VEVENT') { if (cur && cur.start) events.push(cur); cur = null; continue; }
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(';');
    const value = line.slice(i + 1);
    if (!cur) { if (name === 'X-WR-CALNAME') calName = icsUnescape(value); continue; }
    if (name === 'SUMMARY') cur.title = icsUnescape(value);
    else if (name === 'DTSTART') cur.start = parseICSDate(value);
    else if (name === 'RRULE') cur.rrule = Object.fromEntries(value.split(';').map(x => x.split('=')));
    else if (name === 'EXDATE') value.split(',').forEach(v => cur.ex.push(parseICSDate(v).date));
  }
  return { calName, events };
}

function parseICSDate(v) {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z)?)?/);
  if (!m) return { date: null, time: null };
  if (!m[4]) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: null };
  if (m[6]) { // UTC -> lokale Zeit
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
    return { date: toISO(d), time: pad(d.getHours()) + ':' + pad(d.getMinutes()) };
  }
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
}

function expandEvent(ev, from, to) {
  const start = ev.start.date;
  if (!start) return [];
  const r = ev.rrule;
  if (!r) return start >= from && start <= to ? [start] : [];
  const interval = Number(r.INTERVAL || 1);
  const until = r.UNTIL ? parseICSDate(r.UNTIL).date : to;
  const max = r.COUNT ? Number(r.COUNT) : 2000;
  const end = until < to ? until : to;
  const out = [];
  let n = 0;
  const push = d => { n++; if (d >= from && d <= end && !ev.ex.includes(d)) out.push(d); };
  if (r.FREQ === 'WEEKLY' && r.BYDAY) {
    const days = r.BYDAY.split(',').map(x => ICS_DAYS.indexOf(x.slice(-2)) + 1).filter(x => x > 0).sort();
    let weekStart = addDays(start, 1 - isoWeekday(start));
    while (weekStart <= end && n < max) {
      for (const wd of days) {
        const d = addDays(weekStart, wd - 1);
        if (d < start || d > end || n >= max) continue;
        push(d);
      }
      weekStart = addDays(weekStart, 7 * interval);
    }
    return out;
  }
  const sd = fromISO(start);
  for (let k = 0; n < max; k++) {
    let d;
    if (r.FREQ === 'DAILY') d = addDays(start, k * interval);
    else if (r.FREQ === 'WEEKLY') d = addDays(start, 7 * k * interval);
    else if (r.FREQ === 'MONTHLY' || r.FREQ === 'YEARLY') {
      const months = r.FREQ === 'MONTHLY' ? k * interval : 12 * k * interval;
      const x = new Date(sd.getFullYear(), sd.getMonth() + months, sd.getDate());
      if (x.getDate() !== sd.getDate()) continue; // z. B. 31. im kurzen Monat
      d = toISO(x);
    } else break;
    if (d > end) break;
    push(d);
  }
  return out;
}

/* ---------- Abstände zwischen Terminen ---------- */

const minGap = () => state.settings.minGap ?? 15;

// Für jeden Termin mit Uhrzeit: Minuten Luft seit dem Ende des vorherigen (null = unbekannt)
function dayGaps(occ) {
  const timed = occ.filter(o => !isCredit(o) && o.start);
  const gaps = new Map();
  let prevEnd = null;
  for (const o of timed) {
    const s = toMin(o.start);
    if (prevEnd != null) gaps.set(o, s - prevEnd);
    if (o.end && toMin(o.end) > s) prevEnd = Math.max(prevEnd ?? 0, toMin(o.end));
    else if (o.end) prevEnd = 24 * 60; // über Mitternacht
  }
  return gaps;
}

// Mit eingetragener Anfahrt: eng, wenn die Lücke kürzer ist als die Fahrt
function gapLevel(gap, travel = 0) {
  if (gap < 0) return 'overlap';
  if (travel && gap < travel) return 'tight';
  if (gap < minGap()) return 'tight';
  return 'ok';
}

function dayWarning(occ) {
  let worst = null;
  for (const [o, g] of dayGaps(occ)) {
    const l = gapLevel(g, o.travel);
    if (l === 'overlap') return 'overlap';
    if (l === 'tight') worst = 'tight';
  }
  return worst;
}

/* ---------- Fahrzeiten & Kilometer ---------- */

// Arbeitstermine mit Uhrzeit, in zeitlicher Reihenfolge (ohne Privates und Gutschriften)
const timedWork = occ => occ.filter(o => !isCredit(o) && !isPrivate(o) && o.start);

// Pro Tag und Arbeitgeber: Arbeit (inkl. Gutschriften), Fahrzeit, bezahlte Fahrzeit, Kilometer.
// Rückfahrt zählt nur beim letzten Arbeitstermin des Tages.
// „Zwischen Terminen bezahlt“: Anfahrt zählt, wenn direkt davor ein Termin desselben Arbeitgebers war.
// include: optional nur bestimmte Termine zählen (z. B. nur erledigte) – Reihenfolge/letzter Termin bleibt vom ganzen Tag
function dayTotals(occ, include = null) {
  const totals = new Map();
  const get = id => { if (!totals.has(id)) totals.set(id, { work: 0, travel: 0, paidTravel: 0, km: 0 }); return totals.get(id); };
  for (const o of occ) if (!isPrivate(o) && (!include || include(o))) get(o.employerId).work += occMinutes(o);
  const timed = timedWork(occ);
  timed.forEach((o, i) => {
    if (include && !include(o)) return;
    const emp = employerById(o.employerId);
    const t = get(o.employerId);
    const last = i === timed.length - 1;
    const there = o.travel || 0, back = last ? (o.back || 0) : 0;
    t.travel += there + back;
    t.km += (o.km || 0) + (last ? (o.kmBack || 0) : 0);
    if (emp.travelPay === 'all') t.paidTravel += there + back;
    else if (emp.travelPay === 'between' && i > 0 && timed[i - 1].employerId === o.employerId) t.paidTravel += there;
  });
  return totals;
}
const paidMinutes = t => t ? t.work + t.paidTravel : 0;

// Erledigt = Endzeit ist vorbei (ohne Endzeit: Beginn). Urlaub/Krank/Feiertag zählen ab dem Tag selbst.
function isDone(o) {
  const today = todayISO();
  if (o.date !== today) return o.date < today;
  if (isCredit(o) || !o.start) return true;
  const end = o.end || o.start;
  if (o.end && toMin(o.end) <= toMin(o.start)) return false; // läuft über Mitternacht
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() >= toMin(end);
}
const notDone = o => !isDone(o);

function gapText(gap, travel = 0) {
  if (travel && gap >= 0 && gap < travel) return `⚠️ ${fmtDuration(gap)} Zeit, aber ${fmtDuration(travel)} Anfahrt`;
  if (gap < 0) return `⚠️ Überschneidung: ${fmtDuration(-gap)}`;
  if (gap === 0) return '↓ direkt im Anschluss';
  return `↓ ${fmtDuration(gap)} bis zum nächsten Termin`;
}

function fmtDuration(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} Std.${m ? ' ' + m + ' Min.' : ''}` : `${m} Min.`;
}

/* ---------- Mitnehmliste ---------- */

// Abgehakte Sachen pro Tag: state.packed = { 'JJJJ-MM-TT': ['Reithelm', …] }
function packingFor(date, occ) {
  const items = [];
  const seen = new Set();
  for (const o of occ) {
    if (isCredit(o)) continue;
    const emp = employerById(o.employerId);
    for (const item of emp.items || []) {
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ item, color: emp.color });
    }
  }
  return items;
}

function togglePacked(date, item) {
  state.packed = state.packed || {};
  const list = state.packed[date] || [];
  state.packed[date] = list.includes(item) ? list.filter(x => x !== item) : [...list, item];
  // alte Tage aufräumen
  const cutoff = addDays(todayISO(), -14);
  for (const d of Object.keys(state.packed)) if (d < cutoff || !state.packed[d].length) delete state.packed[d];
  save();
}

let packingOpen = null; // null = automatisch (offen, solange nicht alles abgehakt ist)

function renderPacking(date, occ) {
  const items = packingFor(date, occ);
  if (!items.length) return null;
  const done = (state.packed && state.packed[date]) || [];
  const allDone = items.every(i => done.includes(i.item));
  const open = packingOpen ?? !allDone;
  const title = date === todayISO() ? 'Heute mitnehmen' : 'Mitnehmen';
  const card = el('div', { class: 'card packing' + (allDone ? ' done' : '') },
    el('button', {
      class: 'packing-head', type: 'button',
      onclick: () => { packingOpen = !open; renderDay(); },
    }, el('span', {}, (allDone ? '✅ ' : '🎒 ') + title),
      el('span', { class: 'hint' }, `${items.filter(i => done.includes(i.item)).length}/${items.length} ${open ? '▴' : '▾'}`)));
  if (open) {
    for (const { item, color } of items) {
      const checked = done.includes(item);
      card.append(el('label', { class: 'pack-item' + (checked ? ' checked' : '') },
        el('input', Object.assign({ type: 'checkbox', onchange: () => { togglePacked(date, item); renderDay(); } }, checked ? { checked: '' } : {})),
        el('i', { class: 'dot', style: `background:${color}` }),
        el('span', {}, item)));
    }
  }
  return card;
}

/* ---------- Stundenkonto ---------- */

const daysInMonthOf = iso => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0).getDate();

// Soll pro Tag gleichmäßig verteilt: Wochen-Soll / 7 bzw. Monats-Soll / Tage im Monat
const dailySollMin = (acc, iso) => acc.unit === 'week' ? acc.amount * 60 / 7 : acc.amount * 60 / daysInMonthOf(iso);

function accountRange(emp, from, to, occ = occurrencesOn) {
  let soll = 0, ist = 0;
  if (from < emp.account.start) from = emp.account.start;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    soll += dailySollMin(emp.account, d);
    ist += paidMinutes(dayTotals(occ(d)).get(emp.id));
  }
  return { soll, ist };
}

function accountBalance(emp, to, occ) {
  if (to < emp.account.start) return null;
  const r = accountRange(emp, emp.account.start, to, occ);
  return (emp.account.opening || 0) * 60 + r.ist - r.soll;
}

// "Keine Minusstunden": bezahlt wird, was gearbeitet wurde (z. B. Minijob) – nur Plus wird übertragen.
// Ältere Daten ohne Angabe: bei Minijobs automatisch an.
const isNoMinus = emp => emp.account.noMinus ?? !!emp.limit;

// Plusstunden, die aus den Monaten vor (year, month) mitgebracht werden – nie unter 0
function plusCarry(emp, year, month, occ) {
  let carry = Math.max(0, (emp.account.opening || 0) * 60);
  const s = fromISO(emp.account.start);
  for (let y = s.getFullYear(), m = s.getMonth(); y < year || (y === year && m < month); m === 11 ? (y++, m = 0) : m++) {
    const r = accountRange(emp, toISO(new Date(y, m, 1)), toISO(new Date(y, m + 1, 0)), occ);
    carry = Math.max(0, carry + r.ist - r.soll);
  }
  return carry;
}

function fmtSigned(min) {
  const m = Math.round(min);
  if (m === 0) return '±0 Std.';
  return (m > 0 ? '+' : '−') + fmtHours(Math.abs(m));
}

// "5,5" / "5:30" / "-2" -> Minuten
function parseHours(text, allowNegative = false) {
  const t = String(text).trim().replace('−', '-');
  if (!t) return null;
  let min;
  if (t.includes(':')) {
    const neg = t.startsWith('-');
    const [h, m] = t.replace('-', '').split(':').map(Number);
    min = (h * 60 + (m || 0)) * (neg ? -1 : 1);
  } else {
    min = Math.round(parseFloat(t.replace(',', '.')) * 60);
  }
  if (!isFinite(min) || (!allowNegative && min < 0)) return null;
  return min;
}
const hoursText = min => String(Math.round(min / 60 * 100) / 100).replace('.', ',');

/* ---------- Kleine UI-Helfer ---------- */

const $ = id => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children) if (c != null) n.append(c);
  return n;
}

let toastTimer;
function toast(msg, action) {
  const t = $('toast');
  t.replaceChildren(msg);
  t.classList.toggle('has-action', !!action);
  if (action) {
    t.append(el('button', { type: 'button', onclick: () => { t.classList.remove('show'); action.run(); } }, action.label));
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 7000 : 2600);
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
  if (selectMode && name !== 'calendar') setSelectMode(false);
  $('fab').hidden = name !== 'calendar' || selectMode;
  $('select-toggle').hidden = name !== 'calendar';
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
      class: 'cell' + (d.getMonth() !== view.month ? ' other' : '') + (iso === today ? ' today' : '')
        + (selectMode ? (selectedDays.has(iso) ? ' marked' : '') : (iso === view.selected ? ' selected' : '')) + (holidayName(iso) ? ' holiday' : ''),
      'aria-label': fmtDayTitle(iso) + (holidayName(iso) ? ', ' + holidayName(iso) : '') + (occ.length ? `, ${occ.length} Termin(e)` : ''),
      onclick: () => {
        if (selectMode) {
          selectedDays.has(iso) ? selectedDays.delete(iso) : selectedDays.add(iso);
          renderCalendar();
          return;
        }
        view.selected = iso;
        if (d.getMonth() !== view.month) { view.year = d.getFullYear(); view.month = d.getMonth(); }
        renderCalendar();
      },
    }, el('span', { class: 'cell-head' }, el('span', { class: 'num' }, String(d.getDate())), dayMarks(iso)));
    occ.slice(0, 2).forEach(o => {
      const color = employerById(o.employerId).color;
      cell.append(isCredit(o)
        ? el('span', { class: 'pill credit', style: `border-color:${color};color:${color}` }, o.kind === 'holiday' ? 'Feiertag' : ABSENCE_LABEL[o.absence])
        : el('span', { class: 'pill', style: `background:${color}` }, o.start.replace(/^0/, '')));
    });
    if (occ.length > 2) cell.append(el('span', { class: 'more' }, `+${occ.length - 2}`));
    const warn = dayWarning(occ);
    if (warn) cell.append(el('span', { class: 'warn-dot ' + warn, title: warn === 'overlap' ? 'Überschneidung' : 'Wenig Zeit zwischen Terminen' }));
    grid.append(cell);
  }

  const legend = $('legend');
  const legendItems = [...workEmployers(), ...categories(), ...(state.shifts.some(o => o.employerId === PRIVATE.id) ? [PRIVATE] : [])];
  legend.replaceChildren(...legendItems.map(e =>
    el('span', {}, el('i', { class: 'dot', style: `background:${e.color}` }), e.name)));

  if (selectMode) renderSelectBar();
  else renderDay();
  $('day-panel').hidden = selectMode;
}

/* ---------- Mehrere Tage auswählen und Termine löschen ---------- */

let selectMode = false;
let selectedDays = new Set();
let selectExcluded = new Set(); // Arbeitgeber/Kategorien, die beim Löschen ausgenommen sind

function setSelectMode(on) {
  selectMode = on;
  selectedDays = new Set();
  selectExcluded = new Set();
  $('select-toggle').textContent = on ? 'Fertig' : 'Auswählen';
  $('select-bar').hidden = !on;
  $('fab').hidden = on || currentView !== 'calendar';
  document.body.classList.toggle('selecting', on);
  renderCalendar();
}

// Was würde gelöscht? Gutschriften aus festen Wochenzeiten (Feiertag) werden als „Termin entfällt“ mitgezählt
function selectedEntries() {
  const out = [];
  for (const date of [...selectedDays].sort()) {
    for (const o of occurrencesOn(date)) if (!selectExcluded.has(o.employerId)) out.push(o);
  }
  return out;
}

function renderSelectBar() {
  const involved = new Map();
  for (const date of selectedDays) for (const o of occurrencesOn(date)) involved.set(o.employerId, employerById(o.employerId));
  const entries = selectedEntries();
  const days = selectedDays.size;
  $('select-info').textContent = days
    ? `${days} Tag${days === 1 ? '' : 'e'} · ${entries.length} Termin${entries.length === 1 ? '' : 'e'} werden gelöscht`
    : 'Tippe auf die Tage, deren Termine du löschen willst.';
  $('select-filter').replaceChildren(...[...involved.values()].map(e =>
    el('button', {
      type: 'button', class: 'chip' + (selectExcluded.has(e.id) ? '' : ' active'), style: `--c:${e.color}`,
      onclick: () => { selectExcluded.has(e.id) ? selectExcluded.delete(e.id) : selectExcluded.add(e.id); renderSelectBar(); },
    }, el('i', { class: 'dot', style: `background:${e.color}` }), e.name)));
  $('select-filter').hidden = involved.size < 2;
  $('select-delete').disabled = !entries.length;
}

$('select-toggle').addEventListener('click', () => setSelectMode(!selectMode));
$('select-delete').addEventListener('click', () => {
  const entries = selectedEntries();
  if (!entries.length) return;
  const backup = JSON.stringify(state);
  const ids = new Set(entries.filter(o => o.kind === 'shift' || o.kind === 'absence').map(o => o.id));
  state.shifts = state.shifts.filter(x => !ids.has(x.id));
  for (const o of entries) if (o.kind === 'plan' || o.kind === 'holiday') skipPlanDate(o.id, o.date);
  save();
  setSelectMode(false);
  toast(`${entries.length} Termin${entries.length === 1 ? '' : 'e'} gelöscht`, {
    label: 'Rückgängig',
    run: () => { state = JSON.parse(backup); save(); render(); toast('Wiederhergestellt'); },
  });
});

// kleine Symbole neben dem Datum: Müll, Geburtstag
function dayMarks(iso) {
  const icons = [...new Set(importsOn(iso).map(e => eventIcon(e.title)))];
  if (birthdaysOn(iso).length) icons.unshift('🎂');
  return icons.length ? el('span', { class: 'marks' }, icons.slice(0, 3).join('')) : null;
}

function renderDay() {
  const date = view.selected;
  if (renderDay.last !== date) { packingOpen = null; renderDay.last = date; }
  const occ = occurrencesOn(date);
  $('day-title').textContent = date === todayISO() ? 'Heute, ' + fmtDayTitle(date).split(', ')[1] : fmtDayTitle(date);
  const total = workMinutes(occ);
  $('day-sum').textContent = total ? fmtDuration(total) : '';

  const list = $('day-list');
  list.replaceChildren();
  const infos = [];
  const holiday = holidayName(date);
  if (holiday) infos.push(`🎉 Feiertag: ${holiday}`);
  for (const b of birthdaysOn(date)) infos.push(`🎂 ${b.name}` + (b.age != null ? ` wird ${b.age}` : ' hat Geburtstag'));
  for (const ev of importsOn(date)) infos.push(`${eventIcon(ev.title)} ${ev.title}` + (ev.time ? ` · ${ev.time} Uhr` : ''));
  if (infos.length) list.append(el('div', { class: 'holiday-banner' }, ...infos.map(t => el('div', {}, t))));

  if (!state.employers.length && !occ.length) {
    list.append(el('div', { class: 'card' },
      el('h2', {}, 'Willkommen! 👋'),
      el('p', { class: 'hint' }, 'Leg zuerst deine Arbeitgeber an – jeder bekommt eine eigene Farbe.'),
      el('button', { class: 'btn full', onclick: () => openEmployerDialog() }, 'Ersten Arbeitgeber anlegen')));
    return;
  }
  if (!occ.length) {
    list.append(el('div', { class: 'empty' }, 'Keine Termine – tippe auf + um etwas einzutragen.'));
    return;
  }
  const packing = renderPacking(date, occ);
  if (packing) list.append(packing);
  const gaps = dayGaps(occ);
  const timed = timedWork(occ);
  const lastWork = timed[timed.length - 1];
  for (const o of occ) {
    const emp = employerById(o.employerId);
    if (gaps.has(o)) list.append(el('div', { class: 'gap ' + gapLevel(gaps.get(o), o.travel) }, gapText(gaps.get(o), o.travel)));
    if (o.travel && !isCredit(o) && !isPrivate(o)) list.append(el('div', { class: 'travel' }, `🚗 ${fmtDuration(o.travel)} Anfahrt` + (o.km ? ` · ${fmtKm(o.km)}` : '')));
    if (isCredit(o)) {
      list.append(el('button', {
        class: 'entry',
        onclick: () => o.kind === 'holiday'
          ? toast('Feiertag: Die feste Schicht entfällt und wird gutgeschrieben. Arbeitest du trotzdem, trag eine Schicht mit + ein.')
          : openShiftDialog(o),
      },
        el('span', { class: 'stripe credit', style: `background:${emp.color}` }),
        el('span', { class: 'body' },
          el('span', { class: 'who' }, emp.name,
            el('span', { class: 'badge' }, o.kind === 'holiday' ? 'Feiertag' : ABSENCE_LABEL[o.absence])),
          el('div', { class: 'when' }, (o.kind === 'holiday' ? `${o.start} – ${o.end} Uhr entfällt · ` : '') + `${fmtHours(o.credit)} gutgeschrieben`),
          o.note ? el('div', { class: 'note' }, o.note) : null)));
      continue;
    }
    const done = !isPrivate(o) && isDone(o);
    list.append(el('button', { class: 'entry' + (done ? ' done' : ''), onclick: () => openShiftDialog(o) },
      el('span', { class: 'stripe', style: `background:${emp.color}` }),
      el('span', { class: 'body' },
        el('span', { class: 'who' }, isPrivate(o) ? (o.title || emp.name) : emp.name,
          done ? el('span', { class: 'badge ok' }, '✓ erledigt') : null,
          o.kind === 'plan' ? el('span', { class: 'badge' }, 'fest') : null,
          isPrivate(o) && (o.title || emp.id === PRIVATE.id) ? el('span', { class: 'badge' }, emp.id === PRIVATE.id ? 'privat' : emp.name) : null),
        el('div', { class: 'when' }, isPrivate(o)
          ? (o.end ? `${o.start} – ${o.end} Uhr` : `${o.start} Uhr`)
          : `${o.start} – ${o.end} Uhr · ${fmtDuration(netMin(o))}` + (o.pause ? ` (${o.pause} Min. Pause)` : '')),
        o.note ? el('div', { class: 'note' }, o.note) : null)));
    if (o === lastWork && o.back) list.append(el('div', { class: 'travel' }, `🏠 ${fmtDuration(o.back)} Rückfahrt` + (o.kmBack ? ` · ${fmtKm(o.kmBack)}` : '')));
  }
  const dayTravel = [...dayTotals(occ).values()].reduce((a, t) => a + t.travel, 0);
  if (dayTravel) list.append(el('p', { class: 'hint center' }, `Unterwegs heute: ${fmtDuration(workMinutes(occ) + dayTravel)} (davon ${fmtDuration(dayTravel)} Fahrt)`));
}

const fmtKm = km => String(Math.round(km * 10) / 10).replace('.', ',') + ' km';

/* ---------- Schicht-Dialog ---------- */

let editing = null;        // das gerade bearbeitete Vorkommen (oder null = neu)
let shiftEmployerId = null;
let shiftType = 'work';    // 'work' | 'urlaub' | 'krank'

// Vorschlag für die Gutschrift an einem Urlaubs-/Krankheitstag
function defaultCredit(empId, date) {
  const wd = isoWeekday(date);
  const plan = state.plans.find(p => p.employerId === empId && p.weekdays.includes(wd) && date >= p.from && (!p.until || date <= p.until));
  if (plan) return netMin(plan);
  const emp = employerById(empId);
  if (emp && emp.account) return Math.round(emp.account.unit === 'week' ? emp.account.amount * 60 / 5 : emp.account.amount * 60 * 12 / 52 / 5);
  return null;
}

// Arbeitstage für einen Urlaubs-/Krankheitszeitraum: Tage mit fester Wochenzeit, sonst Mo–Fr – ohne Feiertage
function absenceDays(empId, from, until) {
  if (!until || until <= from) return [from];
  const plans = state.plans.filter(p => p.employerId === empId);
  const out = [];
  for (let d = from; d <= until; d = addDays(d, 1)) {
    if (holidayName(d)) continue;
    const wd = isoWeekday(d);
    const works = plans.length
      ? plans.some(p => p.weekdays.includes(wd) && d >= p.from && (!p.until || d <= p.until))
      : wd <= 5;
    if (works) out.push(d);
  }
  return out;
}

function setShiftType(type) {
  const priv = isCat(employerById(shiftEmployerId));
  shiftType = priv ? 'work' : type;
  const absence = shiftType !== 'work';
  $('shift-type').hidden = priv;
  $('shift-type').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.type === shiftType));
  $('time-fields').hidden = absence;
  $('absence-fields').hidden = !absence;
  $('travel-fields').hidden = absence || priv;
  $('shift-start').required = !absence;
  $('shift-end').required = !absence && !priv;
  $('absence-until-field').hidden = !!editing;
  if (absence && (!editing || editing.kind !== 'absence')) {
    const c = defaultCredit(shiftEmployerId, $('shift-date').value);
    $('absence-credit').value = c != null ? hoursText(c) : '';
  }
  $('shift-copy').hidden = !editing || absence || isCredit(editing);
  updateShiftPreview();
}

$('shift-type').addEventListener('click', e => {
  const b = e.target.closest('button[data-type]');
  if (b) setShiftType(b.dataset.type);
});

function renderEmployerChips(container, selectedId, onPick, withPrivate = false) {
  const items = [...workEmployers(), ...categories(), ...(withPrivate ? [PRIVATE] : [])];
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
    ...state.shifts.filter(s => s.employerId === employerId && s.start && s.end).slice().reverse(),
  ];
  for (const s of sources) {
    const key = `${s.start}-${s.end}-${s.pause || 0}`;
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
  const priv = isCat(employerById(id));
  $('private-fields').hidden = !priv;
  $('pause-field').hidden = priv;
  $('travel-fields').hidden = priv;
  const emp = employerById(id);
  document.querySelectorAll('#travel-fields .km-field').forEach(n => { n.hidden = !(emp && emp.kmEnabled); });
  if (!editing) suggestTravel(true);
  $('shift-title').required = id === PRIVATE.id; // bei Kategorien reicht der Kategoriename
  $('shift-end').required = !priv;
  $('end-opt').hidden = !priv;
  $('shift-dialog-title').textContent = editing ? (priv ? 'Termin' : 'Eintrag') + ' bearbeiten' : (priv ? 'Privater Termin' : 'Eintragen');
  const times = id === PRIVATE.id ? [] : recentTimes(id);
  $('recent-times').replaceChildren(...times.map(t =>
    el('button', {
      type: 'button', class: 'chip',
      onclick: () => { $('shift-start').value = t.start; $('shift-end').value = t.end; writePause('shift-pause', t.pause); updateShiftPreview(); },
    }, `${t.start}–${t.end}` + (t.pause ? ` · ${t.pause}′ Pause` : ''))));
  // bei neuen Einträgen: Arbeitgeber -> zuletzt genutzte Zeiten vorschlagen, Privat -> leere Felder
  if (!editing) {
    $('shift-start').value = times[0] ? times[0].start : '';
    $('shift-end').value = times[0] ? times[0].end : '';
    writePause('shift-pause', times[0] && times[0].pause);
  }
  setShiftType(shiftType);
}

// Halbautomatisch: Fahrzeit/km vom letzten Termin mit gleicher Notiz (z. B. Kundin), sonst vom gleichen Arbeitgeber
let travelTouched = false;
function suggestTravel(force = false) {
  if (travelTouched && !force) return;
  if (force) travelTouched = false;
  const note = $('shift-note').value.trim().toLowerCase();
  const mine = state.shifts.filter(x => x.employerId === shiftEmployerId && x.travel);
  const match = (note && [...mine].reverse().find(x => (x.note || '').trim().toLowerCase() === note)) || mine[mine.length - 1];
  $('shift-travel').value = match ? String(match.travel) : '';
  $('shift-km').value = match && match.km ? String(match.km).replace('.', ',') : '';
  $('shift-back').value = match && match.back ? String(match.back) : '';
  $('shift-km-back').value = match && match.kmBack ? String(match.kmBack).replace('.', ',') : '';
}
const readNum = id => { const v = parseFloat(String($(id).value).replace(',', '.')); return isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : 0; };
const writeNum = (id, v) => { $(id).value = v ? String(v).replace('.', ',') : ''; };

function shiftDurationText(s, e, pause) {
  const gross = durationMin(s, e);
  return 'Arbeitszeit: ' + fmtDuration(Math.max(0, gross - pause))
    + (pause ? ` (${fmtDuration(gross)} minus ${pause} Min. Pause)` : '')
    + (toMin(e) <= toMin(s) ? ' · bis zum nächsten Tag' : '');
}

function updateShiftPreview() {
  const s = $('shift-start').value, e = $('shift-end').value;
  const priv = isCat(employerById(shiftEmployerId));
  $('shift-duration').textContent = shiftType === 'work' && s && e && !priv
    ? shiftDurationText(s, e, readPause('shift-pause'))
    : '';
  const link = $('shift-gcal');
  if (shiftType === 'work' && s && (e || priv) && shiftEmployerId && $('shift-date').value) {
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
  writePause('shift-pause', o.pause);
  writeNum('shift-travel', o.travel); writeNum('shift-km', o.km);
  writeNum('shift-back', o.back); writeNum('shift-km-back', o.kmBack);
  travelTouched = !!occurrence;
  $('shift-title').value = o.title || '';
  $('absence-until').value = '';
  $('absence-credit').value = o.kind === 'absence' ? hoursText(o.credit) : '';
  shiftType = o.kind === 'absence' ? o.absence : 'work';
  $('shift-delete').hidden = !occurrence;
  $('plan-hint').hidden = !(occurrence && occurrence.kind === 'plan');
  // neue Einträge starten beim zuletzt genutzten Arbeitgeber (private Termine überspringen)
  const lastWork = state.shifts.filter(s => !isPrivate(s) && !s.absence).pop();
  const fallback = lastWork && employerById(lastWork.employerId) ? lastWork.employerId
    : (workEmployers()[0] || categories()[0] || PRIVATE).id;
  pickShiftEmployer(o.employerId || fallback);
  $('shift-dialog').showModal();
}

function skipPlanDate(planId, date) {
  const p = state.plans.find(x => x.id === planId);
  if (!p) return;
  p.skips = p.skips || [];
  if (!p.skips.includes(date)) p.skips.push(date);
}

function saveAbsence() {
  const credit = parseHours($('absence-credit').value);
  if (credit == null || credit === 0) { toast('Bitte eintragen, wie viele Stunden pro Tag gutgeschrieben werden'); return false; }
  const base = { employerId: shiftEmployerId, absence: shiftType, credit, note: $('shift-note').value.trim() };
  const date = $('shift-date').value;
  if (!date) return false;
  if (editing && editing.kind !== 'plan') {
    // vorhandenen Eintrag (Schicht oder Urlaub/Krank) umwandeln bzw. ändern
    const target = state.shifts.find(s => s.id === editing.id);
    ['start', 'end', 'title'].forEach(k => delete target[k]);
    Object.assign(target, base, { date });
    return date;
  }
  const until = $('absence-until').value;
  if (until && until < date) { toast('„Bis“ liegt vor dem Datum'); return false; }
  const days = editing ? [date] : absenceDays(shiftEmployerId, date, until);
  let added = 0;
  for (const d of days) {
    if (state.shifts.some(s => s.absence && s.employerId === shiftEmployerId && s.date === d)) continue;
    state.shifts.push({ id: uid(), date: d, ...base });
    added++;
  }
  if (!added) { toast('Keine Arbeitstage in diesem Zeitraum'); return false; }
  if (days.length > 1) setTimeout(() => toast(`${added} Tag${added === 1 ? '' : 'e'} ${ABSENCE_LABEL[shiftType]} eingetragen`), 50);
  return date;
}

$('shift-form').addEventListener('submit', e => {
  e.preventDefault();
  if (shiftType !== 'work') {
    const date = saveAbsence();
    if (!date) return;
    save();
    view.selected = date;
    const d = fromISO(date); view.year = d.getFullYear(); view.month = d.getMonth();
    $('shift-dialog').close();
    toast('Gespeichert');
    render();
    return;
  }
  const data = {
    employerId: shiftEmployerId,
    date: $('shift-date').value,
    start: $('shift-start').value,
    end: $('shift-end').value,
    note: $('shift-note').value.trim(),
  };
  const priv = isCat(employerById(data.employerId));
  data.pause = priv ? 0 : readPause('shift-pause');
  const kmOn = !priv && employerById(data.employerId).kmEnabled;
  Object.assign(data, {
    travel: priv ? 0 : readNum('shift-travel'), back: priv ? 0 : readNum('shift-back'),
    km: kmOn ? readNum('shift-km') : 0, kmBack: kmOn ? readNum('shift-km-back') : 0,
  });
  if (data.pause && data.end && data.pause >= durationMin(data.start, data.end)) { toast('Die Pause ist länger als die Schicht'); return; }
  if (priv) {
    data.title = $('shift-title').value.trim();
    if (!data.title && data.employerId === PRIVATE.id) { toast('Bitte eintragen, was für ein Termin es ist'); return; }
  }
  if (!data.date || !data.start || (!data.end && !priv)) return;
  if (data.start === data.end) { toast('Beginn und Ende sind gleich'); return; }

  if (editing && editing.kind === 'shift') {
    const target = state.shifts.find(s => s.id === editing.id);
    ['title', 'absence', 'credit'].forEach(k => delete target[k]);
    Object.assign(target, data);
  } else if (editing && editing.kind === 'absence') {
    const target = state.shifts.find(s => s.id === editing.id);
    ['absence', 'credit'].forEach(k => delete target[k]);
    Object.assign(target, data);
  } else if (editing && editing.kind === 'plan') {
    const unchanged = ['employerId', 'date', 'start', 'end', 'note', 'title', 'pause', 'travel', 'back', 'km', 'kmBack'].every(k => String(editing[k] || '') === String(data[k] || ''));
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
    if (!confirm(editing.kind === 'absence' ? 'Diesen Eintrag löschen?' : 'Diese Schicht löschen?')) return;
    state.shifts = state.shifts.filter(s => s.id !== editing.id);
  }
  save();
  $('shift-dialog').close();
  toast('Gelöscht');
  render();
});

$('shift-cancel').addEventListener('click', () => $('shift-dialog').close());

/* ---------- Kopieren ---------- */

let copySource = null;
let copyDates = new Set();
const copyView = { year: 0, month: 0 };

function openCopyDialog(source) {
  copySource = source;
  copyDates = new Set();
  const d = fromISO(source.date);
  copyView.year = d.getFullYear(); copyView.month = d.getMonth();
  const emp = employerById(source.employerId);
  const name = isPrivate(source) ? (source.title || emp.name) : emp.name;
  const time = source.end ? `${source.start}–${source.end} Uhr` : `${source.start} Uhr`;
  $('copy-summary').textContent = `${name} · ${time} (vom ${fmtShortDate(source.date)})`;
  $('copy-weeks').replaceChildren(...[1, 2, 3, 4, 6, 8].map(n =>
    el('button', {
      type: 'button', class: 'chip',
      onclick: () => {
        copyDates = new Set(Array.from({ length: n }, (_, i) => addDays(source.date, 7 * (i + 1))));
        renderCopyGrid();
      },
    }, n === 1 ? '1 Woche' : `${n} Wochen`)));
  renderCopyGrid();
  $('copy-dialog').showModal();
}

function renderCopyGrid() {
  $('copy-month').textContent = monthName(copyView.year, copyView.month);
  const grid = $('copy-grid');
  grid.replaceChildren();
  const first = new Date(copyView.year, copyView.month, 1);
  const start = new Date(copyView.year, copyView.month, 1 - ((first.getDay() || 7) - 1));
  const color = employerById(copySource.employerId).color;
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    if (i === 35 && d.getMonth() !== copyView.month) break;
    const iso = toISO(d);
    const isSource = iso === copySource.date;
    const on = copyDates.has(iso);
    grid.append(el('button', {
      type: 'button',
      class: 'cell' + (d.getMonth() !== copyView.month ? ' other' : '') + (on ? ' picked' : '') + (isSource ? ' source' : ''),
      style: on ? `background:${color}` : '',
      disabled: isSource ? '' : null,
      onclick: () => { on ? copyDates.delete(iso) : copyDates.add(iso); renderCopyGrid(); },
    }, el('span', { class: 'num' }, String(d.getDate())),
      occurrencesOn(iso).length ? el('span', { class: 'busy' }, '•') : null));
  }
  const n = copyDates.size;
  const prefix = `${copyView.year}-${pad(copyView.month + 1)}`;
  const elsewhere = [...copyDates].filter(d => !d.startsWith(prefix)).length;
  $('copy-count').textContent = n ? `${n} Tag${n === 1 ? '' : 'e'} ausgewählt` + (elsewhere ? ` (davon ${elsewhere} in ${elsewhere === 1 ? 'einem anderen Monat' : 'anderen Monaten'})` : '') : 'Noch keine Tage ausgewählt. Punkte zeigen Tage, an denen schon etwas eingetragen ist.';
  $('copy-save').disabled = !n;
}

$('shift-copy').addEventListener('click', () => {
  const src = editing;
  $('shift-dialog').close();
  openCopyDialog(src);
});

$('copy-form').addEventListener('submit', e => {
  e.preventDefault();
  const src = copySource;
  let added = 0;
  for (const date of [...copyDates].sort()) {
    // gleichen Termin am selben Tag nicht doppelt anlegen
    const exists = occurrencesOn(date).some(o => !isCredit(o) && o.employerId === src.employerId && o.start === src.start && (o.end || '') === (src.end || ''));
    if (exists) continue;
    const copy = {
      id: uid(), employerId: src.employerId, date, start: src.start, end: src.end || '', pause: src.pause || 0, note: src.note || '',
      travel: src.travel || 0, back: src.back || 0, km: src.km || 0, kmBack: src.kmBack || 0,
    };
    if (isPrivate(src) && src.title) copy.title = src.title;
    state.shifts.push(copy);
    added++;
  }
  save();
  $('copy-dialog').close();
  const skipped = copyDates.size - added;
  toast(added
    ? `${added} Termin${added === 1 ? '' : 'e'} kopiert` + (skipped ? ` (${skipped} gab es schon)` : '')
    : 'War schon eingetragen – nichts kopiert');
  render();
});

$('copy-cancel').addEventListener('click', () => $('copy-dialog').close());
$('copy-prev').addEventListener('click', () => { shiftMonth(copyView, -1); renderCopyGrid(); });
$('copy-next').addEventListener('click', () => { shiftMonth(copyView, 1); renderCopyGrid(); });
['shift-start', 'shift-end', 'shift-date', 'shift-note'].forEach(id => $(id).addEventListener('input', updateShiftPreview));
$('shift-pause').addEventListener('input', updateShiftPreview);
['shift-travel', 'shift-km', 'shift-back', 'shift-km-back'].forEach(id => $(id).addEventListener('input', () => { travelTouched = true; }));
$('shift-note').addEventListener('change', () => { if (!editing) suggestTravel(); });
$('travel-chips').replaceChildren(...[10, 15, 20, 30, 45].map(m =>
  el('button', { type: 'button', class: 'chip', onclick: () => { $('shift-travel').value = String(m); travelTouched = true; } }, `${m} Min.`)));
setupPauseChips('shift-pause-chips', 'shift-pause', updateShiftPreview);
$('shift-date').addEventListener('change', () => {
  if (shiftType !== 'work' && (!editing || editing.kind !== 'absence')) setShiftType(shiftType);
});

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

let editingIsCategory = false;

function openEmployerDialog(emp, asCategory = false) {
  editingEmployer = emp || null;
  editingIsCategory = emp ? isCat(emp) : asCategory;
  $('employer-dialog-title').textContent = editingIsCategory
    ? (emp ? 'Kategorie bearbeiten' : 'Neue private Kategorie')
    : (emp ? 'Arbeitgeber bearbeiten' : 'Neuer Arbeitgeber');
  document.querySelectorAll('#employer-form .work-only').forEach(n => { n.hidden = editingIsCategory; });
  $('employer-name').placeholder = editingIsCategory ? 'z. B. Pferde, Arzt, Familie' : '';
  $('employer-name').value = emp ? emp.name : '';
  $('employer-items').value = emp && emp.items ? emp.items.join('\n') : '';
  $('employer-rate').value = emp && emp.rate ? String(emp.rate).replace('.', ',') : '';
  $('employer-minijob').checked = !!(emp && emp.limit);
  $('employer-limit').value = emp && emp.limit ? String(emp.limit).replace('.', ',') : '';
  $('limit-field').hidden = !$('employer-minijob').checked;
  $('employer-travelpay').value = emp && emp.travelPay || 'none';
  $('employer-km').checked = !!(emp && emp.kmEnabled);
  $('kmrate-field').hidden = !$('employer-km').checked;
  writeNum('employer-kmrate', emp && emp.kmRate);
  const acc = emp && emp.account;
  $('employer-account').checked = !!acc;
  $('account-fields').hidden = !acc;
  $('account-amount').value = acc ? String(acc.amount).replace('.', ',') : '';
  $('account-unit').value = acc ? acc.unit : 'week';
  $('account-start').value = acc ? acc.start : todayISO();
  $('account-opening').value = acc && acc.opening ? String(acc.opening).replace('.', ',') : '';
  $('account-nominus').checked = acc ? isNoMinus(emp) : !!(emp && emp.limit);
  updateLimitSuggestion();
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
  if (editingIsCategory) {
    const items = $('employer-items').value.split('\n').map(x => x.trim()).filter(Boolean);
    const data = { name, color: employerColor, items, private: true };
    if (editingEmployer) Object.assign(editingEmployer, data);
    else state.employers.push({ id: uid(), ...data });
    save();
    $('employer-dialog').close();
    render();
    return;
  }
  const num = id => { const v = parseFloat(String($(id).value).replace(',', '.')); return isFinite(v) && v > 0 ? v : null; };
  const limit = $('employer-minijob').checked ? num('employer-limit') : null;
  if ($('employer-minijob').checked && !limit) { toast('Bitte die Verdienstgrenze eintragen'); return; }
  let account = null;
  if ($('employer-account').checked) {
    const amount = num('account-amount');
    if (!amount) { toast('Bitte die Sollstunden eintragen'); return; }
    const opening = parseHours($('account-opening').value, true);
    account = {
      amount, unit: $('account-unit').value, start: $('account-start').value || todayISO(),
      opening: opening ? opening / 60 : 0, noMinus: $('account-nominus').checked,
    };
  }
  const items = $('employer-items').value.split('\n').map(x => x.trim()).filter(Boolean);
  const kmEnabled = $('employer-km').checked;
  const data = {
    name, color: employerColor, rate: num('employer-rate'), limit, account, items,
    travelPay: $('employer-travelpay').value, kmEnabled, kmRate: kmEnabled ? (num('employer-kmrate') || null) : null,
  };
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

$('employer-minijob').addEventListener('change', e => {
  $('limit-field').hidden = !e.target.checked;
  if (e.target.checked && !$('employer-limit').value) $('employer-limit').value = String(MINIJOB_LIMIT);
  $('account-nominus').checked = e.target.checked;
  updateLimitSuggestion();
});

// Minijob: Soll-Stunden aus Grenze ÷ Stundenlohn vorschlagen
function limitHours() {
  const rate = parseFloat(String($('employer-rate').value).replace(',', '.'));
  const limit = parseFloat(String($('employer-limit').value).replace(',', '.'));
  if (!$('employer-minijob').checked || !(rate > 0) || !(limit > 0)) return null;
  return Math.floor(limit / rate * 100) / 100;
}
function updateLimitSuggestion() {
  const h = limitHours();
  const b = $('account-from-limit');
  b.hidden = h == null;
  if (h != null) b.textContent = `Aus Minijob-Grenze übernehmen: ${String(h).replace('.', ',')} Std. / Monat`;
}
$('account-from-limit').addEventListener('click', () => {
  const h = limitHours();
  if (h == null) return;
  $('account-amount').value = String(h).replace('.', ',');
  $('account-unit').value = 'month';
});
$('employer-account').addEventListener('change', e => {
  $('account-fields').hidden = !e.target.checked;
  if (e.target.checked && !$('account-start').value) $('account-start').value = todayISO();
  if (e.target.checked && !editingEmployer?.account) $('account-nominus').checked = $('employer-minijob').checked;
});
['employer-rate', 'employer-limit'].forEach(id => $(id).addEventListener('input', updateLimitSuggestion));

$('employer-cancel').addEventListener('click', () => $('employer-dialog').close());
$('employer-km').addEventListener('change', e => { $('kmrate-field').hidden = !e.target.checked; });

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
    pause: readPause('plan-pause'),
    travel: readNum('plan-travel'), back: readNum('plan-back'),
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
  writePause('plan-pause', plan && plan.pause);
  writeNum('plan-travel', plan && plan.travel); writeNum('plan-back', plan && plan.back);
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
  if (data.pause >= durationMin(data.start, data.end)) { toast('Die Pause ist länger als die Schicht'); return; }
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
setupPauseChips('plan-pause-chips', 'plan-pause', () => {});

/* ---------- Stunden ---------- */

function renderStats() {
  const { year, month } = statsMonth;
  $('stats-label').textContent = monthName(year, month);
  const days = new Date(year, month + 1, 0).getDate();
  // Termine pro Tag nur einmal berechnen (Stundenkonto rechnet ggf. viele Tage durch)
  const memo = new Map();
  const occ = d => { if (!memo.has(d)) memo.set(d, occurrencesOn(d)); return memo.get(d); };
  const per = new Map(workEmployers().map(e => [e.id, { min: 0, planned: 0, count: 0, credit: 0, travel: 0, paidTravel: 0, km: 0 }]));
  for (let d = 1; d <= days; d++) {
    const list = occ(toISO(new Date(year, month, d)));
    for (const o of list) {
      const p = per.get(o.employerId);
      if (!p) continue; // private Termine zählen nicht
      if (isCredit(o)) p.credit += occMinutes(o);
      else p.count++;
    }
    for (const [id, t] of dayTotals(list)) {
      const p = per.get(id);
      if (!p) continue;
      p.min += paidMinutes(t); // Arbeit + bezahlte Fahrzeit
      p.travel += t.travel; p.paidTravel += t.paidTravel; p.km += t.km;
    }
    for (const [id, t] of dayTotals(list, notDone)) if (per.has(id)) per.get(id).planned += paidMinutes(t);
  }

  const box = $('stats');
  box.replaceChildren();
  if (!workEmployers().length) {
    box.append(el('div', { class: 'empty' }, 'Noch keine Arbeitgeber angelegt.'));
    return;
  }

  const max = Math.max(1, ...[...per.values()].map(p => p.min));
  let totalMin = 0, totalMoney = 0, anyRate = false, totalTravel = 0, totalUnpaidTravel = 0, totalKmMoney = 0, totalPlanned = 0, totalPlannedMoney = 0;
  const splitText = (done, planned) => done ? `✓ ${fmtHours(done)} erledigt · 📅 ${fmtHours(planned)} geplant` : '📅 alles noch geplant';
  const card = el('div', { class: 'card' });
  for (const e of workEmployers()) {
    const p = per.get(e.id);
    totalMin += p.min;
    totalPlanned += p.planned;
    if (e.rate) totalPlannedMoney += (p.planned / 60) * e.rate;
    totalTravel += p.travel; totalUnpaidTravel += p.travel - p.paidTravel;
    const kmMoney = e.kmEnabled && e.kmRate ? p.km * e.kmRate : 0;
    totalKmMoney += kmMoney;
    let money = null;
    if (e.rate) { anyRate = true; money = (p.min / 60) * e.rate; totalMoney += money; }
    card.append(el('div', { class: 'stat-row' },
      el('i', { class: 'dot', style: `background:${e.color}` }),
      el('div', { class: 'grow' },
        el('div', {}, e.name),
        el('small', {}, `${p.count} Termin${p.count === 1 ? '' : 'e'}` + (p.credit ? ` · davon ${fmtHours(p.credit)} Urlaub/Krank/Feiertag` : '')),
        p.travel ? el('small', { class: 'block' }, `🚗 ${fmtHours(p.travel)} Fahrzeit` + (p.paidTravel ? (p.paidTravel === p.travel ? ' (bezahlt, schon in den Stunden)' : ` (davon ${fmtHours(p.paidTravel)} bezahlt, schon in den Stunden)`) : ' (unbezahlt)')) : null,
        e.kmEnabled && p.km ? el('small', { class: 'block' }, `🛣️ ${fmtKm(p.km)}` + (kmMoney ? ` · ${fmtMoney(kmMoney)} Kilometergeld` : '')) : null,
        p.planned ? el('small', { class: 'block' }, splitText(p.min - p.planned, p.planned)) : null,
        el('div', { class: 'bar split' },
          el('div', { style: `width:${((p.min - p.planned) / max) * 100}%;background:${e.color}` }),
          el('div', { class: 'planned', style: `width:${(p.planned / max) * 100}%;--c:${e.color}` }))),
      el('div', {},
        el('div', { class: 'stat-hours' }, fmtHours(p.min)),
        money != null ? el('div', { class: 'stat-money' }, fmtMoney(money)) : null)));
  }
  box.append(card);

  // Minijob-Grenze: Balken pro Arbeitgeber mit Verdienstgrenze
  for (const e of workEmployers().filter(x => x.limit)) {
    const limitCard = el('div', { class: 'card' }, el('h2', {}, `Minijob-Grenze · ${e.name}`));
    if (!e.rate) {
      limitCard.append(el('p', { class: 'hint' }, 'Trag unter Einstellungen den Stundenlohn ein, dann siehst du hier, wie viel noch frei ist.'));
    } else {
      const earned = (per.get(e.id).min / 60) * e.rate;
      const earnedDone = ((per.get(e.id).min - per.get(e.id).planned) / 60) * e.rate;
      const ratio = earned / e.limit;
      const level = ratio > 1 ? 'over' : ratio >= 0.85 ? 'near' : 'ok';
      const left = e.limit - earned;
      limitCard.append(
        el('div', { class: 'limit-head' }, el('strong', {}, fmtMoney(earned)), el('span', {}, `von ${fmtMoney(e.limit)}`)),
        earned > earnedDone ? el('p', { class: 'hint', style: 'margin:2px 0 0' }, `davon ${fmtMoney(earnedDone)} schon verdient, ${fmtMoney(earned - earnedDone)} geplant`) : '',
        el('div', { class: 'bar big split' },
          el('div', { class: 'limit-' + level, style: `width:${Math.min(earnedDone / e.limit, 1) * 100}%` }),
          el('div', { class: 'planned limit-' + level, style: `width:${Math.max(0, Math.min(ratio, 1) - Math.min(earnedDone / e.limit, 1)) * 100}%` })),
        el('p', { class: 'hint limit-text ' + level }, left >= 0
          ? `Noch ${fmtMoney(left)} frei – das sind etwa ${fmtHours(Math.floor((left / e.rate) * 60 / 15) * 15)}`
          : e.account
            ? `${fmtMoney(-left)} über der Grenze – das sind ${fmtHours(Math.round(-left / e.rate * 60))}, die als Plus auf dein Stundenkonto gehen (wenn das mit deinem Arbeitgeber so vereinbart ist).`
            : `⚠️ ${fmtMoney(-left)} über der Grenze! Am besten Termine verschieben oder mit dem Arbeitgeber sprechen.`));
    }
    box.append(limitCard);
  }
  // Stundenkonto pro Arbeitgeber (geplant = ab Kontostart, noch nicht erledigt)
  const plannedOf = e => {
    let m = 0;
    for (let d = 1; d <= days; d++) {
      const iso = toISO(new Date(year, month, d));
      if (iso >= e.account.start) m += paidMinutes(dayTotals(occ(iso), notDone).get(e.id));
    }
    return m;
  };
  const mStart = toISO(new Date(year, month, 1)), mEnd = toISO(new Date(year, month, days));
  const today = todayISO();
  for (const e of workEmployers().filter(x => x.account)) {
    const acc = e.account;
    const accCard = el('div', { class: 'card' }, el('h2', {}, `Stundenkonto · ${e.name}`));
    if (mEnd < acc.start) {
      accCard.append(el('p', { class: 'hint' }, `Das Stundenkonto beginnt am ${fmtShortDate(acc.start)}.`));
    } else {
      const r = accountRange(e, mStart, mEnd, occ);
      const row = (label, value, cls = '') => el('div', { class: 'acc-row ' + cls }, el('span', {}, label), el('span', {}, value));
      const sollText = `Soll: ${String(acc.amount).replace('.', ',')} Std. pro ${acc.unit === 'week' ? 'Woche' : 'Monat'}` + (acc.start > mStart ? ` · ab ${fmtShortDate(acc.start)} anteilig` : '');
      if (isNoMinus(e)) {
        const carry = plusCarry(e, year, month, occ);
        const diff = r.ist - r.soll;
        const endPlus = Math.max(0, carry + diff);
        accCard.append(
          el('p', { class: 'hint' }, sollText + ' · keine Minusstunden'),
          row('Plus aus Vormonaten', fmtSigned(carry), carry > 0 ? 'plus' : ''),
          row('Soll diesen Monat', fmtHours(Math.round(r.soll))),
          row('Ist (inkl. geplant)', fmtHours(Math.round(r.ist))),
          plannedOf(e) ? row('davon noch geplant', fmtHours(Math.round(plannedOf(e))), 'sub') : '');
        if (diff >= 0) accCard.append(row('Neue Plusstunden', fmtSigned(diff), diff > 0 ? 'plus' : ''));
        else if (carry > 0) accCard.append(row('Plus abgebaut', fmtHours(Math.round(Math.min(carry, -diff)))));
        accCard.append(row(`Plusstunden Ende ${new Date(year, month, 1).toLocaleDateString('de-DE', { month: 'long' })}`, fmtSigned(endPlus), 'big ' + (endPlus > 0 ? 'plus' : '')));
        if (carry + diff < 0) {
          accCard.append(el('p', { class: 'hint' }, `Noch ${fmtHours(Math.round(-(carry + diff)))} bis zum Soll frei – kein Minus, es wird einfach nur ausgezahlt, was du arbeitest.`));
        }
        box.append(accCard);
        continue;
      }
      const end = accountBalance(e, mEnd, occ);
      accCard.append(
        el('p', { class: 'hint' }, sollText),
        row('Soll diesen Monat', fmtHours(Math.round(r.soll))),
        row('Ist (inkl. geplant)', fmtHours(Math.round(r.ist))),
        plannedOf(e) ? row('davon noch geplant', fmtHours(Math.round(plannedOf(e))), 'sub') : '',
        row('Plus/Minus diesen Monat', fmtSigned(r.ist - r.soll), r.ist - r.soll >= 0 ? 'plus' : 'minus'));
      if (today >= mStart && today <= mEnd && today >= acc.start) {
        const now = accountBalance(e, today, occ);
        accCard.append(row('Kontostand heute', fmtSigned(now), 'big ' + (now >= 0 ? 'plus' : 'minus')));
      }
      accCard.append(row(`Kontostand Ende ${new Date(year, month, 1).toLocaleDateString('de-DE', { month: 'long' })}`, fmtSigned(end), 'big ' + (end >= 0 ? 'plus' : 'minus')));
    }
    box.append(accCard);
  }

  const sub = (label, value) => el('div', { class: 'total', style: 'font-weight:500;color:var(--muted);font-size:.95rem;margin-top:4px' },
    el('span', {}, label), el('span', {}, value));
  box.append(el('div', { class: 'card' },
    el('div', { class: 'total' }, el('span', {}, 'Gesamt'), el('span', {}, fmtHours(totalMin))),
    totalPlanned ? sub('✓ davon erledigt', fmtHours(totalMin - totalPlanned)) : null,
    totalPlanned ? sub('📅 noch geplant', fmtHours(totalPlanned)) : null,
    anyRate ? sub(totalPlanned ? 'Verdienst (inkl. geplant)' : 'Verdienst', fmtMoney(totalMoney)) : null,
    anyRate && totalPlanned ? sub('bisher verdient', fmtMoney(totalMoney - totalPlannedMoney)) : null,
    totalKmMoney ? sub('Kilometergeld', fmtMoney(totalKmMoney)) : null,
    totalTravel ? sub('Unbezahlte Fahrzeit', fmtHours(totalUnpaidTravel)) : null,
    totalTravel ? el('div', { class: 'total', style: 'margin-top:10px' },
      el('span', {}, '🚗 Unterwegs insgesamt'), el('span', {}, fmtHours(totalMin + totalUnpaidTravel))) : null));
  if (!anyRate) box.append(el('p', { class: 'hint center' }, 'Tipp: Trag unter Einstellungen einen Stundenlohn ein, dann siehst du hier auch den Verdienst.'));
}

/* ---------- Einstellungen ---------- */

function renderSettings() {
  const el1 = $('employer-list');
  el1.replaceChildren(...workEmployers().map(e =>
    el('button', { class: 'list-item', onclick: () => openEmployerDialog(e) },
      el('i', { class: 'dot', style: `background:${e.color};width:18px;height:18px` }),
      el('span', { class: 'grow' }, e.name, e.rate ? el('small', {}, fmtMoney(e.rate) + ' / Std.') : null),
      el('span', { class: 'hint' }, '›'))));
  if (!workEmployers().length) el1.append(el('p', { class: 'hint' }, 'Noch keine Arbeitgeber.'));

  const elc = $('category-list');
  elc.replaceChildren(...categories().map(e =>
    el('button', { class: 'list-item', onclick: () => openEmployerDialog(e) },
      el('i', { class: 'dot', style: `background:${e.color};width:18px;height:18px` }),
      el('span', { class: 'grow' }, e.name, e.items && e.items.length ? el('small', {}, 'Mitnehmen: ' + e.items.join(', ')) : null),
      el('span', { class: 'hint' }, '›'))));
  if (!categories().length) elc.append(el('p', { class: 'hint' }, 'Noch keine Kategorien.'));

  renderBirthdayList();
  renderImportList();

  const el2 = $('plan-list');
  el2.replaceChildren(...state.plans.filter(p => employerById(p.employerId)).map(p => {
    const emp = employerById(p.employerId);
    const days = p.weekdays.map(d => WEEKDAYS[d - 1]).join(', ');
    const range = 'ab ' + fmtShortDate(p.from) + (p.until ? ' bis ' + fmtShortDate(p.until) : '');
    return el('button', { class: 'list-item', onclick: () => openPlanDialog(p) },
      el('i', { class: 'dot', style: `background:${emp.color};width:18px;height:18px` }),
      el('span', { class: 'grow' }, `${days} · ${p.start}–${p.end}`, el('small', {}, `${emp.name}` + (p.pause ? ` · ${p.pause} Min. Pause` : '') + ` · ${range}`)),
      el('span', { class: 'hint' }, '›'));
  }));
  if (!state.plans.length) el2.append(el('p', { class: 'hint' }, 'Keine festen Wochenzeiten.'));

  $('reminder').value = String(state.settings.reminder ?? 60);
  $('region').value = state.settings.region || '';
  $('min-gap').value = String(minGap());
  $('last-backup').textContent = state.lastBackup
    ? 'Letzte Sicherung: ' + new Date(state.lastBackup).toLocaleDateString('de-DE')
    : 'Noch keine Sicherung gemacht.';
}

$('add-employer').addEventListener('click', () => openEmployerDialog());
$('add-category').addEventListener('click', () => openEmployerDialog(null, true));
$('add-plan').addEventListener('click', () => openPlanDialog());
$('reminder').addEventListener('change', e => { state.settings.reminder = Number(e.target.value); save(); });
$('region').replaceChildren(el('option', { value: '' }, '– keine Feiertage –'),
  ...Object.entries(REGIONS).map(([k, v]) => el('option', { value: k }, v)));
$('min-gap').addEventListener('change', e => { state.settings.minGap = Number(e.target.value); save(); });
$('region').addEventListener('change', e => {
  state.settings.region = e.target.value || null;
  save();
  toast(e.target.value ? 'Feiertage für ' + REGIONS[e.target.value] + ' aktiv' : 'Feiertage ausgeschaltet');
});

/* ---------- Geburtstage verwalten ---------- */

let editingBirthday = null;

function renderBirthdayList() {
  const list = [...(state.birthdays || [])].sort((a, b) => a.date.slice(5).localeCompare(b.date.slice(5)));
  $('birthday-list').replaceChildren(...list.map(b =>
    el('button', { class: 'list-item', onclick: () => openBirthdayDialog(b) },
      el('span', {}, '🎂'),
      el('span', { class: 'grow' }, b.name,
        el('small', {}, fromISO(b.date).toLocaleDateString('de-DE', b.showAge ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'long' }))),
      el('span', { class: 'hint' }, '›'))));
  if (!list.length) $('birthday-list').append(el('p', { class: 'hint' }, 'Noch keine Geburtstage.'));
}

function openBirthdayDialog(b) {
  editingBirthday = b || null;
  $('bday-name').value = b ? b.name : '';
  $('bday-date').value = b ? b.date : '';
  $('bday-age').checked = b ? !!b.showAge : true;
  $('bday-delete').hidden = !b;
  $('bday-dialog').showModal();
}

$('bday-form').addEventListener('submit', e => {
  e.preventDefault();
  const data = { name: $('bday-name').value.trim(), date: $('bday-date').value, showAge: $('bday-age').checked };
  if (!data.name || !data.date) return;
  state.birthdays = state.birthdays || [];
  if (editingBirthday) Object.assign(editingBirthday, data);
  else state.birthdays.push({ id: uid(), ...data });
  save();
  $('bday-dialog').close();
  render();
});
$('bday-delete').addEventListener('click', () => {
  if (!confirm(`Geburtstag von ${editingBirthday.name} löschen?`)) return;
  state.birthdays = state.birthdays.filter(b => b !== editingBirthday);
  save();
  $('bday-dialog').close();
  render();
});
$('bday-cancel').addEventListener('click', () => $('bday-dialog').close());
$('add-birthday').addEventListener('click', () => openBirthdayDialog());

/* ---------- Kalender importieren ---------- */

function renderImportList() {
  $('import-list').replaceChildren(...(state.imports || []).map(imp => {
    const upcoming = imp.events.filter(ev => ev.d >= todayISO());
    return el('div', { class: 'list-item' },
      el('span', {}, '📅'),
      el('span', { class: 'grow' }, imp.name,
        el('small', {}, `${upcoming.length} kommende Termine` + (upcoming.length ? ` · bis ${fmtShortDate(upcoming[upcoming.length - 1].d)}` : ''))),
      el('button', {
        class: 'btn danger small', type: 'button',
        onclick: () => {
          if (!confirm(`„${imp.name}“ entfernen?`)) return;
          state.imports = state.imports.filter(x => x !== imp);
          save(); render();
        },
      }, 'Entfernen'));
  }));
}

$('import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const { calName, events } = parseICS(await file.text());
    const from = addDays(todayISO(), -31);
    const t = new Date(); t.setFullYear(t.getFullYear() + 2);
    const to = toISO(t);
    const out = [];
    for (const ev of events) {
      for (const d of expandEvent(ev, from, to)) out.push({ d, t: ev.title || 'Termin', time: ev.start.time || undefined });
    }
    if (!out.length) { toast('In der Datei wurden keine kommenden Termine gefunden'); return; }
    out.sort((a, b) => a.d.localeCompare(b.d));
    const name = (calName || file.name.replace(/\.ics$/i, '')).slice(0, 60);
    state.imports = (state.imports || []).filter(x => x.name !== name); // gleiche Datei nochmal = ersetzen
    state.imports.push({ id: uid(), name, events: out });
    save();
    toast(`${out.length} Termine aus „${name}“ importiert`);
    render();
  } catch (err) {
    toast('Die Datei konnte nicht gelesen werden');
  }
});

/* ---------- Google Kalender & ICS ---------- */

const compact = (date, time) => date.replace(/-/g, '') + 'T' + time.replace(':', '') + '00';

function endDate(o) {
  return toMin(endTime(o)) <= toMin(o.start) ? addDays(o.date, 1) : o.date;
}

function eventTitle(o) {
  if (isPrivate(o)) return (o.title || (employerById(o.employerId) || {}).name || 'Termin') + (o.note ? ' – ' + o.note : '');
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
      if (isCredit(o)) continue;
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
    importIndex = null;
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

['shift-dialog', 'employer-dialog', 'plan-dialog', 'copy-dialog', 'bday-dialog'].forEach(id => closeOnBackdrop($(id)));

if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
if ('serviceWorker' in navigator) {
  // Updates automatisch laden: beim Öffnen/Zurückkehren nach neuer Version fragen,
  // und sobald eine neue Version aktiv ist, die Seite einmal neu laden.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    const busy = [...document.querySelectorAll('dialog')].some(d => d.open);
    if (busy) return; // nicht mitten im Eintragen neu laden – kommt beim nächsten Öffnen
    reloading = true;
    location.reload();
  });
}

render();
