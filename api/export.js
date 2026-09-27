// GET /api/export              -> downloads every signup as a CSV file
// GET /api/export?format=json  -> the same data as JSON
// Protect it by setting ADMIN_KEY in your Vercel environment variables, then send it as either
//   an "x-admin-key" header (preferred), or ?key=YOUR_ADMIN_KEY in the URL (quick, but ends up in logs and browser history).

const DB_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const DB_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const COLUMNS = [
  'created_at', 'email', 'first_name', 'stage', 'role', 'market', 'interview',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref',
  'referrer', 'landing_path', 'form', 'country', 'region', 'city', 'profile_at', 'updated_at',
];

async function redis(commands) {
  const r = await fetch(DB_URL.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + DB_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error('Database responded ' + r.status);
  return (await r.json()).map((x) => x.result);
}

const toObject = (arr) => {
  const o = {};
  if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) o[arr[i]] = arr[i + 1];
  else if (arr && typeof arr === 'object') Object.assign(o, arr);
  return o;
};

// Quote every cell, and neutralise values a spreadsheet would treat as a formula.
const cell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const key = req.headers['x-admin-key'] || (req.query && req.query.key);
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) return res.status(401).send('Unauthorized');
  if (!DB_URL || !DB_TOKEN) return res.status(500).send('Storage is not configured.');

  try {
    const [emails] = await redis([['ZRANGE', 'waitlist:index', '0', '-1']]);
    const rows = [];
    for (let i = 0; i < (emails || []).length; i += 100) {
      const batch = emails.slice(i, i + 100);
      const results = await redis(batch.map((e) => ['HGETALL', 'waitlist:' + e]));
      for (const r of results) {
        const o = toObject(r);
        delete o.token;
        rows.push(o);
      }
    }

    if (req.query && req.query.format === 'json') return res.status(200).json({ count: rows.length, signups: rows });

    const csv = [COLUMNS.join(','), ...rows.map((o) => COLUMNS.map((c) => cell(o[c])).join(','))].join('\n');
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="realtipartner-waitlist-${day}.csv"`);
    return res.status(200).send('\uFEFF' + csv);
  } catch (e) {
    console.error('Export error:', e);
    return res.status(502).send('Export failed. Check the function logs in Vercel.');
  }
};
