#!/usr/bin/env node
// Read or update the encrypted trip file from a computer. The passphrase comes from BSB_PASS.
//   node tools/data.mjs dump  trip.enc                 print the decrypted records
//   node tools/data.mjs merge trip.enc records.json    add/replace records (array or {id: record}), newest wins
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { encryptJSON, decryptJSON } from '../crypto.js';

const [cmd, file, src] = process.argv.slice(2);
const pass = process.env.BSB_PASS;
if (!pass || !cmd || !file) { console.error('Usage: BSB_PASS=… node tools/data.mjs dump|merge trip.enc [records.json]'); process.exit(1); }
const current = existsSync(file) ? (await decryptJSON(readFileSync(file, 'utf8'), pass)).items : {};

if (cmd === 'dump') console.log(JSON.stringify(current, null, 2));
else if (cmd === 'merge') {
  const input = JSON.parse(readFileSync(src, 'utf8'));
  const now = Date.now(); let n = 0;
  for (const r of Array.isArray(input) ? input : Object.values(input)) {
    if (!r.id || !r.type) throw new Error('Every record needs an id and a type');
    const rec = { ...r, u: r.u ?? now };
    if (!current[r.id] || current[r.id].u <= rec.u) { current[r.id] = rec; n++; }
  }
  writeFileSync(file, await encryptJSON({ items: current }, pass));
  console.log(`${n} records written, ${Object.keys(current).length} in total`);
} else { console.error('Unknown command'); process.exit(1); }
