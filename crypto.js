// Passphrase encryption shared by the app and the Node tools (WebCrypto in both).
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (buf) => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const ITER = 200000;

async function keyFor(pass, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptJSON(obj, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(pass, salt), enc.encode(JSON.stringify(obj)));
  return JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) });
}

// Throws if the passphrase is wrong or the file was tampered with.
export async function decryptJSON(text, pass) {
  const f = JSON.parse(text);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(f.iv) }, await keyFor(pass, unb64(f.salt)), unb64(f.ct));
  return JSON.parse(dec.decode(pt));
}

export const utf8ToB64 = (s) => b64(enc.encode(s));
export const b64ToUtf8 = (s) => dec.decode(unb64(s.replace(/\s/g, '')));
