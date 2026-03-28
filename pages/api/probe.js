/**
 * /pages/api/probe.js
 * Server-side proxy — bypasses CORS entirely.
 * Fetches each health endpoint from the server and returns real data.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url, type } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });

  const t0 = Date.now();

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 9000);

    const r = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'DiagHub/1.0' },
      cache: 'no-store',
    });
    clearTimeout(tid);

    const latencyMs = Date.now() - t0;
    const httpStatus = r.status;

    if (type === 'health' && r.ok) {
      let data = {};
      try { data = await r.json(); } catch {}
      return res.json({
        ok: true,
        status: data.status || (r.ok ? 'ok' : 'down'),
        latencyMs: data.latencyMs ?? latencyMs,
        httpStatus,
        checks: data.checks || {},
        timestamp: Date.now(),
      });
    }

    // HTTP probe only
    return res.json({
      ok: r.ok,
      status: r.ok ? 'ok' : 'down',
      latencyMs,
      httpStatus,
      checks: {},
      timestamp: Date.now(),
    });

  } catch (e) {
    return res.json({
      ok: false,
      status: 'down',
      latencyMs: Date.now() - t0,
      httpStatus: null,
      checks: {},
      error: e.name === 'AbortError' ? 'Timeout after 9s' : e.message,
      timestamp: Date.now(),
    });
  }
}
