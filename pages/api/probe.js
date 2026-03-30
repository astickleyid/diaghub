export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url, type } = req.query;
  if (!url) return res.status(400).json({ error: "url required" });

  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 9000);
    const r = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": "DiagHub/1.0" },
      cache: "no-store",
    });
    clearTimeout(tid);
    const latencyMs = Date.now() - t0;

    if (type === "health" && r.ok) {
      let data = {};
      try { data = await r.json(); } catch {}
      return res.json({
        ok: true,
        status: data.status || "ok",
        latencyMs: data.latencyMs ?? latencyMs,
        httpStatus: r.status,
        checks: data.checks || {},
        timestamp: Date.now(),
      });
    }
    return res.json({
      ok: r.ok,
      status: r.ok ? "ok" : "down",
      latencyMs,
      httpStatus: r.status,
      checks: {},
      timestamp: Date.now(),
    });
  } catch (e) {
    return res.json({
      ok: false,
      status: "down",
      latencyMs: Date.now() - t0,
      httpStatus: null,
      checks: {},
      error: e.name === "AbortError" ? "Timeout after 9s" : e.message,
      timestamp: Date.now(),
    });
  }
}
