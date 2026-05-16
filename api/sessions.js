// POST /api/sessions — Session allocation CRUD + auto-generate
// GET  /api/sessions — Fetch config/schedule/stats
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ljyogcspkvqgjbiyzfbn.supabase.co';

function getSupabase() {
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return createClient(SUPABASE_URL, key);
}

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  var token = authHeader.replace('Bearer ', '');
  var parts = token.split('.');
  if (parts.length !== 3) return false;
  var tokenBytes = parts[0], timestamp = parts[1], providedSignature = parts[2];
  if (!process.env.ADMIN_PASSWORD || !process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  var secret = process.env.ADMIN_PASSWORD + process.env.SUPABASE_SERVICE_ROLE_KEY;
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

// ---- Helpers ----

function timeToMinutes(t) {
  var parts = (t || '08:00').split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10);
}

function calcTotalSlots(cfg) {
  var morningMin = timeToMinutes(cfg.lunch_start_time) - timeToMinutes(cfg.day_start_time);
  var afternoonMin = timeToMinutes(cfg.day_end_time) - timeToMinutes(cfg.lunch_end_time);
  var dur = cfg.presentation_duration_min || 25;
  var morningSlotsPerTrack = Math.floor(morningMin / dur);
  var afternoonSlotsPerTrack = Math.floor(afternoonMin / dur);
  var startDate = new Date(cfg.event_start_date);
  var endDate = new Date(cfg.event_end_date);
  var days = Math.max(1, Math.round((endDate - startDate) / 86400000) + 1);
  var morningTracks = cfg.morning_tracks || 3;
  var afternoonTracks = cfg.afternoon_tracks || 3;
  return {
    days: days,
    morningSlotsPerTrack: morningSlotsPerTrack,
    afternoonSlotsPerTrack: afternoonSlotsPerTrack,
    morningTracks: morningTracks,
    afternoonTracks: afternoonTracks,
    totalSlotsPerDay: (morningSlotsPerTrack * morningTracks) + (afternoonSlotsPerTrack * afternoonTracks),
    totalSlots: ((morningSlotsPerTrack * morningTracks) + (afternoonSlotsPerTrack * afternoonTracks)) * days
  };
}

function median(arr) {
  if (!arr.length) return 0;
  var s = arr.slice().sort(function(a, b) { return a - b; });
  var mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function isProducer(status) {
  return /producer/i.test(status || '');
}

// ---- Session split: find best combo of 6-slot and 7-slot sessions ----

function bestSessionSplit(totalSlots) {
  if (totalSlots < 6) return { s6: 0, s7: 0, used: 0, waste: totalSlots };
  // Try exact fits first (most sessions of 7, then fewer)
  for (var s7 = Math.floor(totalSlots / 7); s7 >= 0; s7--) {
    var rem = totalSlots - s7 * 7;
    if (rem >= 0 && rem % 6 === 0) {
      return { s6: rem / 6, s7: s7, used: totalSlots, waste: 0 };
    }
  }
  // No exact fit — find minimum waste
  var bestWaste = totalSlots;
  var best = { s6: 0, s7: 0, used: 0, waste: totalSlots };
  for (var s7 = Math.floor(totalSlots / 7); s7 >= 0; s7--) {
    var rem = totalSlots - s7 * 7;
    var s6 = Math.floor(rem / 6);
    var used = s7 * 7 + s6 * 6;
    var waste = totalSlots - used;
    if (waste < bestWaste || (waste === bestWaste && (s7 + s6) > (best.s7 + best.s6))) {
      bestWaste = waste;
      best = { s6: s6, s7: s7, used: used, waste: waste };
    }
  }
  return best;
}

// ---- Build Program: create empty session containers from config ----

function buildProgramSessions(cfg) {
  var dur = cfg.presentation_duration_min || 25;
  var dayOverrides = cfg.day_overrides || {};

  var startDate = new Date(cfg.event_start_date);
  var endDate = new Date(cfg.event_end_date);
  var totalDays = Math.max(1, Math.round((endDate - startDate) / 86400000) + 1);
  var morningTracks = cfg.morning_tracks || 3;
  var afternoonTracks = cfg.afternoon_tracks || 3;
  var maxTracks = Math.max(morningTracks, afternoonTracks);

  var sessions = [];

  var globalSessionNum = 1;
  // Priority: left null — admin must assign manually before generating schedule
  for (var d = 0; d < totalDays; d++) {
    var dayLabel = 'Day ' + (d + 1);
    var sessionDate = new Date(startDate);
    sessionDate.setDate(sessionDate.getDate() + d);
    var dateStr = sessionDate.toISOString().split('T')[0];

    // Per-day time overrides (fall back to global config)
    var ov = dayOverrides[dayLabel] || {};
    var dayStartTime = ov.day_start_time || cfg.day_start_time || '08:00';
    var dayEndTime = ov.day_end_time || cfg.day_end_time || '17:30';
    var dayLunchStart = ov.lunch_start_time || cfg.lunch_start_time || '12:00';
    var dayLunchEnd = ov.lunch_end_time || cfg.lunch_end_time || '13:30';

    var morningMin = timeToMinutes(dayLunchStart) - timeToMinutes(dayStartTime);
    var afternoonMin = timeToMinutes(dayEndTime) - timeToMinutes(dayLunchEnd);
    var morningSlotsPerTrack = Math.max(0, Math.floor(morningMin / dur));
    // Skip afternoon if day ends at or before lunch
    var afternoonSlotsPerTrack = afternoonMin > 0 ? Math.floor(afternoonMin / dur) : 0;

    for (var t = 1; t <= maxTracks; t++) {
      // session_number is globally unique across the event

      // Morning sessions for this track
      if (t <= morningTracks && morningSlotsPerTrack >= 6) {
        var split = bestSessionSplit(morningSlotsPerTrack);
        var currentTime = timeToMinutes(dayStartTime);

        for (var i = 0; i < split.s7; i++) {
          sessions.push({
            event_code: cfg.event_code,
            priority: null,
            session_number: globalSessionNum++,
            stage: 'Stage ' + t,
            day: dayLabel,
            session_date: dateStr,
            time_block: 'morning',
            start_time: minutesToTime(currentTime),
            session_theme: '',
            max_slots: 7
          });
          currentTime += 7 * dur;
        }
        for (var i = 0; i < split.s6; i++) {
          sessions.push({
            event_code: cfg.event_code,
            priority: null,
            session_number: globalSessionNum++,
            stage: 'Stage ' + t,
            day: dayLabel,
            session_date: dateStr,
            time_block: 'morning',
            start_time: minutesToTime(currentTime),
            session_theme: '',
            max_slots: 6
          });
          currentTime += 6 * dur;
        }
      }

      // Afternoon sessions for this track
      if (t <= afternoonTracks && afternoonSlotsPerTrack >= 6) {
        var split = bestSessionSplit(afternoonSlotsPerTrack);
        var currentTime = timeToMinutes(dayLunchEnd);

        for (var i = 0; i < split.s7; i++) {
          sessions.push({
            event_code: cfg.event_code,
            priority: null,
            session_number: globalSessionNum++,
            stage: 'Stage ' + t,
            day: dayLabel,
            session_date: dateStr,
            time_block: 'afternoon',
            start_time: minutesToTime(currentTime),
            session_theme: '',
            max_slots: 7
          });
          currentTime += 7 * dur;
        }
        for (var i = 0; i < split.s6; i++) {
          sessions.push({
            event_code: cfg.event_code,
            priority: null,
            session_number: globalSessionNum++,
            stage: 'Stage ' + t,
            day: dayLabel,
            session_date: dateStr,
            time_block: 'afternoon',
            start_time: minutesToTime(currentTime),
            session_theme: '',
            max_slots: 6
          });
          currentTime += 6 * dur;
        }
      }
    }
  }

  return sessions;
}

function minutesToTime(m) {
  var h = Math.floor(m / 60);
  var min = m % 60;
  return (h < 10 ? '0' : '') + h + ':' + (min < 10 ? '0' : '') + min;
}

// ---- Fill sessions with companies (uses existing session_definitions) ----
// EVERY company must be placed. EVERY slot must be filled (up to company count).
// Sessions filled in PRIORITY ORDER: P1 gets highest-mcap companies, P2 next, etc.
// Within each mcap band, companies are clustered thematically using a similarity score:
//   Mineral 25%, Country 25%, Market Cap (tier) 25%, Status 25%.
// Approach: mcap-sorted pool + greedy nearest-neighbor within a lookahead window.

function fillSessions(companies, sessionDefs) {
  companies.sort(function(a, b) { return (b.market_cap_usd || 0) - (a.market_cap_usd || 0); });

  var caps = companies.map(function(c) { return c.market_cap_usd || 0; });
  var sum = caps.reduce(function(a, b) { return a + b; }, 0);
  var mean = sum / (caps.length || 1);
  var med = median(caps);

  companies.forEach(function(c) {
    var cap = c.market_cap_usd || 0;
    c._tier = cap >= mean ? 'AboveMean' : (cap >= med ? 'AboveMedian' : 'BelowMedian');
    c._geo = c.primary_country || c.primary_subregion || c.primary_region || '';
    c._status = (c.company_status || '').replace(/\s*\(.*\)/, '').trim();
  });

  var orderedDefs = sessionDefs.slice().sort(function(a, b) { return (a.priority || 0) - (b.priority || 0); });
  var totalSlots = orderedDefs.reduce(function(s, d) { return s + (d.max_slots || 6); }, 0);
  var totalCompanyCount = companies.length;

  // ==============================================================
  // Mineral affinity groups: minerals in the same group get partial
  // similarity credit (15/25) even when not an exact match.
  // Precious metals cluster together; base/energy metals cluster together.
  // ==============================================================
  var MINERAL_GROUPS = {
    'Gold': 'precious', 'Silver': 'precious', 'PGMs': 'precious', 'PGM': 'precious',
    'Copper': 'base_energy', 'Uranium': 'base_energy', 'Lithium': 'base_energy',
    'Nickel': 'base_energy', 'Zinc': 'base_energy', 'Iron Ore': 'base_energy',
    'Cobalt': 'base_energy', 'Tin': 'base_energy', 'Manganese': 'base_energy',
    'Rare Earths': 'base_energy', 'Potash': 'base_energy'
  };

  function mineralAffinity(mA, mB) {
    if (!mA || !mB) return 0;
    if (mA === mB) return 25;
    var gA = MINERAL_GROUPS[mA] || 'other_' + mA;
    var gB = MINERAL_GROUPS[mB] || 'other_' + mB;
    if (gA === gB) return 15; // same group but different mineral
    return 0;
  }

  // ==============================================================
  // Similarity score between two companies (0-100).
  // Equal weights: Mineral 25, Country 25, Status 25, Tier 25.
  // ==============================================================
  function similarity(a, b) {
    var score = 0;
    score += mineralAffinity(a.primary_mineral || 'Other', b.primary_mineral || 'Other');
    if (a._geo && a._geo === b._geo) score += 25;
    if (a._status && a._status === b._status) score += 25;
    if (a._tier === b._tier) score += 25;
    else if ((a._tier === 'AboveMean' && b._tier === 'AboveMedian') || (a._tier === 'AboveMedian' && b._tier === 'AboveMean') ||
             (a._tier === 'AboveMedian' && b._tier === 'BelowMedian') || (a._tier === 'BelowMedian' && b._tier === 'AboveMedian')) score += 10;
    return score;
  }

  function groupScore(candidate, group) {
    if (group.length === 0) return 0;
    var total = 0;
    for (var gi = 0; gi < group.length; gi++) total += similarity(candidate, group[gi]);
    return total / group.length;
  }

  // ==============================================================
  // Pool: all companies sorted by mcap desc.
  // For each session (in priority order), we look at a WINDOW of
  // the next N candidates from the pool. The first pick is always
  // the highest-mcap remaining (the "anchor"). Then we greedily
  // pick the most similar company from the window to build the session.
  // WINDOW_MULTIPLIER controls flexibility vs mcap strictness.
  // ==============================================================
  var pool = companies.slice(); // mcap desc
  var WINDOW_MULTIPLIER = 3;    // look ahead 3x session size
  var results = [];

  for (var si = 0; si < orderedDefs.length; si++) {
    var def = orderedDefs[si];
    var maxSlots = def.max_slots || 6;
    var sessionCompanies = [];

    if (pool.length === 0) {
      results.push({ def: def, theme: '', companies: [] });
      continue;
    }

    // Anchor: highest-mcap company remaining (always position 0 in pool)
    var anchor = pool.splice(0, 1)[0];
    sessionCompanies.push(anchor);

    // Window: the next candidates we're allowed to pick from
    var windowSize = Math.min(maxSlots * WINDOW_MULTIPLIER, pool.length);

    // Greedily fill remaining slots from the window
    while (sessionCompanies.length < maxSlots && pool.length > 0) {
      windowSize = Math.min(maxSlots * WINDOW_MULTIPLIER, pool.length);
      if (windowSize === 0) break;

      // Score each candidate in the window against the session so far
      var bestIdx = -1;
      var bestScore = -1;
      for (var wi = 0; wi < windowSize; wi++) {
        var sc = groupScore(pool[wi], sessionCompanies);
        // Slight mcap bonus for candidates near the top of the window
        // so we don't reach too far down for a thematic match
        var positionBonus = (1 - wi / windowSize) * 5;
        var total = sc + positionBonus;
        if (total > bestScore) { bestScore = total; bestIdx = wi; }
      }

      if (bestIdx < 0) break;
      sessionCompanies.push(pool.splice(bestIdx, 1)[0]);
    }

    results.push({ def: def, theme: '', companies: sessionCompanies });
  }

  // Safety: any remaining pool companies into partially-filled sessions
  for (var oi = 0; oi < results.length && pool.length > 0; oi++) {
    var mx = results[oi].def.max_slots || 6;
    while (results[oi].companies.length < mx && pool.length > 0) {
      results[oi].companies.push(pool.shift());
    }
  }

  // ==============================================================
  // Auto-generate descriptive themes from actual session contents
  // ==============================================================
  function topBy(arr, fn) {
    var counts = {};
    arr.forEach(function(c) { var v = fn(c); counts[v] = (counts[v] || 0) + 1; });
    var keys = Object.keys(counts);
    var top = keys[0], topN = counts[keys[0]];
    for (var i = 1; i < keys.length; i++) {
      if (counts[keys[i]] > topN) { top = keys[i]; topN = counts[keys[i]]; }
    }
    return { value: top, count: topN, total: arr.length, keys: keys };
  }

  var isSpecialStatus = function(s) { return /royalty|bullion|streaming/i.test(s || ''); };

  results.forEach(function(r) {
    if (r.companies.length === 0) { r.theme = ''; return; }
    var n = r.companies.length;
    var parts = [];

    var st = topBy(r.companies, function(c) { return c._status || ''; });
    var mn = topBy(r.companies, function(c) { return c.primary_mineral || 'Other'; });
    var ge = topBy(r.companies, function(c) { return c._geo || 'Global'; });
    var ti = topBy(r.companies, function(c) { return c._tier; });

    // Status label if >=50% same (or special status like Royalty)
    if (st.count >= n * 0.5 && st.value) {
      var sLabel = st.value;
      if (isSpecialStatus(sLabel)) {
        // Keep as-is for Royalty/Streaming/Bullion
      } else if (/er$/i.test(sLabel)) {
        sLabel += 's';
      }
      parts.push(sLabel);
    }

    // Geography label if >=50% same country
    if (ge.count >= n * 0.5 && ge.value && ge.value !== 'Global') {
      parts.push(ge.value);
    }

    // Mineral label — check if all minerals are in the same affinity group
    if (mn.count >= n * 0.5) {
      parts.push(mn.value);
    } else if (mn.keys.length === 2) {
      parts.push(mn.keys.join(' & '));
    } else {
      // Check if all minerals share an affinity group
      var groupCounts = {};
      r.companies.forEach(function(c) {
        var g = MINERAL_GROUPS[c.primary_mineral || 'Other'] || 'other';
        groupCounts[g] = (groupCounts[g] || 0) + 1;
      });
      var groupKeys = Object.keys(groupCounts);
      if (groupKeys.length === 1 && groupKeys[0] === 'precious') {
        parts.push('Precious Metals');
      } else if (groupKeys.length === 1 && groupKeys[0] === 'base_energy') {
        parts.push('Base & Energy Metals');
      } else {
        parts.push('Multi-Commodity');
      }
    }

    // Tier label
    if (ti.value === 'AboveMean' && ti.count >= n * 0.5) parts.push('Large Cap');
    else if (ti.value === 'BelowMedian' && ti.count >= n * 0.5) parts.push('Small Cap');

    r.theme = parts.join(' \u2014 ');
  });

  // ==============================================================
  // Convert to slot rows.
  // Sessions that open a day's track (first morning session per stage per day)
  // are sorted ASCENDING by mcap (smaller to larger — build to a crescendo).
  // All other sessions: producers first, then by mcap descending.
  // ==============================================================

  // Build a set of session IDs that are "day openers" — the first morning
  // session for each (stage, day) combination, identified by earliest start_time.
  var dayOpenerIds = {};
  var stageDayMap = {};
  orderedDefs.forEach(function(d) {
    var key = (d.stage || '') + '|' + (d.day || '');
    if (d.time_block === 'morning' || !d.time_block) {
      if (!stageDayMap[key] || (d.start_time || '99:99') < stageDayMap[key].start_time) {
        stageDayMap[key] = { id: d.id, start_time: d.start_time || '08:00' };
      }
    }
  });
  Object.keys(stageDayMap).forEach(function(k) { dayOpenerIds[stageDayMap[k].id] = true; });

  var finalResults = results.map(function(r) {
    var isDayOpener = dayOpenerIds[r.def.id];

    if (isDayOpener) {
      // Day opener: ascending mcap (smallest first, build to largest)
      r.companies.sort(function(a, b) { return (a.market_cap_usd || 0) - (b.market_cap_usd || 0); });
      var ordered = r.companies;
    } else {
      // Normal: producers first, then non-producers; within each group by mcap desc
      var producers = r.companies.filter(function(c) { return isProducer(c.company_status); });
      var nonProducers = r.companies.filter(function(c) { return !isProducer(c.company_status); });
      producers.sort(function(a, b) { return (b.market_cap_usd || 0) - (a.market_cap_usd || 0); });
      nonProducers.sort(function(a, b) { return (b.market_cap_usd || 0) - (a.market_cap_usd || 0); });
      var ordered = producers.concat(nonProducers);
    }

    return {
      def: r.def,
      theme: r.theme,
      slots: ordered.map(function(c, idx) {
        return {
          session_definition_id: r.def.id,
          slot_in_session: idx + 1,
          company_name: c.company_name,
          company_status: c.company_status || '',
          primary_mineral: c.primary_mineral || '',
          geography: c.primary_subregion || c.primary_region || c.primary_country || '',
          market_cap_usd: c.market_cap_usd || 0,
          mcap_tier: c._tier,
          payment_status: c.payment_status || ''
        };
      })
    };
  });

  var totalPlaced = finalResults.reduce(function(s, r) { return s + r.slots.length; }, 0);

  return {
    results: finalResults,
    stats: {
      totalSessions: orderedDefs.length,
      totalFilled: finalResults.filter(function(r) { return r.slots.length > 0; }).length,
      totalPlaced: totalPlaced,
      totalCompanies: totalCompanyCount,
      totalSlots: totalSlots,
      overflow: Math.max(0, totalCompanyCount - totalSlots),
      emptySlots: Math.max(0, totalSlots - totalPlaced),
      mean: Math.round(mean * 100) / 100,
      median: Math.round(med * 100) / 100
    }
  };
}

// ---- Handler ----

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://analytics.miningforum.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!verifyToken(req.headers.authorization)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  var sb = getSupabase();

  // ---- GET ----
  if (req.method === 'GET') {
    var action = req.query.action;
    var eventCode = req.query.event_code;

    if (action === 'config') {
      var { data, error } = await sb.from('session_configs').select('*').eq('event_code', eventCode).single();
      if (error && error.code !== 'PGRST116') return res.status(500).json({ ok: false, error: error.message });
      return res.status(200).json({ ok: true, config: data || null });
    }

    if (action === 'schedule') {
      var { data: defs, error: defErr } = await sb
        .from('session_definitions')
        .select('*')
        .eq('event_code', eventCode)
        .order('priority', { ascending: true });
      if (defErr) return res.status(500).json({ ok: false, error: defErr.message });

      if (!defs || defs.length === 0) {
        return res.status(200).json({ ok: true, sessions: [], stats: { totalSessions: 0, totalPlaced: 0, totalFilled: 0 } });
      }

      var defIds = defs.map(function(d) { return d.id; });
      var { data: slots, error: slotErr } = await sb
        .from('session_slots')
        .select('*')
        .in('session_definition_id', defIds)
        .order('slot_in_session', { ascending: true });
      if (slotErr) return res.status(500).json({ ok: false, error: slotErr.message });

      var slotMap = {};
      (slots || []).forEach(function(s) {
        if (!slotMap[s.session_definition_id]) slotMap[s.session_definition_id] = [];
        slotMap[s.session_definition_id].push(s);
      });

      var sessions = defs.map(function(d) {
        d.slots = slotMap[d.id] || [];
        return d;
      });

      var filledCount = sessions.filter(function(s) { return s.slots.length > 0; }).length;

      // Compute unallocated companies
      var unallocated = [];
      var { data: cfgSch } = await sb.from('session_configs').select('presenting_companies').eq('event_code', eventCode).single();
      var allCompanies = (cfgSch && cfgSch.presenting_companies) || [];
      if (allCompanies.length > 0) {
        var placedNames = {};
        (slots || []).forEach(function(s) { placedNames[s.company_name] = true; });
        unallocated = allCompanies.filter(function(c) { return !placedNames[c.company_name]; });
      }

      // Cross-reference event_participations for programmed status (has presentation_date)
      var programmedMap = {};
      var { data: epRows } = await sb.from('event_participations')
        .select('company_name, presentation_date')
        .eq('event_code', eventCode);
      (epRows || []).forEach(function(ep) {
        programmedMap[ep.company_name] = ep.presentation_date != null;
      });

      // Tag slots with programmed flag
      sessions.forEach(function(s) {
        (s.slots || []).forEach(function(sl) {
          sl.programmed = !!programmedMap[sl.company_name];
        });
      });
      // Tag unallocated companies
      unallocated.forEach(function(c) {
        c.programmed = !!programmedMap[c.company_name];
      });

      var programmedCount = 0;
      var unprogrammedCount = 0;
      (slots || []).forEach(function(s) { if (programmedMap[s.company_name]) programmedCount++; else unprogrammedCount++; });
      unallocated.forEach(function(c) { if (programmedMap[c.company_name]) programmedCount++; else unprogrammedCount++; });

      return res.status(200).json({
        ok: true,
        sessions: sessions,
        unallocated: unallocated,
        stats: {
          totalSessions: sessions.length,
          totalPlaced: (slots || []).length,
          totalFilled: filledCount,
          totalCompanies: allCompanies.length,
          totalUnallocated: unallocated.length,
          programmedCount: programmedCount,
          unprogrammedCount: unprogrammedCount
        }
      });
    }

    if (action === 'companies') {
      var { data: cfgCo } = await sb.from('session_configs').select('presenting_companies').eq('event_code', eventCode).single();
      var companies = (cfgCo && cfgCo.presenting_companies) || [];
      // Tag with programmed status
      var { data: epCo } = await sb.from('event_participations')
        .select('company_name, presentation_date')
        .eq('event_code', eventCode);
      var progMap = {};
      (epCo || []).forEach(function(ep) { progMap[ep.company_name] = ep.presentation_date != null; });
      companies.forEach(function(c) { c.programmed = !!progMap[c.company_name]; });
      return res.status(200).json({ ok: true, count: companies.length, companies: companies });
    }

    if (action === 'slot-info') {
      var { data: cfgData } = await sb.from('session_configs').select('*').eq('event_code', eventCode).single();
      if (!cfgData) return res.status(200).json({ ok: true, slotInfo: null });
      return res.status(200).json({ ok: true, slotInfo: calcTotalSlots(cfgData) });
    }

    // Holding bucket: companies removed from sessions, stored in session_configs.holding_bucket JSONB
    if (action === 'holding') {
      var { data: hCfg } = await sb.from('session_configs').select('holding_bucket').eq('event_code', eventCode).single();
      var bucket = (hCfg && hCfg.holding_bucket) || [];
      return res.status(200).json({ ok: true, holding: bucket });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  }

  // ---- POST ----
  if (req.method === 'POST') {
    try {
      var body = req.body || {};
      var action = body.action;
      var eventCode = body.event_code;

      if (action === 'save-config') {
        var configRow = {
          event_code: eventCode,
          event_start_date: body.event_start_date,
          event_end_date: body.event_end_date,
          day_start_time: body.day_start_time || '08:00',
          day_end_time: body.day_end_time || '17:30',
          presentation_duration_min: parseInt(body.presentation_duration_min) || 25,
          morning_tracks: parseInt(body.morning_tracks) || 3,
          afternoon_tracks: parseInt(body.afternoon_tracks) || 3,
          lunch_start_time: body.lunch_start_time || '12:00',
          lunch_end_time: body.lunch_end_time || '13:30',
          updated_at: new Date().toISOString()
        };

        var { data, error } = await sb
          .from('session_configs')
          .upsert(configRow, { onConflict: 'event_code' })
          .select()
          .single();
        if (error) throw new Error('Save config failed: ' + error.message);

        var slotInfo = calcTotalSlots(data);
        return res.status(200).json({ ok: true, config: data, slotInfo: slotInfo });
      }

      // ---- SAVE DAY TIMES: update per-day start/end overrides ----
      if (action === 'save-day-times') {
        var dayLabel = body.day; // e.g. "Day 1"
        var dayTimes = body.times; // { day_start_time, day_end_time, lunch_start_time, lunch_end_time }
        if (!dayLabel || !dayTimes) {
          return res.status(400).json({ ok: false, error: 'Missing day or times' });
        }

        // Fetch current config
        var { data: curCfg, error: cfgErr } = await sb.from('session_configs').select('day_overrides').eq('event_code', eventCode).single();
        if (cfgErr && cfgErr.code !== 'PGRST116') throw new Error('Fetch config failed: ' + cfgErr.message);

        var overrides = (curCfg && curCfg.day_overrides) || {};
        overrides[dayLabel] = dayTimes;

        var { error: upErr } = await sb
          .from('session_configs')
          .update({ day_overrides: overrides, updated_at: new Date().toISOString() })
          .eq('event_code', eventCode);
        if (upErr) throw new Error('Save day times failed: ' + upErr.message);

        return res.status(200).json({ ok: true, message: dayLabel + ' times saved. Rebuild program to apply changes.' });
      }

      if (action === 'import-companies') {
        var companies = body.companies;
        if (!companies || !Array.isArray(companies) || companies.length === 0) {
          return res.status(400).json({ ok: false, error: 'No companies to import' });
        }

        var normalized = companies.map(function(c) {
          var rawMcap = c.MarketCapUSDActual || c.market_cap_usd_actual || c.market_cap_usd || c.MarketCapUSD_B || c.mcap || 0;
          var mcapNum = parseFloat(String(rawMcap).replace(/[$,\sB]/g, '')) || 0;
          if (mcapNum > 1000) mcapNum = mcapNum / 1000000000;

          return {
            company_name: c.CompanyNameForPublication || c.company_name_for_publication || c.company_name || c.CompanyName || c.company || c.name || '',
            company_status: c.CompanyStatus || c.company_status || c.status || '',
            primary_mineral: c.PrimaryMineral || c.primary_mineral || c.mineral || '',
            primary_country: c.PrimaryCountryOfOperation || c.primary_country_of_operation || c.PrimaryCountry || c.primary_country || c.country || '',
            primary_region: c.PrimaryRegionOfOperation || c.primary_region_of_operation || c.PrimaryRegion || c.primary_region || c.region || '',
            primary_subregion: c.PrimarySubregionOfOperation || c.primary_subregion_of_operation || c.PrimarySubregion || c.primary_subregion || c.Geography || c.geography || '',
            market_cap_usd: Math.round(mcapNum * 100) / 100,
            production_low: parseFloat(c.ProductionLow || c.production_low || 0) || 0,
            production_high: parseFloat(c.ProductionHigh || c.production_high || 0) || 0,
            reserves: parseFloat(c.Reserves || c.reserves || 0) || 0,
            resources: parseFloat(c.Resources || c.resources || 0) || 0,
            presentation_type: c.PresentationType || c.presentation_type || c.pres_type || 'Corporate',
            payment_status: c.PaymentStatus || c.payment_status || c.Payment || c.payment || ''
          };
        }).filter(function(c) { return c.company_name; });

        var { error: upsErr } = await sb
          .from('session_configs')
          .upsert({ event_code: eventCode, presenting_companies: normalized, updated_at: new Date().toISOString() }, { onConflict: 'event_code' });
        if (upsErr) throw new Error('Save companies failed: ' + upsErr.message);

        return res.status(200).json({
          ok: true,
          message: 'Imported ' + normalized.length + ' presenting companies for ' + eventCode + '.',
          count: normalized.length
        });
      }

      // ---- BUILD PROGRAM: create empty session containers from config ----
      if (action === 'build-program') {
        var { data: cfg } = await sb.from('session_configs').select('*').eq('event_code', eventCode).single();
        if (!cfg) return res.status(400).json({ ok: false, error: 'No config saved for ' + eventCode + '. Save config first.' });

        cfg.event_code = eventCode;
        var sessions = buildProgramSessions(cfg);

        if (sessions.length === 0) {
          return res.status(400).json({ ok: false, error: 'Config produces zero sessions. Check event dates and times.' });
        }

        // Fetch existing sessions to preserve priorities and themes
        var { data: existing } = await sb.from('session_definitions').select('*').eq('event_code', eventCode);
        var priorMap = {};
        (existing || []).forEach(function(e) {
          // Key by stage + day + time_block + start_time for precise matching across rebuilds
          var key = e.stage + '|' + e.day + '|' + (e.time_block || '') + '|' + (e.start_time || '');
          priorMap[key] = { priority: e.priority, session_theme: e.session_theme };
        });

        // Carry over saved priorities and themes to new sessions
        var preserved = 0;
        sessions.forEach(function(s) {
          var key = s.stage + '|' + s.day + '|' + (s.time_block || '') + '|' + (s.start_time || '');
          if (priorMap[key]) {
            if (priorMap[key].priority != null) { s.priority = priorMap[key].priority; preserved++; }
            if (priorMap[key].session_theme) s.session_theme = priorMap[key].session_theme;
          }
        });

        // Clear existing session definitions (cascade deletes slots)
        var { error: delErr } = await sb.from('session_definitions').delete().eq('event_code', eventCode);
        if (delErr) throw new Error('Clear sessions failed: ' + delErr.message);

        // Insert session definitions
        var { data: inserted, error: insErr } = await sb
          .from('session_definitions')
          .insert(sessions)
          .select();
        if (insErr) throw new Error('Insert sessions failed: ' + insErr.message);

        var totalSlots = sessions.reduce(function(s, sess) { return s + sess.max_slots; }, 0);
        var preserveNote = preserved > 0 ? ' (' + preserved + ' priorities preserved)' : '';

        return res.status(200).json({
          ok: true,
          message: 'Built program: ' + sessions.length + ' sessions (' + totalSlots + ' total slots) across ' + calcTotalSlots(cfg).days + ' days.' + preserveNote,
          sessions: inserted.length,
          totalSlots: totalSlots
        });
      }

      // ---- UPDATE PRIORITY: hard save, soft warning on duplicate ----
      if (action === 'update-priority') {
        var sessionId = body.session_id;
        var newPriority = parseInt(body.priority);

        if (!sessionId || isNaN(newPriority) || newPriority < 1) {
          return res.status(400).json({ ok: false, error: 'Invalid session_id or priority' });
        }

        // Get the session to know its event_code
        var { data: sess } = await sb.from('session_definitions').select('id, event_code, priority').eq('id', sessionId).single();
        if (!sess) return res.status(404).json({ ok: false, error: 'Session not found' });

        // Always save the priority
        var { error: upErr } = await sb
          .from('session_definitions')
          .update({ priority: newPriority, updated_at: new Date().toISOString() })
          .eq('id', sessionId);
        if (upErr) throw new Error('Update priority failed: ' + upErr.message);

        // Check for duplicates after saving — soft warning
        var { data: dups } = await sb
          .from('session_definitions')
          .select('id, stage, day, session_number')
          .eq('event_code', sess.event_code)
          .eq('priority', newPriority)
          .neq('id', sessionId);

        var warning = null;
        if (dups && dups.length > 0) {
          var dupLabels = dups.map(function(d) { return d.stage + ' ' + d.day + ' S' + d.session_number; }).join(', ');
          warning = 'Warning: P' + newPriority + ' is also assigned to ' + dupLabels + '. Duplicate priorities will cause unpredictable fill order.';
        }

        return res.status(200).json({ ok: true, message: 'Priority P' + newPriority + ' saved.', warning: warning });
      }

      // ---- SWAP PRIORITIES: swap two sessions' priorities ----
      if (action === 'swap-priorities') {
        var sessionIdA = body.session_id_a;
        var sessionIdB = body.session_id_b;

        var { data: a } = await sb.from('session_definitions').select('id, priority').eq('id', sessionIdA).single();
        var { data: b } = await sb.from('session_definitions').select('id, priority').eq('id', sessionIdB).single();
        if (!a || !b) return res.status(404).json({ ok: false, error: 'One or both sessions not found' });

        // Swap
        var { error: e1 } = await sb.from('session_definitions').update({ priority: b.priority, updated_at: new Date().toISOString() }).eq('id', a.id);
        if (e1) throw new Error('Swap failed: ' + e1.message);
        var { error: e2 } = await sb.from('session_definitions').update({ priority: a.priority, updated_at: new Date().toISOString() }).eq('id', b.id);
        if (e2) throw new Error('Swap failed: ' + e2.message);

        return res.status(200).json({ ok: true, message: 'Swapped P' + a.priority + ' and P' + b.priority });
      }

      // ---- GENERATE: fill companies into existing program sessions ----
      if (action === 'generate') {
        var { data: cfg } = await sb.from('session_configs').select('*').eq('event_code', eventCode).single();
        if (!cfg) return res.status(400).json({ ok: false, error: 'No config saved for ' + eventCode + '. Save config first.' });

        // Check if program has been built
        var { data: defs, error: defErr } = await sb
          .from('session_definitions')
          .select('*')
          .eq('event_code', eventCode)
          .order('priority', { ascending: true });
        if (defErr) throw new Error('Fetch sessions failed: ' + defErr.message);

        // Get presenting companies
        var parts = null;
        if (cfg.presenting_companies && cfg.presenting_companies.length > 0) {
          parts = cfg.presenting_companies;
        } else {
          var { data: epParts, error: partErr } = await sb
            .from('event_participations')
            .select('*')
            .eq('event_code', eventCode)
            .not('presentation_type', 'is', null)
            .not('presentation_type', 'eq', '')
            .order('market_cap_usd', { ascending: false, nullsFirst: false });
          if (partErr) throw new Error('Fetch participations failed: ' + partErr.message);
          parts = epParts;
        }

        if (!parts || parts.length === 0) {
          return res.status(400).json({ ok: false, error: 'No presenting companies found for ' + eventCode + '. Upload a companies list first.' });
        }

        // Program must exist — Build Program first
        if (!defs || defs.length === 0) {
          return res.status(400).json({ ok: false, error: 'No program built for ' + eventCode + '. Click Build Program first to create session containers, then Generate Schedule to fill them.' });
        }

        // All sessions must have priorities assigned
        var unassigned = defs.filter(function(d) { return d.priority === null || d.priority === undefined; });
        if (unassigned.length > 0) {
          var labels = unassigned.map(function(d) { return d.stage + ' ' + d.day + ' S' + d.session_number; }).join(', ');
          return res.status(400).json({ ok: false, error: unassigned.length + ' session(s) have no priority assigned: ' + labels + '. Set all priorities before generating.' });
        }

        // Clear existing slots (keep session definitions)
        var defIds = defs.map(function(d) { return d.id; });
        var { error: clearSlotErr } = await sb.from('session_slots').delete().in('session_definition_id', defIds);
        if (clearSlotErr) throw new Error('Clear slots failed: ' + clearSlotErr.message);

        // Fill sessions with companies
        var result = fillSessions(parts, defs);

        // Update session themes and insert slots
        for (var i = 0; i < result.results.length; i++) {
          var r = result.results[i];
          // Update theme
          await sb.from('session_definitions')
            .update({ session_theme: r.theme, updated_at: new Date().toISOString() })
            .eq('id', r.def.id);
          // Insert slots
          if (r.slots.length > 0) {
            var { error: slotErr } = await sb.from('session_slots').insert(r.slots);
            if (slotErr) throw new Error('Insert slots for session ' + r.def.session_number + ' failed: ' + slotErr.message);
          }
        }

        return res.status(200).json({
          ok: true,
          message: 'Filled ' + result.stats.totalFilled + ' of ' + result.stats.totalSessions + ' sessions with ' + result.stats.totalPlaced + ' companies. ' + result.stats.overflow + ' overflow.',
          stats: result.stats
        });
      }

      if (action === 'move-slot') {
        var slotId = body.slot_id;
        var targetSessionId = body.target_session_id;
        var targetSlot = body.target_slot;

        var { data: existing } = await sb
          .from('session_slots')
          .select('id')
          .eq('session_definition_id', targetSessionId)
          .eq('slot_in_session', targetSlot)
          .single();

        if (existing) {
          // Target occupied — three-step swap via temp position to avoid unique constraint
          var { data: sourceSlot } = await sb.from('session_slots').select('*').eq('id', slotId).single();
          if (!sourceSlot) return res.status(404).json({ ok: false, error: 'Source slot not found' });

          // 1. Move source to temp position
          var { error: tmp1 } = await sb
            .from('session_slots')
            .update({ session_definition_id: targetSessionId, slot_in_session: -1, updated_at: new Date().toISOString() })
            .eq('id', slotId);
          if (tmp1) throw new Error('Move step 1 failed: ' + tmp1.message);

          // 2. Move existing to source's old position
          var { error: tmp2 } = await sb
            .from('session_slots')
            .update({ session_definition_id: sourceSlot.session_definition_id, slot_in_session: sourceSlot.slot_in_session, updated_at: new Date().toISOString() })
            .eq('id', existing.id);
          if (tmp2) throw new Error('Move step 2 failed: ' + tmp2.message);

          // 3. Move source from temp to final target
          var { error: tmp3 } = await sb
            .from('session_slots')
            .update({ slot_in_session: targetSlot, updated_at: new Date().toISOString() })
            .eq('id', slotId);
          if (tmp3) throw new Error('Move step 3 failed: ' + tmp3.message);
        } else {
          // Target empty — direct move
          var { error: moveErr } = await sb
            .from('session_slots')
            .update({ session_definition_id: targetSessionId, slot_in_session: targetSlot, updated_at: new Date().toISOString() })
            .eq('id', slotId);
          if (moveErr) throw new Error('Move failed: ' + moveErr.message);
        }

        return res.status(200).json({ ok: true, message: 'Slot moved' });
      }

      // ---- SWAP SLOTS: swap two company slots' positions ----
      if (action === 'swap-slots') {
        var slotIdA = body.slot_id_a;
        var slotIdB = body.slot_id_b;

        var { data: slotA } = await sb.from('session_slots').select('*').eq('id', slotIdA).single();
        var { data: slotB } = await sb.from('session_slots').select('*').eq('id', slotIdB).single();
        if (!slotA || !slotB) return res.status(404).json({ ok: false, error: 'One or both slots not found' });

        // Three-step swap to avoid unique constraint on (session_definition_id, slot_in_session):
        // 1. Move A to a temp position (slot_in_session = -1)
        var { error: e0 } = await sb
          .from('session_slots')
          .update({ session_definition_id: slotB.session_definition_id, slot_in_session: -1, updated_at: new Date().toISOString() })
          .eq('id', slotA.id);
        if (e0) throw new Error('Swap step 1 failed: ' + e0.message);

        // 2. Move B to A's old position
        var { error: e1 } = await sb
          .from('session_slots')
          .update({ session_definition_id: slotA.session_definition_id, slot_in_session: slotA.slot_in_session, updated_at: new Date().toISOString() })
          .eq('id', slotB.id);
        if (e1) throw new Error('Swap step 2 failed: ' + e1.message);

        // 3. Move A from temp to B's old position
        var { error: e2 } = await sb
          .from('session_slots')
          .update({ slot_in_session: slotB.slot_in_session, updated_at: new Date().toISOString() })
          .eq('id', slotA.id);
        if (e2) throw new Error('Swap step 3 failed: ' + e2.message);

        return res.status(200).json({ ok: true, message: 'Slots swapped' });
      }

      // ---- REMOVE TO HOLDING: remove a company from its session into the holding bucket ----
      if (action === 'remove-to-holding') {
        var slotId = body.slot_id;
        if (!slotId) return res.status(400).json({ ok: false, error: 'Missing slot_id' });

        // Get the slot data before deleting
        var { data: slot } = await sb.from('session_slots').select('*').eq('id', slotId).single();
        if (!slot) return res.status(404).json({ ok: false, error: 'Slot not found' });

        // Get the event_code from the session definition
        var { data: sessDef } = await sb.from('session_definitions').select('event_code').eq('id', slot.session_definition_id).single();
        if (!sessDef) return res.status(404).json({ ok: false, error: 'Session not found' });
        var evCode = sessDef.event_code;

        // Delete the slot
        var { error: delErr } = await sb.from('session_slots').delete().eq('id', slotId);
        if (delErr) throw new Error('Delete slot failed: ' + delErr.message);

        // Re-number remaining slots in the session to close the gap
        var { data: remaining } = await sb.from('session_slots')
          .select('id, slot_in_session')
          .eq('session_definition_id', slot.session_definition_id)
          .order('slot_in_session', { ascending: true });
        for (var ri = 0; ri < (remaining || []).length; ri++) {
          if (remaining[ri].slot_in_session !== ri + 1) {
            await sb.from('session_slots').update({ slot_in_session: ri + 1 }).eq('id', remaining[ri].id);
          }
        }

        // Add to holding bucket in session_configs
        var { data: hCfg } = await sb.from('session_configs').select('holding_bucket').eq('event_code', evCode).single();
        var bucket = (hCfg && hCfg.holding_bucket) || [];
        bucket.push({
          company_name: slot.company_name,
          company_status: slot.company_status || '',
          primary_mineral: slot.primary_mineral || '',
          geography: slot.geography || '',
          market_cap_usd: slot.market_cap_usd || 0,
          mcap_tier: slot.mcap_tier || '',
          payment_status: slot.payment_status || '',
          removed_at: new Date().toISOString()
        });
        await sb.from('session_configs')
          .update({ holding_bucket: bucket, updated_at: new Date().toISOString() })
          .eq('event_code', evCode);

        return res.status(200).json({ ok: true, message: slot.company_name + ' moved to holding bucket.', holding: bucket });
      }

      // ---- PLACE FROM HOLDING: move a company from holding bucket into a session slot ----
      if (action === 'place-from-holding') {
        var companyName = body.company_name;
        var targetSessionId = body.target_session_id;
        var targetSlot = body.target_slot;
        if (!companyName || !targetSessionId || !targetSlot) {
          return res.status(400).json({ ok: false, error: 'Missing company_name, target_session_id, or target_slot' });
        }

        // Get the event_code
        var { data: sessDef } = await sb.from('session_definitions').select('event_code').eq('id', targetSessionId).single();
        if (!sessDef) return res.status(404).json({ ok: false, error: 'Session not found' });
        var evCode = sessDef.event_code;

        // Find the company in the holding bucket
        var { data: hCfg } = await sb.from('session_configs').select('holding_bucket').eq('event_code', evCode).single();
        var bucket = (hCfg && hCfg.holding_bucket) || [];
        var compIdx = -1;
        for (var bi = 0; bi < bucket.length; bi++) {
          if (bucket[bi].company_name === companyName) { compIdx = bi; break; }
        }

        var comp;
        var fromHolding = compIdx >= 0;
        if (fromHolding) {
          comp = bucket.splice(compIdx, 1)[0];
        } else {
          // Check if company is unallocated (in presenting_companies but not in any slot)
          var { data: pcCfg } = await sb.from('session_configs').select('presenting_companies').eq('event_code', evCode).single();
          var allCo = (pcCfg && pcCfg.presenting_companies) || [];
          var found = null;
          for (var pi = 0; pi < allCo.length; pi++) {
            if (allCo[pi].company_name === companyName) { found = allCo[pi]; break; }
          }
          if (!found) return res.status(404).json({ ok: false, error: 'Company not found in holding bucket or presenting companies' });
          // Verify not already allocated
          var { data: existSlot } = await sb.from('session_slots').select('id').eq('company_name', companyName).limit(1);
          if (existSlot && existSlot.length > 0) return res.status(400).json({ ok: false, error: 'Company is already allocated to a session' });
          comp = {
            company_name: found.company_name,
            company_status: found.company_status || '',
            primary_mineral: found.primary_mineral || '',
            geography: found.primary_subregion || found.primary_region || found.primary_country || '',
            market_cap_usd: found.market_cap_usd || 0,
            mcap_tier: '',
            payment_status: found.payment_status || ''
          };
        }

        // Insert slot
        var { error: insErr } = await sb.from('session_slots').insert({
          session_definition_id: targetSessionId,
          slot_in_session: targetSlot,
          company_name: comp.company_name,
          company_status: comp.company_status || '',
          primary_mineral: comp.primary_mineral || '',
          geography: comp.geography || '',
          market_cap_usd: comp.market_cap_usd || 0,
          mcap_tier: comp.mcap_tier || '',
          payment_status: comp.payment_status || ''
        });
        if (insErr) throw new Error('Insert slot failed: ' + insErr.message);

        // Update holding bucket if the company came from there
        if (fromHolding) {
          await sb.from('session_configs')
            .update({ holding_bucket: bucket, updated_at: new Date().toISOString() })
            .eq('event_code', evCode);
        }

        return res.status(200).json({ ok: true, message: comp.company_name + ' placed.', holding: bucket });
      }

      if (action === 'update-theme') {
        var { error: thErr } = await sb
          .from('session_definitions')
          .update({ session_theme: body.session_theme, updated_at: new Date().toISOString() })
          .eq('id', body.session_id);
        if (thErr) throw new Error('Update theme failed: ' + thErr.message);
        return res.status(200).json({ ok: true });
      }

      if (action === 'export') {
        var format = body.format || 'csv';
        var { data: defs } = await sb
          .from('session_definitions')
          .select('*')
          .eq('event_code', eventCode)
          .order('priority', { ascending: true });

        var defIds = (defs || []).map(function(d) { return d.id; });
        var { data: slots } = await sb
          .from('session_slots')
          .select('*')
          .in('session_definition_id', defIds)
          .order('slot_in_session', { ascending: true });

        var defMap = {};
        (defs || []).forEach(function(d) { defMap[d.id] = d; });

        var rows = (slots || []).map(function(s) {
          var d = defMap[s.session_definition_id] || {};
          return {
            Priority: 'P' + d.priority,
            SessionNumber: d.session_number,
            Stage: d.stage,
            Day: d.day,
            TimeBlock: d.time_block || '',
            StartTime: d.start_time || '',
            SessionTheme: d.session_theme,
            SlotInSession: s.slot_in_session,
            CompanyName: s.company_name,
            CompanyStatus: s.company_status,
            PrimaryMineral: s.primary_mineral,
            Geography: s.geography,
            MarketCapUSD_B: s.market_cap_usd ? Math.round(s.market_cap_usd * 100) / 100 : 0,
            McapTier: s.mcap_tier,
            PaymentStatus: s.payment_status || ''
          };
        });

        if (format === 'json') {
          return res.status(200).json({ ok: true, data: rows });
        }

        var headers = ['Priority', 'SessionNumber', 'Stage', 'Day', 'TimeBlock', 'StartTime', 'SessionTheme', 'SlotInSession', 'CompanyName', 'CompanyStatus', 'PrimaryMineral', 'Geography', 'MarketCapUSD_B', 'McapTier', 'PaymentStatus'];
        var csvLines = [headers.join(',')];
        rows.forEach(function(r) {
          csvLines.push(headers.map(function(h) {
            var v = String(r[h] || '');
            return v.indexOf(',') >= 0 ? '"' + v.replace(/"/g, '""') + '"' : v;
          }).join(','));
        });
        return res.status(200).json({ ok: true, csv: csvLines.join('\n') });
      }

      if (action === 'clear') {
        var { error: clrErr } = await sb.from('session_definitions').delete().eq('event_code', eventCode);
        if (clrErr) throw new Error('Clear failed: ' + clrErr.message);
        return res.status(200).json({ ok: true, message: eventCode + ' sessions cleared.' });
      }

      if (action === 'import') {
        var rows = body.rows;
        if (!rows || !Array.isArray(rows) || rows.length === 0) {
          return res.status(400).json({ ok: false, error: 'No rows to import' });
        }

        var { error: impClrErr } = await sb.from('session_definitions').delete().eq('event_code', eventCode);
        if (impClrErr) throw new Error('Clear before import failed: ' + impClrErr.message);

        var sessionMap = {};
        var sessionOrder = [];
        rows.forEach(function(r) {
          var key = (r.Priority || r.priority || '') + '|' + (r.SessionNumber || r.session_number || '');
          if (!sessionMap[key]) {
            sessionMap[key] = {
              priority: parseInt(String(r.Priority || r.priority || '0').replace(/^P/, ''), 10) || 0,
              session_number: parseInt(r.SessionNumber || r.session_number, 10) || 0,
              stage: r.Stage || r.stage || '',
              day: r.Day || r.day || '',
              time_block: r.TimeBlock || r.time_block || '',
              start_time: r.StartTime || r.start_time || '',
              session_theme: r.SessionTheme || r.session_theme || '',
              slots: []
            };
            sessionOrder.push(key);
          }
          sessionMap[key].slots.push({
            slot_in_session: parseInt(r.SlotInSession || r.slot_in_session, 10) || (sessionMap[key].slots.length + 1),
            company_name: r.CompanyName || r.company_name || '',
            company_status: r.CompanyStatus || r.company_status || '',
            primary_mineral: r.PrimaryMineral || r.primary_mineral || '',
            geography: r.Geography || r.geography || '',
            market_cap_usd: parseFloat(r.MarketCapUSD_B || r.market_cap_usd || 0) || 0,
            mcap_tier: r.McapTier || r.mcap_tier || '',
            payment_status: r.PaymentStatus || r.payment_status || ''
          });
        });

        var totalPlaced = 0;
        for (var si = 0; si < sessionOrder.length; si++) {
          var sess = sessionMap[sessionOrder[si]];
          var defRow = {
            event_code: eventCode,
            priority: sess.priority,
            session_number: sess.session_number,
            stage: sess.stage,
            day: sess.day,
            time_block: sess.time_block,
            start_time: sess.start_time,
            session_theme: sess.session_theme,
            max_slots: Math.max(6, sess.slots.length)
          };
          var { data: inserted, error: insErr } = await sb
            .from('session_definitions')
            .insert(defRow)
            .select()
            .single();
          if (insErr) throw new Error('Import session ' + sess.session_number + ' failed: ' + insErr.message);

          var slotRows = sess.slots.map(function(sl) {
            return {
              session_definition_id: inserted.id,
              slot_in_session: sl.slot_in_session,
              company_name: sl.company_name,
              company_status: sl.company_status,
              primary_mineral: sl.primary_mineral,
              geography: sl.geography,
              market_cap_usd: sl.market_cap_usd,
              mcap_tier: sl.mcap_tier,
              payment_status: sl.payment_status || ''
            };
          });
          if (slotRows.length > 0) {
            var { error: slotErr } = await sb.from('session_slots').insert(slotRows);
            if (slotErr) throw new Error('Import slots for session ' + sess.session_number + ' failed: ' + slotErr.message);
            totalPlaced += slotRows.length;
          }
        }

        return res.status(200).json({
          ok: true,
          message: 'Imported ' + sessionOrder.length + ' sessions with ' + totalPlaced + ' companies for ' + eventCode + '.'
        });
      }

      // ---- Update program status (presentation_date) from JSON upload ----
      if (action === 'update-program') {
        var companies = body.companies;
        if (!companies || !Array.isArray(companies) || companies.length === 0) {
          return res.status(400).json({ ok: false, error: 'No companies in upload' });
        }

        var updated = 0;
        var skipped = 0;
        var errors = [];

        for (var ui = 0; ui < companies.length; ui++) {
          var row = companies[ui];
          var name = row.company_name || row.CompanyNameForPublication || row.Company || row.name || '';
          if (!name) { skipped++; continue; }

          var updateFields = {};
          // presentation_date
          var pDate = row.presentation_date || row.PresentationDate || row.pres_date || row.date || null;
          if (pDate !== undefined) updateFields.presentation_date = pDate || null;
          // presentation_time
          var pTime = row.presentation_time || row.PresentationTime || row.pres_time || row.time;
          if (pTime !== undefined) updateFields.presentation_time = pTime || '';
          // presentation_type
          var pType = row.presentation_type || row.PresentationType || row.pres_type || row.type;
          if (pType !== undefined) updateFields.presentation_type = pType || '';
          // presentation_location
          var pLoc = row.presentation_location || row.PresentationLocation || row.pres_location || row.location;
          if (pLoc !== undefined) updateFields.presentation_location = pLoc || '';
          // market cap
          var mcapActual = row.market_cap_usd || row.MarketCapUSDActual;
          if (mcapActual !== undefined && mcapActual !== '') updateFields.market_cap_usd = Number(mcapActual) || null;
          var mcapDisplay = row.market_cap_display || row.MarketCapUSD;
          if (mcapDisplay !== undefined) updateFields.market_cap_display = mcapDisplay || '';
          // stock price
          var sPrice = row.stock_price_usd || row.StockPriceUSD;
          if (sPrice !== undefined && sPrice !== '') updateFields.stock_price_usd = Number(sPrice) || null;
          // 52-week range
          var ftwRange = row.fifty_two_week_range || row.FiftyTwoWeekRangeUSD;
          if (ftwRange !== undefined) updateFields.fifty_two_week_range = ftwRange || '';
          // one-year return
          var oyr = row.one_year_return || row.OneYearReturn;
          if (oyr !== undefined) updateFields.one_year_return = oyr || '';
          // ticker and symbol
          var tkr = row.ticker || row.Ticker;
          if (tkr !== undefined) updateFields.ticker = tkr || '';
          var sym = row.stock_symbol || row.StockSymbol;
          if (sym !== undefined) updateFields.stock_symbol = sym || '';
          // production
          var prodLow = row.production_low || row.ProductionLow;
          if (prodLow !== undefined && prodLow !== '') updateFields.production_low = Number(prodLow) || null;
          var prodHigh = row.production_high || row.ProductionHigh;
          if (prodHigh !== undefined && prodHigh !== '') updateFields.production_high = Number(prodHigh) || null;
          // reserves and resources
          var resv = row.reserves || row.Reserves;
          if (resv !== undefined && resv !== '') updateFields.reserves = Number(resv) || null;
          var rsrc = row.resources || row.Resources;
          if (rsrc !== undefined && rsrc !== '') updateFields.resources = Number(rsrc) || null;
          // payment status
          var paySt = row.payment_status || row.PaymentStatus;
          if (paySt !== undefined) updateFields.payment_status = paySt || '';
          // attendance
          var att = row.attendance || row.Attendance;
          if (att !== undefined) updateFields.attendance = att || '';
          // profile and webcast URLs
          var profUrl = row.profile_url || row.Profile;
          if (profUrl !== undefined) updateFields.profile_url = profUrl || '';
          var webUrl = row.webcast_url || row.Webcast;
          if (webUrl !== undefined) updateFields.webcast_url = webUrl || '';
          // company status, mineral, country, exchange, region
          var cStat = row.company_status || row.CompanyStatus;
          if (cStat !== undefined) updateFields.company_status = cStat || '';
          var cMin = row.primary_mineral || row.PrimaryMineral;
          if (cMin !== undefined) updateFields.primary_mineral = cMin || '';
          var cCountry = row.primary_country || row.PrimaryCountryOfOperation;
          if (cCountry !== undefined) updateFields.primary_country = cCountry || '';
          var cExchange = row.primary_stock_exchange || row.PrimaryStockExchange;
          if (cExchange !== undefined) updateFields.primary_stock_exchange = cExchange || '';
          var cRegion = row.primary_region || row.PrimaryRegionOfOperation;
          if (cRegion !== undefined) updateFields.primary_region = cRegion || '';
          var cSubregion = row.primary_subregion || row.PrimarySubregionOfOperation;
          if (cSubregion !== undefined) updateFields.primary_subregion = cSubregion || '';
          // currency
          var curr = row.currency || row.Currency;
          if (curr !== undefined) updateFields.currency = curr || '';

          if (Object.keys(updateFields).length === 0) { skipped++; continue; }

          var { data: upd, error: updErr } = await sb
            .from('event_participations')
            .update(updateFields)
            .eq('event_code', eventCode)
            .ilike('company_name', name)
            .select('company_name');

          if (updErr) {
            errors.push(name + ': ' + updErr.message);
          } else if (upd && upd.length > 0) {
            updated++;
          } else {
            skipped++;
            errors.push(name + ': no matching participation found');
          }
        }

        return res.status(200).json({
          ok: true,
          message: 'Updated ' + updated + ' of ' + companies.length + ' companies for ' + eventCode + '.',
          updated: updated,
          skipped: skipped,
          errors: errors.length > 0 ? errors : undefined
        });
      }

      return res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};
