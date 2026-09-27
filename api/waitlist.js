// POST /api/waitlist
// Step 1: { step: 1, email, first_name, source, utm_*, referrer, path }  -> saves the signup, returns a token
// Step 2: { step: 2, email, token, stage, role, market, interview }     -> adds the optional profile answers
//
// Storage: Upstash Redis (add it from your Vercel project's Storage tab).
// Works with either env var pair Vercel may create:
//   KV_REST_API_URL + KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
// Optional: WAITLIST_WEBHOOK_URL  (Zapier, Make, Slack, Google Sheets, etc.) receives a copy of each signup.

const crypto = require('crypto');

const DB_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const DB_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const WEBHOOK = process.env.WAITLIST_WEBHOOK_URL;

const STAGES = ['Just exploring', 'Saving up', 'Pre-approved', 'Already own one'];
const ROLES = ['First-time investor', 'Real estate agent', 'Something else'];
const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref'];
const MAX_PER_HOUR = 12; // signups per visitor per hour

async function redis(commands) {
  const r = await fetch(DB_URL.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + DB_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error('Database responded ' + r.status);
  const out = await r.json();
  const failed = out.find((x) => x && x.error);
  if (failed) throw new Error('Database error: ' + failed.error);
  return out.map((x) => x.result);
}

const clean = (v, max = 200) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');
const flat = (obj) => Object.entries(obj).filter(([, v]) => v !== '' && v != null).flatMap(([k, v]) => [k, String(v)]);
const header = (req, name) => {
  const v = req.headers[name];
  try { return v ? decodeURIComponent(String(v)).slice(0, 80) : ''; } catch { return String(v).slice(0, 80); }
};

async function notify(payload) {
  if (!WEBHOOK) return;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);
  try {
    await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal });
  } catch (e) {
    console.warn('Webhook failed:', e.message); // never block a signup on the webhook
  } finally {
    clearTimeout(t);
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Use POST.' });
  }
  if (!DB_URL || !DB_TOKEN) {
    console.error('Waitlist storage is not configured: add Upstash Redis from the Vercel Storage tab.');
    return res.status(500).json({ ok: false, error: 'Signups are not set up yet.' });
  }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};

  // Honeypot: real people never see or fill the "company" field.
  if (clean(b.company)) return res.status(200).json({ ok: true, token: 'ok' });

  const email = clean(b.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'Enter a valid email address, like name@example.com.' });
  }

  try {
    // Light rate limit per visitor, keyed by a one-way hash of the IP (the IP itself is never stored).
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const visitor = 'rl:' + crypto.createHash('sha256').update(ip + (process.env.ADMIN_KEY || 'rp')).digest('hex').slice(0, 20);
    const [count] = await redis([['INCR', visitor]]);
    if (count === 1) await redis([['EXPIRE', visitor, '3600']]);
    if (count > MAX_PER_HOUR) return res.status(429).json({ ok: false, error: 'Too many tries. Wait a few minutes and try again.' });

    const key = 'waitlist:' + email;
    const now = new Date().toISOString();

    if (Number(b.step) === 2) {
      const [token] = await redis([['HGET', key, 'token']]);
      if (!token || token !== clean(b.token, 64)) {
        return res.status(403).json({ ok: false, error: 'Join the waitlist first, then add your answers.' });
      }
      const profile = {
        stage: STAGES.includes(b.stage) ? b.stage : '',
        role: ROLES.includes(b.role) ? b.role : '',
        market: clean(b.market, 80),
        interview: b.interview ? 'yes' : 'no',
        profile_at: now,
        updated_at: now,
      };
      await redis([['HSET', key, ...flat(profile)]]);
      await notify({ event: 'waitlist_profile', email, ...profile });
      return res.status(200).json({ ok: true });
    }

    const [created] = await redis([['HGET', key, 'created_at']]);
    const isNew = !created;
    const token = crypto.randomBytes(16).toString('hex'); // lets this browser add step-2 answers
    const record = { email, first_name: clean(b.first_name, 80), token, updated_at: now };

    if (isNew) {
      Object.assign(record, {
        created_at: now,
        form: clean(b.source, 40),
        referrer: clean(b.referrer, 300),
        landing_path: clean(b.path, 200),
        country: header(req, 'x-vercel-ip-country'),
        region: header(req, 'x-vercel-ip-country-region'),
        city: header(req, 'x-vercel-ip-city'),
      });
      for (const k of UTM) record[k] = clean(b[k], 100);
    }

    const cmds = [['HSET', key, ...flat(record)]];
    if (isNew) cmds.push(['ZADD', 'waitlist:index', String(Date.now()), email]);
    await redis(cmds);

    if (isNew) {
      const { token: _t, ...safe } = record;
      await notify({ event: 'waitlist_signup', ...safe });
    }
    return res.status(200).json({ ok: true, token, existing: !isNew });
  } catch (e) {
    console.error('Waitlist error:', e);
    return res.status(502).json({ ok: false, error: 'We couldn’t save that just now. Try again in a minute.' });
  }
};
