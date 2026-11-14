// Local stand-in for the GitHub contents API plus a static file server, for testing sync.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname, join } from 'node:path';
let content = existsSync(process.argv[2] || '') ? Buffer.from(readFileSync(process.argv[2])).toString('base64') : null;
const sha = () => createHash('sha1').update(content || '').digest('hex');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/repos/')) {
    if (req.method === 'GET') { if (!content) { res.writeHead(404); return res.end('{}'); } res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ content, sha: sha() })); }
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      const j = JSON.parse(body);
      if (!req.headers.authorization) { res.writeHead(401); return res.end('{}'); }
      if (content && j.sha !== sha()) { res.writeHead(409); return res.end('{}'); }
      content = j.content; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ content: { sha: sha() } }));
    }); return;
  }
  const f = join(process.cwd(), url.pathname === '/' ? 'index.html' : url.pathname);
  if (!existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f));
}).listen(8765, () => console.log('http://localhost:8765'));
