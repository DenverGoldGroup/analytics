// POST /api/metals-cron — Vercel Cron handler
// Refreshes metal prices in the Supabase cache on a schedule.
// Schedule (vercel.json): "0 0 1 * *" — once per month, 00:00 UTC on the 1st.
// Gold is fetched every invocation; the other metals refresh whenever silver's
// cached row is older than OTHER_INTERVAL_MS, which is always true on a monthly
// cadence, so all five metals refresh together each run. An admin can force an
// out-of-cycle refresh via GET /api/metals?refresh=true.
var https = require('https');
var crypto = require('crypto');
var { createClient } = require('@supabase/supabase-js');

var SUPABASE_URL = 'https://ljyogcspkvqgjbiyzfbn.supabase.co';
var GOLD_METALS = ['gold'];
var OTHER_METALS = ['silver', 'platinum', 'palladium', 'copper'];
var OTHER_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function getSupabase() {
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return createClient(SUPABASE_URL, key);
}

function httpsGet(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, function(resp) {
      var body = '';
      resp.on('data', function(chunk) { body += chunk; });
      resp.on('end', function() {
        if (resp.statusCode !== 200) {
          reject(new Error('HTTP ' + resp.statusCode + ': ' + body.substring(0, 200)));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON: ' + body.substring(0, 200))); }
      });
    }).on('error', reject);
  });
}

// Fetch spot price for a single metal, return full row for upsert
async function fetchSpot(apiKey, metal) {
  var url = 'https://api.metals.dev/v1/metal/spot?api_key=' + apiKey + '&metal=' + metal + '&currency=USD';
  var data = await httpsGet(url);
  if (!data.rate) throw new Error('No rate in response for ' + metal);
  return {
    metal: metal,
    price: data.rate.price,
    bid: data.rate.bid || null,
    ask: data.rate.ask || null,
    high: data.rate.high || null,
    low: data.rate.low || null,
    change: data.rate.change || null,
    change_percent: data.rate.change_percent || null,
    currency: 'USD',
    updated_at: new Date().toISOString()
  };
}

function safeEqual(a, b) {
  var aBuf = Buffer.from(String(a));
  var bBuf = Buffer.from(String(b));
  return aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
}

// True only when CRON_SECRET is configured and the header matches it exactly
function isVercelCron(authHeader) {
  var secret = process.env.CRON_SECRET;
  if (!secret || !authHeader) return false;
  return safeEqual(authHeader, 'Bearer ' + secret);
}

// Admin token, same scheme as api/psr.js and api/metals.js:
// randomBytes.timestamp.emailB64.signature (4 parts) or legacy
// randomBytes.timestamp.signature (3 parts); HMAC-SHA256 with
// ADMIN_PASSWORD + SUPABASE_SERVICE_ROLE_KEY, valid for 24 hours.
function verifyAdminToken(authHeader) {
  if (!authHeader || authHeader.indexOf('Bearer ') !== 0) return false;
  if (!process.env.ADMIN_PASSWORD || !process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  var secret = process.env.ADMIN_PASSWORD + process.env.SUPABASE_SERVICE_ROLE_KEY;
  var parts = authHeader.slice(7).split('.');
  var payload, providedSig;
  if (parts.length === 4 && parts[0] !== 'psr') {
    payload = parts[0] + '.' + parts[1] + '.' + parts[2];
    providedSig = parts[3];
  } else if (parts.length === 3) {
    payload = parts[0] + '.' + parts[1];
    providedSig = parts[2];
  } else {
    return false;
  }
  var expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (!safeEqual(providedSig, expectedSig)) return false;
  var age = Date.now() - parseInt(parts[1], 10);
  if (isNaN(age) || age < 0 || age > 24 * 60 * 60 * 1000) return false;
  return true;
}

module.exports = async function handler(req, res) {
  // Vercel crons send GET requests; also accept POST for manual triggers
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Vercel cron invocations carry "Bearer <CRON_SECRET>"; manual triggers need a
  // signed admin token. Every other caller is refused, so metals.dev is only hit
  // by the monthly cron or a deliberate admin refresh.
  var authHeader = req.headers['authorization'];
  if (!isVercelCron(authHeader) && !verifyAdminToken(authHeader)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  var apiKey = process.env.METALS_DEV_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: 'METALS_DEV_API_KEY not configured' });
  }

  try {
    var sb = getSupabase();
    var updated = [];
    var errors = [];

    // Always fetch gold on every cron run
    for (var g = 0; g < GOLD_METALS.length; g++) {
      try {
        var row = await fetchSpot(apiKey, GOLD_METALS[g]);
        var { error } = await sb.from('metal_prices').upsert(row, { onConflict: 'metal' });
        if (error) throw error;
        updated.push(GOLD_METALS[g]);
      } catch (e) {
        errors.push(GOLD_METALS[g] + ': ' + e.message);
      }
    }

    // Check if other metals need refresh (every ~5 minutes)
    var needOthers = false;
    var { data: silverRow } = await sb.from('metal_prices')
      .select('updated_at')
      .eq('metal', 'silver')
      .single();

    if (!silverRow || !silverRow.updated_at) {
      needOthers = true;
    } else {
      var age = Date.now() - new Date(silverRow.updated_at).getTime();
      needOthers = age >= OTHER_INTERVAL_MS;
    }

    if (needOthers) {
      for (var i = 0; i < OTHER_METALS.length; i++) {
        try {
          var row = await fetchSpot(apiKey, OTHER_METALS[i]);
          var { error } = await sb.from('metal_prices').upsert(row, { onConflict: 'metal' });
          if (error) throw error;
          updated.push(OTHER_METALS[i]);
        } catch (e) {
          errors.push(OTHER_METALS[i] + ': ' + e.message);
        }
      }
    }

    return res.status(200).json({
      ok: true,
      updated: updated,
      errors: errors.length > 0 ? errors : undefined,
      othersRefreshed: needOthers
    });

  } catch (err) {
    console.error('Metals cron error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
