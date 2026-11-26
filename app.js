import * as S from './store.js';
import { PHRASES } from './phrases.js';
import * as D from './docs.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view'), sheet = $('#sheet');
const ui = JSON.parse(localStorage.getItem('bsb.ui') || '{}');
const saveUi = () => localStorage.setItem('bsb.ui', JSON.stringify(ui));
ui.tab ??= 'today'; ui.more ??= 'todo';
if (ui.tab === 'info') { ui.tab = 'more'; ui.more = 'info'; }
if (ui.more === 'thai') ui.more = 'info';
ui.dir ??= 'thb'; ui.open ??= {};

/* ---------- dates ---------- */
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const dayDate = (s) => new Date(`${s}T12:00:00`);
const fmtDay = (s, o = { weekday: 'short', day: 'numeric', month: 'short' }) => dayDate(s).toLocaleDateString('en-GB', o);
const addDays = (s, n) => { const d = dayDate(s); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (a, b) => Math.round((dayDate(b) - dayDate(a)) / 864e5);
const instant = (p) => p.date && p.time ? new Date(`${p.date}T${p.time}:00${p.tz || '+07:00'}`) : null;

const legs = () => S.all('leg').sort((a, b) => a.from.localeCompare(b.from));
const plans = () => S.all('plan');
const legFor = (date) => { const L = legs(); return L.find((l, i) => date >= l.from && (date < l.to || (i === L.length - 1 && date <= l.to))); };
const byTime = (a, b) => (a.time || '99').localeCompare(b.time || '99') || (a.u - b.u);

function countdownParts(ms) {
  const m = Math.max(0, Math.floor(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return { d, h, m: m % 60 };
}
function rel(ms) {
  const { d, h, m } = countdownParts(ms);
  return d > 1 ? `in ${d} days` : d === 1 ? `in 1 day ${h}h` : h ? `in ${h}h ${m}m` : `in ${m} min`;
}

/* ---------- shell ---------- */
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2200); }
function setTab(tab) { ui.tab = tab; saveUi(); render(); window.scrollTo(0, 0); }
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); });
$('#syncdot').addEventListener('click', () => { ui.tab = 'more'; ui.more = 'settings'; saveUi(); render(); S.sync(); });

function render() {
  document.body.dataset.tab = S.cfg.pass ? ui.tab : 'setup';
  const order = ['today', 'plan', 'convert', 'translate', 'more'];
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  $('#tabs').style.setProperty('--i', order.indexOf(ui.tab));
  $('#title').textContent = $('#navtitle').textContent = { today: 'Today', plan: 'Plan', convert: 'Convert', translate: 'Translate', more: 'More' }[ui.tab];
  const st = S.status.state, dot = $('#syncdot');
  dot.className = S.isDirty() && st !== 'syncing' ? (st === 'error' ? 'error' : 'pending') : st;
  if (!S.cfg.pass) return renderSetup();
  ({ today: renderToday, plan: renderPlan, convert: renderConvert, translate: renderTranslate, more: renderMore }[ui.tab])();
}

/* ---------- setup ---------- */
function renderSetup() {
  view.innerHTML = `<div class="setup"><img src="icons/logo-192.png" alt=""><h2>BSB Travel</h2>
    <p>Enter the family passphrase to unlock the trip on this phone.</p>
    <input id="pass" type="text" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Passphrase">
    <input id="tok" type="text" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="GitHub token (needed to save changes)">
    <button class="btn" id="unlock">Unlock</button><p class="err" id="err"></p></div>`;
  $('#unlock').onclick = async () => {
    const b = $('#unlock'); b.disabled = true; b.textContent = 'Unlocking…';
    try { await S.unlock($('#pass').value.trim(), $('#tok').value.trim()); ui.tab = 'today'; render(); }
    catch (e) { $('#err').textContent = e instanceof TypeError ? 'No connection. You need signal the first time.' : e.message; b.disabled = false; b.textContent = 'Unlock'; }
  };
}

/* ---------- today ---------- */
function planRow(p, showDate) {
  return `<li class="row ${p.done ? 'done' : ''}" data-edit="${p.id}">
    <button class="tick" data-tick="${p.id}" aria-label="Done">${p.done ? '✓' : ''}</button>
    <div class="grow"><div class="t">${p.key ? '<i class="keydot"></i>' : ''}${esc(p.title)}</div>
    ${p.note ? `<div class="s">${esc(p.note)}</div>` : ''}${lkChip(p)}</div>
    <div class="time">${showDate && p.date ? esc(fmtDay(p.date, { day: 'numeric', month: 'short' })) + '<br>' : ''}${esc(p.time || '')}</div></li>`;
}

const ZONES = [['gbp', 'UK', 'Europe/London'], ['thb', 'Thailand', 'Asia/Bangkok']];
function clocksHTML(now) {
  const parts = (tz) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  const wall = (o) => Date.parse(`${o.day} ${o.month} ${o.year} ${o.hour}:${o.minute} UTC`);
  const P = ZONES.map(([, , tz]) => parts(tz)), diff = Math.round((wall(P[1]) - wall(P[0])) / 36e5);
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `<div class="clocks">${ZONES.map(([f, name, tz], i) => `<div class="clock glass${tz === here ? ' here' : ''}">${FLAG[f]}<div><small>${name}${tz === here ? ' · you' : ''}</small><b>${P[i].hour}:${P[i].minute}</b><span>${P[i].weekday} ${P[i].day} ${P[i].month}</span></div></div>`).join('')}</div>
    <p class="count ahead">Thailand is ${diff} hours ahead of the UK</p>`;
}
function renderToday() {
  const now = new Date(), t = today(), L = legs();
  const start = L[0]?.from, end = L.at(-1)?.to;
  const upcoming = plans().filter((p) => p.key && instant(p) && instant(p) > now).sort((a, b) => instant(a) - instant(b));
  const next = upcoming[0], leg = legFor(t);
  let hero;
  if (!L.length) hero = `<div class="hero"><div class="where">No trip loaded yet</div></div>`;
  else {
    const c = next ? countdownParts(instant(next) - now) : null;
    const where = t < start ? 'Countdown to take-off' : t > end ? 'Welcome home' : `${leg?.emoji || ''} ${esc(leg?.name || '')}`;
    const sub = t < start ? `${fmtDay(start)} to ${fmtDay(end)}` : t > end ? '' :
      `Day ${daysBetween(start, t) + 1} of ${daysBetween(start, end) + 1}` + (leg && leg.to > leg.from ? ` · ${daysBetween(t, leg.to)} night${daysBetween(t, leg.to) === 1 ? "" : "s"} left here` : '');
    const stay = t >= start && t <= end ? currentStay(t, leg) : null;
    hero = `<div class="hero"><div class="where">${where}</div><div class="sub">${esc(sub)}</div>
      ${stay ? `<button class="staybtn" data-info="${stay.id}">Staying at <b>${esc(stay.title.split(',')[0])}</b><span>›</span></button>` : ''}
      ${next ? `<div class="herolink" data-edit="${next.id}"><div class="cd"><div><b>${c.d}</b>days</div><div><b>${c.h}</b>hrs</div><div><b>${c.m}</b>min</div></div>
      <div class="until">until <b>${esc(next.title)}</b><br>${esc(fmtDay(next.date))} at ${esc(next.time)}${linked(next) ? ' ›' : ''}</div></div>` : ''}</div>`;
  }
  const todays = plans().filter((p) => p.date === t).sort(byTime);
  const todos = S.all('todo').filter((x) => x.list === 'todo' && !x.done).slice(0, 5);
  view.innerHTML = hero + clocksHTML(now) +
    `<h3>Today, ${esc(fmtDay(t))} <button class="add" data-add="plan" data-date="${t}">＋</button></h3>
     ${todays.length ? `<ul class="list">${todays.map((p) => planRow(p)).join('')}</ul>` : `<p class="empty">Nothing planned today.</p>`}
     ${upcoming.length > 1 ? `<h3>Coming up</h3><ul class="list">${upcoming.slice(1, 6).map((p) =>
       `<li class="row" data-edit="${p.id}"><div class="grow"><div class="t">${esc(p.title)}</div><div class="s">${esc(fmtDay(p.date))} at ${esc(p.time)}</div></div><div class="time">${rel(instant(p) - now)}</div></li>`).join('')}</ul>` : ''}
     ${todos.length ? `<h3>Still to do</h3><ul class="list">${todos.map(todoRow).join('')}</ul>` : ''}`;
}

/* ---------- plan ---------- */
function renderPlan() {
  const t = today(), L = legs(), P = plans();
  const cur = legFor(t) || L.find((l) => l.from >= t) || L[0];
  view.innerHTML = L.map((l, i) => {
    const open = ui.open[l.id] ?? (l === cur);
    const lastDay = i === L.length - 1 ? l.to : addDays(l.to, -1);
    let days = '';
    if (open) {
      for (let d = l.from; d <= (l.to === l.from ? l.to : lastDay); d = addDays(d, 1)) {
        const items = P.filter((p) => p.date === d).sort(byTime);
        days += `<div class="day ${d === t ? 'isToday' : ''}"><h4>${esc(fmtDay(d))}${d === t ? ' · today' : ''}<button class="add" data-add="plan" data-date="${d}">＋</button></h4>
          ${items.length ? `<ul class="list">${items.map((p) => planRow(p)).join('')}</ul>` : ''}</div>`;
      }
      const ideas = P.filter((p) => !p.date && p.leg === l.id).sort((a, b) => a.u - b.u);
      days += `<div class="day ideas"><h4>Ideas, no date yet<button class="add" data-add="plan" data-leg="${l.id}">＋</button></h4>
        ${ideas.length ? `<ul class="list">${ideas.map((p) => planRow(p)).join('')}</ul>` : ''}</div>`;
    }
    const n = P.filter((p) => (p.date && legFor(p.date) === l) || (!p.date && p.leg === l.id)).length;
    return `<section class="leg ${open ? 'open' : ''}"><button class="leghead" data-leg="${l.id}">
      <span class="em">${l.emoji || '📍'}</span><span class="grow"><b>${esc(l.name)}</b><small>${esc(fmtDay(l.from, { day: 'numeric', month: 'short' }))} to ${esc(fmtDay(l.to, { day: 'numeric', month: 'short' }))}${l.to > l.from ? ` · ${daysBetween(l.from, l.to)} night${daysBetween(l.from, l.to) === 1 ? "" : "s"}` : ''} · ${n} plans</small></span>
      <span class="chev">${open ? '▾' : '▸'}</span></button>${days}</section>`;
  }).join('') || '<p class="empty">No trip loaded yet.</p>';
  view.querySelectorAll('.leghead').forEach((b) => (b.onclick = () => { const id = b.dataset.leg, l = L.find((x) => x.id === id); ui.open[id] = !(ui.open[id] ?? (l === cur)); saveUi(); render(); }));
}

const planFields = () => [
  { k: 'title', label: 'What', type: 'text', required: true },
  { k: 'date', label: 'Date (leave empty for an idea)', type: 'date' },
  { k: 'time', label: 'Time', type: 'time' },
  { k: 'leg', label: 'Place (for ideas without a date)', type: 'select', options: [['', 'Auto from date'], ...legs().map((l) => [l.id, l.name])] },
  { k: 'link', label: 'Booking (opens with the plan)', type: 'select', options: linkOptions() },
  { k: 'note', label: 'Notes', type: 'textarea' },
  { k: 'key', label: 'Show as a countdown on Today (needs date and time)', type: 'checkbox' },
  { k: 'done', label: 'Done', type: 'checkbox' },
];

/* ---------- converter ---------- */
// rate.rate = baht per £1 (may be set by hand). rate.rates = market rates per £1 for the other currencies.
const rate = JSON.parse(localStorage.getItem('bsb.rate') || '{"rate":43.5,"at":0,"manual":false}');
const saveRate = () => localStorage.setItem('bsb.rate', JSON.stringify(rate));
const ROUGH = { EUR: 1.15, RON: 5.85, USD: 1.32 };
const CUR = { thb: ['THB', 'Thai baht', '฿'], gbp: ['GBP', 'British pounds', '£'], eur: ['EUR', 'Euros', '€'], ron: ['RON', 'Romanian lei', ' lei'], usd: ['USD', 'US dollars', '$'] };
const perGBP = (c) => c === 'gbp' ? 1 : c === 'thb' ? rate.rate : rate.rates?.[CUR[c][0]] || ROUGH[CUR[c][0]];
const withSym = (c, s) => c === 'ron' ? s + ' lei' : CUR[c][2] + s;
// The converter always opens on ฿ and £; other currencies last until the app is closed.
const cv = { from: ui.dir === 'gbp' ? 'gbp' : 'thb' }; cv.to = cv.from === 'thb' ? 'gbp' : 'thb';
const isDefault = () => [cv.from, cv.to].sort().join() === 'gbp,thb';
let amount = '';
async function refreshRate(force) {
  if (!force && rate.rates && (rate.manual || Date.now() - rate.at < 6 * 36e5)) return 'skip';
  const tryGet = async (url, pick) => { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw 0; const v = pick(await r.json()); if (!(v[0].THB > 10 && v[0].THB < 200)) throw 0; return v; };
  try {
    const [all, pub] = await tryGet('https://open.er-api.com/v6/latest/GBP', (j) => [j.rates, j.time_last_update_unix * 1000])
      .catch(() => tryGet('https://api.frankfurter.app/latest?from=GBP&to=THB,EUR,RON,USD', (j) => [j.rates, Date.parse(j.date + 'T12:00:00Z')]));
    rate.rates = Object.fromEntries(Object.keys(ROUGH).filter((k) => all[k] > 0).map((k) => [k, all[k]]));
    if (force || !rate.manual) { rate.rate = all.THB; rate.pub = pub || Date.now(); rate.at = Date.now(); rate.manual = false; }
    saveRate(); if (ui.tab === 'convert') paintConvert();
    return 'ok';
  } catch { return 'fail'; }
}
const money = (n, cur) => withSym(cur, cur === 'thb' ? n.toLocaleString('en-GB', { maximumFractionDigits: n < 20 ? 2 : 0 }) : n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pubDay = (t) => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const age = (at) => { if (!at) return 'not updated yet'; const m = (Date.now() - at) / 6e4; return m < 60 ? 'updated just now' : m < 1440 ? `updated ${Math.floor(m / 60)}h ago` : `updated ${Math.floor(m / 1440)}d ago`; };

const euStars = Array.from({ length: 12 }, (_, i) => { const a = i * Math.PI / 6, x = 15 + 8.6 * Math.sin(a), y = 15 - 8.6 * Math.cos(a);
  return Array.from({ length: 10 }, (_, k) => { const r = k % 2 ? 0.62 : 1.55, b = k * Math.PI / 5; return `${(x + r * Math.sin(b)).toFixed(2)},${(y - r * Math.cos(b)).toFixed(2)}`; }).join(' '); });
const FLAG = {
  thb: '<svg class="flag" viewBox="0 0 30 30" aria-hidden="true"><path fill="#A51931" d="M0 0h30v30H0z"/><path fill="#F4F5F8" d="M0 5h30v20H0z"/><path fill="#2D2A4A" d="M0 10h30v10H0z"/></svg>',
  gbp: '<svg class="flag" viewBox="15 0 30 30" aria-hidden="true"><clipPath id="uj"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/></clipPath><path d="M0,0 v30 h60 v-30 z" fill="#012169"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 L60,30 M60,0 L0,30" clip-path="url(#uj)" stroke="#C8102E" stroke-width="4"/><path d="M30,0 v30 M0,15 h60" stroke="#fff" stroke-width="10"/><path d="M30,0 v30 M0,15 h60" stroke="#C8102E" stroke-width="6"/></svg>',
  eur: `<svg class="flag" viewBox="0 0 30 30" aria-hidden="true"><path fill="#003399" d="M0 0h30v30H0z"/>${euStars.map((p) => `<polygon fill="#FFCC00" points="${p}"/>`).join('')}</svg>`,
  ron: '<svg class="flag" viewBox="0 0 30 30" aria-hidden="true"><path fill="#002B7F" d="M0 0h10v30H0z"/><path fill="#FCD116" d="M10 0h10v30H10z"/><path fill="#CE1126" d="M20 0h10v30H20z"/></svg>',
  usd: `<svg class="flag" viewBox="0 0 30 30" aria-hidden="true"><path fill="#fff" d="M0 0h30v30H0z"/>${[0, 2, 4, 6, 8, 10, 12].map((i) => `<path fill="#B22234" d="M0 ${(i * 30 / 13).toFixed(2)}h30v${(30 / 13).toFixed(2)}H0z"/>`).join('')}<path fill="#3C3B6E" d="M0 0h15v16.15H0z"/>${[[3, 3], [7.5, 3], [12, 3], [5.25, 6.5], [9.75, 6.5], [3, 10], [7.5, 10], [12, 10], [5.25, 13.3], [9.75, 13.3]].map(([x, y]) => `<circle fill="#fff" cx="${x}" cy="${y}" r=".9"/>`).join('')}</svg>`,
};
const curRow = (cur, value) => `${FLAG[cur]}<div class="grow"><small>${CUR[cur][0]} · ${CUR[cur][1]} <svg class="chev" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4"/></svg></small><b>${value}</b></div>`;
function rateLine() {
  const thbPair = cv.from === 'thb' || cv.to === 'thb', base = thbPair ? (cv.from === 'thb' ? cv.to : cv.from) : cv.from, other = base === cv.from ? cv.to : cv.from;
  const v = perGBP(other) / perGBP(base), shown = withSym(other, v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: v < 2 ? 4 : 2 }));
  const note = isDefault() && rate.manual ? 'set by you' : rate.rates ? (rate.pub ? 'rate for ' + pubDay(rate.pub) : age(rate.at)) : 'rough rate, not updated yet';
  return `${base === 'ron' ? '1 leu' : withSym(base, '1')} = ${shown} · ${note}`;
}
function paintConvert() {
  const n = parseFloat(amount) || 0, out = n / perGBP(cv.from) * perGBP(cv.to);
  $('#cfrom').innerHTML = curRow(cv.from, esc(withSym(cv.from, amount ? amount.replace(/^(\d+)/, (d) => Number(d).toLocaleString('en-GB')) : '0')));
  $('#cto').innerHTML = curRow(cv.to, money(out, cv.to));
  $('#crate').textContent = rateLine();
}
function pickCurrency(side) {
  const cur = cv[side];
  sheet.innerHTML = `<div class="panel"><header><button type="button" class="link" data-x>Cancel</button><b>Choose currency</b><span class="link"></span></header>
    <ul class="list picker">${Object.keys(CUR).map((c) => `<li><button class="row" data-cur="${c}">${FLAG[c]}<div class="grow"><b>${CUR[c][1]}</b><small>${CUR[c][0]}</small></div>${c === cur ? '<span class="curon">✓</span>' : ''}</button></li>`).join('')}</ul></div>`;
  sheet.hidden = false; document.body.classList.add('locked');
  const close = () => { sheet.hidden = true; sheet.innerHTML = ''; document.body.classList.remove('locked'); };
  sheet.onclick = (e) => {
    const b = e.target.closest('[data-cur]');
    if (b) { const other = side === 'from' ? 'to' : 'from'; if (b.dataset.cur === cv[other]) cv[other] = cv[side]; cv[side] = b.dataset.cur; if (side === 'from' && b.dataset.cur !== cur) amount = ''; if (isDefault()) { ui.dir = cv.from; saveUi(); } close(); renderConvert(); }
    else if (e.target === sheet || e.target.closest('[data-x]')) close();
  };
}
function renderConvert() {
  const quick = cv.from === 'thb' ? [20, 50, 100, 200, 500, 1000, 2000, 5000] : cv.from === 'ron' ? [5, 10, 20, 50, 100, 200, 500, 1000] : [1, 5, 10, 20, 50, 100, 200, 500];
  view.innerHTML = `<div class="conv">
    <div class="disp"><div id="cfrom" class="from" role="button" aria-label="Change currency"></div><button id="swap" aria-label="Swap currencies">⇅</button><div id="cto" class="to" role="button" aria-label="Change currency"></div></div>
    <div class="raterow"><button id="crate" class="rate"></button><button id="cref" class="refresh" aria-label="Refresh rate">↻</button></div>
    ${isDefault() ? '' : '<button id="cdef" class="backdef">Back to ฿ and £</button>'}
    <div class="quick">${quick.map((q) => `<button data-q="${q}">${esc(withSym(cv.from, q.toLocaleString('en-GB')))}</button>`).join('')}</div>
    <div class="pad">${['AC', '⌫', '⇅', '7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', '.'].map((k) => `<button data-k="${k}" class="${/\d|\./.test(k) ? '' : 'fn'}" aria-label="${{ AC: 'Clear', '⌫': 'Delete', '⇅': 'Swap currencies' }[k] || k}">${k}</button>`).join('')}</div></div>`;
  paintConvert(); refreshRate();
  const swap = () => { [cv.from, cv.to] = [cv.to, cv.from]; if (isDefault()) { ui.dir = cv.from; saveUi(); } renderConvert(); };
  const digit = (k) => { if (amount.replace('.', '').length < 9 && !/\.\d\d$/.test(amount)) amount = amount === '0' ? k : amount + k; };
  $('.conv').onclick = (e) => {
    const row = e.target.closest('#cfrom, #cto'); if (row) return pickCurrency(row.id === 'cfrom' ? 'from' : 'to');
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'swap' || b.dataset.k === '⇅') return swap();
    if (b.id === 'cdef') { cv.from = ui.dir === 'gbp' ? 'gbp' : 'thb'; cv.to = cv.from === 'thb' ? 'gbp' : 'thb'; amount = ''; return renderConvert(); }
    if (b.dataset.q) amount = b.dataset.q;
    else if (b.dataset.k) {
      const k = b.dataset.k;
      if (k === 'AC') amount = ''; else if (k === '⌫') amount = amount.slice(0, -1);
      else if (k === '00') { if (amount && amount !== '0') { digit('0'); digit('0'); } }
      else if (k === '.') { if (!amount.includes('.')) amount = (amount || '0') + '.'; }
      else digit(k);
    } else return;
    paintConvert();
  };
  $('#cref').onclick = async (e) => {
    const b = e.currentTarget; if (b.classList.contains('spin')) return;
    const wasManual = rate.manual; b.classList.add('spin');
    const [res] = await Promise.all([refreshRate(true), new Promise((r) => setTimeout(r, 600))]);
    b.classList.remove('spin'); paintConvert();
    toast(res === 'ok' ? wasManual ? 'Back to the market rate' : 'Rate updated' : 'No connection. Keeping the last rate');
  };
  $('#crate').onclick = () => isDefault() ? openSheet({
    title: 'Exchange rate', rec: { rate: rate.rate.toFixed(2), manual: rate.manual },
    fields: [{ k: 'rate', label: 'Baht for £1', type: 'number' }, { k: 'manual', label: 'Keep my rate (don\'t update automatically)', type: 'checkbox' }],
    onSave: (r) => { const v = parseFloat(r.rate); if (v > 0) { const changed = Math.abs(v - rate.rate) > 0.004; rate.rate = v; rate.manual = !!r.manual; if (changed && !r.manual) rate.at = Date.now(); saveRate(); } if (!rate.manual) refreshRate(true); renderConvert(); },
  }) : toast('You can set your own rate for ฿ and £ only');
}

/* ---------- info ---------- */
const CATS = ['Flights', 'Stays', 'Car hire', 'Transfers', 'Insurance', 'Visas and documents', 'Emergency', 'Contacts'];
function infoHTML() {
  const I = S.all('info'), cats = [...CATS, ...new Set(I.map((x) => x.cat).filter((c) => !CATS.includes(c)))];
  return `<div class="chips">${cats.filter((c) => I.some((x) => x.cat === c)).map((c) => `<a href="#" data-jump="${esc(c)}">${esc(c)}</a>`).join('')}</div>` +
    cats.map((c) => {
      const rows = I.filter((x) => x.cat === c).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.u - b.u);
      return rows.length ? `<h3 id="cat-${esc(c)}">${esc(c)}</h3>` + rows.map((x) => infoCard(x)).join('') : '';
    }).join('') + `<button class="btn ghost" data-add="info">Add a booking or note</button>`;
}
function infoCard(x) {
  const ps = plans().filter((p) => p.link === x.id && p.date).sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
  return `<article class="card">
    <header><div class="grow"><b>${esc(x.title)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</div><button class="pencil" data-edit="${x.id}" aria-label="Edit">✎</button></header>
    ${x.ref ? `<button class="ref" data-copy="${esc(x.ref)}"><small>${esc(x.reflabel || 'Reference')}</small>${esc(x.ref)}</button>` : ''}
    ${x.body ? `<p>${esc(x.body)}</p>` : ''}
    ${ps.length ? `<div class="whens"><small>In the plan</small>${ps.map((p) => `<button data-goto="${p.id}"><b>${esc(fmtDay(p.date))}${p.time ? ' · ' + esc(p.time) : ''}</b><span>${esc(p.title)}</span><i>›</i></button>`).join('')}</div>` : ''}
    <div class="actions">${x.th ? `<button data-driver="${x.id}">Show the driver</button>` : ''}${x.phone ? `<a href="tel:${esc(x.phone.replace(/[^+\d]/g, ''))}">Call ${esc(x.phone)}</a>` : ''}${x.map ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(x.map)}">Map</a>` : ''}</div></article>`;
}
// Links: a plan, to-do or leg can point at one Info record (field `link`, an info id).
const linked = (r) => { const x = r?.link && S.items[r.link]; return x && !x.del && x.type === 'info' ? x : null; };
const lkChip = (r) => { const x = linked(r); return x ? `<div class="lk">${esc(x.title)} ›</div>` : ''; };
const catRank = (c) => (CATS.indexOf(c) + 1) || 99;
const linkOptions = () => [['', 'None'], ...S.all('info').sort((a, b) => catRank(a.cat) - catRank(b.cat) || (a.order ?? 99) - (b.order ?? 99) || a.u - b.u).map((x) => [x.id, `${x.cat}: ${x.title}`])];
// Where we sleep tonight: a stay whose linked plans span today (e.g. a weekend away), else the leg's own stay.
function currentStay(t, leg) {
  for (const x of S.all('info').filter((i) => i.cat === 'Stays' && i.id !== leg?.link)) {
    const ds = plans().filter((p) => p.link === x.id && p.date).map((p) => p.date).sort();
    if (ds.length > 1 && t >= ds[0] && t < ds.at(-1)) return x;
  }
  return linked(leg);
}
// Tap a plan or to-do: with a booking linked, show both together; otherwise open the editor.
function openRec(r) { const x = linked(r); if (r.type !== 'info' && x) showLinked(r, x); else editRecord(r); }
function showLinked(r, x) {
  const when = r?.date ? fmtDay(r.date, { weekday: 'long', day: 'numeric', month: 'long' }) + (r.time ? ' at ' + r.time : '') : '';
  sheet.innerHTML = `<div class="panel linked"><header><button type="button" class="link" data-x>Close</button><b>${r ? (r.type === 'plan' ? 'Plan' : 'To-do') : esc(x.cat)}</b>${r ? '<button type="button" class="link strong" data-ed>Edit</button>' : '<span class="link"></span>'}</header>
    ${r ? `<div class="lhead${r.done ? ' done' : ''}"><b>${esc(r.title || r.text)}</b>${when ? `<small>${esc(when)}</small>` : ''}${r.note ? `<p>${esc(r.note)}</p>` : ''}</div>` : ''}
    ${infoCard(x)}</div>`;
  sheet.hidden = false; document.body.classList.add('locked');
  const close = () => { sheet.hidden = true; sheet.innerHTML = ''; document.body.classList.remove('locked'); };
  sheet.onclick = (e) => {
    const q = (a) => e.target.closest(`[${a}]`); let el;
    if (e.target === sheet || q('data-x')) close();
    else if (q('data-ed')) { close(); editRecord(r); }
    else if ((el = q('data-edit'))) { close(); editRecord(S.items[el.dataset.edit]); }
    else if ((el = q('data-copy'))) copyText(el.dataset.copy);
    else if ((el = q('data-driver'))) showDriver(S.items[el.dataset.driver]);
    else if ((el = q('data-goto'))) { close(); gotoPlan(el.dataset.goto); }
  };
}
// Jump to a plan in the Plan tab: open its leg, scroll to it and flash it.
function gotoPlan(id) {
  const p = S.items[id]; if (!p) return;
  const l = p.date ? legFor(p.date) : legs().find((x) => x.id === p.leg);
  if (l) ui.open[l.id] = true;
  setTab('plan');
  const row = view.querySelector(`.row[data-edit="${id}"]`);
  if (row) { row.scrollIntoView({ block: 'center' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1600); }
}
const infoFields = [
  { k: 'cat', label: 'Section', type: 'select', options: CATS.map((c) => [c, c]) },
  { k: 'title', label: 'Title', type: 'text', required: true },
  { k: 'sub', label: 'Dates or summary', type: 'text' },
  { k: 'ref', label: 'Reference', type: 'text' },
  { k: 'body', label: 'Details', type: 'textarea' },
  { k: 'phone', label: 'Phone', type: 'tel' },
  { k: 'map', label: 'Address for the map', type: 'text' },
  { k: 'th', label: 'Address in Thai (for the driver card)', type: 'textarea' },
];
// Full-screen white card (driver address, phrase, message). Close with the X or a swipe to the right.
function openCard(html, onButton) {
  const d = $('#driver');
  d.innerHTML = `<button class="dclose" data-close aria-label="Close"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>${html}`;
  d.style.transform = ''; d.style.transition = ''; d.hidden = false;
  const close = () => { d.hidden = true; d.innerHTML = ''; d.style.transform = ''; };
  d.onclick = (e) => { if (e.target.closest('[data-close]')) return close(); const b = e.target.closest('[data-c]'); if (b) onButton(b.dataset.c); };
  let x0, y0, dx, live;
  d.ontouchstart = (e) => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; dx = 0; live = null; d.style.transition = 'none'; };
  d.ontouchmove = (e) => {
    const t = e.touches[0]; dx = t.clientX - x0; const dy = t.clientY - y0;
    if (live === null && Math.abs(dx) + Math.abs(dy) > 10) live = dx > 0 && Math.abs(dx) > Math.abs(dy);
    if (live) { e.preventDefault(); d.style.transform = `translateX(${Math.max(0, dx)}px)`; }
  };
  d.ontouchend = () => {
    if (!live) return;
    d.style.transition = 'transform .25s ease';
    if (dx > 90) { d.style.transform = 'translateX(100%)'; setTimeout(close, 230); } else d.style.transform = '';
  };
}
function showDriver(x) {
  openCard(`<small>กรุณาพาไปที่นี่ · Please take us here</small><div class="th">${esc(x.th)}</div><div class="en">${esc(x.title)}${x.map ? '<br>' + esc(x.map) : ''}</div>${x.phone ? `<div class="en">โทร ${esc(x.phone)}</div>` : ''}
    <div class="dcopy"><button data-c="th">Copy Thai address</button>${x.map ? '<button data-c="en">Copy English address</button>' : ''}</div><em>Swipe right or tap ✕ to close</em>`,
    (c) => copyText(c === 'th' ? x.th : x.map));
}
// Copy to the clipboard, with an older fallback for when the clipboard API says no.
function copyText(t) {
  const fallback = () => { const a = document.createElement('textarea'); a.value = t; a.setAttribute('readonly', ''); a.style.cssText = 'position:fixed;opacity:0'; document.body.append(a); a.select(); a.setSelectionRange(0, t.length); const ok = document.execCommand('copy'); a.remove(); toast(ok ? 'Copied' : 'Couldn\'t copy on this phone'); };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(t).then(() => toast('Copied'), fallback); else fallback();
}

/* ---------- translate ---------- */
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');
// Extra English words people might search for, so 'loo' finds the toilet.
const SYN = { 'Hello / goodbye': 'hi bye greeting', 'Thank you': 'thanks cheers', 'Sorry / excuse me': 'apologise pardon', 'How much is this?': 'price cost', 'Too expensive': 'price cost dear', 'Can you lower the price?': 'discount cheaper bargain haggle', 'Can I pay by card?': 'credit debit payment', 'No bag, thanks': 'plastic carrier', 'Not spicy': 'chilli hot mild', 'A little spicy': 'chilli hot medium', 'No chilli (for the child)': 'spicy hot kid baby bella isabella', 'Delicious': 'tasty good food', 'The bill, please': 'check pay cheque restaurant', 'Water': 'drink bottle', 'No ice': 'drink cold', 'No sugar': 'sweet drink', 'Takeaway': 'take away to go', 'Please take me here': 'taxi driver grab address', 'Please use the meter': 'taxi driver fare', 'Stop here, please': 'taxi driver drop', 'Where is the toilet?': 'loo bathroom restroom wc', 'Turn left / turn right': 'directions driver', 'Straight on': 'ahead directions driver', 'Airport': 'flight plane', 'How long does it take?': 'time minutes', 'She is two years old': 'age bella isabella baby child kid', 'Do you have a high chair?': 'baby bella isabella restaurant', 'Do you have a child seat?': 'car seat baby taxi', 'Nappies': 'diapers baby', 'Milk': 'baby drink', 'Help!': 'emergency', 'Please call an ambulance': 'emergency doctor', 'Hospital': 'doctor emergency sick ill', 'Pharmacy': 'chemist medicine drugstore', '{i} am allergic to…': 'allergy nuts', '{i} am lost': 'directions help', '1, 2, 3, 4, 5': 'one two three four five', '6, 7, 8, 9, 10': 'six seven eight nine ten', '20 / 50': 'twenty fifty', '100 / 500': 'hundred', '1,000': 'thousand' };
// Three parts: Phrases (built in, with recorded audio), Write (your own messages, translated by Claude
// with your own key or via Google, saved and synced as 'msg' records) and Places (bookings with a Thai address).
const pol = (s, rom) => { const f = ui.female; return s.replaceAll('{p}', rom ? (f ? 'kha' : 'khrap') : (f ? 'ค่ะ' : 'ครับ')).replaceAll('{i}', rom ? (f ? 'chan' : 'phom') : (f ? 'ฉัน' : 'ผม')); };
const enOf = (t) => pol(t, true).replace('chan', 'I').replace('phom', 'I');
const phraseAt = (gi, pi) => { const [e, th, ro, ith, iro] = PHRASES[gi][1][pi]; const isan = !!(ui.isaan && ith); return { en: enOf(e), th: pol(isan ? ith : th), ro: pol(isan ? iro : ro, true), isan }; };
const voiceBar = () => `<div class="voicebar"><div class="seg two"><button data-voice="m" class="${ui.female ? '' : 'on'}">Ben (khrap)</button><button data-voice="f" class="${ui.female ? 'on' : ''}">Stef (kha)</button></div>
  <button class="isanbtn ${ui.isaan ? 'on' : ''}" data-isan aria-pressed="${!!ui.isaan}">Isaan</button></div>`;

function showCard({ head, th, ro, en, more = '' }) {
  openCard(`<small>${esc(head)}</small><div class="th">${esc(th)}</div>${ro ? `<div class="ro">${esc(ro)}</div>` : ''}${en ? `<div class="en">${esc(en)}</div>` : ''}${more}
    <div class="dcopy row"><button data-c="play">▶ Play</button><button data-c="th">Copy Thai</button></div><em>Swipe right or tap ✕ to close</em>`,
    (c) => (c === 'play' ? say(th) : copyText(th)));
}

// One call to Claude with your own key (More, Settings). Returns the JSON object described by `props`.
// A saved message or photo you received: show the English, and the suggested reply if there is one.
function showRead(m) {
  const nl = (t) => esc(t).replace(/\n/g, '<br>');
  sheet.innerHTML = `<div class="panel"><header><button type="button" class="link" data-x>Close</button><b>${m.kind === 'photo' ? 'Photo' : 'Message'}</b><span class="link"></span></header>
    <p class="body">${nl(m.en)}</p>${m.warn ? `<p class="warn">${nl(m.warn)}</p>` : ''}${m.th ? `<p class="hint">${nl(m.th)}</p>` : ''}
    ${m.reply_th ? `<div class="card reply"><small>Suggested reply</small><div class="th">${esc(m.reply_th)}</div>${m.reply_rom ? `<div class="ro">${esc(m.reply_rom)}</div>` : ''}<p class="hint">Means: ${esc(m.reply_en)}</p><div class="actions"><button data-rc>Copy reply</button><button data-rs>Show</button></div></div>` : ''}</div>`;
  sheet.hidden = false; document.body.classList.add('locked');
  const close = () => { sheet.hidden = true; sheet.innerHTML = ''; document.body.classList.remove('locked'); };
  sheet.onclick = (e) => {
    if (e.target.closest('[data-rc]')) copyText(m.reply_th);
    else if (e.target.closest('[data-rs]')) { close(); showCard({ head: 'กรุณาอ่านข้อความนี้ · Please read this', th: m.reply_th, ro: m.reply_rom, en: m.reply_en }); }
    else if (e.target === sheet || e.target.closest('[data-x]')) close();
  };
}
async function askClaude(system, content, props) {
  const schema = { type: 'object', additionalProperties: false, required: Object.keys(props), properties: Object.fromEntries(Object.entries(props).map(([k, d]) => [k, { type: 'string', description: d }])) };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': S.cfg.claude, 'anthropic-version': '2026-10-21', 'anthropic-beta': 'server-side-fallback-2026-07-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: 'claude-opus-5-5', max_tokens: 6000, fallbacks: 'default', system, output_config: { effort: 'low', format: { type: 'json_schema', schema } }, messages: [{ role: 'user', content }] }),
  });
  if (res.status === 401 || res.status === 403) throw new Error('The Claude key was not accepted. Check it in More, Settings.');
  if (res.status === 429 || res.status >= 500) throw new Error('Claude is busy. Try again in a moment.');
  if (!res.ok) { let m = ''; try { m = (await res.json()).error?.message || ''; } catch {} throw new Error(`Translation failed (${res.status})${m ? ': ' + m : '.'}`); }
  const j = await res.json();
  if (j.stop_reason === 'refusal') throw new Error('Claude would not translate that.');
  const t = j.content?.find((c) => c.type === 'text')?.text;
  if (!t) throw new Error('No translation came back. Try again.');
  return JSON.parse(t);
}
const WHO = 'a British family travelling in Thailand: Ben, Stefania and their two-year-old daughter Bella';
const speaker = () => ui.female ? 'a woman (use ค่ะ / คะ and ดิฉัน or ฉัน)' : 'a man (use ครับ and ผม)';
const dialect = () => ui.isaan ? 'Isan (the north-east dialect of Udon Thani and Nong Khai), in Thai script, using everyday Isan words such as บ่, แม่น, เด้อ, ไส, หลาย where a local would, but easy to understand' : 'standard Central Thai';
const toThai = (text) => askClaude(`You translate short messages from ${WHO} into Thai, to show or send to Thai people: drivers, hosts, hotel and restaurant staff, shopkeepers, neighbours.
Write natural, polite, simple ${dialect()} that a local would actually say. The speaker is ${speaker()}.
Keep names, numbers, times and addresses exactly as given. Do not add anything that was not in the message.`, text,
  { th: 'The message in Thai script', rom: 'Easy romanisation for an English speaker, no tone marks', back: 'Literal translation of the Thai back into English, so the sender can check the meaning', note: 'One short sentence if anything was unclear, changed or culturally awkward; otherwise empty' });
const fromThai = (text) => askClaude(`You help ${WHO} understand Thai messages they receive, for example on LINE or WhatsApp from a host, driver or neighbour. The message may be Central Thai or Isan.
Translate it into natural British English. Then suggest a short, polite reply they could send back, written in ${dialect()} by ${speaker()}. If no reply is needed, leave the reply fields empty.`, text,
  { en: 'The message in natural British English', note: 'One short sentence on anything to be aware of (tone, a request, a time or price); otherwise empty', reply_en: 'Suggested reply in English, or empty', reply_th: 'The suggested reply in Thai script, or empty', reply_rom: 'Easy romanisation of the reply, or empty' });
const readPhoto = (dataUrl) => askClaude(`You help ${WHO} understand Thai text in photos: menus, signs, medicine and baby product labels, notices, receipts and screenshots of messages. Reply in plain British English, concise, with line breaks.
For a menu, list the dishes with a short description and say which are very spicy or not suitable for a two-year-old.
For medicine, food or child products, put the dose, age range, allergens and warnings exactly as printed in "warn". If a dose for a two-year-old is not printed, say so and advise asking the pharmacist. Never invent a dose.`,
  [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: dataUrl.split(',')[1] } }, { type: 'text', text: 'What does this say?' }],
  { what: 'A few words on what this is, e.g. "Restaurant menu" or "Children\'s paracetamol"', en: 'The useful content translated and explained in English', warn: 'Safety information for medicine, food or child products; otherwise empty', th: 'The main Thai text read from the photo, short (first lines if long)' });
// Phone photos are big: shrink to 1568px on the long side as a JPEG before sending.
function shrinkPhoto(file) {
  return new Promise((ok, fail) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const s = Math.min(1, 1568 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.85)); };
    img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('Could not open that photo.')); };
    img.src = url;
  });
}

let draft = null; // the current translation on the Write screen
function renderTranslate() {
  loadClips();
  ui.tsub ??= 'phrases';
  const segs = [['phrases', 'Phrases'], ['write', 'Write'], ['places', 'Places']];
  let body = '';
  if (ui.tsub === 'phrases') {
    body = voiceBar() + `<div class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><input id="tq" type="search" placeholder="Search in English, e.g. toilet, spicy, how much" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="search" value="${esc(ui.tq || '')}"><button id="tqx" aria-label="Clear search" hidden>✕</button></div>
      <p class="count" id="tcount"></p>` + PHRASES.map(([cat, list], gi) => `<section class="pgroup"><h3>${esc(cat)}</h3><ul class="list">${list.map(([e], pi) => { const p = phraseAt(gi, pi);
        return `<li class="row phrase" data-say="${esc(p.th)}" data-k="${esc(norm(p.en + ' ' + cat + ' ' + (SYN[e] || '') + (p.isan ? ' isaan' : '')))}"><div class="grow"><div class="s">${esc(p.en)}${p.isan ? ' <span class="isantag">Isaan</span>' : ''}</div><div class="th">${esc(p.th)}</div><div class="ro">${esc(p.ro)}</div></div><button class="playbtn" data-say="${esc(p.th)}" aria-label="Play"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg></button><button class="showbtn" data-show="${gi}.${pi}">Show</button></li>`; }).join('')}</ul></section>`).join('') +
      `<p class="empty" id="tnone" hidden>No phrases match. Try a simpler word.</p>`;
  } else if (ui.tsub === 'write') {
    const saved = S.all('msg').sort((a, b) => b.u - a.u), hasKey = !!S.cfg.claude, th2en = ui.wdir === 'th2en';
    body = voiceBar() + `<div class="card write"><div class="seg two dirseg"><button data-wdir="en2th" class="${th2en ? '' : 'on'}">English → Thai</button><button data-wdir="th2en" class="${th2en ? 'on' : ''}">Thai → English</button></div>
      <textarea id="wen" rows="3" placeholder="${th2en ? 'Paste a Thai message, e.g. from LINE or WhatsApp' : 'Type in English, e.g. Could you open the gate at 7am tomorrow?'}">${esc((th2en ? ui.wdt : ui.wd) || '')}</textarea>
      <div class="wbtns">${hasKey ? '<button class="btn" id="wgo">Translate</button>' : '<a class="btn" id="wgoogle" target="_blank" rel="noopener">Translate with Google</a>'}<button class="btn ghost" id="wphoto" aria-label="Read a photo">📷 Photo</button></div>
      <input type="file" id="wfile" accept="image/*" hidden>
      ${hasKey ? '' : `<p class="hint">${th2en ? 'Google opens in a new tab.' : 'Copy the Thai from Google, then paste it below.'} Add a Claude key in More, Settings to translate and read photos right here.</p>${th2en ? '' : '<textarea id="wth" rows="2" placeholder="Paste the Thai here"></textarea><button class="btn ghost" id="wsavep">Save</button>'}`}</div>
      <div id="wout">${draft ? draftHTML() : ''}</div>
      ${saved.length ? `<h3>Saved</h3><ul class="list">${saved.map((m) => { const read = m.kind === 'read' || m.kind === 'photo';
        return `<li class="row msg" data-msg="${m.id}"><div class="grow"><div class="s">${m.kind === 'photo' ? '📷 ' : read ? '↩︎ ' : ''}${esc(m.en.split('\n')[0])}${m.isan ? ' <span class="isantag">Isaan</span>' : ''}</div>${m.th ? `<div class="th${read ? ' small' : ''}">${esc(m.th.split('\n')[0])}</div>` : ''}${m.rom ? `<div class="ro">${esc(m.rom)}</div>` : ''}</div><button class="showbtn" data-mdel="${m.id}" aria-label="Delete">✕</button></li>`; }).join('')}</ul>` : '<p class="empty">Messages and photos you save appear here, on both phones, and work offline.</p>'}`;
  } else {
    const order = (x) => { const i = CATS.indexOf(x.cat); return (i < 0 ? 99 : i) * 1000 + (x.order ?? 99); };
    const P = S.all('info').filter((x) => x.th).sort((a, b) => order(a) - order(b) || a.u - b.u);
    body = (P.length ? P.map((x) => `<article class="card place"><b>${esc(x.title)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}<div class="th">${esc(x.th)}</div>
      <div class="actions"><button data-driver="${x.id}">Show the driver</button><button data-copy="${esc(x.th)}">Copy Thai</button>${x.map ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(x.map)}">Map</a>` : ''}</div></article>`).join('') : '') +
      '<p class="hint center">Any booking in More, Info with an address in Thai shows here.</p>';
  }
  view.innerHTML = `<div class="seg">${segs.map(([k, l]) => `<button data-tsub="${k}" class="${ui.tsub === k ? 'on' : ''}">${l}</button>`).join('')}</div>${body}`;
  view.querySelectorAll('[data-tsub]').forEach((b) => (b.onclick = () => { ui.tsub = b.dataset.tsub; saveUi(); render(); window.scrollTo(0, 0); }));
  view.querySelectorAll('[data-voice]').forEach((b) => (b.onclick = () => { ui.female = b.dataset.voice === 'f'; draft = null; saveUi(); render(); }));
  view.querySelector('[data-isan]')?.addEventListener('click', () => { ui.isaan = !ui.isaan; draft = null; saveUi(); render(); if (ui.isaan) toast('Isaan where it differs. Central Thai is understood everywhere'); });
  if (ui.tsub === 'phrases') wirePhrases(); else if (ui.tsub === 'write') wireWrite();
}
function draftHTML() {
  const d = draft, nl = (t) => esc(t).replace(/\n/g, '<br>');
  if (d.mode === 'photo') return `<div class="card result"><img class="thumb" src="${d.img}" alt=""><b>${esc(d.what)}</b><p class="body">${nl(d.en)}</p>${d.warn ? `<p class="warn">${nl(d.warn)}</p>` : ''}
    <div class="actions"><button data-dsave>Save</button>${d.th ? `<button data-copy="${esc(d.th)}">Copy Thai text</button>` : ''}</div></div>`;
  if (d.mode === 'th2en') return `<div class="card result"><p class="body big">${nl(d.en)}</p>${d.note ? `<p class="hint">${esc(d.note)}</p>` : ''}
    ${d.reply_th ? `<div class="reply"><small>Suggested reply</small><div class="th">${esc(d.reply_th)}</div>${d.reply_rom ? `<div class="ro">${esc(d.reply_rom)}</div>` : ''}<p class="hint">Means: ${esc(d.reply_en)}</p>
      <div class="actions"><button data-copy="${esc(d.reply_th)}">Copy reply</button><button data-dshow>Show</button></div></div>` : ''}
    <div class="actions"><button data-dsave>Save</button><button data-dreply>Write my own reply</button></div></div>`;
  return `<div class="card result"><div class="th">${esc(d.th)}</div>${d.rom ? `<div class="ro">${esc(d.rom)}</div>` : ''}${d.back ? `<p class="hint">Means: ${esc(d.back)}</p>` : ''}${d.note ? `<p class="hint">${esc(d.note)}</p>` : ''}
    <div class="actions"><button data-dshow>Show</button><button data-copy="${esc(d.th)}">Copy Thai</button><button data-dsave>Save</button></div></div>`;
}
function wirePhrases() {
  const inp = $('#tq'), x = $('#tqx');
  const filter = () => {
    const words = norm(inp.value).split(' ').filter(Boolean); let n = 0;
    ui.tq = inp.value; x.hidden = !inp.value;
    view.querySelectorAll('.pgroup').forEach((g) => {
      let any = false;
      g.querySelectorAll('.phrase').forEach((r) => { const k = ' ' + r.dataset.k; const ok = words.every((w) => k.includes(' ' + w)); r.hidden = !ok; if (ok) { any = true; n++; } });
      g.hidden = !any;
    });
    $('#tnone').hidden = n > 0;
    $('#tcount').hidden = words.length && !n;
    $('#tcount').textContent = words.length ? `${n} phrase${n === 1 ? '' : 's'} found. Tap to hear, or Show to a Thai person.` : 'Tap a phrase to hear it, or Show it to a Thai person.';
  };
  inp.oninput = filter;
  inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); };
  x.onclick = () => { inp.value = ''; filter(); inp.focus(); };
  filter();
}
function wireWrite() {
  const en = $('#wen'), th2en = ui.wdir === 'th2en', key = th2en ? 'wdt' : 'wd';
  en.oninput = () => { ui[key] = en.value; saveUi(); const g = $('#wgoogle'); if (g) g.href = googleUrl(); };
  const g = $('#wgoogle'); if (g) g.href = googleUrl();
  view.querySelectorAll('[data-wdir]').forEach((b) => (b.onclick = () => { ui.wdir = b.dataset.wdir; draft = null; saveUi(); render(); }));
  const save = (m) => { S.put({ type: 'msg', ...m, isan: !!ui.isaan, female: !!ui.female }); if (!m.kind) ui.wd = ''; else if (m.kind === 'read') ui.wdt = ''; draft = null; saveUi(); toast('Saved on both phones'); render(); };
  const busy = async (b, label, job) => {
    if (b.disabled) return; if (!navigator.onLine) return toast('No connection. This needs signal');
    const was = b.textContent; b.disabled = true; b.textContent = label;
    try { draft = await job(); $('#wout').innerHTML = draftHTML(); $('#wout').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    catch (err) { toast(err instanceof TypeError ? 'No connection. This needs signal' : err.message || 'Something went wrong'); }
    b.disabled = false; b.textContent = was;
  };
  $('#wgo')?.addEventListener('click', (e) => { const text = en.value.trim(); if (!text) return;
    busy(e.currentTarget, 'Translating…', async () => th2en ? { mode: 'th2en', th: text, ...(await fromThai(text)) } : { mode: 'en2th', en: text, ...(await toThai(text)) }); });
  $('#wphoto').onclick = () => S.cfg.claude ? $('#wfile').click() : toast('Add a Claude key in More, Settings to read photos');
  $('#wfile').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    busy($('#wphoto'), 'Reading…', async () => { const img = await shrinkPhoto(f); return { mode: 'photo', img, ...(await readPhoto(img)) }; }); };
  $('#wsavep')?.addEventListener('click', () => { const th = $('#wth').value.trim(), t = en.value.trim(); if (!th) return toast('Paste the Thai first'); save({ en: t || th, th }); });
  $('#wout').onclick = (e) => {
    const d = draft; if (!d) return;
    if (e.target.closest('[data-dshow]')) d.mode === 'th2en' ? showCard({ head: 'กรุณาอ่านข้อความนี้ · Please read this', th: d.reply_th, ro: d.reply_rom, en: d.reply_en }) : showCard({ head: 'กรุณาอ่านข้อความนี้ · Please read this', th: d.th, ro: d.rom, en: d.en });
    else if (e.target.closest('[data-dreply]')) { ui.wdir = 'en2th'; ui.wd = ''; draft = null; saveUi(); render(); $('#wen').focus(); }
    else if (e.target.closest('[data-dsave]')) {
      if (d.mode === 'photo') save({ kind: 'photo', en: d.what + '\n' + d.en, warn: d.warn || '', th: d.th || '' });
      else if (d.mode === 'th2en') save({ kind: 'read', en: d.en, th: d.th, reply_th: d.reply_th || '', reply_rom: d.reply_rom || '', reply_en: d.reply_en || '' });
      else save({ en: d.en, th: d.th, rom: d.rom || '', back: d.back || '' });
    }
  };
}
const googleUrl = () => { const th2en = ui.wdir === 'th2en'; return `https://translate.google.com/?sl=${th2en ? 'th' : 'en'}&tl=${th2en ? 'en' : 'th'}&op=translate&text=${encodeURIComponent($('#wen')?.value || '')}`; };

/* ---------- documents (this phone only) ---------- */
let docRows = null, docKept = null;
const docIcon = (r) => `<span class="dicon ${D.isPdf(r) ? 'pdf' : 'img'}">${D.isPdf(r) ? 'PDF' : 'IMG'}</span>`;
function docsHTML() {
  if (!docRows) return '<p class="empty">Loading…</p>';
  const total = docRows.reduce((n, r) => n + (r.size || 0), 0);
  const groups = [...D.GROUPS, ...new Set(docRows.map((r) => r.group).filter((g) => !D.GROUPS.includes(g)))];
  return `<button class="btn" id="docadd">Add documents</button>
    <p class="hint">PDFs or photos from the Files app. They stay on this phone only, are never synced, and open offline. iCloud Drive stays the master copy.</p>` +
    (docRows.length ? groups.map((g) => {
      const rows = docRows.filter((r) => r.group === g).sort((a, b) => a.name.localeCompare(b.name));
      return rows.length ? `<h3>${esc(g)}</h3><ul class="list">${rows.map((r) => `<li class="row doc" data-doc="${r.id}">${docIcon(r)}<div class="grow"><div class="t">${esc(r.name)}</div><div class="s">${D.fmtSize(r.size || 0)} · added ${new Date(r.added).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div></div><button class="pencil" data-docedit="${r.id}" aria-label="Rename or delete">✎</button></li>`).join('')}</ul>` : '';
    }).join('') : '<p class="empty center">No documents on this phone yet. Add the e-visas, insurance schedule, bookings and passport pages.</p>') +
    (docRows.length ? `<p class="count">${docRows.length} document${docRows.length === 1 ? '' : 's'} · ${D.fmtSize(total)} on this phone${docKept ? ' · kept safe from clean-ups' : ''}</p>` : '');
}
async function loadDocs() {
  try { docRows = await D.list(); docKept = await D.persisted(); } catch { docRows = []; toast('Could not open document storage'); }
  const box = $('#docs'); if (!box) return;
  box.innerHTML = docsHTML();
  $('#docadd').onclick = () => pickDocs();
}
function pickDocs() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.multiple = true; inp.accept = 'application/pdf,image/*,.pdf';
  inp.onchange = () => { const files = [...inp.files]; if (files.length) askDocDetails(files); };
  inp.click();
}
function askDocDetails(files) {
  const one = files.length === 1, opts = D.GROUPS.map((g) => [g, g]);
  openSheet({
    title: one ? 'Add document' : `Add ${files.length} documents`, saveLabel: 'Add',
    rec: one ? { name: D.baseName(files[0].name), group: D.guessGroup(files[0].name) } : { group: 'auto' },
    fields: one ? [{ k: 'name', label: 'Name', type: 'text', required: true }, { k: 'group', label: 'Section', type: 'select', options: opts }]
      : [{ k: 'group', label: 'Section', type: 'select', options: [['auto', 'Guess from each file name'], ...opts] }],
    onSave: async (out) => {
      let n = 0;
      for (const f of files) {
        if (f.size > 40e6) { toast(`${f.name} is over 40 MB, skipped`); continue; }
        try { await D.add(f, { name: one ? out.name : '', group: out.group === 'auto' ? D.guessGroup(f.name) : out.group }); n++; } catch { toast('This phone is out of space for documents'); break; }
      }
      docKept = await D.persist() || await D.persisted();
      if (n) toast(n === 1 ? 'Saved on this phone' : `${n} saved on this phone`);
      if (ui.tab === 'more' && ui.more === 'docs') loadDocs();
    },
  });
}
function editDoc(id) {
  const r = docRows?.find((x) => x.id === id); if (!r) return;
  openSheet({
    title: 'Edit document', rec: { name: r.name, group: r.group },
    fields: [{ k: 'name', label: 'Name', type: 'text', required: true }, { k: 'group', label: 'Section', type: 'select', options: D.GROUPS.map((g) => [g, g]) }],
    onSave: async (out) => { await D.update(id, { name: out.name || r.name, group: out.group }); loadDocs(); },
    onDelete: () => setTimeout(() => openSheet({ title: 'Delete from this phone?', rec: {}, fields: [], saveLabel: 'Delete', onSave: async () => { await D.remove(id); toast('Deleted from this phone'); loadDocs(); } })),
  });
}
// Full-screen viewer. PDFs are drawn page by page with pdf.js (saved in the app, so it works
// offline); Share hands the file to iOS for Files, Print, AirDrop or Mail.
let viewUrl = null;
function closeDoc() {
  const v = $('#docview'); v.hidden = true; v.innerHTML = ''; document.body.classList.remove('locked');
  if (viewUrl) { URL.revokeObjectURL(viewUrl); viewUrl = null; }
}
async function openDoc(id) {
  const r = await D.getDoc(id).catch(() => null); if (!r?.blob) return toast('Could not open this document');
  const v = $('#docview'), pdf = D.isPdf(r);
  const ext = pdf ? '.pdf' : '.' + ((r.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg'));
  const file = new File([r.blob], r.name.replace(/[\\/:*?"<>|]/g, '-') + ext, { type: r.type || (pdf ? 'application/pdf' : 'image/jpeg') });
  viewUrl = URL.createObjectURL(r.blob);
  v.innerHTML = `<div class="dvbar chrome"><button data-dv="close" aria-label="Close"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button><b>${esc(r.name)}</b><button data-dv="share">Share</button></div>
    <div class="dvbody">${pdf ? '<p class="empty center">Opening…</p>' : `<img src="${viewUrl}" alt="${esc(r.name)}">`}</div>`;
  v.hidden = false; document.body.classList.add('locked'); v.scrollTop = 0;
  v.onclick = async (e) => {
    const b = e.target.closest('[data-dv]'); if (!b) return;
    if (b.dataset.dv === 'close') return closeDoc();
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: r.name });
      else { const a = document.createElement('a'); a.href = viewUrl; a.download = file.name; a.target = '_blank'; a.click(); }
    } catch (err) { if (err?.name !== 'AbortError') toast('Could not share this file'); }
  };
  if (pdf) renderPdf(r.blob, $('.dvbody', v)).catch((err) => {
    const body = $('.dvbody', v); if (!body) return;
    body.innerHTML = `<p class="empty center">${err?.name === 'PasswordException' ? 'This PDF has a password.' : 'This PDF could not be shown here.'} Tap Share to open it in Files or Books.</p>`;
  });
}
async function renderPdf(blob, box) {
  const pdfjs = await import('./vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', location.href).href;
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }), doc = await task.promise;
  box.innerHTML = '';
  const width = Math.min(box.clientWidth || 360, 900), dpr = Math.min(window.devicePixelRatio || 1, 3);
  for (let i = 1; i <= doc.numPages; i++) {
    if (!box.isConnected) break;
    const page = await doc.getPage(i), base = page.getViewport({ scale: 1 });
    let scale = (width * dpr * 1.5) / base.width;
    const maxPx = 12e6; if (base.width * base.height * scale * scale > maxPx) scale = Math.sqrt(maxPx / (base.width * base.height));
    const vp = page.getViewport({ scale }), c = document.createElement('canvas');
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    box.appendChild(c);
    await page.render({ canvasContext: c.getContext('2d'), canvas: c, viewport: vp }).promise;
  }
  task.destroy();
}

/* ---------- more: lists, info, settings ---------- */
function todoRow(x) {
  return `<li class="row ${x.done ? 'done' : ''}" data-edit="${x.id}"><button class="tick" data-tick="${x.id}" aria-label="Done">${x.done ? '✓' : ''}</button><div class="grow"><div class="t">${esc(x.text)}</div>${x.note ? `<div class="s">${esc(x.note)}</div>` : ''}${lkChip(x)}</div></li>`;
}
const THEMES = [
  ['night', 'Night flight', 'linear-gradient(135deg,#2D2A4A,#3b4096 60%,#A51931)'],
  ['temple', 'Temple morning', 'linear-gradient(135deg,#fff,#e9e6f3 55%,#e7b9c0)'],
  ['andaman', 'Andaman', 'linear-gradient(135deg,#0b4f54,#14878a 60%,#c4503f)'],
  ['jungle', 'Jungle sun', 'linear-gradient(135deg,#1d5a34,#2f8f4e 55%,#f08a3c)'],
];
function setTheme(t) {
  document.documentElement.dataset.theme = t; localStorage.setItem('bsb.theme', t);
  document.querySelector('meta[name="theme-color"]').content = { night: '#0c0e24', temple: '#f3f1ed', andaman: '#05242b', jungle: '#0b1f14' }[t];
}
function renderMore() {
  const seg = [['todo', 'To-do'], ['pack', 'Packing'], ['docs', 'Docs'], ['info', 'Info'], ['settings', 'Settings']];
  let body = '';
  if (ui.more === 'todo' || ui.more === 'pack') {
    const rows = S.all('todo').filter((x) => x.list === ui.more).sort((a, b) => !!a.done - !!b.done || (a.order ?? 1e9) - (b.order ?? 1e9) || a.u - b.u);
    const left = rows.filter((x) => !x.done).length;
    body = `<form id="quickadd"><input id="qa" placeholder="${ui.more === 'todo' ? 'Add a to-do' : 'Add something to pack'}" enterkeyhint="done"><button class="btn small">Add</button></form>
      <p class="count">${left} left of ${rows.length}</p><ul class="list">${rows.map(todoRow).join('')}</ul>`;
  } else if (ui.more === 'docs') {
    body = `<div id="docs">${docsHTML()}</div>`;
  } else if (ui.more === 'info') {
    body = infoHTML();
  } else {
    const st = S.status;
    const line = st.state === 'syncing' ? 'Syncing…' : st.error ? st.error : S.isDirty() ? 'Changes waiting to sync' + (st.state === 'offline' ? ' (offline)' : '') : st.state === 'offline' ? 'Offline. Showing saved data' : 'Up to date';
    body = `<div class="card"><b>Sync</b><p>${esc(line)}${st.last ? `<br><small>Last synced ${new Date(st.last).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>` : ''}</p>
      <button class="btn small" id="syncnow">Sync now</button></div>
      <div class="card"><b>GitHub token</b><p>${S.cfg.token ? 'A token is saved on this phone.' : 'No token yet, so this phone can view but not save changes.'}</p>
      <button class="btn small ghost" id="settoken">${S.cfg.token ? 'Replace token' : 'Add token'}</button></div>
      <div class="card"><b>Claude translation</b><p>${S.cfg.claude ? 'A Claude key is saved on this phone. Translate, Write uses it to translate your own messages.' : 'Add your Claude API key to translate your own messages in Translate, Write. It stays on this phone only.'}</p>
      <button class="btn small ghost" id="setclaude">${S.cfg.claude ? 'Replace key' : 'Add key'}</button>${S.cfg.claude ? ' <button class="btn small ghost" id="delclaude">Remove</button>' : ''}</div>
      <div class="card"><b>Appearance</b><div class="themes">${THEMES.map(([k, l, bg]) => `<button data-theme="${k}" class="${(document.documentElement.dataset.theme || 'night') === k ? 'on' : ''}"><i style="background:${bg}"></i>${l}</button>`).join('')}</div></div>
      <div class="card"><b>This phone</b><p>Signing out removes the trip data and the saved documents from this phone only.</p><button class="btn small danger" id="signout">Sign out</button></div>
      <img class="aboutlogo" src="icons/logo-180.png" alt=""><p class="count">BSB Travel · v21</p>`;
  }
  view.innerHTML = `<div class="seg">${seg.map(([k, l]) => `<button data-more="${k}" class="${ui.more === k ? 'on' : ''}">${l}</button>`).join('')}</div>${body}`;
  view.querySelectorAll('[data-more]').forEach((b) => (b.onclick = () => { ui.more = b.dataset.more; saveUi(); render(); }));
  view.querySelectorAll('[data-theme]').forEach((b) => (b.onclick = () => { setTheme(b.dataset.theme); render(); }));
  if (ui.more === 'docs') loadDocs();
  const qa = $('#quickadd');
  if (qa) qa.onsubmit = (e) => { e.preventDefault(); const v = $('#qa').value.trim(); if (v) { S.put({ type: 'todo', list: ui.more, text: v }); setTimeout(() => $('#qa')?.focus()); } };
  if ($('#syncnow')) {
    $('#syncnow').onclick = () => S.sync();
    $('#settoken').onclick = () => openSheet({ title: 'GitHub token', rec: { token: '' }, fields: [{ k: 'token', label: 'Paste the token', type: 'text' }], onSave: (r) => { if (r.token.trim()) { S.saveCfg({ token: r.token.trim() }); S.sync(); } } });
    $('#setclaude').onclick = () => openSheet({ title: 'Claude API key', rec: { key: '' }, fields: [{ k: 'key', label: 'Paste the key (starts sk-ant-)', type: 'text' }], onSave: (r) => { if (r.key.trim()) { S.saveCfg({ claude: r.key.trim() }); toast('Key saved on this phone'); render(); } } });
    if ($('#delclaude')) $('#delclaude').onclick = () => { S.saveCfg({ claude: '' }); render(); };
    $('#signout').onclick = () => openSheet({ title: 'Sign out of this phone?', rec: {}, fields: [], saveLabel: 'Sign out', onSave: async () => { S.wipe(); await D.clearAll(); location.reload(); } });
  }
}
// Recorded clips (audio/) play with the phone on silent; iOS speech is muted by the silent switch,
// so it is only the fallback. Clips are turned into blob URLs up front so a tap can play at once.
const clip = new Audio(); const clipUrl = {};
let clipsLoading;
function loadClips() {
  clipsLoading ??= fetch('audio/list.json').then((r) => r.json()).then((list) => Promise.all(Object.entries(list).map(([t, f]) =>
    fetch('audio/' + f).then((r) => r.ok ? r.blob() : null).then((b) => { if (b) clipUrl[t] = URL.createObjectURL(b); }).catch(() => {})))).catch(() => { clipsLoading = null; });
}
function speak(text) {
  if (!('speechSynthesis' in window)) return toast('No speech on this device');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = 'th-TH'; u.rate = 0.85;
  const v = speechSynthesis.getVoices().find((x) => x.lang.replace('_', '-').startsWith('th')); if (v) u.voice = v;
  speechSynthesis.speak(u);
}
// Google's Thai voice as an mp3, for text with no recorded clip (own messages). Audio files play
// with the iPhone on silent; iOS speech doesn't. Long text is sent in parts of up to 180 characters.
const ttsUrl = (t) => 'https://translate.google.com/translate_tts?ie=UTF-8&tl=th&client=tw-ob&q=' + encodeURIComponent(t);
function parts(text) {
  const out = []; let cur = '';
  const pieces = text.replace(/[\n…]+/g, ' ').split(/(?<=[\s.,!?])/).flatMap((w) => w.match(/[^]{1,180}/g) || []);
  for (const w of pieces) { if ((cur + w).length > 180) { out.push(cur); cur = ''; } cur += w; }
  return [...out, cur].map((x) => x.trim()).filter(Boolean);
}
function playQueue(list, text) {
  clip.onended = () => { list.shift(); if (list.length) { clip.src = list[0]; clip.play().catch(() => {}); } else clip.onended = null; };
  clip.onerror = () => { clip.onended = clip.onerror = null; speak(text); };
  clip.pause(); clip.src = list[0]; clip.currentTime = 0;
  clip.play().catch(() => { clip.onended = clip.onerror = null; speak(text); });
}
function say(text) {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  const url = clipUrl[text]; loadClips();
  if (url) return playQueue([url], text);
  if (navigator.onLine) return playQueue(parts(text).map(ttsUrl), text);
  speak(text);
}

/* ---------- editor sheet ---------- */
function openSheet({ title, fields, rec, onSave, onDelete, saveLabel = 'Save' }) {
  sheet.innerHTML = `<form class="panel"><header><button type="button" class="link" data-x>Cancel</button><b>${esc(title)}</b><button class="link strong">${esc(saveLabel)}</button></header>
    ${fields.map((f) => f.type === 'checkbox' ? `<label class="check"><input type="checkbox" name="${f.k}" ${rec[f.k] ? 'checked' : ''}>${esc(f.label)}</label>` :
      `<label>${esc(f.label)}${f.type === 'textarea' ? `<textarea name="${f.k}" rows="3">${esc(rec[f.k])}</textarea>` :
      f.type === 'select' ? `<select name="${f.k}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${v === (rec[f.k] ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>` :
      `<input name="${f.k}" type="${f.type === 'number' ? 'text' : f.type}" ${f.type === 'number' ? 'inputmode="decimal"' : ''} value="${esc(rec[f.k])}" ${f.required ? 'required' : ''}>`}</label>`).join('')}
    ${onDelete ? '<button type="button" class="btn danger" data-del>Delete</button>' : ''}</form>`;
  sheet.hidden = false; document.body.classList.add('locked');
  const close = () => { sheet.hidden = true; sheet.innerHTML = ''; document.body.classList.remove('locked'); };
  sheet.onclick = (e) => { if (e.target === sheet || e.target.closest('[data-x]')) close(); if (e.target.closest('[data-del]')) { onDelete(); close(); } };
  $('form', sheet).onsubmit = (e) => {
    e.preventDefault();
    const out = {};
    fields.forEach((f) => { const el = e.target.elements[f.k]; out[f.k] = f.type === 'checkbox' ? el.checked : el.value.trim(); });
    close(); onSave(out);
  };
}
function editRecord(r, isNew) {
  const def = { plan: ['plan', planFields()], info: ['booking or note', infoFields], todo: ['item', [{ k: 'text', label: 'What', type: 'text', required: true }, { k: 'note', label: 'Notes', type: 'textarea' }, { k: 'link', label: 'Booking (opens with the item)', type: 'select', options: linkOptions() }, { k: 'done', label: 'Done', type: 'checkbox' }]] }[r.type];
  if (!def) return;
  openSheet({
    title: (isNew ? 'New ' : 'Edit ') + def[0], fields: def[1], rec: r,
    onSave: (out) => { if (r.type === 'plan' && out.key && !(out.date && out.time)) out.key = false; S.put({ ...r, ...out }); },
    onDelete: isNew ? null : () => S.remove(r.id),
  });
}

view.addEventListener('click', (e) => {
  const q = (a) => e.target.closest(`[${a}]`);
  let el;
  if ((el = q('data-docedit'))) editDoc(el.dataset.docedit);
  else if ((el = q('data-doc'))) openDoc(el.dataset.doc);
  else if ((el = q('data-tick'))) { const r = S.items[el.dataset.tick]; S.put({ ...r, done: !r.done }); }
  else if ((el = q('data-copy'))) copyText(el.dataset.copy);
  else if ((el = q('data-driver'))) showDriver(S.items[el.dataset.driver]);
  else if ((el = q('data-show'))) { const [g, i] = el.dataset.show.split('.').map(Number), p = phraseAt(g, i); showCard({ head: 'กรุณาอ่านข้อความนี้ · Please read this', th: p.th, ro: p.ro, en: p.en }); }
  else if ((el = q('data-mdel'))) { const m = S.items[el.dataset.mdel]; openSheet({ title: 'Delete this message?', rec: {}, fields: [], saveLabel: 'Delete', onSave: () => { S.remove(m.id); render(); } }); }
  else if ((el = q('data-msg'))) { const m = S.items[el.dataset.msg]; m.kind ? showRead(m) : showCard({ head: 'กรุณาอ่านข้อความนี้ · Please read this', th: m.th, ro: m.rom, en: m.en }); }
  else if ((el = q('data-say'))) say(el.dataset.say);
  else if ((el = q('data-jump'))) { e.preventDefault(); document.getElementById('cat-' + el.dataset.jump)?.scrollIntoView({ behavior: 'smooth' }); }
  else if ((el = q('data-add'))) editRecord(el.dataset.add === 'plan' ? { type: 'plan', title: '', date: el.dataset.date || '', leg: el.dataset.leg || '' } : { type: 'info', cat: 'Stays', title: '' }, true);
  else if ((el = q('data-goto'))) gotoPlan(el.dataset.goto);
  else if ((el = q('data-info'))) showLinked(null, S.items[el.dataset.info]);
  else if ((el = q('data-edit')) && !e.target.closest('a')) openRec(S.items[el.dataset.edit]);
});

/* ---------- boot ---------- */
S.onChange(() => { if (sheet.hidden && !((ui.tab === 'convert' || ui.tab === 'translate') && S.cfg.pass) && document.activeElement?.id !== 'qa') render(); else if (document.activeElement?.id === 'qa') { const v = ''; render(); $('#qa').value = v; $('#qa').focus(); } else document.body.dataset.sync = S.status.state; });
render();
// The compact glass title bar appears once the large title has scrolled away.
new IntersectionObserver(([e]) => { if (e.isIntersecting) delete document.body.dataset.scrolled; else document.body.dataset.scrolled = '1'; }).observe($('#sentinel'));
S.sync();
document.addEventListener('visibilitychange', () => { if (!document.hidden) { S.sync(); refreshRate(); if (sheet.hidden) render(); } });
window.addEventListener('online', () => S.sync());
setInterval(() => { if (!document.hidden) { if (ui.tab === 'today' && sheet.hidden && S.cfg.pass) render(); } }, 30000);
setInterval(() => { if (!document.hidden) S.sync(); }, 90000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
