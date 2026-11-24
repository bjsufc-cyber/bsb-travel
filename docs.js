// Documents (e-visas, insurance, bookings, IDs) kept on THIS phone only, in IndexedDB.
// They are never synced or uploaded: the repo is public and these files hold passport details.
// Each phone adds its own copies from the Files app; iCloud Drive stays the master copy.
const DB = 'bsb-docs', STORE = 'files';
export const GROUPS = ['Visas', 'Flights', 'Stays', 'Insurance', 'Car', 'IDs', 'Other'];

let dbp;
function db() {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbp = null; rej(r.error); };
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode), s = t.objectStore(STORE);
    let out; const r = fn(s);
    if (r) r.onsuccess = () => (out = r.result);
    t.oncomplete = () => res(out);
    t.onerror = t.onabort = () => rej(t.error || new Error('Storage failed'));
  });
}

// The list without the file bodies, so drawing it stays quick.
let cache = null;
export async function list() {
  if (!cache) {
    const rows = (await tx('readonly', (s) => s.getAll())) || [];
    cache = rows.map(({ blob, ...meta }) => meta);
  }
  return cache;
}
export const getDoc = (id) => tx('readonly', (s) => s.get(id));

// Guess the section from the file name; the person can change it before saving.
export function guessGroup(name) {
  const n = name.toLowerCase();
  if (/visa|e-?visa|tdac|arrival card/.test(n)) return 'Visas';
  if (/insur|policy|holiday extras|mbds/.test(n)) return 'Insurance';
  if (/passport|idp|permit|licen[cs]e|birth/.test(n)) return 'IDs';
  if (/car|lek|rental|hire/.test(n)) return 'Car';
  if (/airbnb|hotel|villa|stay|resort|booking\.com|apartment|residenc/.test(n)) return 'Stays';
  if (/flight|ticket|boarding|gulf|airasia|thai ?air|lion|itinerary|trip\.?com|pnr/.test(n)) return 'Flights';
  return 'Other';
}
export const baseName = (name) => name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' ').trim() || 'Document';

export async function add(file, { name, group }) {
  const rec = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name: name || baseName(file.name), group,
    file: file.name, type: file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : ''), size: file.size, added: Date.now() };
  // Store the bytes, not the File handle: a File from the picker can stop being readable later on iOS.
  const blob = new Blob([await file.arrayBuffer()], { type: rec.type });
  await tx('readwrite', (s) => s.put({ ...rec, blob }));
  cache = null; return rec;
}
export async function update(id, patch) {
  const r = await getDoc(id); if (!r) return;
  await tx('readwrite', (s) => s.put({ ...r, ...patch }));
  cache = null;
}
export async function remove(id) { await tx('readwrite', (s) => s.delete(id)); cache = null; }
export async function clearAll() { cache = null; try { await tx('readwrite', (s) => s.clear()); } catch {} }

// Ask the browser not to clear these files when space runs low.
export async function persist() {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : false; } catch { return false; }
}
export async function persisted() {
  try { return navigator.storage?.persisted ? await navigator.storage.persisted() : false; } catch { return false; }
}
export const isPdf = (r) => r.type === 'application/pdf' || /\.pdf$/i.test(r.file || '');
export const fmtSize = (b) => b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
