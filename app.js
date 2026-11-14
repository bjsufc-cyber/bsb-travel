import * as S from './store.js';
import { PHRASES } from './phrases.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view'), sheet = $('#sheet');
const ui = JSON.parse(localStorage.getItem('bsb.ui') || '{}');
const saveUi = () => localStorage.setItem('bsb.ui', JSON.stringify(ui));
ui.tab ??= 'today'; ui.more ??= 'todo'; ui.dir ??= 'thb'; ui.open ??= {};

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
  const order = ['today', 'plan', 'convert', 'info', 'more'];
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  $('#tabs').style.setProperty('--i', order.indexOf(ui.tab));
  $('#title').textContent = $('#navtitle').textContent = { today: 'Today', plan: 'Plan', convert: 'Convert', info: 'Info', more: 'More' }[ui.tab];
  const st = S.status.state, dot = $('#syncdot');
  dot.className = S.isDirty() && st !== 'syncing' ? (st === 'error' ? 'error' : 'pending') : st;
  if (!S.cfg.pass) return renderSetup();
  ({ today: renderToday, plan: renderPlan, convert: renderConvert, info: renderInfo, more: renderMore }[ui.tab])();
}

/* ---------- setup ---------- */
function renderSetup() {
  view.innerHTML = `<div class="setup"><img src="icons/icon-192.png" alt=""><h2>BSB Travel</h2>
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
    ${p.note ? `<div class="s">${esc(p.note)}</div>` : ''}</div>
    <div class="time">${showDate && p.date ? esc(fmtDay(p.date, { day: 'numeric', month: 'short' })) + '<br>' : ''}${esc(p.time || '')}</div></li>`;
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
    hero = `<div class="hero"><div class="where">${where}</div><div class="sub">${esc(sub)}</div>
      ${next ? `<div class="cd"><div><b>${c.d}</b>days</div><div><b>${c.h}</b>hrs</div><div><b>${c.m}</b>min</div></div>
      <div class="until">until <b>${esc(next.title)}</b><br>${esc(fmtDay(next.date))} at ${esc(next.time)}</div>` : ''}</div>`;
  }
  const todays = plans().filter((p) => p.date === t).sort(byTime);
  const todos = S.all('todo').filter((x) => x.list === 'todo' && !x.done).slice(0, 5);
  view.innerHTML = hero +
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
  { k: 'note', label: 'Notes', type: 'textarea' },
  { k: 'key', label: 'Show as a countdown on Today (needs date and time)', type: 'checkbox' },
  { k: 'done', label: 'Done', type: 'checkbox' },
];

/* ---------- converter ---------- */
const rate = JSON.parse(localStorage.getItem('bsb.rate') || '{"rate":43.5,"at":0,"manual":false}');
const saveRate = () => localStorage.setItem('bsb.rate', JSON.stringify(rate));
let amount = '';
async function refreshRate(force) {
  if (rate.manual || (!force && Date.now() - rate.at < 6 * 36e5)) return;
  const tryGet = async (url, pick) => { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw 0; const v = pick(await r.json()); if (!(v > 10 && v < 200)) throw 0; return v; };
  try {
    rate.rate = await tryGet('https://open.er-api.com/v6/latest/GBP', (j) => j.rates.THB)
      .catch(() => tryGet('https://api.frankfurter.app/latest?from=GBP&to=THB', (j) => j.rates.THB));
    rate.at = Date.now(); saveRate(); if (ui.tab === 'convert') paintConvert();
  } catch {}
}
const money = (n, cur) => cur === 'thb' ? '฿' + n.toLocaleString('en-GB', { maximumFractionDigits: n < 20 ? 2 : 0 }) : '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const age = (at) => { if (!at) return 'not updated yet'; const m = (Date.now() - at) / 6e4; return m < 60 ? 'updated just now' : m < 1440 ? `updated ${Math.floor(m / 60)}h ago` : `updated ${Math.floor(m / 1440)}d ago`; };

const FLAG = {
  thb: '<svg class="flag" viewBox="0 0 30 30" aria-hidden="true"><path fill="#A51931" d="M0 0h30v30H0z"/><path fill="#F4F5F8" d="M0 5h30v20H0z"/><path fill="#2D2A4A" d="M0 10h30v10H0z"/></svg>',
  gbp: '<svg class="flag" viewBox="15 0 30 30" aria-hidden="true"><clipPath id="uj"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/></clipPath><path d="M0,0 v30 h60 v-30 z" fill="#012169"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 L60,30 M60,0 L0,30" clip-path="url(#uj)" stroke="#C8102E" stroke-width="4"/><path d="M30,0 v30 M0,15 h60" stroke="#fff" stroke-width="10"/><path d="M30,0 v30 M0,15 h60" stroke="#C8102E" stroke-width="6"/></svg>',
};
const CUR = { thb: ['THB', 'Thai baht', '฿'], gbp: ['GBP', 'Pounds', '£'] };
const curRow = (cur, value) => `${FLAG[cur]}<div class="grow"><small>${CUR[cur][0]} · ${CUR[cur][1]}</small><b>${value}</b></div>`;
function paintConvert() {
  const from = ui.dir, to = from === 'thb' ? 'gbp' : 'thb', n = parseFloat(amount) || 0;
  const out = from === 'thb' ? n / rate.rate : n * rate.rate;
  $('#cfrom').innerHTML = curRow(from, CUR[from][2] + esc(amount ? amount.replace(/^(\d+)/, (d) => Number(d).toLocaleString('en-GB')) : '0'));
  $('#cto').innerHTML = curRow(to, money(out, to));
  $('#crate').textContent = `£1 = ฿${rate.rate.toFixed(2)} · ${rate.manual ? 'set by you' : age(rate.at)}`;
}
function renderConvert() {
  const quick = ui.dir === 'thb' ? [20, 50, 100, 200, 500, 1000, 2000, 5000] : [1, 5, 10, 20, 50, 100, 200, 500];
  view.innerHTML = `<div class="conv">
    <div class="disp"><div id="cfrom" class="from"></div><button id="swap" aria-label="Swap currencies">⇅</button><div id="cto" class="to"></div></div>
    <button id="crate" class="rate"></button>
    <div class="quick">${quick.map((q) => `<button data-q="${q}">${ui.dir === 'thb' ? '฿' : '£'}${q.toLocaleString('en-GB')}</button>`).join('')}</div>
    <div class="pad">${['AC', '⌫', '⇅', '7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', '.'].map((k) => `<button data-k="${k}" class="${/\d|\./.test(k) ? '' : 'fn'}" aria-label="${{ AC: 'Clear', '⌫': 'Delete', '⇅': 'Swap currencies' }[k] || k}">${k}</button>`).join('')}</div></div>`;
  paintConvert(); refreshRate();
  const swap = () => { ui.dir = ui.dir === 'thb' ? 'gbp' : 'thb'; saveUi(); renderConvert(); };
  const digit = (k) => { if (amount.replace('.', '').length < 9 && !/\.\d\d$/.test(amount)) amount = amount === '0' ? k : amount + k; };
  $('.conv').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'swap' || b.dataset.k === '⇅') return swap();
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
  $('#crate').onclick = () => openSheet({
    title: 'Exchange rate', rec: { rate: rate.rate.toFixed(2), manual: rate.manual },
    fields: [{ k: 'rate', label: 'Baht for £1', type: 'number' }, { k: 'manual', label: 'Keep my rate (don\'t update automatically)', type: 'checkbox' }],
    onSave: (r) => { const v = parseFloat(r.rate); if (v > 0) { const changed = Math.abs(v - rate.rate) > 0.004; rate.rate = v; rate.manual = !!r.manual; if (changed && !r.manual) rate.at = Date.now(); saveRate(); } if (!rate.manual) refreshRate(true); renderConvert(); },
  });
}

/* ---------- info ---------- */
const CATS = ['Flights', 'Stays', 'Car hire', 'Transfers', 'Insurance', 'Visas and documents', 'Emergency', 'Contacts'];
function renderInfo() {
  const I = S.all('info'), cats = [...CATS, ...new Set(I.map((x) => x.cat).filter((c) => !CATS.includes(c)))];
  view.innerHTML = `<div class="chips">${cats.filter((c) => I.some((x) => x.cat === c)).map((c) => `<a href="#" data-jump="${esc(c)}">${esc(c)}</a>`).join('')}</div>` +
    cats.map((c) => {
      const rows = I.filter((x) => x.cat === c).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.u - b.u);
      return rows.length ? `<h3 id="cat-${esc(c)}">${esc(c)}</h3>` + rows.map((x) => `<article class="card">
        <header><div class="grow"><b>${esc(x.title)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</div><button class="pencil" data-edit="${x.id}" aria-label="Edit">✎</button></header>
        ${x.ref ? `<button class="ref" data-copy="${esc(x.ref)}"><small>${esc(x.reflabel || 'Reference')}</small>${esc(x.ref)}</button>` : ''}
        ${x.body ? `<p>${esc(x.body)}</p>` : ''}
        <div class="actions">${x.th ? `<button data-driver="${x.id}">Show the driver</button>` : ''}${x.phone ? `<a href="tel:${esc(x.phone.replace(/[^+\d]/g, ''))}">Call ${esc(x.phone)}</a>` : ''}${x.map ? `<a href="https://maps.apple.com/?q=${encodeURIComponent(x.map)}">Map</a>` : ''}</div></article>`).join('') : '';
    }).join('') + `<button class="btn ghost" data-add="info">Add a booking or note</button>`;
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
function showDriver(x) {
  const d = $('#driver');
  d.innerHTML = `<small>กรุณาพาไปที่นี่ · Please take us here</small><div class="th">${esc(x.th)}</div><div class="en">${esc(x.title)}${x.map ? '<br>' + esc(x.map) : ''}</div>${x.phone ? `<div class="en">โทร ${esc(x.phone)}</div>` : ''}<em>Tap to close</em>`;
  d.hidden = false; d.onclick = () => (d.hidden = true);
}

/* ---------- more: lists, phrases, settings ---------- */
function todoRow(x) {
  return `<li class="row ${x.done ? 'done' : ''}" data-edit="${x.id}"><button class="tick" data-tick="${x.id}" aria-label="Done">${x.done ? '✓' : ''}</button><div class="grow"><div class="t">${esc(x.text)}</div>${x.note ? `<div class="s">${esc(x.note)}</div>` : ''}</div></li>`;
}
const THEMES = [
  ['night', 'Night flight', 'linear-gradient(135deg,#2D2A4A,#3b4096 60%,#A51931)'],
  ['temple', 'Temple morning', 'linear-gradient(135deg,#fff,#e9e6f3 55%,#e7b9c0)'],
  ['andaman', 'Andaman', 'linear-gradient(135deg,#0b4f54,#14878a 60%,#c4503f)'],
];
function setTheme(t) {
  document.documentElement.dataset.theme = t; localStorage.setItem('bsb.theme', t);
  document.querySelector('meta[name="theme-color"]').content = { night: '#0c0e24', temple: '#f3f1ed', andaman: '#05242b' }[t];
}
function renderMore() {
  const seg = [['todo', 'To-do'], ['pack', 'Packing'], ['thai', 'Thai'], ['settings', 'Settings']];
  let body = '';
  if (ui.more === 'todo' || ui.more === 'pack') {
    const rows = S.all('todo').filter((x) => x.list === ui.more).sort((a, b) => !!a.done - !!b.done || (a.order ?? 1e9) - (b.order ?? 1e9) || a.u - b.u);
    const left = rows.filter((x) => !x.done).length;
    body = `<form id="quickadd"><input id="qa" placeholder="${ui.more === 'todo' ? 'Add a to-do' : 'Add something to pack'}" enterkeyhint="done"><button class="btn small">Add</button></form>
      <p class="count">${left} left of ${rows.length}</p><ul class="list">${rows.map(todoRow).join('')}</ul>`;
  } else if (ui.more === 'thai') {
    const f = ui.female, sub = (s, rom) => s.replaceAll('{p}', rom ? (f ? 'kha' : 'khrap') : (f ? 'ค่ะ' : 'ครับ')).replaceAll('{i}', rom ? (f ? 'chan' : 'phom') : (f ? 'ฉัน' : 'ผม'));
    body = `<div class="seg two"><button data-voice="m" class="${f ? '' : 'on'}">Ben says (khrap)</button><button data-voice="f" class="${f ? 'on' : ''}">Stefania says (kha)</button></div>
      <p class="count">Tap a phrase to hear it.</p>` + PHRASES.map(([cat, list]) => `<h3>${esc(cat)}</h3><ul class="list">${list.map(([en, th, ro]) =>
        `<li class="row phrase" data-say="${esc(sub(th))}"><div class="grow"><div class="s">${esc(sub(en, true).replace('chan', 'I').replace('phom', 'I'))}</div><div class="th">${esc(sub(th))}</div><div class="ro">${esc(sub(ro, true))}</div></div><span class="spk">🔊</span></li>`).join('')}</ul>`).join('');
  } else {
    const st = S.status;
    const line = st.state === 'syncing' ? 'Syncing…' : st.error ? st.error : S.isDirty() ? 'Changes waiting to sync' + (st.state === 'offline' ? ' (offline)' : '') : st.state === 'offline' ? 'Offline. Showing saved data' : 'Up to date';
    body = `<div class="card"><b>Sync</b><p>${esc(line)}${st.last ? `<br><small>Last synced ${new Date(st.last).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>` : ''}</p>
      <button class="btn small" id="syncnow">Sync now</button></div>
      <div class="card"><b>GitHub token</b><p>${S.cfg.token ? 'A token is saved on this phone.' : 'No token yet, so this phone can view but not save changes.'}</p>
      <button class="btn small ghost" id="settoken">${S.cfg.token ? 'Replace token' : 'Add token'}</button></div>
      <div class="card"><b>Appearance</b><div class="themes">${THEMES.map(([k, l, bg]) => `<button data-theme="${k}" class="${(document.documentElement.dataset.theme || 'night') === k ? 'on' : ''}"><i style="background:${bg}"></i>${l}</button>`).join('')}</div></div>
      <div class="card"><b>This phone</b><p>Signing out removes the trip data from this phone only.</p><button class="btn small danger" id="signout">Sign out</button></div>
      <p class="count">BSB Travel · v5</p>`;
  }
  view.innerHTML = `<div class="seg">${seg.map(([k, l]) => `<button data-more="${k}" class="${ui.more === k ? 'on' : ''}">${l}</button>`).join('')}</div>${body}`;
  view.querySelectorAll('[data-more]').forEach((b) => (b.onclick = () => { ui.more = b.dataset.more; saveUi(); render(); }));
  view.querySelectorAll('[data-theme]').forEach((b) => (b.onclick = () => { setTheme(b.dataset.theme); render(); }));
  view.querySelectorAll('[data-voice]').forEach((b) => (b.onclick = () => { ui.female = b.dataset.voice === 'f'; saveUi(); render(); }));
  const qa = $('#quickadd');
  if (qa) qa.onsubmit = (e) => { e.preventDefault(); const v = $('#qa').value.trim(); if (v) { S.put({ type: 'todo', list: ui.more, text: v }); setTimeout(() => $('#qa')?.focus()); } };
  if ($('#syncnow')) {
    $('#syncnow').onclick = () => S.sync();
    $('#settoken').onclick = () => openSheet({ title: 'GitHub token', rec: { token: '' }, fields: [{ k: 'token', label: 'Paste the token', type: 'text' }], onSave: (r) => { if (r.token.trim()) { S.saveCfg({ token: r.token.trim() }); S.sync(); } } });
    $('#signout').onclick = () => openSheet({ title: 'Sign out of this phone?', rec: {}, fields: [], saveLabel: 'Sign out', onSave: () => { S.wipe(); location.reload(); } });
  }
}
function say(text) {
  if (!('speechSynthesis' in window)) return toast('No speech on this device');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = 'th-TH'; u.rate = 0.85;
  const v = speechSynthesis.getVoices().find((x) => x.lang.replace('_', '-').startsWith('th')); if (v) u.voice = v;
  speechSynthesis.speak(u);
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
  const def = { plan: ['plan', planFields()], info: ['booking or note', infoFields], todo: ['item', [{ k: 'text', label: 'What', type: 'text', required: true }, { k: 'note', label: 'Notes', type: 'textarea' }, { k: 'done', label: 'Done', type: 'checkbox' }]] }[r.type];
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
  if ((el = q('data-tick'))) { const r = S.items[el.dataset.tick]; S.put({ ...r, done: !r.done }); }
  else if ((el = q('data-copy'))) { navigator.clipboard?.writeText(el.dataset.copy).then(() => toast('Copied'), () => {}); }
  else if ((el = q('data-driver'))) showDriver(S.items[el.dataset.driver]);
  else if ((el = q('data-say'))) say(el.dataset.say);
  else if ((el = q('data-jump'))) { e.preventDefault(); document.getElementById('cat-' + el.dataset.jump)?.scrollIntoView({ behavior: 'smooth' }); }
  else if ((el = q('data-add'))) editRecord(el.dataset.add === 'plan' ? { type: 'plan', title: '', date: el.dataset.date || '', leg: el.dataset.leg || '' } : { type: 'info', cat: 'Stays', title: '' }, true);
  else if ((el = q('data-edit')) && !e.target.closest('a')) editRecord(S.items[el.dataset.edit]);
});

/* ---------- boot ---------- */
S.onChange(() => { if (sheet.hidden && !(ui.tab === 'convert' && S.cfg.pass) && document.activeElement?.id !== 'qa') render(); else if (document.activeElement?.id === 'qa') { const v = ''; render(); $('#qa').value = v; $('#qa').focus(); } else document.body.dataset.sync = S.status.state; });
render();
// The compact glass title bar appears once the large title has scrolled away.
new IntersectionObserver(([e]) => { if (e.isIntersecting) delete document.body.dataset.scrolled; else document.body.dataset.scrolled = '1'; }).observe($('#sentinel'));
S.sync();
document.addEventListener('visibilitychange', () => { if (!document.hidden) { S.sync(); refreshRate(); if (sheet.hidden) render(); } });
window.addEventListener('online', () => S.sync());
setInterval(() => { if (!document.hidden) { if (ui.tab === 'today' && sheet.hidden && S.cfg.pass) render(); } }, 30000);
setInterval(() => { if (!document.hidden) S.sync(); }, 90000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
