// GET /api/metals — serve cached spot metal prices from Supabase
// Prices are populated by the /api/metals-cron Vercel cron job.
// Gold: updated every 60s, served with 2-minute CDN cache
// Silver/others: updated every 5min, served with 5-minute CDN cache
// GET /api/metals?refresh=true — force cron to run (admin auth required)
var crypto = require('crypto');
var { createClient } = require('@supabase/supabase-js');

var SUPABASE_URL = 'https://ljyogcspkvqgjbiyzfbn.supabase.co';
var METALS = ['gold', 'silver', 'platinum', 'palladium', 'copper'];

var ALLOWED_ORIGINS = [
  'https://analytics.miningforum.com',
  'https://dealbook.miningforum.com'
];

function getSupabase() {
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return createClient(SUPABASE_URL, key);
}

// Verify admin token — supports 4-part (JSON payload) and 3-part (legacy)
function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  var token = authHeader.replace('Bearer ', '');
  var parts = token.split('.');
  if (!process.env.ADMIN_PASSWORD || !process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  var secret = process.env.ADMIN_PASSWORD + process.env.SUPABASE_SERVICE_ROLE_KEY;
  var payloadB64, providedSignature, payload;
  if (parts.length === 4) {
    payloadB64 = parts[2]; providedSignature = parts[3];
    payload = parts[0] + '.' + parts[1] + '.' + payloadB64;
  } else if (parts.length === 3) {
    payloadB64 = ''; providedSignature = parts[2];
    payload = parts[0] + '.' + parts[1];
  } else { return false; }
  var expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  var sigBuf = Buffer.from(providedSignature);
  var expBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
  var age = Date.now() - parseInt(parts[1], 10);
  if (isNaN(age) || age < 0 || age > 24 * 60 * 60 * 1000) return false;
  return true;
}

function formatResponse(rows) {
  var result = {};
  (rows || []).forEach(function(row) {
    result[row.metal] = {
      price: row.price,
      bid: row.bid,
      ask: row.ask,
      high: row.high,
      low: row.low,
      change: row.change,
      change_percent: row.change_percent,
      currency: row.currency,
      updated_at: row.updated_at
    };
  });
  return result;
}

module.exports = async function handler(req, res) {
  var origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.indexOf(origin) >= 0) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    var sb = getSupabase();

    // Admin force-refresh: trigger the cron handler directly
    if (req.query.refresh === 'true') {
      if (!verifyToken(req.headers.authorization)) {
        return res.status(401).json({ ok: false, error: 'Unauthorized — admin token required for refresh' });
      }
      // Import and call the cron handler's fetch logic
      var cronHandler = require('./metals-cron');
      // Simulate a cron request
      var fakeReq = { method: 'POST', headers: { authorization: 'Bearer ' + process.env.CRON_SECRET } };
      var cronResult = {};
      var fakeRes = {
        status: function(code) { cronResult.status = code; return fakeRes; },
        json: function(body) { cronResult.body = body; return fakeRes; },
        end: function() { return fakeRes; }
      };
      await cronHandler(fakeReq, fakeRes);
      // Now read fresh data
      var { data: fresh } = await sb.from('metal_prices').select('*').in('metal', METALS);
      return res.status(200).json({
        ok: true,
        refreshed: true,
        cron_result: cronResult.body,
        metals: formatResponse(fresh)
      });
    }

    // Normal read: return cached data from Supabase (populated by cron)
    var { data, error } = await sb.from('metal_prices').select('*').in('metal', METALS);
    if (error) throw error;

    // CDN cache: 2 minutes (gold is updated every 60s by cron)
    res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=60');

    return res.status(200).json({
      ok: true,
      metals: formatResponse(data)
    });

  } catch (err) {
    console.error('Metals API error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
};
