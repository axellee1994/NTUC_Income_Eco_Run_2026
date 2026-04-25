const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT         = 3001;
const FRONTEND_DIR = path.resolve(__dirname, '..', 'frontend');
const API_HOST     = 'results.raceroster.com';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

// ── Rate limiter ─────────────────────────────────────────────────────────────
// 3000 API requests per IP per 60 seconds — generous enough for a full race
// load (~2700 requests) while blocking runaway scripts or external abuse.

const RATE_WINDOW_MS = 60_000;
const RATE_MAX       = 3000;
const rateMap        = new Map(); // ip → { count, windowStart }

function isRateLimited(ip) {
  const now   = Date.now();
  const entry = rateMap.get(ip) ?? { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count++;
  rateMap.set(ip, entry);
  return entry.count > RATE_MAX;
}

// Prune stale entries every 5 minutes so the map doesn't grow unbounded
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  for (const [ip, entry] of rateMap) {
    if (entry.windowStart < cutoff) rateMap.delete(ip);
  }
}, 5 * 60_000).unref();

// ── Static file handler ──────────────────────────────────────────────────────
function serveStatic(res, urlPath) {
  const relative = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const filePath = path.resolve(FRONTEND_DIR, relative);

  if (!filePath.startsWith(FRONTEND_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// ── API proxy ────────────────────────────────────────────────────────────────
function proxyApi(res, apiPath, query) {
  const options = {
    hostname: API_HOST,
    path:     `/v2/api/${apiPath}${query ? '?' + query : ''}`,
    method:   'GET',
    headers:  { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
  };

  const upstream = https.request(options, (upRes) => {
    res.writeHead(upRes.statusCode, { 'Content-Type': 'application/json' });
    upRes.pipe(res);
  });

  upstream.on('error', (err) => {
    console.error('[proxy error]', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });

  upstream.end();
}

// ── Request router ───────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith('/api/')) {
    const ip = req.socket.remoteAddress ?? 'unknown';
    if (isRateLimited(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limit exceeded. Try again shortly.' }));
      return;
    }
    proxyApi(res, url.pathname.slice(5), url.searchParams.toString());
    return;
  }

  serveStatic(res, url.pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Income Eco Run – Results`);
  console.log(`  → http://localhost:${PORT}\n`);
});
