// Builds audio/*.m4a for every Thai phrase (khrap and kha, Central and Isaan versions) with the Mac's Thai voice,
// plus audio/list.json ({ thai text: file }). Audio files play with the iPhone on silent;
// iOS speech doesn't. Run on a Mac after changing phrases.js:  node tools/make-audio.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { PHRASES } from '../phrases.js';

const sub = (s, f) => s.replaceAll('{p}', f ? 'ค่ะ' : 'ครับ').replaceAll('{i}', f ? 'ฉัน' : 'ผม');
const texts = [...new Set(PHRASES.flatMap(([, list]) => list.flatMap(([, th, , isan]) => [th, isan].filter(Boolean).flatMap((t) => [sub(t, false), sub(t, true)]))))];
mkdirSync('audio', { recursive: true });
const list = {};
for (const t of texts) {
  const f = createHash('sha1').update(t).digest('hex').slice(0, 10) + '.m4a';
  list[t] = f;
  if (existsSync(`audio/${f}`)) continue;
  const tmp = `audio/${f}.aiff`;
  execFileSync('say', ['-v', 'Kanya', '-r', '150', '-o', tmp, t.replace(/[/…]/g, ' ')]);
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '48000', tmp, `audio/${f}`]);
  unlinkSync(tmp);
}
for (const f of readdirSync('audio')) if (f.endsWith('.m4a') && !Object.values(list).includes(f)) unlinkSync(`audio/${f}`);
writeFileSync('audio/list.json', JSON.stringify(list));
console.log(`${texts.length} clips in audio/`);
