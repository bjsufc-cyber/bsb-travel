// Local state + encrypted sync to a file in the GitHub repo.
// Every record is {id, type, ..., u: updatedAt ms, del?: true}; merging is last-write-wins per record.
import { encryptJSON, decryptJSON, utf8ToB64, b64ToUtf8 } from './crypto.js';

const LS = { items: 'bsb.items', cfg: 'bsb.cfg', dirty: 'bsb.dirty', last: 'bsb.lastSync' };
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const cfg = read(LS.cfg, {});            // {pass, token, api?, owner?, repo?}
export let items = read(LS.items, {});
let dirty = read(LS.dirty, false);
export const status = { state: 'idle', last: read(LS.last, 0), error: '' };
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn());

export function saveCfg(patch) { Object.assign(cfg, patch); write(LS.cfg, cfg); }
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const all = (type) => Object.values(items).filter((r) => r.type === type && !r.del);

export function put(rec) {
  rec.id ??= uid(); rec.u = Date.now();
  items[rec.id] = rec; persist(true); return rec;
}
export function remove(id) { if (items[id]) put({ id, type: items[id].type, del: true }); }
function persist(markDirty) {
  write(LS.items, items);
  if (markDirty) { dirty = true; write(LS.dirty, true); scheduleSync(2500); }
  emit();
}

export function merge(a, b) {
  const out = { ...a }; let changedA = false, changedB = false;
  for (const [id, r] of Object.entries(b)) {
    if (!out[id] || (r.u || 0) > (out[id].u || 0)) { out[id] = r; changedA = true; }
  }
  for (const [id, r] of Object.entries(out)) if (!b[id] || (b[id].u || 0) < (r.u || 0)) changedB = true;
  return { out, changedA, changedB };   // changedA: local gained something; changedB: remote is missing something
}

function repo() {
  const owner = cfg.owner || location.hostname.split('.')[0];
  const name = cfg.repo || location.pathname.split('/').filter(Boolean)[0] || 'bsb-travel';
  return { url: `${cfg.api || 'https://api.github.com'}/repos/${owner}/${name}/contents/trip.enc`, branch: 'data' };
}
const headers = () => ({ Accept: 'application/vnd.github+json', ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) });

async function pull(pass = cfg.pass) {
  const { url, branch } = repo();
  const res = await fetch(`${url}?ref=${branch}&t=${Date.now()}`, { headers: headers(), cache: 'no-store' });
  if (res.status === 404) return { remote: {}, sha: null };
  if (res.status === 401) throw new Error('GitHub token rejected');
  if (!res.ok) throw new Error(`GitHub read failed (${res.status})`);
  const j = await res.json();
  let data;
  try { data = await decryptJSON(b64ToUtf8(j.content), pass); } catch { throw new Error('Wrong passphrase'); }
  return { remote: data.items || {}, sha: j.sha };
}

let running = null, timer = null;
export function scheduleSync(ms = 0) { clearTimeout(timer); timer = setTimeout(sync, ms); }

export function sync() {
  if (running) return running;
  if (!cfg.pass) return Promise.resolve(false);
  running = (async () => {
    status.state = 'syncing'; status.error = ''; emit();
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const { remote, sha } = await pull();
        const { out, changedA, changedB } = merge(items, remote);
        if (changedA) { items = out; write(LS.items, items); }
        if (!changedB) { dirty = false; write(LS.dirty, false); break; }
        if (!cfg.token) throw new Error('Add a GitHub token in Settings to save changes');
        const { url, branch } = repo();
        const snapshot = JSON.stringify(items);
        const body = { message: 'sync', branch, content: utf8ToB64(await encryptJSON({ items }, cfg.pass)), ...(sha ? { sha } : {}) };
        const res = await fetch(url, { method: 'PUT', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (res.ok) { if (JSON.stringify(items) === snapshot) { dirty = false; write(LS.dirty, false); } else scheduleSync(1500); break; }
        if (res.status !== 409 && res.status !== 422) throw new Error(res.status === 401 || res.status === 403 || res.status === 404 ? 'GitHub token cannot write to the repo' : `GitHub save failed (${res.status})`);
        if (attempt === 3) throw new Error('Could not save, will retry');
      }
      status.state = 'ok'; status.last = Date.now(); write(LS.last, status.last);
    } catch (e) {
      status.state = navigator.onLine === false || e instanceof TypeError ? 'offline' : 'error';
      status.error = status.state === 'offline' ? '' : e.message;
    }
    running = null; emit(); return status.state === 'ok';
  })();
  return running;
}
export const isDirty = () => dirty;

// First-time setup: prove the passphrase by decrypting the shared file.
export async function unlock(pass, token) {
  const prev = { ...cfg };
  Object.assign(cfg, { pass, token });
  try { const { remote } = await pull(pass); items = merge(items, remote).out; }
  catch (e) { Object.keys(cfg).forEach((k) => delete cfg[k]); Object.assign(cfg, prev); throw e; }
  write(LS.cfg, cfg); write(LS.items, items); status.state = 'ok'; status.last = Date.now(); write(LS.last, status.last); emit();
}
export function wipe() { Object.values(LS).forEach((k) => localStorage.removeItem(k)); }
