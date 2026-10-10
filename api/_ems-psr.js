// Live EMS reads for a Post Show Report, server side. Used only while a PSR is unlocked: locking stores the
// whole report as a snapshot (api/psr.js psr-lock), after which nothing here is called for it.
//
// What comes from EMS, for the report's own event only:
//   event dates and venue        GET /events/{id}
//   member data (composition)    GET /event-members?event_id=   (market cap: the stored row's, else EMS's current)
//   1x1 meetings                 GET /events/{id}/meetings      (formal = accepted, declined, per-kind averages;
//                                                                informal = DGG's estimate on the accepted total)
// Prior-year comparisons never come from live EMS: EMS lists only companies active today, so companies acquired
// since would vanish from past years and understate them. The prior year comes from its locked PSR snapshot, or
// from the stored rows. Each block falls back to the stored data when EMS cannot answer.
const EMS = require('./_ems');

const CACHE_MS = 10 * 60 * 1000;   // one EMS read serves every view of a report for ten minutes
var _cache = {};
function cached(key, fn) {
  var hit = _cache[key];
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.p;
  var p = fn();
  _cache[key] = { at: Date.now(), p: p };
  p.then(function(v) { if (v == null) delete _cache[key]; }, function() { delete _cache[key]; });
  return p;
}

function nameKey(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(corporation|corp|limited|ltd|inc|plc|company|co|the|sa|nv|ag|llc|lp)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

// The EMS answers this report needs, cached
async function emsFor(code) {
  return cached('psr:' + code, async function() {
    var evt = await EMS.eventByCode(code);
    if (!evt) return null;
    var parts = await Promise.all([
      EMS.ems('/events/' + evt.id),
      EMS.ems('/event-members', { event_id: evt.id }),
      EMS.ems('/events/' + evt.id + '/meetings')
    ]);
    return { id: evt.id, event: parts[0] && parts[0].data, members: parts[1] && Array.isArray(parts[1].data) ? parts[1].data : null, meetings: parts[2] && parts[2].data };
  });
}

// Upsert one metric into a psr_meetings-shaped list
function setMetric(rows, section, metric, cur, prior) {
  var hit = rows.filter(function(r) { return String(r.metric).toLowerCase() === metric.toLowerCase(); })[0];
  if (hit) {
    hit.value_current = cur != null ? String(cur) : hit.value_current;
    if (prior != null) hit.value_prior = String(prior);
    hit.source = 'ems';
  } else {
    rows.push({ section: section, metric: metric, value_current: cur != null ? String(cur) : '0', value_prior: prior != null ? String(prior) : '0', sort_order: 900 + rows.length, source: 'ems' });
  }
}

// The value_current of a metric in a list of psr_meetings rows
function metricValue(rows, metric) {
  var hit = (rows || []).filter(function(r) { return String(r.metric).toLowerCase() === metric.toLowerCase(); })[0];
  return hit && hit.value_current != null && hit.value_current !== '' ? Number(hit.value_current) : null;
}

/**
 * Apply EMS's live figures to a full-report payload in place.
 * ctx: { sb, eventCode, priorCode, informalFactor, priorSnapshot (the prior year's locked payload, or null),
 *        priorMeetings (the prior event's stored psr_meetings rows) }
 * Returns the sources map: which blocks came from EMS and which stayed stored.
 */
async function applyLive(payload, ctx) {
  var sources = { event: 'stored', composition: 'stored', meetings: 'stored', checked_at: new Date().toISOString() };
  var live;
  try { live = await emsFor(ctx.eventCode); } catch (err) { console.warn('[ems-psr] ' + ctx.eventCode + ': ' + err.message); live = null; }

  // Prior year: the prior PSR's locked snapshot when it has one, never live EMS
  if (ctx.priorSnapshot && ctx.priorSnapshot.composition && Array.isArray(ctx.priorSnapshot.composition.current)) {
    payload.composition.prior = ctx.priorSnapshot.composition.current;
    sources.prior = 'locked ' + ctx.priorCode;
  }
  if (!live) { sources.note = 'EMS did not answer; stored data shown.'; return sources; }
  sources.ems_event_id = live.id;

  // Event dates and venue
  var e = live.event;
  if (e && e.start_date) {
    payload.event.start_date = e.start_date;
    payload.event.end_date = e.end_date || payload.event.end_date;
    if (e.venue && e.venue.name) payload.event.venue = e.venue.name;
    sources.event = 'ems';
  }

  // Member data: the event's participating companies
  var stored = payload.composition.current || [];
  if (live.members && live.members.length && live.members.length >= stored.length * 0.5) {
    var byName = {};
    stored.forEach(function(r) { byName[nameKey(r.company_name)] = r; });
    var missing = live.members.filter(function(c) { var s = byName[nameKey(c.name)]; return !s || s.market_cap_usd == null; });
    // Companies with no stored market cap: EMS's current figure, the only one it has
    var details = {};
    await Promise.all(missing.slice(0, 60).map(function(c) {
      return cached('co:' + c.id, function() { return EMS.ems('/companies/' + c.id); }).then(function(r) { details[c.id] = r && r.data; });
    }));
    payload.composition.current = live.members.map(function(c) {
      var s = byName[nameKey(c.name)] || {};
      var d = details[c.id], stock = (d && d.stock) || {};
      return {
        event_code: ctx.eventCode,
        company_name: c.name,
        company_status: c.company_status || s.company_status || '',
        primary_mineral: c.primary_mineral || s.primary_mineral || '',
        primary_country: (c.country && c.country.name) || s.primary_country || '',
        market_cap_usd: s.market_cap_usd != null ? s.market_cap_usd : (stock.market_cap_usd != null ? stock.market_cap_usd : null)
      };
    });
    sources.composition = 'ems';
    sources.composition_counts = { ems: live.members.length, stored: stored.length };
  } else if (live.members) {
    sources.composition_note = 'EMS returned ' + live.members.length + ' companies against ' + stored.length + ' stored; stored list shown.';
  }

  // 1x1 meetings
  var m = live.meetings, t = m && m.totals;
  if (t && t.accepted != null) {
    var rows = payload.meetings = (payload.meetings || []).map(function(r) { return Object.assign({}, r); });
    // Prior-year value: this report's own stored prior, else the prior year's locked snapshot, else its stored rows
    var priorOf = function(metric) {
      var own = metricValue(rows.filter(function(r) { return String(r.metric).toLowerCase() === metric.toLowerCase(); }).map(function(r) { return { metric: r.metric, value_current: r.value_prior }; }), metric);
      if (own != null && own !== 0) return own;
      var snap = ctx.priorSnapshot && ctx.priorSnapshot.meetings ? metricValue(ctx.priorSnapshot.meetings, metric) : null;
      return snap != null ? snap : metricValue(ctx.priorMeetings, metric);
    };
    setMetric(rows, 'status', 'Formal meetings', t.accepted, priorOf('Formal meetings'));
    if (ctx.informalFactor > 1) setMetric(rows, 'status', 'Informal meetings (est.)', Math.round(t.accepted * (ctx.informalFactor - 1)), priorOf('Informal meetings (est.)'));
    if (t.declined != null) setMetric(rows, 'status', 'Declined', t.declined, priorOf('Declined'));
    var groups = m.groups || {};
    Object.keys(groups).forEach(function(k) {
      var g = groups[k] || {};
      if (g.average == null) return;
      if (/member/.test(k)) setMetric(rows, 'mean', 'Average member meetings', Math.round(g.average * 10) / 10, priorOf('Average member meetings'));
      else if (/participant|investor/.test(k)) setMetric(rows, 'mean', 'Average participant meetings', Math.round(g.average * 10) / 10, priorOf('Average participant meetings'));
    });
    sources.meetings = 'ems';
  }
  return sources;
}

module.exports = { applyLive: applyLive };
