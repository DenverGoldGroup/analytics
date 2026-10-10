// GET /api/ems-sync — the daily Vercel cron (vercel.json): the member roster and the participating companies
// of every current or forthcoming event whose registration has opened, from EMS. See api/_ems-sync.js.
// Only Vercel's cron may call it (Authorization: Bearer CRON_SECRET); admins run it from /admin via
// /api/psr (ems-sync, ems-sync-log), which carries the admin token check.
const sync = require('./_ems-sync');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  var secret = process.env.CRON_SECRET;
  if (!secret || req.headers['authorization'] !== 'Bearer ' + secret) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  try {
    var out = await sync.run({ trigger: 'cron', dryRun: false });
    return res.status(200).json({ ok: true, result: out });
  } catch (err) {
    console.warn('[ems-sync] run failed: ' + err.message);
    return res.status(500).json({ ok: false, error: 'Sync failed' });
  }
};
