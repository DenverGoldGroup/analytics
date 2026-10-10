// Daily sync from EMS into Supabase: the DGG member roster (companies) and the participating companies
// (event_participations) of every current or forthcoming event whose registration has opened.
// EMS is the source of truth; the CSV uploads on /admin are the fallback, used when EMS cannot answer.
//
// What EMS supplies and what it does not (October 2026 API):
//   EMS: name, status, primary mineral, country, exchange, symbol, ticker, share price, market cap (USD),
//        region and subregion (from the facets tree), presentation slot (date, time, room, format).
//   Not in EMS's API yet: currency, 52-week range, 1-year return, production, reserves, resources,
//        webcast page URL. Those are carried forward from the last upload for the same company until EMS adds them.
// Safety: nothing is written when EMS fails, returns nothing, or returns far fewer rows than we hold
// (a partial answer must not wipe good data). Concluded events are never touched, so a signed-off
// event's figures stay as they were.
const { createClient } = require('@supabase/supabase-js');
const EMS = require('./_ems');

const SUPABASE_URL = 'https://ljyogcspkvqgjbiyzfbn.supabase.co';
const ROSTER_FLOOR = 0.8;   // skip the roster when EMS returns under 80% of the members we hold
const EVENT_FLOOR = 0.5;    // skip an event when EMS returns under half the participations we hold
const CONCURRENCY = 6;

// Fields EMS does not provide yet: kept from the previous row for the same company
const CARRY = ['currency', 'fifty_two_week_range', 'one_year_return', 'production_low', 'production_high', 'reserves', 'resources', 'profile_url'];

function db() {
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(SUPABASE_URL, key);
}

function nameKey(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(corporation|corp|limited|ltd|inc|plc|company|co|the|sa|nv|ag|llc|lp)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

// Run fn over items, a few at a time
async function pool(items, fn) {
  var out = new Array(items.length), next = 0;
  async function worker() { while (next < items.length) { var i = next++; out[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}

// country name -> { region, subregion }, from a facets tree
function regionIndex(facets) {
  var idx = {};
  ((facets && facets.data && facets.data.regions) || []).forEach(function(r) {
    (r.subregions || []).forEach(function(s) {
      (s.countries || []).forEach(function(c) { idx[c] = { region: r.name, subregion: s.name }; });
    });
  });
  return idx;
}

// "$1.20B" style display, as the uploads carry it
function mcapDisplay(v) {
  if (v == null) return '';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + ' B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + ' M';
  return '$' + Math.round(v).toLocaleString('en-US');
}

// Share price and market cap live only on the company detail endpoint; fetched once per company per run
function detailFetcher() {
  var cache = {};
  return function(id) {
    if (!cache[id]) cache[id] = EMS.ems('/companies/' + id).then(function(r) { return r && r.data ? r.data : null; });
    return cache[id];
  };
}

// One company row from EMS, with the fields EMS lacks carried from `prev`
function companyRow(c, detail, regions, prev) {
  var countryName = c.country && typeof c.country === 'object' ? c.country.name : c.country;
  var where = regions[countryName] || {};
  var stock = (detail && detail.stock) || {};
  var row = {
    ems_company_id: c.id,
    company_name: c.name,
    company_status: c.company_status || '',
    primary_mineral: c.primary_mineral || '',
    primary_country: countryName || '',
    primary_region: where.region || (prev && prev.primary_region) || '',
    primary_subregion: where.subregion || (prev && prev.primary_subregion) || '',
    primary_stock_exchange: c.exchange || stock.exchange || '',
    stock_symbol: c.symbol || stock.symbol || '',
    ticker: c.ticker || stock.ticker || '',
    stock_price_usd: stock.price != null ? stock.price : (prev ? prev.stock_price_usd : null),
    market_cap_usd: stock.market_cap_usd != null ? stock.market_cap_usd : (prev ? prev.market_cap_usd : null),
    source: 'ems',
    synced_at: new Date().toISOString()
  };
  row.market_cap_display = mcapDisplay(row.market_cap_usd);
  CARRY.forEach(function(f) { row[f] = prev && prev[f] != null ? prev[f] : (f === 'profile_url' || f === 'currency' || f === 'fifty_two_week_range' || f === 'one_year_return' ? '' : null); });
  return row;
}

// Calendar day and wall-clock time of a presentation, in the event's own zone
function slot(p, tz) {
  if (!p || !p.start) return { date: null, time: '' };
  var d = new Date(p.start);
  var parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d);
  var get = function(t) { var x = parts.filter(function(q) { return q.type === t; })[0]; return x ? x.value : ''; };
  return { date: get('year') + '-' + get('month') + '-' + get('day'), time: get('hour') + ':' + get('minute') + ' ' + get('dayPeriod').toUpperCase() };
}

async function log(sb, entry) {
  var { error } = await sb.from('ems_sync_log').insert(entry);
  if (error) console.warn('[ems-sync] log write failed: ' + error.message);
}

// ── The roster ──────────────────────────────────────────
async function syncRoster(sb, opts, detail) {
  var base = { trigger: opts.trigger, dry_run: !!opts.dryRun, scope: 'roster' };
  // /members always pages (16 a page); walk every page
  var members = [], page = 1, last = 1;
  do {
    var r = await EMS.ems('/members', { page: page });
    if (!r || !Array.isArray(r.data)) { members = null; break; }
    members = members.concat(r.data);
    last = (r.meta && r.meta.last_page) || 1;
    page++;
  } while (page <= last && page <= 100);
  var facets = members ? await EMS.ems('/members/facets') : null;

  var { data: existing, error } = await sb.from('companies').select('*');
  if (error) throw new Error('Read companies failed: ' + error.message);
  var held = existing.filter(function(c) { return c.in_roster !== false; }).length;

  if (!members || !members.length) {
    await log(sb, Object.assign({}, base, { status: 'skipped', message: 'EMS did not return the member roster; the last upload stays in place.' }));
    return { status: 'skipped', reason: 'no answer' };
  }
  if (members.length < held * ROSTER_FLOOR) {
    var msg = 'EMS returned ' + members.length + ' members against ' + held + ' held (under ' + Math.round(ROSTER_FLOOR * 100) + '%); not applied, check EMS.';
    await log(sb, Object.assign({}, base, { status: 'skipped', counts: { ems: members.length, held: held }, message: msg }));
    return { status: 'skipped', reason: msg };
  }

  var regions = regionIndex(facets);
  var byEms = {}, byName = {};
  existing.forEach(function(c) { if (c.ems_company_id) byEms[c.ems_company_id] = c; byName[nameKey(c.company_name)] = c; });
  var details = await pool(members, function(m) { return detail(m.id); });

  var updates = [], inserts = [], seen = {};
  members.forEach(function(m, i) {
    var prev = byEms[m.id] || byName[nameKey(m.name)];
    var row = companyRow(m, details[i], regions, prev);
    row.in_roster = true;
    if (prev) { seen[prev.id] = true; updates.push(Object.assign({ id: prev.id }, row)); }
    else inserts.push(row);
  });
  var leaving = existing.filter(function(c) { return !seen[c.id] && c.in_roster !== false; });
  var { data: refs } = await sb.from('event_participations').select('company_id');
  var referenced = {};
  (refs || []).forEach(function(r) { referenced[r.company_id] = true; });
  var toDelete = leaving.filter(function(c) { return !referenced[c.id]; }).map(function(c) { return c.id; });
  var toFlag = leaving.filter(function(c) { return referenced[c.id]; }).map(function(c) { return c.id; });
  var counts = { ems: members.length, held: held, updated: updates.length, added: inserts.length, removed: toDelete.length,
    kept_for_past_events: toFlag.length, without_market_cap: updates.concat(inserts).filter(function(r) { return r.market_cap_usd == null; }).length };

  if (!opts.dryRun) {
    for (var i = 0; i < updates.length; i += 50) {
      var { error: uErr } = await sb.from('companies').upsert(updates.slice(i, i + 50), { onConflict: 'id' });
      if (uErr) throw new Error('Update companies failed: ' + uErr.message);
    }
    for (var j = 0; j < inserts.length; j += 50) {
      var { error: iErr } = await sb.from('companies').insert(inserts.slice(j, j + 50));
      if (iErr) throw new Error('Insert companies failed: ' + iErr.message);
    }
    if (toFlag.length) {
      var { error: fErr } = await sb.from('companies').update({ in_roster: false }).in('id', toFlag);
      if (fErr) throw new Error('Flag companies failed: ' + fErr.message);
    }
    if (toDelete.length) {
      var { error: dErr } = await sb.from('companies').delete().in('id', toDelete);
      if (dErr) throw new Error('Delete companies failed: ' + dErr.message);
    }
  }
  await log(sb, Object.assign({}, base, { status: opts.dryRun ? 'preview' : 'applied', counts: counts,
    message: (opts.dryRun ? 'Would apply: ' : 'Applied: ') + members.length + ' members from EMS.' }));
  return Object.assign({ status: opts.dryRun ? 'preview' : 'applied' }, counts,
    opts.dryRun ? { joining: inserts.map(function(r) { return r.company_name; }), leaving: leaving.map(function(c) { return c.company_name; }) } : {});
}

// ── Events whose registration has opened ───────────────
// Current or forthcoming: ending today or later. A concluded event is never re-synced.
async function eventsToSync() {
  var list = await EMS.ems('/events', { upcoming: 1, days: 1, require_logo: 0 });
  if (!list || !Array.isArray(list.data)) return null;
  var full = await pool(list.data, function(e) { return EMS.ems('/events/' + e.id); });
  var now = Date.now();
  return full.map(function(r) { return r && r.data; }).filter(function(e) {
    return e && e.registration_opens && Date.parse(e.registration_opens) <= now;
  });
}

// EMS codes that differ from the ones this dashboard files data under
var LOCAL_CODE = { MFS27: 'MFAU27' };

async function syncEvent(sb, evt, opts, detail) {
  var code = LOCAL_CODE[evt.code] || evt.code;
  var base = { trigger: opts.trigger, dry_run: !!opts.dryRun, scope: 'event', event_code: code };
  var r = await EMS.ems('/event-members', { event_id: evt.id });
  var facets = await EMS.ems('/event-members/facets', { event_id: evt.id });
  var { data: prior, error } = await sb.from('event_participations').select('*').eq('event_code', code);
  if (error) throw new Error('Read participations failed: ' + error.message);
  if (!r || !Array.isArray(r.data)) {
    await log(sb, Object.assign({}, base, { status: 'skipped', message: 'EMS did not answer for ' + code + '; the last upload stays in place.' }));
    return { event_code: code, status: 'skipped', reason: 'no answer' };
  }
  if ((r.data.length === 0 && prior.length) || r.data.length < prior.length * EVENT_FLOOR) {
    var msg = 'EMS returned ' + r.data.length + ' participating companies against ' + prior.length + ' held; not applied, check EMS.';
    await log(sb, Object.assign({}, base, { status: 'skipped', counts: { ems: r.data.length, held: prior.length }, message: msg }));
    return { event_code: code, status: 'skipped', reason: msg };
  }

  var regions = regionIndex(facets);
  var { data: companies } = await sb.from('companies').select('*');
  var byEms = {}, byName = {}, prevPart = {};
  (companies || []).forEach(function(c) { if (c.ems_company_id) byEms[c.ems_company_id] = c; byName[nameKey(c.company_name)] = c; });
  prior.forEach(function(p) { prevPart[nameKey(p.company_name)] = p; });
  var details = await pool(r.data, function(c) { return detail(c.id); });

  var newCompanies = [], rows = [];
  r.data.forEach(function(c, i) {
    var comp = byEms[c.id] || byName[nameKey(c.name)];
    var prev = prevPart[nameKey(c.name)] || comp;
    var row = companyRow(c, details[i], regions, prev);
    var s = slot(c.presentation, evt.timezone);
    var p = c.presentation || null;
    Object.assign(row, {
      event_code: code,
      participation_status: 'Accepted',
      presentation_type: p ? (p.format || 'Presentation') : '',
      presentation_date: s.date,
      presentation_time: s.time,
      presentation_location: (p && p.location) || '',
      webcast_url: (prev && prev.webcast_url) || '',
      company_id: comp ? comp.id : null
    });
    if (!comp) newCompanies.push(c.id);
    rows.push(row);
  });
  var counts = { ems: r.data.length, held: prior.length, presenting: rows.filter(function(x) { return x.presentation_date; }).length,
    new_companies: newCompanies.length, without_market_cap: rows.filter(function(x) { return x.market_cap_usd == null; }).length };

  if (!opts.dryRun) {
    // Companies taking part that are not on the roster (not in good standing) get a row, off the roster
    var missing = rows.filter(function(x) { return !x.company_id; });
    for (var i = 0; i < missing.length; i += 50) {
      var batch = missing.slice(i, i + 50).map(function(x) {
        var o = {}; Object.keys(x).forEach(function(k) { if (['event_code', 'participation_status', 'presentation_type', 'presentation_date', 'presentation_time', 'presentation_location', 'webcast_url', 'company_id'].indexOf(k) === -1) o[k] = x[k]; });
        o.in_roster = false; return o;
      });
      var { data: made, error: cErr } = await sb.from('companies').insert(batch).select('id, ems_company_id');
      if (cErr) throw new Error('Create companies failed: ' + cErr.message);
      (made || []).forEach(function(m) { rows.forEach(function(x) { if (x.ems_company_id === m.ems_company_id) x.company_id = m.id; }); });
    }
    // Delete and replace, as an upload does
    var { error: dErr } = await sb.from('event_participations').delete().eq('event_code', code);
    if (dErr) throw new Error('Delete participations failed: ' + dErr.message);
    for (var j = 0; j < rows.length; j += 50) {
      var { error: iErr } = await sb.from('event_participations').insert(rows.slice(j, j + 50));
      if (iErr) throw new Error('Insert participations failed: ' + iErr.message);
    }
  }
  await log(sb, Object.assign({}, base, { status: opts.dryRun ? 'preview' : 'applied', counts: counts,
    message: (opts.dryRun ? 'Would replace ' : 'Replaced ') + code + ' with ' + rows.length + ' participating companies from EMS.' }));
  return Object.assign({ event_code: code, ems_id: evt.id, name: evt.name, registration_opens: evt.registration_opens, status: opts.dryRun ? 'preview' : 'applied' }, counts);
}

// The whole run. opts: { trigger: 'cron'|'admin', dryRun: bool }
async function run(opts) {
  var sb = db(), detail = detailFetcher(), out = { started: new Date().toISOString(), dry_run: !!opts.dryRun };
  try {
    out.roster = await syncRoster(sb, opts, detail);
  } catch (err) {
    console.warn('[ems-sync] roster failed: ' + err.message);
    out.roster = { status: 'failed', reason: err.message };
    await log(sb, { trigger: opts.trigger, dry_run: !!opts.dryRun, scope: 'roster', status: 'failed', message: err.message });
  }
  var events = await eventsToSync();
  if (!events) {
    out.events = { status: 'skipped', reason: 'EMS did not return the event list' };
    await log(sb, { trigger: opts.trigger, dry_run: !!opts.dryRun, scope: 'events', status: 'skipped', message: 'EMS did not return the event list.' });
  } else {
    out.events = [];
    for (var i = 0; i < events.length; i++) {
      try { out.events.push(await syncEvent(sb, events[i], opts, detail)); }
      catch (err) {
        console.warn('[ems-sync] ' + events[i].code + ' failed: ' + err.message);
        out.events.push({ event_code: events[i].code, status: 'failed', reason: err.message });
        await log(sb, { trigger: opts.trigger, dry_run: !!opts.dryRun, scope: 'event', event_code: events[i].code, status: 'failed', message: err.message });
      }
    }
    if (!events.length) await log(sb, { trigger: opts.trigger, dry_run: !!opts.dryRun, scope: 'events', status: 'none', message: 'No current or forthcoming event has opened registration.' });
  }
  out.finished = new Date().toISOString();
  console.log('[ems-sync] ' + JSON.stringify({ roster: out.roster && out.roster.status, events: Array.isArray(out.events) ? out.events.map(function(e) { return e.event_code + ':' + e.status; }) : out.events.status }));
  return out;
}

async function recentLog(limit) {
  var { data, error } = await db().from('ems_sync_log').select('*').order('run_at', { ascending: false }).limit(limit || 20);
  if (error) throw new Error(error.message);
  return data || [];
}

module.exports = { run: run, recentLog: recentLog, slot: slot, nameKey: nameKey, regionIndex: regionIndex };
