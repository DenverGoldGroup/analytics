// POST /api/psr — Post Show Report data CRUD
// GET  /api/psr — Fetch PSR data by section
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ljyogcspkvqgjbiyzfbn.supabase.co';

function getSupabase() {
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return createClient(SUPABASE_URL, key);
}

// ── Budget Supabase (read-only, anon key) ──────────────
var BUDGET_SUPABASE_URL = 'https://inhmwnaqgfjatrvfkkcu.supabase.co';

function getBudgetSupabase() {
  var key = process.env.BUDGET_SUPABASE_ANON_KEY;
  if (!key) return null;
  return createClient(BUDGET_SUPABASE_URL, key);
}

// Revenue GL codes → labels (ordered as in budget dashboard)
var REVENUE_ACCOUNTS = {
  '4000': 'Participating Company Fees',
  '4010': 'Event Sponsorship Fees',
  '4020': 'Delegate Fees',
  '4030': 'Participant Fees',
  '4050': 'Advertising Fees',
  '4070': 'Other Fees & Income',
  '4080': 'Venue Incentives',
  '4150': 'Webcast Revenue',
  '4160': 'Room Block Commission'
};
var REVENUE_GL_ORDER = ['4000','4010','4020','4030','4070','4150','4080','4160','4050'];

// Event-direct expense GL codes
var EVENT_EXPENSE_CODES = [
  '4004130','4006000','4006001','4006002','4006003','4006004','4006005',
  '4006006','4006008','4006009','4006010','4006011','4006012','4006013',
  '4006014','4006016','4006017','4006020','4006022'
];
var OTHER_EVENT_EXPENSE_CODES = ['5910', '5040'];

/**
 * Compute budget revenue from assumptions (replicates budget app logic).
 * Returns map of GL code → budget dollar amount.
 */
function computeBudgetRevenue(event, assumptions) {
  var ea = event === 'mfe' ? assumptions.mfe : assumptions.mfa;
  var npr = event === 'mfe' ? assumptions.mfeNonPartRevenue : assumptions.mfaNonPartRevenue;
  if (!ea || !npr) return {};

  // Participating company fees (tiered pricing)
  var eb = Math.round(ea.companyCount * ea.earlyBirdPct) * ea.earlyBirdRate;
  var reg = Math.round(ea.companyCount * ea.regularPct) * ea.regularRate;
  var late = Math.round(ea.companyCount * ea.latePct) * ea.lateRate;
  var companyFees = eb + reg + late;

  // Delegate fees
  var totalDelegates = ea.companyCount * npr.delegatesPerMember;
  var payingDelegates = totalDelegates * npr.payingDelegateFraction;
  var delegates = Math.round(payingDelegates * npr.delegateWeightedFee);

  // Participant fees
  var participants = ea.companyCount * npr.participantsPerMember;
  var attendees = Math.round(participants * npr.participantFee);

  // Sponsorships
  var sponsorships = Math.round(npr.sponsorships || 0);

  // Webcasts
  var webcastCorporate = Math.round(ea.companyCount * (npr.webcastCorporateRate || 0));
  var webcasts = webcastCorporate + Math.round(npr.webcastOnlinePurchases || 0);

  // Room block commission
  var roomBlock = Math.round(
    (npr.roomBlockNights || 0) * (npr.roomBlockRate || 0) * (npr.roomBlockCommissionRate || 0)
  );

  // Other fees (participation revenue × ratio, minus webcasts already counted)
  var grossOther = Math.round(companyFees * (npr.otherRevenueRatio || 0));
  var other = Math.max(0, grossOther - webcasts);

  var result = {};
  result['4000'] = companyFees;
  if (sponsorships) result['4010'] = sponsorships;
  if (delegates) result['4020'] = delegates;
  if (attendees) result['4030'] = attendees;
  if (other) result['4070'] = other;
  if (webcasts) result['4150'] = webcasts;
  if (roomBlock) result['4160'] = roomBlock;

  return result;
}

/**
 * Build PSR-format financials from budget system data.
 * Revenue budget is computed from assumptions (matches budget dashboard).
 * Expense budget is summed from budget_detail aggregation (budget_lines).
 */
function buildFinancialsFromBudget(cc, assumptions, budgetLines, actuals, priorActuals) {
  function glVal(lines, gl) {
    var row = lines.find(function(r) { return r.gl_code === gl; });
    return row ? Number(row[cc]) || 0 : 0;
  }

  // Compute budget revenue from assumptions
  var budgetRevenue = computeBudgetRevenue(cc, assumptions);

  var items = [];
  var sortOrder = 1;

  // Revenue items — show GL if any column has a non-zero value
  REVENUE_GL_ORDER.forEach(function(gl) {
    var budget = budgetRevenue[gl] || 0;
    var actual = glVal(actuals, gl);
    var prior = glVal(priorActuals, gl);
    if (budget !== 0 || actual !== 0 || prior !== 0) {
      items.push({
        category: 'revenue',
        line_item: REVENUE_ACCOUNTS[gl],
        gl_code: gl,
        actual_amount: String(Math.round(actual)),
        budget_amount: String(Math.round(budget)),
        prior_year_amount: String(Math.round(prior)),
        sort_order: sortOrder++
      });
    }
  });

  // Expense total — event-direct GL codes from budget_lines + actuals
  var expBudget = 0, expActual = 0, expPrior = 0;
  EVENT_EXPENSE_CODES.concat(OTHER_EVENT_EXPENSE_CODES).forEach(function(gl) {
    expBudget += glVal(budgetLines, gl);
    expActual += glVal(actuals, gl);
    expPrior += glVal(priorActuals, gl);
  });

  if (expBudget !== 0 || expActual !== 0 || expPrior !== 0) {
    items.push({
      category: 'expense',
      line_item: 'Event direct expenses',
      gl_code: null,
      actual_amount: String(-Math.round(Math.abs(expActual))),
      budget_amount: String(-Math.round(Math.abs(expBudget))),
      prior_year_amount: String(-Math.round(Math.abs(expPrior))),
      sort_order: 1
    });
  }

  return items;
}

/**
 * Fetch financial data from the budget Supabase for a given event.
 * Revenue is computed from budget_assumptions (matching budget dashboard).
 * Returns null if budget system is not configured or no data exists.
 */
/**
 * Fetch per-event actuals for given years from budget Supabase.
 * eventType: 'mfe' or 'mfa' — column name in actuals_lines.
 * Returns array of { year, revenue, expenses } objects.
 */
async function fetchHistoricalActuals(eventType, years) {
  var bsb = getBudgetSupabase();
  if (!bsb) return [];

  var col = eventType.toLowerCase().slice(0, 3); // 'mfe' or 'mfa'

  try {
    var { data, error } = await bsb.from('actuals_lines')
      .select('year, gl_code, ' + col)
      .in('year', years);
    if (error || !data) return [];

    // Build revenue GL set (4xxx codes that are in REVENUE_ACCOUNTS)
    var revGLs = {};
    Object.keys(REVENUE_ACCOUNTS).forEach(function(gl) { revGLs[gl] = true; });

    // Build expense GL set
    var expGLs = {};
    EVENT_EXPENSE_CODES.forEach(function(gl) { expGLs[gl] = true; });
    OTHER_EVENT_EXPENSE_CODES.forEach(function(gl) { expGLs[gl] = true; });

    // Aggregate by year
    var byYear = {};
    years.forEach(function(y) { byYear[y] = { revenue: 0, expenses: 0 }; });

    data.forEach(function(row) {
      var y = row.year;
      if (!byYear[y]) byYear[y] = { revenue: 0, expenses: 0 };
      var val = Number(row[col]) || 0;

      if (revGLs[row.gl_code]) {
        byYear[y].revenue += val;
      } else if (expGLs[row.gl_code]) {
        byYear[y].expenses += val;
      }
    });

    return years.map(function(y) {
      return { year: y, revenue: Math.round(byYear[y].revenue), expenses: Math.round(byYear[y].expenses) };
    }).filter(function(r) { return r.revenue !== 0 || r.expenses !== 0; });
  } catch (err) {
    console.error('Historical actuals fetch error:', err.message);
    return [];
  }
}

async function fetchBudgetFinancials(eventType, year) {
  var bsb = getBudgetSupabase();
  if (!bsb) return null;

  var cc = eventType.toLowerCase().slice(0, 3); // 'mfe' or 'mfa'

  try {
    var results = await Promise.all([
      bsb.from('budget_assumptions').select('data').eq('year', year).single(),
      bsb.from('budget_lines').select('gl_code, mfe, mfa, ga').eq('year', year),
      bsb.from('actuals_lines').select('gl_code, mfe, mfa, ga').eq('year', year),
      bsb.from('actuals_lines').select('gl_code, mfe, mfa, ga').eq('year', year - 1)
    ]);

    var assumptions = results[0].data ? results[0].data.data : null;
    var budgetLines = results[1].data || [];
    var actuals = results[2].data || [];
    var priorActuals = results[3].data || [];

    // Need assumptions to compute revenue budget
    if (!assumptions) return null;

    return {
      financials: buildFinancialsFromBudget(cc, assumptions, budgetLines, actuals, priorActuals),
      source: 'budget',
      budget_year: year,
      actuals_count: actuals.length,
      prior_actuals_count: priorActuals.length
    };
  } catch (err) {
    console.error('Budget financials fetch error:', err.message);
    return null;
  }
}

function getSecret() {
  if (!process.env.ADMIN_PASSWORD || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return process.env.ADMIN_PASSWORD + process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  var secret = getSecret();
  if (!secret) return false;
  var token = authHeader.replace('Bearer ', '');
  var parts = token.split('.');

  // Admin token: randomBytes.timestamp.signature (3 parts)
  if (parts.length === 3) {
    var tokenBytes = parts[0], timestamp = parts[1], providedSignature = parts[2];
    var expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(tokenBytes + '.' + timestamp)
      .digest('hex');
    var sigBuf = Buffer.from(providedSignature);
    var expBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
    var age = Date.now() - parseInt(timestamp, 10);
    if (isNaN(age) || age < 0 || age > 24 * 60 * 60 * 1000) return false;
    return true;
  }

  // PSR token: psr.<base64url_email>.<role>.<timestamp>.<signature> (5 parts)
  if (parts.length === 5 && parts[0] === 'psr') {
    var role = parts[2];
    if (role !== 'admin') return false; // only PSR admins can write
    var payload = parts.slice(0, 4).join('.');
    var providedSig = parts[4];
    var expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    var sigBuf = Buffer.from(providedSig);
    var expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
    var age = Date.now() - parseInt(parts[3], 10);
    if (isNaN(age) || age < 0 || age > 7 * 24 * 60 * 60 * 1000) return false; // 7-day validity
    return true;
  }

  return false;
}

// Verify any valid PSR token (admin or viewer) for read access
function verifyReadToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  var secret = getSecret();
  if (!secret) return false;
  var token = authHeader.replace('Bearer ', '');
  var parts = token.split('.');
  // Admin token (3 parts)
  if (parts.length === 3) {
    var expectedSig = crypto.createHmac('sha256', secret).update(parts[0] + '.' + parts[1]).digest('hex');
    var sigBuf = Buffer.from(parts[2]);
    var expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
    var age = Date.now() - parseInt(parts[1], 10);
    return !(isNaN(age) || age < 0 || age > 24 * 60 * 60 * 1000);
  }
  // PSR token (5 parts) — any role (admin or viewer)
  if (parts.length === 5 && parts[0] === 'psr') {
    var payload = parts.slice(0, 4).join('.');
    var expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    var sigBuf = Buffer.from(parts[4]);
    var expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
    var age = Date.now() - parseInt(parts[3], 10);
    return !(isNaN(age) || age < 0 || age > 30 * 24 * 60 * 60 * 1000);
  }
  return false;
}

// ── Activity Logging ──────────────────────────────────

// Extract user identity from auth token
function extractTokenInfo(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return { email: 'unknown', role: 'unknown' };
  var token = authHeader.replace('Bearer ', '');
  var parts = token.split('.');
  // Admin token (3 parts) — site admin
  if (parts.length === 3) return { email: 'admin', role: 'admin' };
  // PSR token (5 parts): psr.<base64url_email>.<role>.<ts>.<sig>
  if (parts.length === 5 && parts[0] === 'psr') {
    try {
      var email = Buffer.from(parts[1], 'base64url').toString('utf8');
      return { email: email, role: parts[2] };
    } catch (e) { return { email: 'unknown', role: parts[2] || 'unknown' }; }
  }
  return { email: 'unknown', role: 'unknown' };
}

// Fire-and-forget log write — never blocks the response
function logActivity(sb, opts) {
  var row = {
    event_code: opts.event_code || null,
    user_email: opts.email || 'unknown',
    user_role: opts.role || 'unknown',
    action: opts.action,
    detail: opts.detail || null,
    ip_address: opts.ip || null
  };
  sb.from('psr_activity_log').insert(row).then(function(r) {
    if (r.error) console.error('Activity log write failed:', r.error.message);
  });
}

function getClientIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || null;
}

// Build human-readable detail string for audit log
function _buildDetail(action, body) {
  if (!action) return null;
  var a = action.toLowerCase();
  if (a === 'upload-tracking') return 'Uploaded member tracking data';
  if (a === 'upload-cancellations') return 'Uploaded member cancellations (' + ((body.rows || []).length) + ' rows)';
  if (a === 'cover-save') return body.cover_pdf ? 'Uploaded cover page PDF' : 'Cleared cover page';
  if (a === 'refresh-mcaps') return 'Refreshed market caps';
  if (a.indexOf('swot') === 0) return 'SWOT: ' + a.replace('swot-', '') + (body.category ? ' (' + body.category + ')' : '');
  if (a.indexOf('market') === 0) return 'Market data: ' + a.replace('market-', '') + (body.year ? ' year ' + body.year : '');
  if (a.indexOf('venue') === 0) return 'Venue history: ' + a.replace('venue-', '');
  if (a.indexOf('hotel') === 0) return 'Hotel: ' + a.replace('hotel-', '');
  if (a.indexOf('engagement') === 0) return 'Engagement: ' + a.replace('engagement-', '') + (body.metric ? ' — ' + body.metric : '');
  if (a === 'upload-member-meetings') return 'Uploaded member meetings (' + ((body.rows || []).length) + ' rows)';
  if (a === 'upload-participant-meetings') return 'Uploaded participant meetings (' + ((body.rows || []).length) + ' rows)';
  if (a === 'upload-webcasts') return 'Uploaded webcast metrics (' + ((body.rows || []).length) + ' rows)';
  if (a.indexOf('webcast') === 0) return 'Webcasts: ' + a;
  if (a.indexOf('meeting') === 0 || a.indexOf('top-meeting') === 0) return 'Meetings: ' + a;
  if (a === 'reg-recon-save') return 'Saved registration reconciliation (' + (body.items ? body.items.length + ' items' : '') + ')';
  if (body.section) return body.section + ': ' + a;
  return a;
}

module.exports = async function handler(req, res) {
  try {
    var sb = getSupabase();

    // GET — requires valid PSR or admin token
    if (req.method === 'GET') {
      var action = req.query.action;
      var eventCode = req.query.event_code;
      var eventType = req.query.event_type;

      // Require auth for all GET endpoints
      if (!verifyReadToken(req.headers.authorization)) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }

      if (action === 'events') {
        var q = sb.from('psr_events').select('*').order('year', { ascending: false });
        if (eventType) q = q.eq('event_type', eventType);
        var { data, error } = await q;
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, events: data });
      }

      if (action === 'glossary') {
        var { data, error } = await sb.from('psr_glossary').select('*').order('sort_order');
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, glossary: data });
      }

      if (action === 'venue-history') {
        var q = sb.from('psr_venue_history').select('*').order('sort_order');
        if (eventType) q = q.eq('event_type', eventType);
        var { data, error } = await q;
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, venues: data });
      }

      if (action === 'swot' && eventCode) {
        var { data, error } = await sb.from('psr_swot').select('*').eq('event_code', eventCode).order('sort_order');
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, swot: data });
      }

      if (action === 'market-data') {
        var q = sb.from('psr_market_data').select('*').order('year');
        if (eventType) q = q.eq('event_type', eventType);
        var { data, error } = await q;
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, market_data: data });
      }

      if (action === 'financials' && eventCode) {
        var { data, error } = await sb.from('psr_financials').select('*').eq('event_code', eventCode).order('sort_order');
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, financials: data });
      }

      // Live financials from budget system (budget.denvergold.org)
      if (action === 'budget-financials') {
        var evTypeParam = req.query.event_type;
        var yearParam = Number(req.query.year);
        if (!evTypeParam || !yearParam) {
          return res.status(400).json({ ok: false, error: 'event_type and year required' });
        }
        var budgetResult = await fetchBudgetFinancials(evTypeParam, yearParam);
        if (!budgetResult) {
          return res.status(503).json({ ok: false, error: 'Budget system not configured or unavailable' });
        }
        return res.status(200).json({ ok: true, financials: budgetResult.financials, source: budgetResult.source });
      }

      if (action === 'attendance' && eventCode) {
        var { data, error } = await sb.from('psr_attendance').select('*').eq('event_code', eventCode).order('sort_order');
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, attendance: data });
      }

      if (action === 'members' && eventCode) {
        var { data, error } = await sb.from('psr_members').select('*').eq('event_code', eventCode).order('sort_order');
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, members: data });
      }

      if (action === 'sponsors' && eventCode) {
        var { data, error } = await sb.from('psr_sponsors').select('*').eq('event_code', eventCode).order('sort_order');
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, sponsors: data });
      }

      if (action === 'member-history') {
        var q = sb.from('psr_member_history').select('*').order('year');
        if (eventType) q = q.eq('event_type', eventType);
        var { data, error } = await q;
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, member_history: data });
      }

      if (action === 'hotel' && eventCode) {
        var { data, error } = await sb.from('psr_hotel').select('*').eq('event_code', eventCode).order('night_date');
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, hotel: data });
      }

      if (action === 'engagement' && eventCode) {
        var { data, error } = await sb.from('psr_engagement').select('*').eq('event_code', eventCode).order('sort_order');
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, engagement: data });
      }

      if (action === 'webcasts' && eventCode) {
        var { data, error } = await sb.from('psr_webcasts').select('*').eq('event_code', eventCode).order('sort_order');
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, webcasts: data });
      }

      if (action === 'meetings' && eventCode) {
        var { data: meetings, error: mErr } = await sb.from('psr_meetings').select('*').eq('event_code', eventCode).order('sort_order');
        var { data: top, error: tErr } = await sb.from('psr_top_meetings').select('*').eq('event_code', eventCode).order('rank');
        if (mErr) return res.status(500).json({ ok: false, error: mErr.message });
        return res.status(200).json({ ok: true, meetings: meetings, top_meetings: top || [] });
      }

      // Cancellations
      if (action === 'cancellations' && eventCode) {
        var { data, error } = await sb.from('psr_cancellations').select('*').eq('event_code', eventCode).order('sort_order');
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, cancellations: data || [] });
      }

      // Activity log: last 30 days of user actions
      if (action === 'activity-log') {
        var since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        var q = sb.from('psr_activity_log').select('*')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(2000);
        if (eventCode) q = q.eq('event_code', eventCode);
        var { data, error } = await q;
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, logs: data || [] });
      }

      // Full report: fetch everything for one event
      if (action === 'full-report' && eventCode) {
        // Log report view (fire-and-forget)
        var _viewer = extractTokenInfo(req.headers.authorization);
        logActivity(sb, { event_code: eventCode, email: _viewer.email, role: _viewer.role, action: 'view-report', detail: 'Opened PSR report', ip: getClientIP(req) });

        var { data: evt } = await sb.from('psr_events').select('*').eq('event_code', eventCode).single();
        if (!evt) return res.status(404).json({ ok: false, error: 'Event not found' });

        var evType = evt.event_type;
        // Derive prior event code for YoY comparisons
        var priorCode = evType + String(evt.year - 1).slice(-2);

        var results = await Promise.all([
          sb.from('psr_glossary').select('*').order('sort_order'),
          sb.from('psr_venue_history').select('*').eq('event_type', evType).order('sort_order'),
          sb.from('psr_swot').select('*').eq('event_code', eventCode).order('sort_order'),
          sb.from('psr_market_data').select('*').eq('event_type', evType).order('year'),
          sb.from('psr_financials').select('*').eq('event_code', eventCode).order('sort_order'),
          sb.from('psr_attendance').select('*').eq('event_code', eventCode).order('sort_order'),
          sb.from('psr_members').select('*').eq('event_code', eventCode).order('sort_order'),
          sb.from('psr_sponsors').select('*').eq('event_code', eventCode).order('sort_order'),
          sb.from('psr_hotel').select('*').eq('event_code', eventCode).order('night_date'),
          sb.from('psr_engagement').select('*').eq('event_code', eventCode).order('sort_order'),
          sb.from('psr_webcasts').select('*').eq('event_code', eventCode).order('sort_order'),
          sb.from('psr_meetings').select('*').eq('event_code', eventCode).order('sort_order'),
          sb.from('psr_top_meetings').select('*').eq('event_code', eventCode).order('rank'),
          // Member composition from analytics (current + prior year)
          sb.from('event_participations')
            .select('event_code, company_name, company_status, primary_mineral, primary_country, market_cap_usd')
            .in('event_code', [eventCode, priorCode]),
          // Member historical composition
          sb.from('psr_member_history').select('*').eq('event_type', evType).order('year'),
          // Registration reconciliation
          sb.from('psr_reg_recon').select('*').eq('event_code', eventCode).order('sort_order'),
          // Member cancellations
          sb.from('psr_cancellations').select('*').eq('event_code', eventCode).order('sort_order')
        ]);

        // Build composition breakdown
        var epRows = results[13].data || [];
        var composition = { current: [], prior: [], current_code: eventCode, prior_code: priorCode };
        epRows.forEach(function(r) {
          if (r.event_code === eventCode) composition.current.push(r);
          else composition.prior.push(r);
        });

        // Fetch live financials from budget system (non-blocking fallback to psr_financials)
        var financials = results[4].data || [];
        var financialsSource = 'manual';
        var budgetResult = await fetchBudgetFinancials(evType, evt.year);
        if (budgetResult && budgetResult.financials && budgetResult.financials.length > 0) {
          financials = budgetResult.financials;
          financialsSource = 'budget';
        }

        // Fetch historical actuals from budget Supabase for recent years (per-event)
        var histActuals = await fetchHistoricalActuals(evType, [2022, 2023, 2024, 2025]);

        return res.status(200).json({
          ok: true,
          event: evt,
          glossary: results[0].data || [],
          venues: results[1].data || [],
          swot: results[2].data || [],
          market_data: results[3].data || [],
          financials: financials,
          financials_source: financialsSource,
          attendance: results[5].data || [],
          members: results[6].data || [],
          sponsors: results[7].data || [],
          hotel: results[8].data || [],
          engagement: results[9].data || [],
          webcasts: results[10].data || [],
          meetings: results[11].data || [],
          top_meetings: results[12].data || [],
          composition: composition,
          member_history: results[14].data || [],
          historical_actuals: histActuals,
          reg_recon: results[15].data || [],
          cancellations: results[16].data || []
        });
      }

      if (action === 'reg-recon' && eventCode) {
        var { data, error } = await sb.from('psr_reg_recon').select('*').eq('event_code', eventCode).order('sort_order');
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, reg_recon: data });
      }

      // Cover page PDF (base64) — GET
      if (action === 'cover' && eventCode) {
        var { data, error } = await sb.from('psr_events').select('cover_pdf').eq('event_code', eventCode).single();
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, cover_pdf: data.cover_pdf || null });
      }

      return res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
    }

    // POST — admin-only writes
    if (req.method === 'POST') {
      var authResult = verifyToken(req.headers.authorization);
      if (!authResult) {
        console.error('PSR auth failed: hasAdminPw=' + !!process.env.ADMIN_PASSWORD + ', hasSvcKey=' + !!process.env.SUPABASE_SERVICE_ROLE_KEY);
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }

      var body = req.body || {};
      var postAction = body.action;

      // Log every write action (fire-and-forget)
      var _who = extractTokenInfo(req.headers.authorization);
      logActivity(sb, {
        event_code: body.event_code || null,
        email: _who.email,
        role: _who.role,
        action: postAction,
        detail: _buildDetail(postAction, body),
        ip: getClientIP(req)
      });

      // SWOT: add item
      if (postAction === 'swot-add') {
        var { data, error } = await sb.from('psr_swot').insert({
          event_code: body.event_code,
          category: body.category,
          item_text: body.item_text,
          sort_order: body.sort_order || 999
        }).select();
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, item: data[0] });
      }

      // SWOT: update item text
      if (postAction === 'swot-update') {
        var { error } = await sb.from('psr_swot').update({ item_text: body.item_text }).eq('id', body.id);
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true });
      }

      // SWOT: delete item
      if (postAction === 'swot-delete') {
        var { error } = await sb.from('psr_swot').delete().eq('id', body.id);
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true });
      }

      // SWOT: reorder items
      if (postAction === 'swot-reorder') {
        var updates = (body.items || []).map(function(item) {
          return sb.from('psr_swot').update({ sort_order: item.sort_order }).eq('id', item.id);
        });
        var results = await Promise.all(updates);
        var failed = results.find(function(r) { return r.error; });
        if (failed) return res.status(500).json({ ok: false, error: failed.error.message });
        return res.status(200).json({ ok: true });
      }

      // Market data: update single cell
      if (postAction === 'market-update') {
        var { error } = await sb.from('psr_market_data').update({ value: body.value }).eq('id', body.id);
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true });
      }

      // Market data: add a full year (all 9 metrics)
      if (postAction === 'market-add-year') {
        var metrics = ['gold_price','silver_price','platinum_price','palladium_price',
                       'gold_mcap_bn','silver_mcap_bn','hui_index','dji_index','au_ag_ratio'];
        var rows = metrics.map(function(m) {
          return { event_type: body.event_type, year: body.year, metric: m, value: 0 };
        });
        var { data, error } = await sb.from('psr_market_data').insert(rows).select();
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, rows: data });
      }

      // Market data: delete a full year
      if (postAction === 'market-delete-year') {
        var { error } = await sb.from('psr_market_data').delete()
          .eq('event_type', body.event_type).eq('year', body.year);
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true });
      }

      // Upload member tracking (XLSX data as JSON array)
      if (postAction === 'upload-tracking') {
        var evCode = body.event_code;
        var evType = body.event_type;
        var evYear = body.year;
        var rows = body.rows; // array of { company, track, status, mineral, country, market_cap, first_year, first_event, total_events }
        var nrRows = body.not_returning_rows || []; // explicit not-returning from spreadsheet
        if (!evCode || (!rows.length && !nrRows.length)) {
          return res.status(400).json({ ok: false, error: 'event_code and rows are required' });
        }

        // Build insert rows — separate not_returning from active members
        var insertRows = [];
        var activeRows = [];
        rows.forEach(function(r, i) {
          var trackVal = (r.track || '').toLowerCase().replace(/ /g, '_');
          var row = {
            event_code: evCode,
            company_name: r.company || '',
            tracking_status: trackVal,
            company_status: r.status || '',
            primary_mineral: r.mineral || '',
            primary_country: r.country || '',
            market_cap_usd: r.market_cap || null,
            first_year: r.first_year || null,
            first_event: r.first_event || '',
            total_events: r.total_events || null,
            reason: null,
            sort_order: i + 1
          };
          insertRows.push(row);
          if (trackVal !== 'not_returning') activeRows.push(row);
        });

        // Add explicit not-returning rows from spreadsheet (e.g. "Not Returning" sheet)
        nrRows.forEach(function(r, i) {
          insertRows.push({
            event_code: evCode,
            company_name: r.company || '',
            tracking_status: 'not_returning',
            company_status: r.status || '',
            primary_mineral: r.mineral || '',
            primary_country: r.country || '',
            market_cap_usd: r.market_cap || null,
            first_year: null,
            first_event: null,
            total_events: null,
            reason: null,
            sort_order: rows.length + i + 1
          });
        });

        // If no explicit not-returning provided, fall back to prior-year computation
        var hasExplicitNR = nrRows.length > 0 || rows.some(function(r) {
          return (r.track || '').toLowerCase().replace(/ /g, '_') === 'not_returning';
        });

        if (!hasExplicitNR) {
          var priorCode = evType + String(evYear - 1).slice(-2);
          var { data: priorMembers } = await sb.from('psr_members')
            .select('company_name, company_status, primary_mineral, primary_country, market_cap_usd')
            .eq('event_code', priorCode)
            .in('tracking_status', ['new', 'repeating', 'returning']);

          if (priorMembers && priorMembers.length) {
            var currentNames = {};
            activeRows.forEach(function(r) { currentNames[r.company_name.toLowerCase()] = true; });
            var notReturning = priorMembers.filter(function(pm) {
              return !currentNames[pm.company_name.toLowerCase()];
            });
            notReturning.forEach(function(pm, i) {
              insertRows.push({
                event_code: evCode,
                company_name: pm.company_name,
                tracking_status: 'not_returning',
                company_status: pm.company_status || '',
                primary_mineral: pm.primary_mineral || '',
                primary_country: pm.primary_country || '',
                market_cap_usd: pm.market_cap_usd || null,
                first_year: null,
                first_event: null,
                total_events: null,
                reason: null,
                sort_order: rows.length + nrRows.length + i + 1
              });
            });
          }
        }

        // Delete existing and insert
        await sb.from('psr_members').delete().eq('event_code', evCode);
        var { data: inserted, error: insErr } = await sb.from('psr_members').insert(insertRows).select();
        if (insErr) return res.status(500).json({ ok: false, error: insErr.message });

        var counts = { new: 0, repeating: 0, returning: 0, not_returning: 0 };
        insertRows.forEach(function(r) { counts[r.tracking_status] = (counts[r.tracking_status] || 0) + 1; });

        return res.status(200).json({
          ok: true,
          total: insertRows.length,
          counts: counts,
          message: 'Uploaded ' + (insertRows.length - (counts.not_returning || 0)) + ' members + ' + (counts.not_returning || 0) + ' not returning'
        });
      }

      // Venue history: update venue or dates
      if (postAction === 'venue-update') {
        var updates = {};
        if (body.venue != null) updates.venue = body.venue;
        if (body.program_dates != null) updates.program_dates = body.program_dates;
        if (Object.keys(updates).length === 0) {
          return res.status(400).json({ ok: false, error: 'Nothing to update' });
        }
        var { error } = await sb.from('psr_venue_history').update(updates).eq('id', body.id);
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true });
      }

      // Refresh market caps from analytics event_participations
      if (postAction === 'refresh-mcaps') {
        var evCode = body.event_code;
        var evType = body.event_type;
        var evYear = body.year;
        if (!evCode || !evType || !evYear) {
          return res.status(400).json({ ok: false, error: 'event_code, event_type, and year are required' });
        }

        // Sum market caps by primary_mineral from event_participations
        var { data: epRows, error: epErr } = await sb
          .from('event_participations')
          .select('primary_mineral, market_cap_usd')
          .eq('event_code', evCode);
        if (epErr) return res.status(500).json({ ok: false, error: epErr.message });

        var goldMcap = 0;
        var silverMcap = 0;
        var totalParticipants = 0;
        (epRows || []).forEach(function(row) {
          totalParticipants++;
          var mcap = Number(row.market_cap_usd) || 0;
          if (row.primary_mineral === 'Gold') goldMcap += mcap;
          else if (row.primary_mineral === 'Silver') silverMcap += mcap;
        });

        var goldBn = Math.round(goldMcap / 1e9);
        var silverBn = Math.round(silverMcap / 1e9);

        // Update psr_market_data rows
        var updates = [];
        var { data: existing } = await sb.from('psr_market_data')
          .select('id, metric')
          .eq('event_type', evType)
          .eq('year', evYear)
          .in('metric', ['gold_mcap_bn', 'silver_mcap_bn']);

        (existing || []).forEach(function(row) {
          var val = row.metric === 'gold_mcap_bn' ? goldBn : silverBn;
          updates.push(sb.from('psr_market_data').update({ value: val }).eq('id', row.id));
        });

        if (updates.length > 0) {
          var results = await Promise.all(updates);
          var failed = results.find(function(r) { return r.error; });
          if (failed) return res.status(500).json({ ok: false, error: failed.error.message });
        }

        return res.status(200).json({
          ok: true,
          gold_mcap_bn: goldBn,
          silver_mcap_bn: silverBn,
          participants: totalParticipants
        });
      }

      // Hotel: update a single field (night_date, contracted, actual)
      if (postAction === 'hotel-update') {
        var updates = {};
        if (body.field === 'night_date') updates.night_date = body.value;
        else if (body.field === 'contracted') updates.contracted = Number(body.value) || 0;
        else if (body.field === 'actual') updates.actual = Number(body.value) || 0;
        else return res.status(400).json({ ok: false, error: 'Invalid field: ' + body.field });
        var { error } = await sb.from('psr_hotel').update(updates).eq('id', body.id);
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true });
      }

      // Hotel: rename hotel (update all rows with old name for this event)
      if (postAction === 'hotel-rename') {
        var { error } = await sb.from('psr_hotel').update({ hotel_name: body.new_name })
          .eq('event_code', body.event_code).eq('hotel_name', body.old_name);
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true });
      }

      // Hotel: delete a single night row
      if (postAction === 'hotel-delete') {
        var { error } = await sb.from('psr_hotel').delete().eq('id', body.id);
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true });
      }

      // Hotel: add a night row to existing hotel
      if (postAction === 'hotel-add-night') {
        // Find the latest night_date for this hotel to default the new row's date
        var { data: existing } = await sb.from('psr_hotel').select('night_date')
          .eq('event_code', body.event_code).eq('hotel_name', body.hotel_name)
          .order('night_date', { ascending: false }).limit(1);
        var lastDate = (existing && existing.length) ? existing[0].night_date : null;
        var newDate = null;
        if (lastDate) {
          var d = new Date(lastDate + 'T00:00:00');
          d.setDate(d.getDate() + 1);
          newDate = d.toISOString().slice(0, 10);
        }
        var { data, error } = await sb.from('psr_hotel').insert({
          event_code: body.event_code,
          hotel_name: body.hotel_name,
          night_date: newDate,
          contracted: 0,
          actual: 0
        }).select();
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, row: data[0] });
      }

      // Hotel: add a new hotel block (one initial night row)
      if (postAction === 'hotel-add-new') {
        if (!body.hotel_name || !body.hotel_name.trim()) {
          return res.status(400).json({ ok: false, error: 'Hotel name is required' });
        }
        var { data, error } = await sb.from('psr_hotel').insert({
          event_code: body.event_code,
          hotel_name: body.hotel_name.trim(),
          night_date: null,
          contracted: 0,
          actual: 0
        }).select();
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, row: data[0] });
      }

      // Engagement: update a single field (metric, value_current, value_prior)
      if (postAction === 'engagement-update') {
        var updates = {};
        if (body.field === 'metric') updates.metric = body.value;
        else if (body.field === 'value_current') updates.value_current = Number(body.value) || 0;
        else if (body.field === 'value_prior') updates.value_prior = Number(body.value) || 0;
        else return res.status(400).json({ ok: false, error: 'Invalid field: ' + body.field });
        var { error } = await sb.from('psr_engagement').update(updates).eq('id', body.id);
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true });
      }

      // Engagement: add a new row
      if (postAction === 'engagement-add') {
        // Find max sort_order for this event
        var { data: existing } = await sb.from('psr_engagement').select('sort_order')
          .eq('event_code', body.event_code).order('sort_order', { ascending: false }).limit(1);
        var nextOrder = (existing && existing.length) ? existing[0].sort_order + 1 : 1;
        var { data, error } = await sb.from('psr_engagement').insert({
          event_code: body.event_code,
          metric: body.metric || 'New Metric',
          value_current: Number(body.value_current) || 0,
          value_prior: Number(body.value_prior) || 0,
          sort_order: nextOrder
        }).select();
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, row: data[0] });
      }

      // Engagement: reorder rows (bulk update sort_order)
      if (postAction === 'engagement-reorder') {
        var order = Array.isArray(body.order) ? body.order : [];
        if (!order.length) return res.status(400).json({ ok: false, error: 'Missing order array' });
        // Update each row's sort_order sequentially
        for (var i = 0; i < order.length; i++) {
          var rowId = Number(order[i]);
          if (!rowId) continue;
          var { error: uerr } = await sb.from('psr_engagement').update({ sort_order: i + 1 }).eq('id', rowId);
          if (uerr) return res.status(500).json({ ok: false, error: uerr.message });
        }
        return res.status(200).json({ ok: true });
      }

      // Engagement: delete a row
      if (postAction === 'engagement-delete') {
        var { error } = await sb.from('psr_engagement').delete().eq('id', body.id);
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true });
      }

      // Meetings: update a single field
      if (postAction === 'meeting-update') {
        var updates = {};
        if (body.field === 'metric') updates.metric = body.value;
        else if (body.field === 'value_current') updates.value_current = Number(body.value) || 0;
        else if (body.field === 'value_prior') updates.value_prior = Number(body.value) || 0;
        else return res.status(400).json({ ok: false, error: 'Invalid field: ' + body.field });
        var { error } = await sb.from('psr_meetings').update(updates).eq('id', body.id);
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true });
      }

      // Meetings: add a new row
      if (postAction === 'meeting-add') {
        var { data: existing } = await sb.from('psr_meetings').select('sort_order')
          .eq('event_code', body.event_code).eq('section', body.section)
          .order('sort_order', { ascending: false }).limit(1);
        var nextOrder = (existing && existing.length) ? existing[0].sort_order + 1 : 1;
        var { data, error } = await sb.from('psr_meetings').insert({
          event_code: body.event_code,
          section: body.section,
          metric: body.metric || 'New Metric',
          value_current: 0,
          value_prior: 0,
          sort_order: nextOrder
        }).select();
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, row: data[0] });
      }

      // Meetings: delete a row
      if (postAction === 'meeting-delete') {
        var { error } = await sb.from('psr_meetings').delete().eq('id', body.id);
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true });
      }

      // Top Meetings: update a single field
      if (postAction === 'top-meeting-update') {
        var updates = {};
        if (body.field === 'entity_name') updates.entity_name = body.value;
        else if (body.field === 'meeting_count') updates.meeting_count = Number(body.value) || 0;
        else if (body.field === 'rank') updates.rank = Number(body.value) || 0;
        else if (body.field === 'requests_made') updates.requests_made = Number(body.value) || 0;
        else if (body.field === 'company_name') updates.company_name = body.value;
        else return res.status(400).json({ ok: false, error: 'Invalid field: ' + body.field });
        var { error } = await sb.from('psr_top_meetings').update(updates).eq('id', body.id);
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true });
      }

      // Top Meetings: add a new row
      if (postAction === 'top-meeting-add') {
        var { data: existing } = await sb.from('psr_top_meetings').select('rank')
          .eq('event_code', body.event_code).eq('ranking_type', body.ranking_type)
          .order('rank', { ascending: false }).limit(1);
        var nextRank = (existing && existing.length) ? existing[0].rank + 1 : 1;
        var { data, error } = await sb.from('psr_top_meetings').insert({
          event_code: body.event_code,
          ranking_type: body.ranking_type,
          entity_name: body.entity_name || 'New Entry',
          meeting_count: 0,
          rank: nextRank
        }).select();
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, row: data[0] });
      }

      // Top Meetings: delete a row
      if (postAction === 'top-meeting-delete') {
        var { error } = await sb.from('psr_top_meetings').delete().eq('id', body.id);
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true });
      }

      // Registration Reconciliation: save pre-aggregated data from client
      if (postAction === 'reg-recon-save') {
        var reconAgg = body.aggregation;
        var reconCatOrder = body.cat_order;
        var reconEventCode = body.event_code;
        if (!reconAgg || !reconCatOrder || !reconEventCode) {
          return res.status(400).json({ ok: false, error: 'aggregation, cat_order, and event_code required' });
        }

        // Fetch existing prior_total values to preserve them
        var { data: existing } = await sb.from('psr_reg_recon').select('category, subcategory, is_total, prior_total')
          .eq('event_code', reconEventCode);
        var priorMap = {};
        (existing || []).forEach(function(r) {
          var key = r.is_total ? r.category + '||TOTAL' : r.category + '||' + (r.subcategory || '');
          priorMap[key] = r.prior_total || 0;
        });

        // Delete existing rows
        await sb.from('psr_reg_recon').delete().eq('event_code', reconEventCode);

        // Build insert rows from pre-aggregated data
        var rows = [];
        var sortBase = 100;
        reconCatOrder.forEach(function(cat) {
          var subs = reconAgg[cat] || {};
          var catTotals = subs['__cat__'] || { New: 0, Repeating: 0, Returning: 0, checked_in: 0, walk_up: 0, no_show: 0 };
          var subRows = [];
          var subSort = 1;

          var subKeys = Object.keys(subs).filter(function(k) { return k !== '__cat__'; });
          subKeys.sort(function(a, b) {
            var priorA = priorMap[cat + '||' + a] || 0;
            var priorB = priorMap[cat + '||' + b] || 0;
            if (priorB !== priorA) return priorB - priorA;
            var ta = subs[a].New + subs[a].Repeating + subs[a].Returning;
            var tb = subs[b].New + subs[b].Repeating + subs[b].Returning;
            return tb - ta;
          });

          subKeys.forEach(function(sub) {
            var s = subs[sub];
            subRows.push({
              event_code: reconEventCode,
              category: cat,
              subcategory: sub,
              is_total: false,
              value_new: s.New || 0,
              value_repeating: s.Repeating || 0,
              value_returning: s.Returning || 0,
              value_checked_in: s.checked_in || 0,
              value_walk_up: s.walk_up || 0,
              value_no_show: s.no_show || 0,
              prior_total: priorMap[cat + '||' + sub] || 0,
              sort_order: sortBase + subSort
            });
            subSort++;
          });

          // Add subcategory rows that exist in prior but not in current
          var existingSubKeys = {};
          subKeys.forEach(function(k) { existingSubKeys[k] = true; });
          Object.keys(priorMap).forEach(function(key) {
            if (key.indexOf(cat + '||') !== 0 || key === cat + '||TOTAL') return;
            var sub = key.replace(cat + '||', '');
            if (!existingSubKeys[sub] && priorMap[key] > 0) {
              subRows.push({
                event_code: reconEventCode,
                category: cat,
                subcategory: sub,
                is_total: false,
                value_new: 0, value_repeating: 0, value_returning: 0,
                value_checked_in: 0, value_walk_up: 0, value_no_show: 0,
                prior_total: priorMap[key],
                sort_order: sortBase + subSort
              });
              subSort++;
            }
          });

          // Category total row
          rows.push({
            event_code: reconEventCode,
            category: cat,
            subcategory: null,
            is_total: true,
            value_new: catTotals.New || 0,
            value_repeating: catTotals.Repeating || 0,
            value_returning: catTotals.Returning || 0,
            value_checked_in: catTotals.checked_in || 0,
            value_walk_up: catTotals.walk_up || 0,
            value_no_show: catTotals.no_show || 0,
            prior_total: priorMap[cat + '||TOTAL'] || 0,
            sort_order: sortBase
          });
          rows = rows.concat(subRows);
          sortBase += 100;
        });

        if (rows.length > 0) {
          var { error: insErr } = await sb.from('psr_reg_recon').insert(rows);
          if (insErr) return res.status(500).json({ ok: false, error: insErr.message });
        }

        var { data: fresh, error: fetchErr } = await sb.from('psr_reg_recon').select('*')
          .eq('event_code', reconEventCode).order('sort_order');
        if (fetchErr) return res.status(500).json({ ok: false, error: fetchErr.message });

        // Update psr_attendance with checked_in, walk_up, no_show from contacts
        var attendance = body.attendance || {};
        var attendanceUpdated = false;
        if (attendance.checked_in != null || attendance.walk_up != null || attendance.no_show != null) {
          var checkedIn = Number(attendance.checked_in) || 0;
          var walkUp = Number(attendance.walk_up) || 0;
          var noShow = Number(attendance.no_show) || 0;

          // Update checked_in
          await sb.from('psr_attendance')
            .update({ value_current: checkedIn })
            .eq('event_code', reconEventCode)
            .eq('section', 'registration')
            .eq('metric', 'checked_in');

          // Update walk_up
          await sb.from('psr_attendance')
            .update({ value_current: walkUp })
            .eq('event_code', reconEventCode)
            .eq('section', 'registration')
            .eq('metric', 'walk_up');

          // Update no_show (stored as negative)
          await sb.from('psr_attendance')
            .update({ value_current: -Math.abs(noShow) })
            .eq('event_code', reconEventCode)
            .eq('section', 'registration')
            .eq('metric', 'no_show');

          attendanceUpdated = true;
        }

        // Update attendee_class from attended-only data
        var attClass = body.attendee_class || {};
        if (Object.keys(attClass).length > 0) {
          for (var cls of Object.keys(attClass)) {
            await sb.from('psr_attendance')
              .update({ value_current: Number(attClass[cls]) || 0 })
              .eq('event_code', reconEventCode)
              .eq('section', 'attendee_class')
              .eq('metric', cls);
          }
          attendanceUpdated = true;
        }

        // Update attendee_country from attended-only data
        var attCountry = body.attendee_country || {};
        if (Object.keys(attCountry).length > 0) {
          for (var cty of Object.keys(attCountry)) {
            await sb.from('psr_attendance')
              .update({ value_current: Number(attCountry[cty]) || 0 })
              .eq('event_code', reconEventCode)
              .eq('section', 'attendee_country')
              .eq('metric', cty);
          }
          attendanceUpdated = true;
        }

        return res.status(200).json({ ok: true, reg_recon: fresh, attendance_updated: attendanceUpdated });
      }

      // Upload member cancellations (XLSX data as JSON array)
      if (postAction === 'upload-cancellations') {
        var cxlCode = body.event_code;
        var cxlRows = body.rows || [];
        if (!cxlCode || !cxlRows.length) {
          return res.status(400).json({ ok: false, error: 'event_code and rows are required' });
        }
        // Delete existing cancellations for this event
        await sb.from('psr_cancellations').delete().eq('event_code', cxlCode);

        var insertRows = cxlRows.map(function(r, i) {
          // Parse CXL Date — handle various formats
          var cxlDate = null;
          if (r.cxl_date) {
            var d = new Date(r.cxl_date);
            if (!isNaN(d.getTime())) cxlDate = d.toISOString();
          }
          return {
            event_code: cxlCode,
            company: r.company || '',
            status: r.status || null,
            mineral: r.mineral || null,
            primary_country: r.primary_country || null,
            market_cap: r.market_cap || null,
            cxl_date: cxlDate,
            company_reason: r.company_reason || null,
            dgg_response: r.dgg_response || null,
            sort_order: i + 1
          };
        });

        var { error: cxlErr } = await sb.from('psr_cancellations').insert(insertRows);
        if (cxlErr) return res.status(500).json({ ok: false, error: cxlErr.message });
        return res.status(200).json({ ok: true, message: 'Uploaded ' + insertRows.length + ' cancellations for ' + cxlCode, total: insertRows.length });
      }

      // Upload member meetings (from XLSX)
      if (postAction === 'upload-member-meetings') {
        var mmCode = body.event_code;
        var mmRows = body.rows || [];
        if (!mmCode || !mmRows.length) {
          return res.status(400).json({ ok: false, error: 'event_code and rows are required' });
        }
        // Delete existing member rankings for this event
        await sb.from('psr_top_meetings').delete().eq('event_code', mmCode).eq('ranking_type', 'member');

        var mmInsert = mmRows.map(function(r, i) {
          var confirmed = parseInt(r.confirmed_meetings) || 0;
          var requests = parseInt(r.requests_made) || 0;
          return {
            event_code: mmCode,
            ranking_type: 'member',
            entity_name: r.company_name || '',
            company_name: r.company_name || '',
            requests_made: requests,
            meeting_count: confirmed,
            rank: i + 1
          };
        });

        var { error: mmErr } = await sb.from('psr_top_meetings').insert(mmInsert);
        if (mmErr) return res.status(500).json({ ok: false, error: mmErr.message });
        return res.status(200).json({ ok: true, message: 'Uploaded ' + mmInsert.length + ' member meeting records for ' + mmCode, total: mmInsert.length });
      }

      // Upload participant meetings (from XLSX)
      if (postAction === 'upload-participant-meetings') {
        var pmCode = body.event_code;
        var pmRows = body.rows || [];
        if (!pmCode || !pmRows.length) {
          return res.status(400).json({ ok: false, error: 'event_code and rows are required' });
        }
        // Delete existing participant rankings for this event
        await sb.from('psr_top_meetings').delete().eq('event_code', pmCode).eq('ranking_type', 'participant');

        var pmInsert = pmRows.map(function(r, i) {
          return {
            event_code: pmCode,
            ranking_type: 'participant',
            entity_name: r.name || '',
            company_name: r.company_name || '',
            requests_made: 0,
            meeting_count: parseInt(r.confirmed_meetings) || 0,
            rank: i + 1
          };
        });

        var { error: pmErr } = await sb.from('psr_top_meetings').insert(pmInsert);
        if (pmErr) return res.status(500).json({ ok: false, error: pmErr.message });
        return res.status(200).json({ ok: true, message: 'Uploaded ' + pmInsert.length + ' participant meeting records for ' + pmCode, total: pmInsert.length });
      }

      // Upload webcast metrics (from XLSX)
      if (postAction === 'upload-webcasts') {
        var wcCode = body.event_code;
        var wcRows = body.rows || [];
        if (!wcCode || !wcRows.length) {
          return res.status(400).json({ ok: false, error: 'event_code and rows are required' });
        }
        // Delete existing webcasts for this event
        await sb.from('psr_webcasts').delete().eq('event_code', wcCode);

        var wcInsert = wcRows.map(function(r, i) {
          var obj = {
            event_code: wcCode,
            webcast_type: r.webcast_type || 'video_metrics',
            entity_name: r.entity_name || '',
            total_views: parseInt(r.total_views) || 0,
            total_duration_min: parseFloat(r.total_duration_min) || 0,
            avg_duration_min: parseFloat(r.avg_duration_min) || 0,
            sort_order: r.sort_order != null ? Number(r.sort_order) : i + 1
          };
          if (r.avg_views != null) obj.avg_views = parseFloat(r.avg_views) || 0;
          return obj;
        });

        var { error: wcErr } = await sb.from('psr_webcasts').insert(wcInsert);
        if (wcErr) return res.status(500).json({ ok: false, error: wcErr.message });
        return res.status(200).json({ ok: true, message: 'Uploaded ' + wcInsert.length + ' webcast records for ' + wcCode, total: wcInsert.length });
      }

      // Webcast inline edits
      if (postAction === 'webcast-update') {
        var wcId = body.id;
        var wcField = body.field;
        var wcVal = body.value;
        if (!wcId || !wcField) return res.status(400).json({ ok: false, error: 'id and field required' });
        var wcUpdates = {};
        if (wcField === 'entity_name') wcUpdates.entity_name = wcVal;
        else if (wcField === 'total_views') wcUpdates.total_views = Number(wcVal) || 0;
        else if (wcField === 'total_duration_min') wcUpdates.total_duration_min = Number(wcVal) || 0;
        else if (wcField === 'avg_duration_min') wcUpdates.avg_duration_min = Number(wcVal) || 0;
        else if (wcField === 'sort_order') wcUpdates.sort_order = Number(wcVal) || 0;
        else if (wcField === 'avg_views') wcUpdates.avg_views = wcVal != null && wcVal !== '' ? Number(wcVal) || 0 : null;
        else return res.status(400).json({ ok: false, error: 'invalid field' });
        var { error: wcuErr } = await sb.from('psr_webcasts').update(wcUpdates).eq('id', wcId);
        if (wcuErr) return res.status(500).json({ ok: false, error: wcuErr.message });
        return res.status(200).json({ ok: true });
      }

      if (postAction === 'webcast-delete') {
        var wdId = body.id;
        if (!wdId) return res.status(400).json({ ok: false, error: 'id required' });
        var { error: wdErr } = await sb.from('psr_webcasts').delete().eq('id', wdId);
        if (wdErr) return res.status(500).json({ ok: false, error: wdErr.message });
        return res.status(200).json({ ok: true });
      }

      // Cover page PDF: save base64
      if (postAction === 'cover-save') {
        var coverEvt = body.event_code;
        var coverData = body.cover_pdf; // base64 string or null to clear
        if (!coverEvt) return res.status(400).json({ ok: false, error: 'event_code required' });
        var { error: covErr } = await sb.from('psr_events').update({ cover_pdf: coverData || null }).eq('event_code', coverEvt);
        if (covErr) return res.status(500).json({ ok: false, error: covErr.message });
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ ok: false, error: 'Unknown POST action: ' + postAction });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  } catch (err) {
    console.error('PSR API error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
};
