// GET/POST/PUT/DELETE /api/deals — CRUD for M&A deals
var crypto = require('crypto');
var { createClient } = require('@supabase/supabase-js');

var SUPABASE_URL = 'https://ljyogcspkvqgjbiyzfbn.supabase.co';

function getSupabase() {
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return createClient(SUPABASE_URL, key);
}

function getSecret() {
  if (!process.env.ADMIN_PASSWORD || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return process.env.ADMIN_PASSWORD + process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function verifyAdminToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  var secret = getSecret();
  if (!secret) return false;
  var token = authHeader.replace('Bearer ', '');
  var parts = token.split('.');
  var payloadB64, providedSig, payload;
  if (parts.length === 4) {
    payloadB64 = parts[2]; providedSig = parts[3];
    payload = parts[0] + '.' + parts[1] + '.' + payloadB64;
  } else if (parts.length === 3) {
    payloadB64 = ''; providedSig = parts[2];
    payload = parts[0] + '.' + parts[1];
  } else { return false; }
  var expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  var sigBuf = Buffer.from(providedSig);
  var expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
  var age = Date.now() - parseInt(parts[1], 10);
  if (isNaN(age) || age < 0 || age > 24 * 60 * 60 * 1000) return false;
  return true;
}

// Verify dealbook session token: dealbook.<timestamp>.<signature>
function verifyDealbookToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  var secret = getDealbookSecret();
  if (!secret) return false;
  var token = authHeader.replace('Bearer ', '');
  var parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'dealbook') return false;
  var payload = parts[0] + '.' + parts[1];
  var expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  var sigBuf = Buffer.from(parts[2]);
  var expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
  var age = Date.now() - parseInt(parts[1], 10);
  if (isNaN(age) || age < 0 || age > 7 * 24 * 60 * 60 * 1000) return false;
  return true;
}

function getDealbookSecret() {
  if (!process.env.DEALBOOK_PASSWORD || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return process.env.DEALBOOK_PASSWORD + process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function slugify(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

var ALLOWED_ORIGINS = [
  'https://analytics.miningforum.com',
  'https://dealbook.miningforum.com'
];

function setCors(req, res) {
  var origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.indexOf(origin) >= 0) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Enrich deal_data with live company data from the companies table.
// Overlays current market cap, stock price, production, reserves, resources
// onto bidder/target objects so deals always show the latest figures.
async function enrichDealData(sb, dealData, bidderName, targetName) {
  if (!dealData || !bidderName || !targetName) return dealData;
  try {
    var names = [bidderName, targetName];
    var { data: companies } = await sb.from('companies')
      .select('company_name, market_cap_usd, stock_price_usd, production_low, production_high, reserves, resources')
      .in('company_name', names);
    if (!companies || companies.length === 0) return dealData;

    var byName = {};
    companies.forEach(function(c) { byName[c.company_name] = c; });

    function applyLive(party, comp) {
      if (!party || !comp) return;
      // market_cap_usd in companies is full USD; deal_data stores in millions
      var mcRaw = parseFloat(comp.market_cap_usd);
      if (!isNaN(mcRaw) && mcRaw > 0) {
        party.marketCapUsd = mcRaw / 1e6;
        // Clear stale display string so renderer uses live marketCapUsd
        delete party.marketCapDisplay;
      }
      var sp = parseFloat(comp.stock_price_usd);
      if (!isNaN(sp) && sp > 0) party.stockPriceUsd = sp;
      var pl = parseFloat(comp.production_low);
      if (!isNaN(pl) && pl > 0) party.productionLow = pl;
      var ph = parseFloat(comp.production_high);
      if (!isNaN(ph) && ph > 0) party.productionHigh = ph;
      var res = parseFloat(comp.reserves);
      if (!isNaN(res) && res > 0) party.reserves = res;
      var rsc = parseFloat(comp.resources);
      if (!isNaN(rsc) && rsc > 0) party.resources = rsc;
    }

    applyLive(dealData.bidder, byName[bidderName]);
    applyLive(dealData.target, byName[targetName]);

    // Update combined market cap as sum of live bidder + target
    if (dealData.combined && dealData.bidder && dealData.target) {
      var bMC = dealData.bidder.marketCapUsd;
      var tMC = dealData.target.marketCapUsd;
      if (bMC && tMC) dealData.combined.marketCapUsd = bMC + tMC;
    }
  } catch (e) {
    // Non-fatal — return deal with original data if enrichment fails
    console.error('Deal enrichment error:', e);
  }
  return dealData;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    var sb = getSupabase();

    // ── GET: List deals or fetch single deal by slug ──
    if (req.method === 'GET') {
      var slug = req.query.slug;
      var announced = req.query.announced;
      var isAdmin = verifyAdminToken(req.headers.authorization);
      var isDealbookUser = verifyDealbookToken(req.headers.authorization);

      if (slug) {
        // Single deal by slug
        var { data: deal, error } = await sb.from('deals').select('*').eq('slug', slug).single();
        if (error || !deal) return res.status(404).json({ ok: false, error: 'Deal not found' });
        // Non-admin can only see announced deals
        if (!isAdmin && !deal.is_announced) {
          // Dealbook users can also see announced deals
          if (!isDealbookUser || !deal.is_announced) {
            return res.status(404).json({ ok: false, error: 'Deal not found' });
          }
        }

        // Enrich deal_data with live company data from companies table
        deal.deal_data = await enrichDealData(sb, deal.deal_data, deal.bidder_name, deal.target_name);

        return res.status(200).json({ ok: true, deal: deal });
      }

      // List deals
      var query = sb.from('deals').select('id, slug, title, status, bidder_name, target_name, mineral, is_announced, deal_data, created_at, updated_at');

      if (isAdmin) {
        // Admin sees all deals
        query = query.order('updated_at', { ascending: false });
      } else if (isDealbookUser || announced === 'true') {
        // Public/dealbook users see only announced
        query = query.eq('is_announced', true).order('created_at', { ascending: false });
      } else {
        return res.status(401).json({ ok: false, error: 'Authentication required' });
      }

      var { data: deals, error: listErr } = await query;
      if (listErr) return res.status(500).json({ ok: false, error: listErr.message });

      // Enrich all deals with live company data
      for (var i = 0; i < (deals || []).length; i++) {
        var d = deals[i];
        if (d.deal_data && d.bidder_name && d.target_name) {
          d.deal_data = await enrichDealData(sb, d.deal_data, d.bidder_name, d.target_name);
        }
      }

      return res.status(200).json({ ok: true, deals: deals });
    }

    // ── Write operations require admin auth ──
    if (!verifyAdminToken(req.headers.authorization)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    var body = req.body || {};

    // ── POST: Create deal ──
    if (req.method === 'POST') {
      var title = (body.title || '').trim();
      if (!title) return res.status(400).json({ ok: false, error: 'Title required' });

      var slug = body.slug || slugify(title);
      var dealData = body.deal_data;
      if (!dealData || typeof dealData !== 'object') {
        return res.status(400).json({ ok: false, error: 'deal_data (object) required' });
      }

      var row = {
        slug: slug,
        title: title,
        status: body.status || 'draft',
        bidder_name: body.bidder_name || null,
        target_name: body.target_name || null,
        mineral: body.mineral || null,
        is_announced: body.is_announced === true,
        deal_data: dealData
      };

      var { data, error } = await sb.from('deals').insert(row).select();
      if (error) {
        if (error.code === '23505') return res.status(400).json({ ok: false, error: 'A deal with this slug already exists' });
        return res.status(500).json({ ok: false, error: error.message });
      }
      return res.status(201).json({ ok: true, deal: data[0] });
    }

    // ── PUT: Update deal ──
    if (req.method === 'PUT') {
      var id = body.id;
      if (!id) return res.status(400).json({ ok: false, error: 'Deal id required' });

      var updates = { updated_at: new Date().toISOString() };
      if (body.title != null) updates.title = body.title;
      if (body.slug != null) updates.slug = body.slug;
      if (body.status != null) updates.status = body.status;
      if (body.bidder_name != null) updates.bidder_name = body.bidder_name;
      if (body.target_name != null) updates.target_name = body.target_name;
      if (body.mineral != null) updates.mineral = body.mineral;
      if (body.is_announced != null) updates.is_announced = body.is_announced;
      if (body.deal_data != null) updates.deal_data = body.deal_data;

      var { data, error } = await sb.from('deals').update(updates).eq('id', id).select();
      if (error) return res.status(500).json({ ok: false, error: error.message });
      if (!data || data.length === 0) return res.status(404).json({ ok: false, error: 'Deal not found' });
      return res.status(200).json({ ok: true, deal: data[0] });
    }

    // ── DELETE: Remove deal ──
    if (req.method === 'DELETE') {
      var id = body.id || req.query.id;
      if (!id) return res.status(400).json({ ok: false, error: 'Deal id required' });

      var { error } = await sb.from('deals').delete().eq('id', id);
      if (error) return res.status(500).json({ ok: false, error: error.message });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('Deals API error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
};
