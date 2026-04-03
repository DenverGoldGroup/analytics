// POST /api/upload — handle CSV upload and replace data in Supabase
// GET  /api/upload?action=stats — return row counts
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ljyogcspkvqgjbiyzfbn.supabase.co';

function getSupabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return createClient(SUPABASE_URL, key);
}

// Verify admin token (matches new format: randomBytes.timestamp.signature)
function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.replace('Bearer ', '');
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [tokenBytes, timestamp, providedSignature] = parts;
  const secret = (process.env.ADMIN_PASSWORD || '') + (process.env.SUPABASE_SERVICE_ROLE_KEY || 'fallback');

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(tokenBytes + '.' + timestamp)
    .digest('hex');

  // Timing-safe comparison for signature
  const sigBuf = Buffer.from(providedSignature);
  const expBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;

  // Token valid for 24 hours
  const age = Date.now() - parseInt(timestamp, 10);
  if (isNaN(age) || age < 0 || age > 24 * 60 * 60 * 1000) return false;

  return true;
}

// Normalize a header: CamelCase → snake_case, lowercase, trim
function normalizeHeader(h) {
  return h.trim()
    // Insert underscore before uppercase letters preceded by lowercase
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    // Insert underscore before uppercase letters followed by lowercase (for runs like "USD")
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_');
}

// Strip markdown links: [text](url) → text
function stripMarkdownLink(val) {
  if (!val) return val;
  return val.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

// Parse CSV text into array of objects
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');

  // Parse header - handle quoted fields
  const headers = parseLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseLine(line);
    const row = {};
    headers.forEach(function (h, idx) {
      const key = normalizeHeader(h);
      let val = stripMarkdownLink((values[idx] || '').trim());
      row[key] = val;
    });
    rows.push(row);
  }

  return { headers: headers.map(h => normalizeHeader(h)), rows };
}

// Parse a single CSV line, handling quoted fields
function parseLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

// Map CSV row to companies table columns
// Handles both snake_case DB-style headers and CamelCase export headers
function mapCompanyRow(row) {
  const mapped = {
    company_name: row.company_name || row.company_name_for_publication || row.company || row.name || '',
    company_status: row.company_status || row.status || '',
    primary_mineral: row.primary_mineral || row.mineral || '',
    primary_country: row.primary_country || row.primary_country_of_operation || row.country || '',
    primary_region: row.primary_region || row.primary_region_of_operation || row.region || '',
    primary_subregion: row.primary_subregion || row.primary_subregion_of_operation || row.subregion || '',
    primary_stock_exchange: row.primary_stock_exchange || row.stock_exchange || row.exchange || '',
    stock_symbol: row.stock_symbol || row.symbol || '',
    ticker: row.ticker || '',
    currency: row.currency || '',
    stock_price_usd: parseFloatSafe(row.stock_price_usd),
    fifty_two_week_range: row.fifty_two_week_range || row.fifty_two_week_range_usd || row['52_week_range'] || '',
    one_year_return: row.one_year_return || '',
    market_cap_display: row.market_cap_display || row.market_cap_usd || row.mcap_display || '',
    market_cap_usd: parseFloatSafe(row.market_cap_usd_actual || row.market_cap_usd || row.mcap || row.market_cap),
    production_low: parseFloatSafe(row.production_low || row.prod_lo || row.prod_low),
    production_high: parseFloatSafe(row.production_high || row.prod_hi || row.prod_high),
    reserves: parseFloatSafe(row.reserves),
    resources: parseFloatSafe(row.resources),
    profile_url: row.profile_url || row.profile || row.url || ''
  };
  // Include id from CSV if present (companies table has no auto-increment)
  if (row.id && parseInt(row.id)) {
    mapped.id = parseInt(row.id);
  }
  return mapped;
}

// Map CSV row to event_participations table columns
// Handles both snake_case DB-style headers and CamelCase export headers
function mapEventRow(row, eventCode) {
  return {
    event_code: eventCode,
    company_name: row.company_name || row.company_name_for_publication || row.company || row.name || '',
    company_status: row.company_status || row.status || '',
    primary_mineral: row.primary_mineral || row.mineral || '',
    primary_country: row.primary_country || row.primary_country_of_operation || row.country || '',
    primary_region: row.primary_region || row.primary_region_of_operation || row.region || '',
    primary_subregion: row.primary_subregion || row.primary_subregion_of_operation || row.subregion || '',
    primary_stock_exchange: row.primary_stock_exchange || row.stock_exchange || row.exchange || '',
    stock_symbol: row.stock_symbol || row.symbol || '',
    ticker: row.ticker || '',
    currency: row.currency || '',
    stock_price_usd: parseFloatSafe(row.stock_price_usd),
    fifty_two_week_range: row.fifty_two_week_range || row.fifty_two_week_range_usd || row['52_week_range'] || '',
    one_year_return: row.one_year_return || '',
    market_cap_display: row.market_cap_display || row.market_cap_usd || row.mcap_display || '',
    market_cap_usd: parseFloatSafe(row.market_cap_usd_actual || row.market_cap_usd || row.mcap || row.market_cap),
    production_low: parseFloatSafe(row.production_low || row.prod_lo || row.prod_low),
    production_high: parseFloatSafe(row.production_high || row.prod_hi || row.prod_high),
    reserves: parseFloatSafe(row.reserves),
    resources: parseFloatSafe(row.resources),
    participation_status: row.participation_status || row.part_status || '',
    presentation_type: row.presentation_type || row.pres_type || '',
    presentation_date: row.presentation_date || row.pres_date || null,
    presentation_time: row.presentation_time || row.pres_time || '',
    presentation_location: row.presentation_location || row.pres_location || row.location || '',
    payment_status: row.payment_status || '',
    attendance: row.attendance || '',
    profile_url: row.profile_url || row.profile || row.url || '',
    webcast_url: row.webcast_url || row.webcast || ''
  };
}

function parseFloatSafe(val) {
  if (val == null || val === '') return null;
  // Remove $ signs, commas
  const cleaned = String(val).replace(/[$,]/g, '').trim();
  if (cleaned === '' || cleaned === '-' || cleaned === '—') return null;
  const num = parseFloat(cleaned);
  return (isNaN(num) || !isFinite(num)) ? null : num;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Verify auth
  if (!verifyToken(req.headers.authorization)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  // GET: stats
  if (req.method === 'GET') {
    try {
      const sb = getSupabase();
      const [c, mfe, mfa, amfe, amfa] = await Promise.all([
        sb.from('companies').select('id', { count: 'exact', head: true }),
        sb.from('event_participations').select('id', { count: 'exact', head: true }).eq('event_code', 'MFE26'),
        sb.from('event_participations').select('id', { count: 'exact', head: true }).eq('event_code', 'MFA26'),
        sb.from('attendees').select('id', { count: 'exact', head: true }).eq('event_code', 'MFE26'),
        sb.from('attendees').select('id', { count: 'exact', head: true }).eq('event_code', 'MFA26')
      ]);
      return res.status(200).json({
        ok: true,
        companies: c.count || 0,
        mfe26: mfe.count || 0,
        mfa26: mfa.count || 0,
        mfe26_attendees: amfe.count || 0,
        mfa26_attendees: amfa.count || 0
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // POST: upload or purge
  if (req.method === 'POST') {
    try {
      const { target, csv, action } = req.body || {};
      const sb = getSupabase();

      // PURGE action
      if (action === 'purge') {
        if (target === 'companies') {
          // Must delete all event_participations first (FK constraint)
          const { error: epErr } = await sb.from('event_participations').delete().neq('id', 0);
          if (epErr) throw epErr;
          const { error } = await sb.from('companies').delete().neq('id', 0);
          if (error) throw error;
          return res.status(200).json({ ok: true, message: 'All companies and event participations deleted.' });
        } else if (target === 'mfe26-attendees' || target === 'mfa26-attendees') {
          const code = target === 'mfe26-attendees' ? 'MFE26' : 'MFA26';
          const { error } = await sb.from('attendees').delete().eq('event_code', code);
          if (error) throw error;
          return res.status(200).json({ ok: true, message: code + ' attendees deleted.' });
        } else {
          const code = target === 'mfe26' ? 'MFE26' : 'MFA26';
          const { error } = await sb.from('event_participations').delete().eq('event_code', code);
          if (error) throw error;
          return res.status(200).json({ ok: true, message: code + ' participations deleted.' });
        }
      }

      // UPLOAD action
      if (!csv) return res.status(400).json({ ok: false, error: 'No CSV data provided' });

      // Enforce 10MB limit on CSV data
      const csvSize = Buffer.byteLength(csv, 'utf8');
      if (csvSize > 10 * 1024 * 1024) {
        return res.status(400).json({ ok: false, error: 'CSV data exceeds 10MB limit' });
      }

      const parsed = parseCSV(csv);
      if (parsed.rows.length === 0) {
        return res.status(400).json({ ok: false, error: 'CSV has no data rows' });
      }

      if (target === 'companies') {
        // CSV replaces all existing data.
        var mapped = parsed.rows.map(r => mapCompanyRow(r)).filter(r => r.company_name);

        // Deduplicate by company name (keep first occurrence)
        var seen = {};
        var unique = [];
        mapped.forEach(function (row) {
          var nameKey = row.company_name.toLowerCase().trim();
          if (!seen[nameKey]) {
            seen[nameKey] = true;
            unique.push(row);
          }
        });

        // Assign sequential IDs
        unique.forEach(function (row, idx) {
          row.id = idx + 1;
        });

        // Delete all event_participations first (FK constraint), then all companies
        var { error: epErr } = await sb.from('event_participations').delete().neq('id', 0);
        if (epErr) throw new Error('Delete event_participations failed: ' + epErr.message);
        var { error: delErr } = await sb.from('companies').delete().neq('id', 0);
        if (delErr) throw new Error('Delete companies failed: ' + delErr.message);

        // Insert all companies in batches
        var inserted = 0;
        for (var i = 0; i < unique.length; i += 50) {
          var batch = unique.slice(i, i + 50);
          var { error: insErr } = await sb.from('companies').insert(batch);
          if (insErr) throw new Error('Insert batch ' + i + ' failed: ' + insErr.message);
          inserted += batch.length;
        }

        var msg = 'Companies replaced: ' + inserted + ' companies from ' + parsed.rows.length + ' CSV rows.';
        return res.status(200).json({ ok: true, message: msg });

      } else {
        // Event upload — CSV replaces all participations for this event.
        // Companies referenced in the CSV are matched by name or auto-created.
        var eventCode = target === 'mfe26' ? 'MFE26' : 'MFA26';

        // Delete existing event_participations for this event
        var { error: epDelErr } = await sb.from('event_participations').delete().eq('event_code', eventCode);
        if (epDelErr) throw new Error('Delete failed: ' + epDelErr.message);

        // Fetch all current companies for lookup
        var { data: companies } = await sb.from('companies').select('id, company_name');
        var companyLookup = {};
        var maxId = 0;
        (companies || []).forEach(function (c) {
          companyLookup[c.company_name.toLowerCase().trim()] = c.id;
          if (c.id > maxId) maxId = c.id;
        });

        // Map rows and assign company_id
        var mapped = parsed.rows.map(function (r) {
          var row = mapEventRow(r, eventCode);
          var nameKey = (row.company_name || '').toLowerCase().trim();
          row.company_id = companyLookup[nameKey] || null;
          return row;
        }).filter(function (r) { return r.company_name; });

        // Auto-create companies not in the companies table
        var unmatched = mapped.filter(function (r) { return !r.company_id; });
        var created = 0;
        if (unmatched.length > 0) {
          var seen = {};
          var newCompanies = [];
          unmatched.forEach(function (r) {
            var nameKey = r.company_name.toLowerCase().trim();
            if (seen[nameKey]) return;
            seen[nameKey] = true;
            maxId++;
            newCompanies.push({
              id: maxId,
              company_name: r.company_name,
              company_status: r.company_status || '',
              primary_mineral: r.primary_mineral || '',
              primary_country: r.primary_country || '',
              primary_region: r.primary_region || '',
              primary_subregion: r.primary_subregion || '',
              primary_stock_exchange: r.primary_stock_exchange || '',
              stock_symbol: r.stock_symbol || '',
              ticker: r.ticker || '',
              currency: r.currency || '',
              stock_price_usd: r.stock_price_usd || null,
              fifty_two_week_range: r.fifty_two_week_range || '',
              one_year_return: r.one_year_return || '',
              market_cap_display: r.market_cap_display || '',
              market_cap_usd: r.market_cap_usd || null,
              production_low: r.production_low || null,
              production_high: r.production_high || null,
              reserves: r.reserves || null,
              resources: r.resources || null,
              profile_url: r.profile_url || ''
            });
          });

          for (var i = 0; i < newCompanies.length; i += 50) {
            var batch = newCompanies.slice(i, i + 50);
            var { error: compErr } = await sb.from('companies').insert(batch);
            if (compErr) throw new Error('Auto-create companies failed: ' + compErr.message);
            created += batch.length;
          }

          newCompanies.forEach(function (c) {
            companyLookup[c.company_name.toLowerCase().trim()] = c.id;
          });

          unmatched.forEach(function (r) {
            r.company_id = companyLookup[r.company_name.toLowerCase().trim()];
          });
        }

        // Insert event rows in batches
        var ready = mapped.filter(function (r) { return r.company_id; });
        var inserted = 0;
        for (var i = 0; i < ready.length; i += 50) {
          var batch = ready.slice(i, i + 50);
          var { error: insErr } = await sb.from('event_participations').insert(batch);
          if (insErr) throw new Error('Insert batch ' + i + ' failed: ' + insErr.message);
          inserted += batch.length;
        }

        var msg = eventCode + ' replaced: ' + inserted + ' participations from ' + parsed.rows.length + ' CSV rows.';
        if (created > 0) {
          msg += ' Auto-created ' + created + ' new companies.';
        }

        return res.status(200).json({ ok: true, message: msg });

      } else if (target === 'mfe26-attendees' || target === 'mfa26-attendees') {
        // Attendees upload — delete and replace for this event
        var attendeeCode = target === 'mfe26-attendees' ? 'MFE26' : 'MFA26';

        var { error: attDelErr } = await sb.from('attendees').delete().eq('event_code', attendeeCode);
        if (attDelErr) throw new Error('Delete attendees failed: ' + attDelErr.message);

        var attRows = parsed.rows.map(function(r) {
          return {
            event_code: attendeeCode,
            contact_id: r.id || '',
            first_name: r.first_name || '',
            last_name: r.last_name || '',
            company: r.company || '',
            job_title: r.job_title || '',
            city: r.city || '',
            country: r.country || '',
            type: r.type || '',
            category: r.category || '',
            subcategory: r.subcategory || '',
            member_id: r.member_id || '',
            attendance: r.attendance || '',
            accepted_date: r.accepted_date || ''
          };
        }).filter(function(r) { return r.type && r.type !== 'Staff'; });

        var attInserted = 0;
        for (var i = 0; i < attRows.length; i += 50) {
          var batch = attRows.slice(i, i + 50);
          var { error: attInsErr } = await sb.from('attendees').insert(batch);
          if (attInsErr) throw new Error('Insert attendees batch ' + i + ' failed: ' + attInsErr.message);
          attInserted += batch.length;
        }

        return res.status(200).json({ ok: true, message: attendeeCode + ' attendees replaced: ' + attInserted + ' records from ' + parsed.rows.length + ' CSV rows.' });
      }

    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};
