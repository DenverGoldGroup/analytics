// GET /api/metals — return cached spot metal prices
// GET /api/metals?refresh=true — force refresh from Metals.Dev (requires admin auth)
const crypto = require('crypto');
const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ljyogcspkvqgjbiyzfbn.supabase.co';
const METALS = ['gold', 'silver', 'platinum', 'palladium', 'copper'];
const CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

function getSupabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return createClient(SUPABASE_URL, key);
}

// Verify admin token (same logic as upload.js)
function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.replace('Bearer ', '');
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [tokenBytes, timestamp, providedSignature] = parts;
  if (!process.env.ADMIN_PASSWORD || !process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  const secret = process.env.ADMIN_PASSWORD + process.env.SUPABASE_SERVICE_ROLE_KEY;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(tokenBytes + '.' + timestamp)
    .digest('hex');

  const sigBuf = Buffer.from(providedSignature);
  const expBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;

  const age = Date.now() - parseInt(timestamp, 10);
  if (isNaN(age) || age < 0 || age > 24 * 60 * 60 * 1000) return false;

  return true;
}

// HTTPS GET that works in all Node.js versions
function httpsGet(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, function(resp) {
      let body = '';
      resp.on('data', function(chunk) { body += chunk; });
      resp.on('end', function() {
        if (resp.statusCode !== 200) {
          reject(new Error('HTTP ' + resp.statusCode + ': ' + body.substring(0, 200)));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Invalid JSON: ' + body.substring(0, 200)));
        }
      });
    }).on('error', reject);
  });
}

// Fetch all metals in one call using /v1/latest and update Supabase cache
async function refreshPrices(sb, apiKey) {
  const url = 'https://api.metals.dev/v1/latest?api_key=' + apiKey + '&currency=USD&unit=toz';
  const data = await httpsGet(url);

  if (data.status && data.status !== 'success') {
    throw new Error('Metals.Dev error: ' + (data.error || JSON.stringify(data)));
  }

  // The /v1/latest response has { metals: { gold: 2650.30, silver: 31.20, ... } }
  const metalPrices = data.metals || {};
  const now = new Date().toISOString();
  const errors = [];
  const results = {};

  for (const metal of METALS) {
    try {
      const price = metalPrices[metal];
      if (price == null) {
        errors.push(metal + ': not found in API response');
        continue;
      }

      const row = {
        metal: metal,
        price: price,
        bid: null,
        ask: null,
        high: null,
        low: null,
        change: null,
        change_percent: null,
        currency: 'USD',
        updated_at: now
      };

      const { error } = await sb.from('metal_prices').upsert(row, { onConflict: 'metal' });
      if (error) throw error;

      results[metal] = row;
    } catch (err) {
      errors.push(metal + ': ' + err.message);
    }
  }

  // Now fetch individual spot prices for bid/ask/high/low/change data
  for (const metal of METALS) {
    if (!results[metal]) continue;
    try {
      const spotUrl = 'https://api.metals.dev/v1/metal/spot?api_key=' + apiKey + '&metal=' + metal + '&currency=USD';
      const spotData = await httpsGet(spotUrl);
      if (spotData.rate) {
        const row = {
          metal: metal,
          price: spotData.rate.price || results[metal].price,
          bid: spotData.rate.bid,
          ask: spotData.rate.ask,
          high: spotData.rate.high,
          low: spotData.rate.low,
          change: spotData.rate.change,
          change_percent: spotData.rate.change_percent,
          currency: 'USD',
          updated_at: now
        };
        const { error } = await sb.from('metal_prices').upsert(row, { onConflict: 'metal' });
        if (error) throw error;
        results[metal] = row;
      }
    } catch (err) {
      // Non-fatal: we still have the price from /latest
      errors.push(metal + ' (spot detail): ' + err.message);
    }
  }

  return { results, errors };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://analytics.miningforum.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const sb = getSupabase();
    const forceRefresh = req.query.refresh === 'true';

    // Force refresh requires admin auth
    if (forceRefresh) {
      if (!verifyToken(req.headers.authorization)) {
        return res.status(401).json({ ok: false, error: 'Unauthorized — admin token required for refresh' });
      }

      const apiKey = process.env.METALS_DEV_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ ok: false, error: 'METALS_DEV_API_KEY not configured' });
      }

      const { results, errors } = await refreshPrices(sb, apiKey);

      if (Object.keys(results).length === 0) {
        return res.status(502).json({ ok: false, error: 'All fetches failed', details: errors });
      }

      const { data } = await sb.from('metal_prices').select('*').in('metal', METALS);
      return res.status(200).json({
        ok: true,
        refreshed: true,
        errors: errors.length > 0 ? errors : undefined,
        metals: formatResponse(data)
      });
    }

    // Normal read: return cached data
    const { data, error } = await sb.from('metal_prices').select('*').in('metal', METALS);
    if (error) throw error;

    // Check if cache is stale (old data OR null prices from seed rows)
    let stale = false;
    if (data && data.length > 0) {
      const hasNullPrices = data.some(function(row) { return row.price == null; });
      const oldest = data.reduce(function(min, row) {
        var t = new Date(row.updated_at).getTime();
        return t < min ? t : min;
      }, Infinity);
      stale = hasNullPrices || (Date.now() - oldest) > CACHE_MAX_AGE_MS;
    } else {
      stale = true;
    }

    // Auto-refresh if stale and API key is available
    if (stale && process.env.METALS_DEV_API_KEY) {
      try {
        const { results, errors } = await refreshPrices(sb, process.env.METALS_DEV_API_KEY);
        const { data: fresh } = await sb.from('metal_prices').select('*').in('metal', METALS);
        return res.status(200).json({
          ok: true,
          refreshed: true,
          errors: errors.length > 0 ? errors : undefined,
          metals: formatResponse(fresh)
        });
      } catch (refreshErr) {
        // If refresh fails, return stale data with error info
        console.error('Auto-refresh failed:', refreshErr);
        return res.status(200).json({
          ok: true,
          refreshed: false,
          stale: true,
          refresh_error: refreshErr.message,
          metals: formatResponse(data)
        });
      }
    }

    // Set cache header for CDN (5 minutes)
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');

    return res.status(200).json({
      ok: true,
      refreshed: false,
      stale: stale,
      metals: formatResponse(data)
    });

  } catch (err) {
    console.error('Metals API error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
};

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
