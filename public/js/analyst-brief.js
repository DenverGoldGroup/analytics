// Analyst Briefing — a three-page, vector PDF summarizing an event for sell-side analysts.
// Pure layout: takes a PDFKit constructor, the 'analyst-brief-data' API payload, binary assets
// (fonts + logos) and the shared metal history, and returns the PDFKit document.
// Runs unchanged in the browser (pdfkit.standalone) and in node (tests).
(function(root) {
  'use strict';

  // The site's standing attendee projection rule (shared with the attendees view)
  var Projection = (typeof module !== 'undefined' && module.exports)
    ? require('./attendee-projection.js') : root.AttendeeProjection;

  // The Denver Gold Group lockup, drawn as vectors (dgg-mark.js); loaded before this file
  var DGG = (typeof module !== 'undefined' && module.exports) ? require('./dgg-mark.js') : root.DGGMark;

  // ── Brand ────────────────────────────────────────────
  // DGG Brand Guidelines, edition 1 (2026), section 07 "DGG on forum material": DGG appears once, in the
  // header band; the forum's colour owns the body. Mining Forum Americas: orange accent, ink, dark cards.
  // Orange is a graphic colour only (rules, bars, borders) — it never carries text on white.
  var INK = '#0B0708';
  var BAND = '#1B1416';        // the DGG header band
  var CARD = '#1C1517';        // dark cards and the running head
  var ACCENT = '#F9A51A';      // MFA orange
  var ACCENT_DEEP = '#E8892A'; // the lead bar in a list
  var TEXT = '#0B0708';
  var MUTED = '#4A4644';       // grey 700: captions, footers
  var RULE = '#C9C5C2';        // thin neutral rules
  var TINT = '#FBF8F3';        // paper: light panels
  var TRACK = '#E9E5E0';       // sand: table banding, bar tracks
  var UP = '#1E7B45';
  var DOWN = '#B03A2E';
  // The forums' grounds, for the "forums to come" cards (guidelines 07.1)
  var FORUM = {
    mfa: { fill: '#0B0708', eyebrow: '#F9A51A', text: '#FFFFFF', sub: '#EDE6DD' },
    mfe: { grad: ['#F0443A', '#DA291C', '#A81E14'], eyebrow: '#FFFFFF', text: '#FFFFFF', sub: '#FFE9E6' },
    mfau: { grad: ['#03592D', '#048442', '#0AA552'], eyebrow: '#FDB71C', text: '#FFFFFF', sub: '#E6F4EC' }
  };

  var PAGE_W = 612, PAGE_H = 792, M = 36;
  var CONTENT_W = PAGE_W - M * 2;

  // ── Formatting ───────────────────────────────────────
  function fmtInt(n) {
    return Math.round(Number(n) || 0).toLocaleString('en-US');
  }
  function fmtUsd(n) {
    var v = Number(n) || 0;
    if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
    if (v >= 1e10) return '$' + (v / 1e9).toFixed(0) + 'B';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(0) + 'M';
    return '$' + fmtInt(v);
  }
  // For running text: "$1.26 trillion", "$272 billion"
  function fmtUsdWords(n) {
    var v = Number(n) || 0;
    if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + ' trillion';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(v >= 1e10 ? 0 : 1) + ' billion';
    return '$' + (v / 1e6).toFixed(0) + ' million';
  }
  function fmtPct(v, digits) {
    if (v == null || isNaN(v)) return '—';
    return (v * 100).toFixed(digits || 0) + '%';
  }
  function fmtSigned(v) {
    if (v == null || isNaN(v)) return '—';
    var p = Math.abs(v * 100).toFixed(0);
    if (p === '0') return '0%';
    return (v >= 0 ? '+' : '−') + p + '%';
  }
  function fmtPrice(v, unit) {
    if (v == null) return '—';
    var d = v >= 100 ? 0 : 2;
    return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) + unit;
  }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function parseDate(s) {
    var p = String(s || '').slice(0, 10).split('-');
    return p.length === 3 ? new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])) : null;
  }
  // House style (brand guidelines 09): "19–22 September 2027", day first, en dash, no comma
  function fmtDate(d) {
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function fmtDateRange(a, b) {
    if (!a) return '';
    if (!b || a.getTime() === b.getTime()) return fmtDate(a);
    if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) {
      return a.getUTCDate() + '–' + b.getUTCDate() + ' ' + MONTHS[a.getUTCMonth()] + ' ' + a.getUTCFullYear();
    }
    if (a.getUTCFullYear() === b.getUTCFullYear()) return a.getUTCDate() + ' ' + MONTHS[a.getUTCMonth()] + ' – ' + fmtDate(b);
    return fmtDate(a) + ' – ' + fmtDate(b);
  }
  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // ── Aggregation ──────────────────────────────────────
  var STATUS_LABELS = {
    'Producer': 'Producers',
    'Developer (construction/feasibility)': 'Developers, feasibility & build',
    'Developer (PEA/scoping)': 'Developers, PEA & scoping',
    'Developer': 'Developers',
    'Explorer (advanced)': 'Explorers, advanced',
    'Explorer (early-stage)': 'Explorers, early stage',
    'Explorer': 'Explorers',
    'Royalty / Streaming': 'Royalty & streaming',
    'Bullion Dealer': 'Bullion dealers',
    'Service Member': 'Service members'
  };
  var STATUS_SHORT = {
    'Producer': 'Producer',
    'Developer (construction/feasibility)': 'Developer',
    'Developer (PEA/scoping)': 'Developer',
    'Developer': 'Developer',
    'Explorer (advanced)': 'Explorer',
    'Explorer (early-stage)': 'Explorer',
    'Explorer': 'Explorer',
    'Royalty / Streaming': 'Royalty',
    'Bullion Dealer': 'Bullion',
    'Service Member': 'Service'
  };

  function groupBy(rows, key, labelFn) {
    var map = {}, order = [];
    rows.forEach(function(r) {
      var k = (typeof key === 'function' ? key(r) : r[key]) || 'Other';
      if (!map[k]) { map[k] = { key: k, label: labelFn ? labelFn(k) : k, count: 0, mcap: 0 }; order.push(k); }
      map[k].count++;
      map[k].mcap += Number(r.market_cap_usd) || 0;
    });
    var list = order.map(function(k) { return map[k]; });
    list.sort(function(a, b) { return (b.count - a.count) || (b.mcap - a.mcap); });
    return list;
  }

  // Keep the material groups, fold the tail into one "Other" row
  function foldTail(list, maxRows) {
    var kept = [], other = { key: 'Other', label: 'Other', count: 0, mcap: 0, members: [] };
    list.forEach(function(g) {
      var material = g.count >= 2 || g.mcap >= 1e9;
      if (g.key !== 'Other' && material && kept.length < maxRows - 1) kept.push(g);
      else { other.count += g.count; other.mcap += g.mcap; other.members.push(g.label); }
    });
    if (other.count) {
      // A single folded group keeps its own name
      if (other.members.length === 1) other.label = other.members[0];
      kept.push(other);
    }
    return kept;
  }

  // Dashboard names ("Pan American Silver Co", "Aeris Resources Limited Business Development")
  // rarely match the roster exactly, so compare on a stripped-down form
  function normName(s) {
    return String(s || '').toLowerCase().replace(/&/g, ' and ')
      .replace(/business development\s*$/, '').replace(/\s+\d+\s*$/, '')
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\b(corporation|corp|limited|ltd|inc|plc|company|co|the|sa|nv|ag|llc|lp)\b/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function summarise(data, asOf) {
    asOf = asOf || (data.generated_at ? new Date(data.generated_at) : new Date());
    var evtStart = parseDate(data.event && data.event.start_date);
    var upcoming = !!(evtStart && asOf < evtStart);
    var inputs = data.inputs || {};
    var cur = data.companies || [], prior = data.companies_prior || [];

    // Match a name from another system (meeting accounts, attendee companies) to a roster issuer
    var byName = {};
    cur.forEach(function(c) { byName[normName(c.company_name)] = c; });
    var rosterKeys = Object.keys(byName);
    function findCompany(name) {
      var n = normName(name);
      if (!n) return null;
      if (byName[n]) return byName[n];
      var cands = rosterKeys.filter(function(k) { return k.indexOf(n) === 0 || n.indexOf(k) === 0; });
      return cands.length === 1 ? byName[cands[0]] : null;
    }
    function total(rows) { return rows.reduce(function(s, r) { return s + (Number(r.market_cap_usd) || 0); }, 0); }
    function distinct(rows, key) {
      var seen = {};
      rows.forEach(function(r) { if (r[key]) seen[r[key]] = 1; });
      return Object.keys(seen).length;
    }
    var top = cur.slice().sort(function(a, b) { return (Number(b.market_cap_usd) || 0) - (Number(a.market_cap_usd) || 0); });
    // Accepted issuers either present or take 1x1 meetings only; a presentation slot tells them apart
    var presents = function(c) { return !!(c.presentation_date || (c.presentation_location && String(c.presentation_location).trim()) || (c.presentation_type && String(c.presentation_type).trim())); };
    var hasSlots = cur.some(presents);
    var presenters = hasSlots ? cur.filter(presents).length : null;
    var meetingsOnly = hasSlots ? cur.length - presenters : null;

    // Attendees: only usable when the rows carry a classification
    var att = (data.attendees || []).filter(function(a) { return a.type; });
    var attended = att.filter(function(a) { return a.invitation_status === 'Attended' || a.attendance === 'Attended'; });
    // Nobody has checked in before the doors open, whatever a stray status says
    var useAttended = !upcoming && attended.length > 0;
    // One registration per person per issuer: someone representing two issuers has two registrations.
    // Headcounts count people (by contact ID); issuer coverage counts registrations.
    var registrations = useAttended ? attended : att;
    var seenPeople = {};
    var pool = registrations.filter(function(a) {
      if (!a.contact_id) return true;
      if (seenPeople[a.contact_id]) return false;
      seenPeople[a.contact_id] = true;
      return true;
    });
    var audience = null;
    if (pool.length >= 10) {
      // Before the forum, headcounts are projected to on-site attendance with the same per-attendee
      // factors the attendees view uses; once it has started, the counts are who actually attended.
      var projecting = upcoming && !!Projection;
      var mult = projecting ? Projection.buySellMult(data.event.start_date, asOf) : 1;
      // An admin can set the projected on-site total; every group is then scaled pro-rata to it
      var siteTotal = projecting && Number(inputs.attendees_projected_total) > 0 ? Number(inputs.attendees_projected_total) : null;
      var scale = 1;
      if (siteTotal) {
        var rawTotal = 0;
        pool.forEach(function(a) { rawTotal += Projection.factor(a, mult); });
        scale = rawTotal ? siteTotal / rawTotal : 1;
      }
      // Projections are estimates, so they are shown rounded up to the nearest 10. Checked-in counts follow
      // the attendees view's rule: buy-side participants +3.5% for on-site colleagues who were not badged.
      var headcount = function(list) {
        var raw = 0;
        if (!projecting) {
          list.forEach(function(a) { raw += Projection ? Projection.factor(a, 1, 'checked-in') : 1; });
          return Math.round(raw);
        }
        list.forEach(function(a) { raw += Projection.factor(a, mult); });
        return Math.ceil(raw * scale / 10) * 10;
      };
      // Same definitions as the attendees view: buy-side and sell-side are participants
      var buy = pool.filter(function(a) { return a.type !== 'Delegate' && a.category === 'Buy-Side'; });
      var sell = pool.filter(function(a) { return a.type !== 'Delegate' && a.category === 'Sell-Side'; });
      // Corporate delegates are the issuers' own people. Sponsor banks and partners (BMO, JP Morgan,
      // VRIFY, the World Gold Council...) also register as member delegates, so match to the roster.
      var hasCompany = pool.some(function(a) { return a.company; });
      var isIssuerDelegate = function(a) {
        return a.type === 'Delegate' && a.category === 'Member' && (!hasCompany || findCompany(a.company));
      };
      var delegateRegs = registrations.filter(isIssuerDelegate);
      if (!delegateRegs.length) delegateRegs = registrations.filter(function(a) { return a.type === 'Delegate' && a.category !== 'Buy-Side' && a.category !== 'Sell-Side'; });
      // The same people, once each
      var delegatePeople = {};
      var delegates = delegateRegs.filter(function(a) {
        if (!a.contact_id) return true;
        if (delegatePeople[a.contact_id]) return false;
        delegatePeople[a.contact_id] = true;
        return true;
      });
      var bankers = pool.filter(function(a) { return a.category === 'Banking & Corporate Finance Services'; });
      var buyN = headcount(buy), sellN = headcount(sell), delegateN = headcount(delegates), bankerN = headcount(bankers);
      var totalN, otherN;
      if (projecting) {
        totalN = siteTotal ? Math.ceil(siteTotal / 10) * 10 : headcount(pool);
        // "Other" is the remainder, so the rows always add up to the (rounded) total
        otherN = totalN - buyN - sellN - delegateN - bankerN;
      } else {
        // Checked in: the total is the sum of the groups shown, so it reconciles with the lifted buy-side
        otherN = Math.max(pool.length - buy.length - sell.length - delegates.length - bankers.length, 0);
        totalN = buyN + sellN + delegateN + bankerN + otherN;
      }
      var subMap = {};
      buy.forEach(function(a) {
        var s = String(a.subcategory || 'Unclassified');
        s = s === 'Institutional Investor: Other' ? 'Other institutional' : s.replace('Institutional Investor: ', '');
        subMap[s] = (subMap[s] || 0) + 1;
      });
      var subs = Object.keys(subMap).map(function(k) { return { label: k, count: subMap[k] }; })
        .sort(function(a, b) { return b.count - a.count; });
      var subTop = subs.slice(0, 5);
      var subRest = subs.slice(5).reduce(function(s, x) { return s + x.count; }, 0);
      if (subRest > 0) subTop.push({ label: 'All other types', count: subRest });

      // C-suite representation among corporate delegates, read from job titles
      var csuite = null;
      var titledRegs = delegateRegs.filter(function(a) { return a.job_title; });
      if (titledRegs.length >= 10) {
        // Each person counts once, at their most senior role across the issuers they represent
        var RANK = { ceo: 4, cfo: 3, chief: 2, chair: 1 };
        var personLevel = {}, personMd = {}, people = [];
        titledRegs.forEach(function(a, i) {
          var key = a.contact_id || ('row' + i);
          var level = executiveLevel(a.job_title);
          if (!(key in personLevel)) { personLevel[key] = null; people.push(key); }
          if (level && (!personLevel[key] || RANK[level] > RANK[personLevel[key]])) personLevel[key] = level;
          if (level === 'ceo' && /managing director|\bmd\b/i.test(a.job_title)) personMd[key] = true;
        });
        var ceo = 0, cfo = 0, otherChief = 0, chairs = 0, mds = 0;
        people.forEach(function(key) {
          var level = personLevel[key];
          if (level === 'ceo') { ceo++; if (personMd[key]) mds++; }
          else if (level === 'cfo') cfo++;
          else if (level === 'chief') otherChief++;
          else if (level === 'chair') chairs++;
        });
        // Issuer coverage is per registration: which issuers have a chief executive attending
        var ceoCompanies = {}, companyIds = {};
        titledRegs.concat(delegateRegs).forEach(function(a) {
          var key = hasCompany ? findCompany(a.company).company_name : a.member_id;
          if (!key) return;
          companyIds[key] = 1;
          if (a.job_title && executiveLevel(a.job_title) === 'ceo') ceoCompanies[key] = 1;
        });
        // The denominator is every corporate delegate, the same count as the attendee mix; a delegate
        // with no job title on record simply isn't counted as C-suite
        csuite = {
          delegates: delegates.length, ceo: ceo, cfo: cfo, other: otherChief, chairs: chairs, mds: mds, total: ceo + cfo + otherChief,
          share: (ceo + cfo + otherChief) / delegates.length,
          ceoCompanies: Object.keys(ceoCompanies).length, companies: Object.keys(companyIds).length,
          // Denominator for CEO attendance: every presenting issuer, the same count used across the briefing
          issuers: hasCompany ? cur.length : Object.keys(companyIds).length
        };
      }

      var byCountry = function(list) {
        var cMap = {};
        list.forEach(function(a) { if (a.country) cMap[a.country] = (cMap[a.country] || 0) + 1; });
        return Object.keys(cMap).map(function(k) { return { label: k, count: cMap[k] }; }).sort(function(a, b) { return b.count - a.count; });
      };
      var countries = byCountry(pool), buyCountries = byCountry(buy);

      audience = {
        mode: useAttended ? 'Attended' : 'Registered',
        projected: projecting, registered: pool.length, checkedIn: useAttended,
        prior: Number(inputs.attendees_prior) || null,
        buyLifted: useAttended && buyN !== buy.length,
        phrase: useAttended ? 'attendees' : (projecting ? 'attendees projected on site' : 'registered attendees'),
        mixLabel: projecting ? 'Attendee mix, projected on site' : 'Attendee mix',
        csuite: csuite,
        total: totalN,
        buy: buyN, sell: sellN, delegates: delegateN, other: Math.max(otherN, 0),
        mix: [
          { label: 'Corporate delegates', count: delegateN },
          { label: 'Buy-side', count: buyN },
          { label: 'Investment Bankers', count: bankerN },
          { label: 'Sell-side', count: sellN },
          { label: 'Other participants', count: Math.max(otherN, 0) }
        ].filter(function(x) { return x.count > 0; }),
        buySubs: subTop,
        countries: countries, buyCountries: buyCountries
      };
    }

    // 1x1 meetings, from the member rankings
    var members = (data.top_meetings || []).filter(function(t) { return t.ranking_type === 'member'; });
    var meetings = null;
    if (members.length) {
      var totalMeet = members.reduce(function(s, t) { return s + (Number(t.meeting_count) || 0); }, 0);
      var active = members.filter(function(t) { return (Number(t.meeting_count) || 0) > 0; });
      // Before the forum, bookings are still building: totals are shown projected to the final
      // tally. Afterwards, an estimate of informal meetings held outside the meeting system is added to
      // the accepted total. Both multipliers are internal inputs and are never printed.
      var informal = !upcoming && Number(inputs.informal_factor) > 0 ? Number(inputs.informal_factor) : 1;
      var factor = upcoming ? (Number(inputs.projection_factor) > 0 ? Number(inputs.projection_factor) : 1.4) : informal;

      // Meetings held by roster issuers' host accounts; host accounts not on the roster are left out
      var issuersMeeting = {}, issuerMeetings = 0;
      members.forEach(function(t) {
        if (!(Number(t.meeting_count) > 0)) return;
        var c = findCompany(t.entity_name || t.company_name);
        if (c) {
          if (!issuersMeeting[c.company_name]) issuersMeeting[c.company_name] = { company: c, meetings: 0 };
          issuersMeeting[c.company_name].meetings += Number(t.meeting_count);
          issuerMeetings += Number(t.meeting_count);
        }
      });
      var nIssuers = Object.keys(issuersMeeting).length;

      // Average meetings per issuer by a roster field (stage of development, primary metal): the
      // issuers' own counts, groups of fewer than three issuers folded into Other, best average first
      var averagesBy = function(key, labelFn) {
        var map = {}, order = [];
        Object.keys(issuersMeeting).forEach(function(n) {
          var r = issuersMeeting[n], k = r.company[key] || 'Other';
          if (!map[k]) { map[k] = { key: k, label: labelFn ? labelFn(k) : k, issuers: 0, meetings: 0 }; order.push(k); }
          map[k].issuers++;
          map[k].meetings += r.meetings;
        });
        var kept = [], other = { key: 'Other', label: 'Other', issuers: 0, meetings: 0 };
        order.forEach(function(k) {
          var g = map[k];
          if (k !== 'Other' && g.issuers >= 3) kept.push(g); else { other.issuers += g.issuers; other.meetings += g.meetings; }
        });
        kept.sort(function(a, b) { return b.meetings / b.issuers - a.meetings / a.issuers; });
        if (other.issuers) kept.push(other);
        kept.forEach(function(g) { g.avg = g.meetings * factor / g.issuers; });
        return kept;
      };
      var nInvestors = Number(inputs.investors_with_meetings) || 0;
      var investorMeetings = Number(inputs.investor_meetings_total) || 0;

      // The admin can enter the accepted-meetings total from the meeting system (each meeting once);
      // otherwise it is the sum of the upload, which counts a meeting once per issuer taking part.
      // Per-issuer and per-investor averages always use the parties' own counts, so they don't scale.
      var entered = Number(inputs.meetings_current) > 0 ? Number(inputs.meetings_current) : null;
      var base = entered || totalMeet;

      meetings = {
        total: base, uploadTotal: totalMeet, baseEntered: !!entered,
        hosts: active.length, factor: factor, projected: upcoming && factor !== 1, informal: informal !== 1,
        shownTotal: Math.round(base * factor),
        mean: active.length ? totalMeet * factor / active.length : 0,
        priorFinal: Number(inputs.meetings_prior_final) || null,
        issuersWithMeetings: nIssuers,
        perIssuer: nIssuers ? issuerMeetings * factor / nIssuers : null,
        byStatus: averagesBy('company_status', function(k) { return STATUS_LABELS[k] || k; }),
        byMineral: averagesBy('primary_mineral'),
        perInvestor: nInvestors && investorMeetings ? investorMeetings * factor / nInvestors : null,
        investors: Number(inputs.investors_with_meetings) || null,
        investorFirms: Number(inputs.investor_firms) || null
      };
    }

    // Shareholder representation. The tier table gives totals; medians come from the roster's market caps,
    // bucketed by the bounds written in each tier's label ("$2 billion to $10 billion", "Under $50 million").
    var holdings = null;
    if (data.holdings && data.holdings.length) {
      var caps = cur.map(function(c) { return Number(c.market_cap_usd) || 0; }).filter(function(v) { return v > 0; });
      var median = function(list) {
        if (!list.length) return null;
        var a = list.slice().sort(function(x, y) { return x - y; }), m = a.length >> 1;
        return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
      };
      var bounds = function(label) {
        var nums = [], re = /\$?\s*([\d.]+)\s*(billion|million|B|M)\b/gi, x;
        while ((x = re.exec(label))) nums.push(parseFloat(x[1]) * (/^b/i.test(x[2]) ? 1e9 : 1e6));
        if (/under|below|less than/i.test(label) && nums.length === 1) return [0, nums[0]];
        if (/over|above|more than/i.test(label) && nums.length === 1) return [nums[0], Infinity];
        return nums.length >= 2 ? [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])] : null;
      };
      var rows = data.holdings.map(function(h) {
        var mc = Number(h.total_mc) || 0, held = Number(h.attendee_holdings) || 0;
        var b = bounds(String(h.mc_range || ''));
        var med = b ? median(caps.filter(function(v) { return v >= b[0] && v < b[1]; })) : null;
        return { label: h.mc_range, members: Number(h.members) || 0, mc: mc, avg: Number(h.average_mc) || 0, median: med, held: held, ratio: mc ? held / mc : null };
      });
      var tMc = rows.reduce(function(s, r) { return s + r.mc; }, 0);
      var tHeld = rows.reduce(function(s, r) { return s + r.held; }, 0);
      var tMembers = rows.reduce(function(s, r) { return s + r.members; }, 0);
      holdings = { rows: rows, mc: tMc, held: tHeld, members: tMembers, ratio: tMc ? tHeld / tMc : null, avg: tMembers ? tMc / tMembers : 0,
        median: median(caps), hasMedian: rows.some(function(r) { return r.median != null; }),
        priorRatio: inputs.holdings_ratio_prior != null ? Number(inputs.holdings_ratio_prior) : null };
    }

    // Webcast performance: REEI (Reach, Engagement, Efficiency, Impact) indexed to last year at the same
    // point after its forum, combined into one Relative Webcast Performance score. Built from the two
    // platform tables pasted on /admin; only indices are ever printed, never the view counts.
    var webcast = null;
    if (inputs.webcast_stats && inputs.webcast_stats.current_text && inputs.webcast_stats.prior_text) {
      var ws = inputs.webcast_stats;
      var curW = parseWebcastTable(ws.current_text), priW = parseWebcastTable(ws.prior_text);
      var share = Number(ws.same_time_share) > 0 && Number(ws.same_time_share) <= 1 ? Number(ws.same_time_share) : 1;
      var find = function(list, st) { return list.filter(function(r) { return r.status === st; })[0]; };
      var idx = function(a, b) { return a != null && b ? a / b * 100 : null; };
      var score = function(c, p) {
        if (!c || !p || !c.views || !p.views || !c.webcasts || !p.webcasts) return null;
        var r = { reach: idx(c.views, p.views * share), engagement: idx(c.avg_seconds, p.avg_seconds),
          efficiency: idx(c.views / c.webcasts, p.views * share / p.webcasts), impact: idx(c.seconds, p.seconds * share) };
        var parts = [r.reach, r.engagement, r.efficiency, r.impact].filter(function(v) { return v != null; });
        r.rwp = parts.length ? parts.reduce(function(t, v) { return t + v; }, 0) / parts.length : null;
        r.webcasts = c.webcasts; r.priorWebcasts = p.webcasts;
        return r;
      };
      var all = score(find(curW, 'All'), find(priW, 'All'));
      if (all) {
        var byStatus = curW.filter(function(r) { return r.status !== 'All'; }).map(function(r) {
          var sc = score(r, find(priW, r.status));
          return sc ? { label: STATUS_LABELS[r.status] || r.status, status: r.status, score: sc } : null;
        }).filter(function(x) { return x && x.score.webcasts >= 5 && x.score.priorWebcasts >= 5; })
          .sort(function(a, b) { return b.score.rwp - a.score.rwp; });
        webcast = { all: all, byStatus: byStatus, webcasts: all.webcasts, priorWebcasts: all.priorWebcasts,
          estimated: share < 1, priorYear: (data.event && data.event.year ? data.event.year : new Date().getFullYear()) - 1 };
      }
    }

    // MiningForum.live, the webcast site: views by month, compared as a rate per 30 days so that last
    // year's forum month and the month after can be set against this year's months to date. The current
    // month counts only the days elapsed at generation.
    var site = null;
    if (inputs.site_views && inputs.site_views.current_text && inputs.site_views.prior_text) {
      var asOfDate = asOf ? new Date(asOf) : (data.generated_at ? new Date(data.generated_at) : new Date());
      var tally = function(text) {
        var views = 0, days = 0, months = parseSiteViews(text);
        months.forEach(function(m) {
          var last = new Date(Date.UTC(m.year, m.month, 0)).getUTCDate();
          var d = (m.year === asOfDate.getUTCFullYear() && m.month === asOfDate.getUTCMonth() + 1) ? Math.min(asOfDate.getUTCDate(), last) : last;
          views += m.views; days += d;
        });
        return days ? { views: views, days: days, rate: views / days * 30, months: months } : null;
      };
      var siteCur = tally(inputs.site_views.current_text), sitePri = tally(inputs.site_views.prior_text);
      if (siteCur && sitePri && sitePri.rate) site = { current: siteCur, prior: sitePri, yoy: siteCur.rate / sitePri.rate - 1 };
    }

    // Buy-side headline: before the forum, the admin's projected pre-registration; afterwards, the count
    var buyside = null;
    if (audience) {
      buyside = { value: audience.buy, projected: audience.projected };
    } else if (upcoming && Number(inputs.buyside_projected) > 0) {
      buyside = { value: Number(inputs.buyside_projected), projected: true };
    }
    if (buyside) buyside.prior = Number(inputs.buyside_prior) || null;

    // Exchanges under their short names, with spelling variants merged
    function exchangeKey(r) {
      var x = shortExchange(r.primary_stock_exchange).replace(/-/g, ' ');
      return x === 'Canadian' ? 'CSE' : x;
    }

    return {
      n: cur.length, mcap: total(cur), priorN: prior.length, priorMcap: total(prior),
      countries: distinct(cur, 'primary_country'), exchanges: distinct(cur, 'primary_stock_exchange'),
      byStatus: foldTail(groupBy(cur, 'company_status', function(k) { return STATUS_LABELS[k] || k; }), 7),
      byMineral: foldTail(groupBy(cur, 'primary_mineral'), 7),
      byCountry: foldTail(groupBy(cur, 'primary_country'), 9),
      byExchange: foldTail(groupBy(cur, exchangeKey), 9),
      presenters: presenters, meetingsOnly: meetingsOnly, webcast: webcast, site: site,
      top: top, audience: audience, meetings: meetings, holdings: holdings, buyside: buyside, upcoming: upcoming
    };
  }

  // Site views pasted one month per line, "YYYY-MM: views" (any separator; thousands commas allowed)
  function parseSiteViews(text) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function(line) {
      var m = /(\d{4})-(\d{1,2})\D+([\d,]+)/.exec(line);
      if (m) out.push({ year: +m[1], month: +m[2], views: parseInt(m[3].replace(/,/g, ''), 10) });
    });
    return out.sort(function(a, b) { return a.year - b.year || a.month - b.month; });
  }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // "September 2025" or "September–October 2025"
  function monthSpan(months) {
    if (!months.length) return '';
    var a = months[0], z = months[months.length - 1];
    if (a === z) return MONTHS[a.month - 1] + ' ' + a.year;
    return MONTHS[a.month - 1] + (a.year === z.year ? '' : ' ' + a.year) + '–' + MONTHS[z.month - 1] + ' ' + z.year;
  }

  // "1181h 28m 41s" -> seconds; "10m 0s" -> seconds
  function durationSeconds(s) {
    var t = 0, re = /(\d+)\s*([hms])/g, m, any = false;
    while ((m = re.exec(String(s || '')))) { any = true; t += parseInt(m[1], 10) * { h: 3600, m: 60, s: 1 }[m[2]]; }
    return any ? t : null;
  }
  // The webcast platform's per-status table, pasted as tab-separated text with a header row:
  // Status, Total Views, Average Views, Total Duration, Average Duration. Webcasts = views / average views.
  function parseWebcastTable(text) {
    var rows = [];
    String(text || '').split(/\r?\n/).slice(1).forEach(function(line) {
      var p = line.split('\t').map(function(x) { return x.trim(); });
      if (p.length < 5 || !p[0]) return;
      var views = parseInt(p[1].replace(/,/g, ''), 10) || 0, avg = parseInt(p[2].replace(/,/g, ''), 10) || 0;
      rows.push({ status: p[0], views: views, avg_views: avg || null, seconds: durationSeconds(p[3]) || 0,
        avg_seconds: durationSeconds(p[4]), webcasts: avg ? Math.round(views / avg) : 0 });
    });
    return rows;
  }

  // 'ceo' = chief executive, president, managing director, founder or executive chair;
  // 'cfo' = finance chief; 'chief' = any other chief officer; 'chair' = a board chair who is not
  // an executive (counted separately, never as C-suite). Vice presidents are not C-suite.
  function executiveLevel(title) {
    var t = ' ' + String(title || '').toLowerCase().replace(/vice[\s-]*president/g, 'vp').replace(/[.,&\/()\u2013\u2014-]/g, ' ').replace(/\s+/g, ' ') + ' ';
    if (/ ceo | chief executive| president | managing director | md | founder /.test(t)) return 'ceo';
    if (/ executive (co )?chair/.test(t) && !/ non executive /.test(t)) return 'ceo';
    if (/ cfo | chief financial| finance director | financial director /.test(t)) return 'cfo';
    if (/ c[a-z]o | chief [a-z ]*officer/.test(t)) return 'chief';
    if (/ chair| chairman | chairwoman /.test(t)) return 'chair';
    return null;
  }

  function shortExchange(s) {
    if (!s) return '';
    var m = String(s).match(/\(([^)]+)\)/);
    if (m) return m[1];
    return String(s).replace(/ Stock Exchange| Securities Exchange/i, '').trim();
  }
  function shortTicker(s) {
    return String(s || '').split(':')[0];
  }

  // ── Drawing primitives ───────────────────────────────
  function Brief(doc) { this.doc = doc; }

  Brief.prototype.caps = function(text, x, y, opts) {
    opts = opts || {};
    this.doc.font(opts.font || 'black').fontSize(opts.size || 7).fillColor(opts.color || MUTED)
      .text(String(text).toUpperCase(), x, y, { characterSpacing: opts.spacing != null ? opts.spacing : 1.1, width: opts.width, align: opts.align || 'left', lineBreak: opts.width != null });
  };

  Brief.prototype.sectionTitle = function(title, y, kicker) {
    var doc = this.doc;
    doc.rect(M, y + 2, 3, 16).fill(ACCENT);
    doc.font('display').fontSize(17).fillColor(INK).text(title, M + 11, y, { lineBreak: false });
    if (kicker) {
      var w = doc.widthOfString(title);
      doc.font('regular').fontSize(8.5).fillColor(MUTED).text(kicker, M + 11 + w + 10, y + 6.5, { lineBreak: false });
    }
    doc.moveTo(M, y + 22).lineTo(PAGE_W - M, y + 22).lineWidth(0.5).strokeColor(RULE).stroke();
    return y + 31;
  };

  // Footers in Lato grey 700 under a thin rule. The last page is the back cover: the DGG stacked lockup
  // sits in its corner at 20 mm with denvergold.org beneath (guidelines 07), so its footer is taller.
  Brief.FOOTER_H = 40;
  Brief.BACK_FOOTER_H = 80;
  Brief.prototype.footer = function(pageNo, asOf, pages, opts) {
    var doc = this.doc, back = opts && opts.back, y = PAGE_H - (back ? Brief.BACK_FOOTER_H : Brief.FOOTER_H);
    doc.moveTo(M, y).lineTo(PAGE_W - M, y).lineWidth(0.5).strokeColor(RULE).stroke();
    var rightW = back ? 70 : 115, textW = CONTENT_W - rightW - 12;
    doc.font('regular').fontSize(7.2).fillColor(MUTED)
      .text('© ' + asOf.getUTCFullYear() + ' Denver Gold Group. Prepared for information only; it is not investment advice or a recommendation. ' +
        'Issuer data as supplied to Denver Gold Group by participating members and public market sources.',
        M, y + 8, { width: textW, lineGap: 1.2 });
    var ty = back ? doc.y + 6 : y + 8;
    doc.font('bold').fontSize(7.2).fillColor(TEXT)
      .text('Data as of ' + fmtDate(asOf), back ? M : PAGE_W - M - 115, ty, { width: back ? textW : 115, align: back ? 'left' : 'right', lineBreak: false });
    doc.font('regular').fontSize(7.2).fillColor(MUTED)
      .text('Page ' + pageNo + ' of ' + (pages || 2), back ? M : PAGE_W - M - 115, ty + 10, { width: back ? textW : 115, align: back ? 'left' : 'right', lineBreak: false });
    if (back && DGG) {
      var lw = 58, lh = lw * DGG.LOCKUPS.stacked.h / DGG.LOCKUPS.stacked.w, lx = PAGE_W - M - lw;   // 20 mm wide
      DGG.draw(doc, 'stacked', lx, y + 8, lh, DGG.NAVY);
      doc.font('bold').fontSize(7.2).fillColor(TEXT).text('denvergold.org', lx - 20, y + 8 + lh + 4, { width: lw + 40, align: 'center', lineBreak: false, link: 'https://www.denvergold.org' });
    }
  };

  // Horizontal bar list: label · bar · value (· secondary)
  Brief.prototype.barList = function(items, x, y, w, opts) {
    var doc = this.doc;
    opts = opts || {};
    var rowH = opts.rowH || 18, labelW = opts.labelW || 128, valueW = opts.valueW || 74;
    var barX = x + labelW + 6, barW = w - labelW - 6 - valueW - 6;
    var max = items.reduce(function(m, i) { return Math.max(m, i.count); }, 0) || 1;
    var totalCount = items.reduce(function(s, i) { return s + i.count; }, 0) || 1;
    items.forEach(function(it, i) {
      var ry = y + i * rowH;
      doc.font('regular').fontSize(8.3).fillColor(TEXT).text(it.label, x, ry + 2, { width: labelW, lineBreak: false, ellipsis: true });
      doc.roundedRect(barX, ry + 3.5, barW, 7, 1.5).fill(TRACK);
      var fw = Math.max(barW * it.count / max, 2);
      doc.roundedRect(barX, ry + 3.5, fw, 7, 1.5).fill(i === 0 && opts.leadDark ? ACCENT_DEEP : ACCENT);
      var vx = barX + barW + 6;
      if (opts.shareOnly) {
        doc.font('bold').fontSize(8.3).fillColor(INK).text(fmtPct(it.count / totalCount), vx, ry + 2, { width: valueW, align: 'right', lineBreak: false });
        return;
      }
      doc.font('bold').fontSize(8.3).fillColor(INK).text((opts.fmtValue || fmtInt)(it.count), vx, ry + 2, { width: 24, align: 'right', lineBreak: false });
      var second = opts.secondary ? opts.secondary(it) : fmtPct(it.count / totalCount);
      doc.font('regular').fontSize(7.8).fillColor(MUTED).text(second, vx + 28, ry + 2.4, { width: valueW - 28, align: 'right', lineBreak: false });
    });
    return y + items.length * rowH;
  };

  // Simple table. cols: [{label, w, align, font, get}]
  Brief.prototype.table = function(cols, rows, x, y, opts) {
    var doc = this.doc;
    opts = opts || {};
    var rowH = opts.rowH || 15.5, size = opts.size || 8.2;
    var totalW = cols.reduce(function(s, c) { return s + c.w; }, 0);
    var cx = x;
    doc.rect(x, y, totalW, 16).fill(INK);
    cols.forEach(function(c) {
      // Tighten the tracking, then the size, until the heading fits its column on one line
      var label = String(c.label).toUpperCase(), hs = 6.6, sp = 0.7;
      doc.font('bold');
      while (hs > 5.6 && doc.fontSize(hs).widthOfString(label, { characterSpacing: sp }) > c.w - 10) {
        if (sp > 0.15) sp -= 0.15; else hs -= 0.2;
      }
      doc.fontSize(hs).fillColor('#FFFFFF')
        .text(label, cx + 5, y + 5.2 + (6.6 - hs) / 2, { width: c.w - 8, align: c.align || 'left', characterSpacing: sp, lineBreak: false });
      cx += c.w;
    });
    y += 16;
    rows.forEach(function(r, i) {
      var isTotal = r.__total;
      if (isTotal) doc.rect(x, y, totalW, rowH).fill('#DDD8D2');
      else if (i % 2 === 1) doc.rect(x, y, totalW, rowH).fill(TRACK);
      cx = x;
      cols.forEach(function(c) {
        var val = c.get(r, i);
        if (c.draw) {
          c.draw(doc, r, cx, y, c.w, rowH);
        } else {
          doc.font(isTotal ? 'bold' : (c.font || 'regular')).fontSize(size).fillColor(c.color && !isTotal ? c.color : (isTotal ? INK : TEXT))
            .text(val == null ? '' : String(val), cx + 5, y + (rowH - size) / 2 - 0.6, { width: c.w - 10, align: c.align || 'left', lineBreak: false, ellipsis: true });
        }
        cx += c.w;
      });
      y += rowH;
    });
    doc.moveTo(x, y).lineTo(x + totalW, y).lineWidth(0.5).strokeColor(RULE).stroke();
    return y;
  };

  Brief.prototype.kpi = function(x, y, w, h, value, label, note, noteColor) {
    var doc = this.doc;
    doc.roundedRect(x, y, w, h, 3).fill(TINT);
    doc.rect(x, y, w, 3).fill(ACCENT);
    doc.font('display').fontSize(27).fillColor(INK).text(value, x + 9, y + 9, { width: w - 18, lineBreak: false });
    this.caps(label, x + 9, y + 40, { size: 6.4, spacing: 0.8, width: w - 18, color: TEXT });
    if (note) doc.font('regular').fontSize(7.2).fillColor(noteColor || MUTED).text(note, x + 9, y + 60, { width: w - 16, lineGap: 1, height: 30 });
  };

  // ── Sections ─────────────────────────────────────────
  // Each draws one block at y and returns the next y. The Analyst and Member briefings compose them.
  var sections = {};

  // Page one opens with the DGG header band (guidelines 07: #1B1416, white horizontal lockup flush left,
  // gold rule beneath), then the forum's own block on white: shield, eyebrow, Bebas title, dates.
  sections.headerBand = function(b, data, assets, kicker) {
    var doc = b.doc, evt = data.event;
    var start = parseDate(evt.start_date), end = parseDate(evt.end_date);
    var bandH = 32;
    doc.rect(0, 0, PAGE_W, bandH).fill(BAND);
    doc.rect(0, bandH, PAGE_W, 2).fill(DGG ? DGG.GOLD : ACCENT);
    if (DGG) DGG.draw(doc, 'horizontal', M, (bandH - 12.5) / 2, 12.5, '#FFFFFF');
    var top = bandH + 16, textX = M;
    if (assets.logos && assets.logos.event) {
      doc.image(assets.logos.event, M - 3, top - 3, { height: 68 });
      textX = M + 110;
    }
    b.caps(kicker, textX, top, { size: 7.5, spacing: 2.2, color: INK });
    doc.font('display').fontSize(30).fillColor(INK).text(evt.event_name, textX, top + 10, { lineBreak: false });
    var where = [evt.venue, evt.city].filter(Boolean).join(', ');
    doc.font('regular').fontSize(9.5).fillColor(TEXT).text(fmtDateRange(start, end) + (where ? '   ·   ' + where : ''), textX, top + 41, { lineBreak: false });
    doc.font('italic').fontSize(8).fillColor(MUTED)
      .text('Presented by the Denver Gold Group since 1989 · Connecting global mining with global capital.', textX, top + 55, { lineBreak: false });
    var y = top + 70;
    doc.rect(M, y, CONTENT_W, 2).fill(ACCENT);
    return y + 16;
  };

  sections.runningHead = function(b, data, kicker) {
    var doc = b.doc;
    doc.rect(0, 0, PAGE_W, 30).fill(CARD);
    doc.rect(0, 30, PAGE_W, 2).fill(ACCENT);
    b.caps(data.event.event_name, M, 11.5, { size: 7.2, spacing: 1.8, color: '#FFFFFF' });
    b.caps(kicker, PAGE_W - M - 300, 11.5, { size: 7.2, spacing: 1.8, color: ACCENT, width: 300, align: 'right' });
    return 46;
  };

  // Ordinals take a superscript suffix ("38TH annual", guidelines 09), set through Lato's own superior figures
  sections.lede = function(b, text, y) {
    var doc = b.doc, parts = String(text).split(/(\b\d+(?:st|nd|rd|th)\b)/), first = true;
    doc.font('regular').fontSize(10.4).fillColor(TEXT);
    var opts = function(cont, extra) { var o = { width: CONTENT_W, lineGap: 2.6, continued: cont, features: [] }; if (extra) for (var k in extra) o[k] = extra[k]; return o; };
    parts.forEach(function(part, i) {
      if (!part) return;
      var m = /^(\d+)(st|nd|rd|th)$/.exec(part), last = i === parts.length - 1;
      if (m) {
        if (first) doc.text(m[1], M, y, opts(true)); else doc.text(m[1], opts(true));
        doc.text(m[2], opts(!last, { features: ['sups'] }));
      } else if (first) doc.text(part, M, y, opts(!last));
      else doc.text(part, opts(!last));
      first = false;
    });
    return doc.y + 12;
  };

  // "up 12%" / "down 3%" for running text
  function upDown(v) { return fmtSigned(v).replace('+', 'up ').replace('−', 'down '); }

  // KPI tiles: [{v, l, n, c}] — at most five across
  sections.kpiRow = function(b, tiles, y) {
    tiles = tiles.slice(0, 5);
    var gap = 8, tw = (CONTENT_W - gap * (tiles.length - 1)) / tiles.length;
    tiles.forEach(function(t, i) { b.kpi(M + i * (tw + gap), y, tw, 96, t.v, t.l, t.n, t.c); });
    return y + 96 + 20;
  };

  // The standard tiles, each with last year's comparative where one exists
  sections.tile = function(s, evt, key) {
    var py = evt.year - 1;
    var versus = function(now, prior, fmtFn) { return prior ? fmtSigned(now / prior - 1) + ' vs ' + fmtFn(prior) + ' in ' + py : null; };
    var tone = function(now, prior) { return !prior ? MUTED : (now >= prior ? UP : DOWN); };
    switch (key) {
      case 'issuers': return { v: fmtInt(s.n), l: 'Participating issuers', n: versus(s.n, s.priorN, fmtInt) ||
        (s.meetingsOnly ? fmtInt(s.presenters) + ' presenting, ' + fmtInt(s.meetingsOnly) + ' meetings only' : null), c: tone(s.n, s.priorN) };
      case 'mcap': return { v: fmtUsd(s.mcap), l: 'Aggregate MC', n: versus(s.mcap, s.priorMcap, fmtUsd), c: tone(s.mcap, s.priorMcap) };
      case 'holdings': return s.holdings ? { v: fmtPct(s.holdings.ratio), l: 'Shareholding',
        n: versus(s.holdings.ratio, s.holdings.priorRatio, function(r) { return fmtPct(r); }), c: tone(s.holdings.ratio, s.holdings.priorRatio) } : null;
      case 'meetings': return s.meetings ? { v: fmtInt(s.meetings.shownTotal), l: (s.meetings.projected ? 'Proj. accepted meetings' : (s.meetings.informal ? '1x1 meetings' : 'Accepted meetings')),
        n: versus(s.meetings.shownTotal, s.meetings.priorFinal, fmtInt) || s.meetings.mean.toFixed(1) + ' per issuer', c: tone(s.meetings.shownTotal, s.meetings.priorFinal) } : null;
      case 'buyside': return s.buyside ? { v: fmtInt(s.buyside.value), l: (s.buyside.projected ? 'Proj. buy-side' : 'Buy-side'),
        n: versus(s.buyside.value, s.buyside.prior, fmtInt), c: tone(s.buyside.value, s.buyside.prior) } : null;
      case 'attendees': return s.audience ? { v: fmtInt(s.audience.total), l: (s.audience.projected ? 'Proj. attendees' : 'Attendees'),
        n: versus(s.audience.total, s.audience.prior, fmtInt) || (s.audience.countries.length ? 'from ' + s.audience.countries.length + ' countries' : null),
        c: tone(s.audience.total, s.audience.prior) } : null;
      case 'countries': return { v: fmtInt(s.countries), l: 'Countries of operation', n: fmtInt(s.exchanges) + ' stock exchanges' };
    }
    return null;
  };

  // Four bar charts on the issuer roster: stage, metal, operations, exchange
  sections.roster = function(b, s, y, opts) {
    opts = opts || {};
    var colW = (CONTENT_W - 24) / 2, x2 = M + colW + 24, rowH = opts.rowH || 19;
    var secondary = function(it) { return fmtUsd(it.mcap); };
    y = b.sectionTitle(opts.title || (opts.upcoming ? 'Who is taking part' : 'Who took part'), y, 'issuers and aggregate market cap');
    b.caps('By stage of development', M, y, { color: INK });
    b.caps('By primary metal', x2, y, { color: INK });
    var yL = b.barList(s.byStatus, M, y + 13, colW, { labelW: 138, valueW: 70, rowH: rowH, secondary: secondary });
    var yR = b.barList(s.byMineral, x2, y + 13, colW, { labelW: 84, valueW: 70, rowH: rowH, secondary: secondary });
    y = Math.max(yL, yR) + 16;
    if (opts.compact) return y;
    y = b.sectionTitle('Where they operate and list', y, 'issuers and aggregate market cap');
    b.caps('By primary operations', M, y, { color: INK });
    b.caps('By primary stock exchange', x2, y, { color: INK });
    yL = b.barList(s.byCountry, M, y + 13, colW, { labelW: 104, valueW: 70, rowH: rowH, secondary: secondary });
    yR = b.barList(s.byExchange, x2, y + 13, colW, { labelW: 84, valueW: 70, rowH: rowH, secondary: secondary });
    return Math.max(yL, yR);
  };

  sections.holdings = function(b, s, evt, y) {
    var doc = b.doc, h = s.holdings;
    y = b.sectionTitle('Shareholder representation', y, 'what attending investors already own');
    doc.font('display').fontSize(44).fillColor(INK).text(fmtPct(h.ratio), M, y - 6, { lineBreak: false });
    var bigW = doc.widthOfString(fmtPct(h.ratio));
    doc.font('regular').fontSize(9.6).fillColor(TEXT)
      .text('of aggregate event market cap is held by investors ' + (s.audience && s.audience.checkedIn ? 'who attended' : 'registered to attend') +
        (h.priorRatio != null ? ', against ' + fmtPct(h.priorRatio) + ' in ' + (evt.year - 1) : '') + ': ' +
        fmtUsd(h.held) + ' of ' + fmtUsd(h.mc) + ' across ' + fmtInt(h.members) + ' issuers.', M + bigW + 14, y + 2, { width: CONTENT_W - bigW - 14, lineGap: 2.2 });
    y += 40;
    var maxRatio = h.rows.reduce(function(m, r) { return Math.max(m, r.ratio || 0); }, 0) || 1;
    var tierRows = h.rows.concat([{ __total: true, label: 'All participating issuers', members: h.members, mc: h.mc, avg: h.avg, median: h.median, held: h.held, ratio: h.ratio }]);
    var cols = [
      { label: 'Market-cap tier', w: h.hasMedian ? 150 : 178, get: function(r) { return r.label; } },
      { label: 'Issuers', w: 62, align: 'right', get: function(r) { return fmtInt(r.members); } },
      { label: 'Market cap', w: 66, align: 'right', get: function(r) { return fmtUsd(r.mc); } },
      { label: 'Average', w: h.hasMedian ? 52 : 56, align: 'right', get: function(r) { return fmtUsd(r.avg); } }];
    if (h.hasMedian) cols.push({ label: 'Median', w: 52, align: 'right', get: function(r) { return r.median != null ? fmtUsd(r.median) : '—'; } });
    cols.push(
      { label: 'Attendee holdings', w: h.hasMedian ? 84 : 98, align: 'right', font: 'bold', get: function(r) { return fmtUsd(r.held); } },
      { label: 'Share held', w: h.hasMedian ? 74 : 80, get: function() { return ''; }, draw: function(d, r, cx, cy, cw, rh) {
        var bw = cw - 38;
        d.roundedRect(cx + 5, cy + rh / 2 - 3, bw, 6, 1.5).fill(r.__total ? RULE : TRACK);
        d.roundedRect(cx + 5, cy + rh / 2 - 3, Math.max(bw * (r.ratio || 0) / maxRatio, 1.5), 6, 1.5).fill(r.__total ? INK : ACCENT);
        d.font('bold').fontSize(8.2).fillColor(INK).text(fmtPct(r.ratio), cx + bw + 8, cy + rh / 2 - 4.7, { width: 27, align: 'right', lineBreak: false });
      } });
    y = b.table(cols, tierRows, M, y, { rowH: 15 });
    doc.font('italic').fontSize(7.2).fillColor(MUTED)
      .text('Attendee holdings: the value of shares in participating issuers held by investment firms ' + (s.audience && s.audience.checkedIn ? 'that attended the forum' : 'registered for the forum') +
        (h.hasMedian ? '. Median market cap from the event roster' : '') + '. Source: Denver Gold Group.', M, y + 5, { width: CONTENT_W });
    return y + 16;
  };

  sections.audience = function(b, s, y, opts) {
    var doc = b.doc, a = s.audience;
    opts = opts || {};
    y = b.sectionTitle(opts.title || 'The audience', y, fmtInt(a.total) + ' ' + a.phrase +
      (a.countries.length ? ' from ' + a.countries.length + ' countries' : ''));
    var colW = (CONTENT_W - 24) / 2;
    b.caps(a.mixLabel, M, y, { color: INK });
    b.caps('Buy-side by type', M + colW + 24, y, { color: INK });
    var rowH = opts.rowH || 15.5;
    var y1 = b.barList(a.mix, M, y + 13, colW, { labelW: 132, valueW: 62, rowH: rowH });
    var y2 = b.barList(a.buySubs, M + colW + 24, y + 13, colW, { labelW: 132, valueW: 62, rowH: rowH, shareOnly: a.projected });
    y = Math.max(y1, y2) + 2;
    if (a.projected) {
      doc.font('italic').fontSize(7).fillColor(MUTED)
        .text('Projected on-site attendance, rounded up to the nearest 10. Denver Gold Group projection allowing for late registration and attrition.',
          M, y, { width: CONTENT_W, lineBreak: false });
      y += 12;
    } else if (a.buyLifted) {
      doc.font('italic').fontSize(7).fillColor(MUTED)
        .text('Attendance as checked in. Buy-side includes investors on site who were not badged, a Denver Gold Group estimate.',
          M, y, { width: CONTENT_W, lineBreak: false });
      y += 12;
    }
    if (a.csuite && a.csuite.total && !opts.noCsuite) y = sections.csuite(b, s, y) + 2;
    return y;
  };

  // Where the audience came from: the top countries, the rest folded; attendees on the left, buy-side on the right
  sections.audienceCountries = function(b, s, y, maxRows) {
    var a = s.audience, colW = (CONTENT_W - 24) / 2;
    var fold = function(list) {
      var top = list.slice(0, maxRows - 1);
      var rest = list.slice(maxRows - 1).reduce(function(t, c) { return t + c.count; }, 0);
      if (rest > 0) top.push({ label: 'All other countries', count: rest });
      return top;
    };
    b.caps('Attendees by country', M, y, { color: INK });
    b.caps('Buy-side by country', M + colW + 24, y, { color: INK });
    var y1 = b.barList(fold(a.countries), M, y + 13, colW, { labelW: 132, valueW: 62, rowH: 15.5 });
    var y2 = b.barList(fold(a.buyCountries), M + colW + 24, y + 13, colW, { labelW: 132, valueW: 62, rowH: 15.5 });
    return Math.max(y1, y2);
  };

  // Average 1x1 meetings per issuer: by stage of development on the left, by primary metal on the right
  sections.meetingsByGroup = function(b, s, y, maxRows) {
    var m = s.meetings, colW = (CONTENT_W - 24) / 2;
    var word = m.projected ? ', projected' : '';
    // Value is the average; the grey figure beside it is the number of issuers in the group
    var opts = { labelW: 132, valueW: 62, rowH: 14, fmtValue: function(v) { return v.toFixed(1); },
      secondary: function(it) { return fmtInt(it.issuers); } };
    var rows = function(list) { return list.slice(0, maxRows).map(function(g) { return { label: g.label, count: g.avg, issuers: g.issuers }; }); };
    b.caps('Average meetings by stage' + word + ' (issuers)', M, y, { color: INK });
    b.caps('Average meetings by primary metal' + word + ' (issuers)', M + colW + 24, y, { color: INK });
    var y1 = b.barList(rows(m.byStatus), M, y + 13, colW, opts);
    var y2 = b.barList(rows(m.byMineral), M + colW + 24, y + 13, colW, opts);
    return Math.max(y1, y2);
  };

  sections.csuite = function(b, s, y) {
    var doc = b.doc, c = s.audience.csuite, boxH = 40;
    // Lead with the strongest true statement: how many issuers bring their chief executive
    var lead = c.ceoCompanies && c.issuers ? c.ceoCompanies / c.issuers : c.share;
    var past = s.audience.checkedIn;
    doc.roundedRect(M, y, CONTENT_W, boxH, 3).fill(TINT);
    doc.rect(M, y, 3, boxH).fill(ACCENT);
    doc.font('display').fontSize(30).fillColor(INK).text(fmtPct(lead), M + 13, y + 4, { lineBreak: false });
    var cw = doc.widthOfString(fmtPct(lead));
    var parts = [fmtInt(c.ceo) + ' CEOs, presidents and managing directors', fmtInt(c.cfo) + ' CFOs'];
    if (c.other) parts.push(fmtInt(c.other) + ' other chief officers');
    var breakdown = parts.join(', ').replace(/, ([^,]*)$/, ' and $1');
    var line;
    if (c.ceoCompanies && c.issuers) {
      line = 'of issuers ' + (past ? 'brought' : 'bring') + ' their chief executive, ' + fmtInt(c.ceoCompanies) + ' of ' + fmtInt(c.issuers) + '. ' +
        fmtInt(c.total) + ' of the ' + fmtInt(c.delegates) + (past ? ' corporate delegates who attended (' : ' registered corporate delegates (') + fmtPct(c.share) + ') ' +
        (past ? 'were' : 'are') + ' C-suite: ' + breakdown +
        (c.chairs ? '; ' + fmtInt(c.chairs) + ' board chairs also ' + (past ? 'attended.' : 'attend.') : '.');
    } else {
      line = 'of the ' + fmtInt(c.delegates) + ' corporate delegates ' + (past ? 'were' : 'are') + ' C-suite executives: ' + breakdown + '.';
    }
    var tx = M + 26 + cw;
    b.caps('C-suite representation', tx, y + 6, { size: 6.4, spacing: 1, color: INK });
    doc.font('regular').fontSize(8.4).fillColor(TEXT).text(line, tx, y + 15.5, { width: PAGE_W - M - tx - 10, lineGap: 1.2, height: 22, ellipsis: true });
    return y + boxH;
  };

  sections.meetings = function(b, s, evt, y) {
    var doc = b.doc, m = s.meetings;
    y = b.sectionTitle('1x1 meetings', y, 'between issuers and investors');
    var cells = [[fmtInt(m.shownTotal), m.projected ? 'meetings, projected final tally' : 'meetings held']];
    if (m.priorFinal) cells.push([fmtSigned(m.shownTotal / m.priorFinal - 1), 'against ' + fmtInt(m.priorFinal) + ' final meetings in ' + (evt.year - 1)]);
    var projWord = m.projected ? ', projected' : '';
    if (m.perIssuer != null) cells.push([m.perIssuer.toFixed(1), 'average per issuer' + projWord + ' (' + fmtInt(m.issuersWithMeetings) + ' of ' + fmtInt(s.n) + ' issuers accepting meetings)']);
    if (m.perInvestor != null) cells.push([m.perInvestor.toFixed(1), 'average per investor' + projWord + ' (' + fmtInt(m.investors) + ' investors)']);
    var cellW = CONTENT_W / cells.length;
    cells.forEach(function(cell, i) {
      var cx = M + i * cellW;
      if (i) doc.moveTo(cx - 8, y + 2).lineTo(cx - 8, y + 50).lineWidth(0.5).strokeColor(RULE).stroke();
      doc.font('display').fontSize(27).fillColor(INK).text(cell[0], cx, y - 2, { lineBreak: false });
      doc.font('regular').fontSize(7.8).fillColor(MUTED).text(cell[1], cx, y + 27, { width: cellW - 18, lineGap: 0.8, height: 30 });
    });
    y += 60;
    doc.font('italic').fontSize(7).fillColor(MUTED)
      .text((m.projected ? 'Scheduling is still open: the total is a Denver Gold Group projection of the final tally, based on confirmed bookings to date. ' : '') +
        (m.informal ? 'Includes Denver Gold Group’s estimate of informal meetings held outside the meeting system. ' : '') +
        'Source: Denver Gold Group meeting system.', M, y, { width: CONTENT_W, lineBreak: false });
    return y + 11;
  };

  // The metal table is built on September prices, so it only suits a forum held around then
  sections.marketFits = function(evt, metal) {
    var start = parseDate(evt.start_date), month = start ? start.getUTCMonth() : -1;
    return !!(metal && month >= 7 && month <= 9 && metal.SEP[evt.year] && metal.SEP[evt.year - 1]);
  };

  sections.market = function(b, evt, metal, y, opts) {
    var doc = b.doc, yr = evt.year;
    y = b.sectionTitle('Market backdrop', y, metal.MACRO_SEP ? 'metals and currencies into the forum' : 'metal prices into the forum');
    var order = [0, 1, 4, 2, 3]; // gold, silver, copper, platinum, palladium
    var row = function(name, sepNow, sepPrev, annNow, annPrev, fmt, neutral) {
      return { name: name, now: sepNow, prev: sepPrev, fmt: fmt, neutral: neutral,
        sepYoY: sepNow != null && sepPrev ? sepNow / sepPrev - 1 : null, annYoY: annNow != null && annPrev ? annNow / annPrev - 1 : null };
    };
    var mrows = order.map(function(idx) {
      var unit = metal.UNITS[idx];
      return row(metal.NAMES[idx], metal.SEP[yr][idx], metal.SEP[yr - 1][idx], metal.ANN[yr] ? metal.ANN[yr][idx] : null,
        metal.ANN[yr - 1] ? metal.ANN[yr - 1][idx] : null, function(v) { return fmtPrice(v, unit); });
    });
    // Comparators: the US dollar against the two big mining currencies, shown without a good/bad colour.
    var hasMacro = metal.MACRO_SEP && metal.MACRO_SEP[yr] && metal.MACRO_SEP[yr - 1];
    if (hasMacro) {
      var mf = [function(v) { return v == null ? '—' : 'C$' + v.toFixed(4); }, function(v) { return v == null ? '—' : 'A$' + v.toFixed(4); },
        function(v) { return v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 0 }); }];
      metal.MACRO_NAMES.forEach(function(name, i) {
        mrows.push(row(name, metal.MACRO_SEP[yr][i], metal.MACRO_SEP[yr - 1][i], metal.MACRO_ANN[yr] ? metal.MACRO_ANN[yr][i] : null,
          metal.MACRO_ANN[yr - 1] ? metal.MACRO_ANN[yr - 1][i] : null, mf[i] || mf[2], i < 2));
      });
    }
    var partial = metal.PARTIAL_SEP === yr;
    var chg = function(key) {
      return function(d, r, cx, cy, cw, rh) {
        var v = r[key];
        d.font('bold').fontSize(8.2).fillColor(v == null ? MUTED : (r.neutral ? INK : (v >= 0 ? UP : DOWN)))
          .text(fmtSigned(v), cx + 5, cy + rh / 2 - 4.7, { width: cw - 10, align: 'right', lineBreak: false });
      };
    };
    var rowH = opts && opts.rowH || 14;
    y = b.table([
      { label: 'Series', w: 150, font: 'bold', get: function(r) { return r.name; } },
      { label: 'September ' + (yr - 1), w: 95, align: 'right', get: function(r) { return r.fmt(r.prev); } },
      { label: 'September ' + yr + (partial ? ' †' : ''), w: 95, align: 'right', font: 'bold', get: function(r) { return r.fmt(r.now); } },
      { label: 'Change', w: 90, align: 'right', get: function() { return ''; }, draw: chg('sepYoY') },
      { label: '12 months to September', w: 110, align: 'right', get: function() { return ''; }, draw: chg('annYoY') }
    ], mrows, M, y, { rowH: rowH });
    doc.font('italic').fontSize(7).fillColor(MUTED)
      .text('Monthly averages; the last column compares the October–September year with the one before. Copper is the LME cash price. ' +
        (partial ? '† Part month, through ' + fmtDate(parseDate(metal.DATA_THROUGH)) + '. ' : '') + (hasMacro && metal.MACRO_NOTE ? metal.MACRO_NOTE : ''),
        M, y + 5, { width: CONTENT_W, lineGap: 1 });
    return doc.y + 4;
  };

  // Webcast performance: the RWP score, its four REEI components, and the score by issuer stage.
  // Indices only; the underlying view counts are never printed.
  sections.webcast = function(b, s, y, opts) {
    var doc = b.doc, w = s.webcast, all = w.all;
    opts = opts || {};
    var fmtIdx = function(v) { return v == null ? '—' : String(Math.round(v)); };
    var tone = function(v) { return v == null ? MUTED : (v >= 100 ? UP : DOWN); };
    y = b.sectionTitle('Webcast performance', y, 'relative to ' + w.priorYear + ' at the same point after its forum');
    // The headline score
    doc.font('display').fontSize(44).fillColor(all.rwp >= 100 ? INK : DOWN).text(fmtIdx(all.rwp), M, y - 6, { lineBreak: false });
    var bigW = doc.widthOfString(fmtIdx(all.rwp));
    doc.font('regular').fontSize(9.6).fillColor(TEXT)
      .text('Relative Webcast Performance (RWP) across ' + fmtInt(w.webcasts) + ' presentation webcasts, against ' + fmtInt(w.priorWebcasts) +
        ' in ' + w.priorYear + '. RWP averages four REEI indices, each scored against ' + w.priorYear + ' at the same point after its forum (= 100): ' +
        'Reach (views), Engagement (watch time per view), Efficiency (views per webcast) and Impact (total watch time).',
        M + bigW + 14, y + 2, { width: CONTENT_W - bigW - 14, lineGap: 2.2 });
    y += 46;
    var comps = [['Reach', all.reach, 'views'], ['Engagement', all.engagement, 'watch time per view'], ['Efficiency', all.efficiency, 'views per webcast'], ['Impact', all.impact, 'total watch time']];
    var gap = 8, tw = (CONTENT_W - gap * 3) / 4;
    comps.forEach(function(c, i) {
      var x = M + i * (tw + gap);
      doc.roundedRect(x, y, tw, 70, 3).fill(TINT);
      doc.rect(x, y, tw, 2.2).fill(c[1] == null ? MUTED : (c[1] >= 100 ? ACCENT : DOWN));
      doc.font('display').fontSize(27).fillColor(tone(c[1])).text(fmtIdx(c[1]), x + 9, y + 9, { lineBreak: false });
      b.caps(c[0], x + 9, y + 38, { size: 6.4, spacing: 0.8, color: TEXT });
      doc.font('regular').fontSize(7.2).fillColor(MUTED).text(c[2] + ', ' + w.priorYear + ' = 100', x + 9, y + 49, { width: tw - 16, lineBreak: false });
    });
    y += 70 + 10;
    // The webcast site itself, as a rate per 30 days so unequal spans compare
    if (s.site) {
      var st = s.site;
      doc.font('bold').fontSize(8.4).fillColor(INK).text('MiningForum.live', M, y, { link: 'https://www.miningforum.live', continued: true, width: CONTENT_W })
        .font('regular').fillColor(TEXT).text(', the forum’s webcast site, had ' + fmtInt(st.current.views) + ' views in ' + monthSpan(st.current.months) +
          ': ' + fmtInt(Math.round(st.current.rate)) + ' per 30 days, against ' + fmtInt(Math.round(st.prior.rate)) + ' per 30 days across ' +
          monthSpan(st.prior.months) + ' (', { link: null, continued: true })
        .font('bold').fillColor(st.yoy >= 0 ? UP : DOWN).text(fmtSigned(st.yoy), { continued: true })
        .font('regular').fillColor(TEXT).text(').', { continued: false });
      y = doc.y + 8;
    }
    if (w.byStatus.length && !opts.noTable) {
      var col = function(label, key) {
        return { label: label, w: 62, align: 'right', get: function() { return ''; }, draw: function(d, r, cx, cy, cw, rh) {
          var v = r.score[key];
          d.font(key === 'rwp' ? 'bold' : 'regular').fontSize(8.2).fillColor(tone(v)).text(fmtIdx(v), cx + 5, cy + rh / 2 - 4.7, { width: cw - 10, align: 'right', lineBreak: false });
        } };
      };
      y = b.table([
        { label: 'By stage of development', w: 168, get: function(r) { return r.label; } },
        { label: 'Webcasts', w: 62, align: 'right', get: function(r) { return fmtInt(r.score.webcasts); } },
        col('Reach', 'reach'), col('Engagement', 'engagement'), col('Efficiency', 'efficiency'), col('Impact', 'impact'), col('RWP', 'rwp')
      ], w.byStatus, M, y, { rowH: 15 });
      y += 5;
    }
    doc.font('italic').fontSize(7).fillColor(MUTED)
      .text('Green: at or above ' + w.priorYear + '; red: below. ' + (w.estimated ? w.priorYear + '’s same-point result is a Denver Gold Group estimate from its twelve-month total. ' : '') +
        'Stages with fewer than five webcasts in either year are not scored separately. Recordings are still being released, so ' + (w.priorYear + 1) + ' figures will rise. Source: webcast platform statistics. ' +
        (s.site ? 'Site views are a rate per 30 days over the months shown, the current month to date; last year’s span the forum month and the month after. Source: MiningForum.live analytics.' : ''),
        M, y, { width: CONTENT_W, lineGap: 1.2 });
    return doc.y;
  };

  sections.about = function(b, evt, y) {
    var doc = b.doc;
    y = b.sectionTitle('About the forum', y);
    doc.font('regular').fontSize(9.2).fillColor(TEXT)
      .text(evt.event_name + ' is organized by the Denver Gold Group, a not-for-profit association of the mining industry. ' +
        'It takes no commissions, deal flow or advisory fees from the issuers or investors that take part, ' +
        'and presenting issuers are scheduled on equal terms, by seniority. ', M, y, { width: CONTENT_W, lineGap: 2.2, continued: true })
      .font('bold').fillColor(INK).text('denvergold.org', { link: 'https://www.denvergold.org', underline: false, continued: false });
    return doc.y;
  };

  // Event partners: the firms that sponsored or supported the forum, as a name grid in four columns
  sections.partners = function(b, partners, y, opts) {
    var doc = b.doc, names = (partners || []).map(function(p) { return typeof p === 'string' ? p : p.sponsor_name; }).filter(Boolean);
    if (!names.length) return y;
    // Alphabetical, whatever order they were entered in
    names.sort(function(a, c) { return a.toLowerCase().localeCompare(c.toLowerCase()); });
    opts = opts || {};
    y = b.sectionTitle(opts.title || 'Event partners', y, opts.kicker || 'the firms that make the Forum more affordable and attractive to investors');
    var cols = 4, rowH = 14, colW = CONTENT_W / cols, rows = Math.ceil(names.length / cols);
    doc.rect(M, y - 2, CONTENT_W, rows * rowH + 8).fill(TINT);
    doc.rect(M, y - 2, CONTENT_W, 2.2).fill(ACCENT);
    names.forEach(function(n, i) {
      var c = i % cols, r = Math.floor(i / cols);
      doc.font('bold').fontSize(8.4).fillColor(TEXT).text(n, M + 9 + c * colW, y + 6 + r * rowH, { width: colW - 14, lineBreak: false, ellipsis: true });
    });
    return y + rows * rowH + 6;
  };

  // What is new in the presentation recordings this year: four features, each a tile
  sections.recordings = function(b, evt, y) {
    var doc = b.doc;
    y = b.sectionTitle('New this year: webcast enhancements', y, 'on every presentation webcast, a first for industry investor forums');
    var items = [
      ['Readable transcripts', 'Natural-language transcripts that read as prose while preserving every fact and the substance of what was said.'],
      ['Premium captioning', 'More precise captions on the video, with mining, financial and company terms rendered correctly.'],
      ['Summaries', 'A concise summary of each presentation, so a reader can decide in a minute whether to watch.'],
      ['Key moments', 'The moments that matter, built with a custom mining taxonomy and embedded as video chapters to jump straight to.']
    ];
    var gap = 8, tw = (CONTENT_W - gap * 3) / 4, th = 74;
    items.forEach(function(it, i) {
      var x = M + i * (tw + gap);
      doc.roundedRect(x, y, tw, th, 3).fill(TINT);
      doc.rect(x, y, tw, 2.2).fill(ACCENT);
      doc.font('display').fontSize(13).fillColor(INK).text(it[0], x + 9, y + 10, { width: tw - 18, lineBreak: false });
      doc.font('regular').fontSize(7.6).fillColor(TEXT).text(it[1], x + 9, y + 28, { width: tw - 18, lineGap: 1.2, height: th - 30, ellipsis: true });
    });
    return y + th;
  };

  // The forums to come, shown at the foot of each briefing's last page. Logos are /logos/<code>-logo.png;
  // admin.html and the node harness load one per entry into assets.logos[code].
  var NEXT_FORUMS = {
    2027: [
      { code: 'mfe27', event_name: 'Mining Forum Europe 2027', year: 2027, dates: '12–15 April 2027', venue: 'Park Hyatt Zürich', city: 'Zürich, Switzerland' },
      { code: 'mfa27', event_name: 'Mining Forum Americas 2027', year: 2027, dates: '19–22 September 2027', venue: 'The Broadmoor', city: 'Colorado Springs, Colorado' },
      { code: 'mfau27', event_name: 'Mining Forum Australia 2027', year: 2027, dates: '26–28 October 2027', venue: 'Hilton Sydney', city: 'Sydney, Australia' }
    ]
  };
  // The forums that follow the event of `year`
  function nextForums(year) { return NEXT_FORUMS[year + 1] || []; }

  // The forums to come: one card per forum with its logo, dates and venue
  sections.nextForums = function(b, forums, assets, y, opts) {
    var doc = b.doc;
    forums = (forums || []).filter(Boolean);
    if (!forums.length) return y;
    opts = opts || {};
    y = b.sectionTitle(opts.title || 'Join us in ' + forums[0].year, y, opts.kicker || 'the Denver Gold Group forums to come');
    // Logo across the top of each card, the words beneath it
    // Each card on its own forum's ground (guidelines 07.1), the shield as supplied on the forum colour
    var gap = 10, cw = (CONTENT_W - gap * (forums.length - 1)) / forums.length, ch = sections.nextForums.CARD_H, logoH = 50;
    forums.forEach(function(f, i) {
      var x = M + i * (cw + gap), tx = x + 10, tw = cw - 20;
      var g = FORUM[String(f.code).toLowerCase().replace(/\d+$/, '')] || FORUM.mfa;
      if (g.grad) {
        var grad = doc.linearGradient(x, y, x + cw, y + ch);
        grad.stop(0, g.grad[0]).stop(0.45, g.grad[1]).stop(1, g.grad[2]);
        doc.roundedRect(x, y, cw, ch, 4).fill(grad);
      } else doc.roundedRect(x, y, cw, ch, 4).fill(g.fill);
      var logo = assets && assets.logos && assets.logos[f.code.toLowerCase()];
      if (logo) doc.image(logo, x + 10, y + 9, { fit: [tw, logoH], align: 'center', valign: 'center' });
      b.caps(f.event_name, tx, y + logoH + 17, { size: 6.4, spacing: 0.9, color: g.eyebrow, width: tw });
      doc.font('display').fontSize(13).fillColor(g.text).text(f.dates, tx, y + logoH + 27, { width: tw, lineBreak: false });
      doc.font('regular').fontSize(8).fillColor(g.sub).text([f.venue, f.city].filter(Boolean).join('\n'), tx, y + logoH + 43, { width: tw, lineGap: 1 });
    });
    return y + ch;
  };
  sections.nextForums.CARD_H = 114;

  // ── Pages ────────────────────────────────────────────
  function pageOne(b, data, s, assets, asOf) {
    var evt = data.event;
    var start = parseDate(evt.start_date);
    var upcoming = start && asOf < start;
    var y = sections.headerBand(b, data, assets, 'Analyst briefing');

    var nth = evt.event_type === 'MFA' ? 'the ' + ordinal(evt.year - 1988) + ' annual ' : '';
    var lede = fmtInt(s.n) + ' mining issuers with an aggregate market capitalization of ' + fmtUsdWords(s.mcap) +
      (upcoming ? ' will take part in ' : ' took part in ') + nth + evt.event_name +
      (s.meetingsOnly ? ': ' + fmtInt(s.presenters) + (upcoming ? ' will present' : ' presented') + ' and ' + fmtInt(s.meetingsOnly) +
        (upcoming ? ' will take' : ' took') + ' 1x1 meetings only.' : '.');
    if (s.holdings && s.holdings.ratio != null) {
      lede += ' Investors ' + (s.audience && s.audience.checkedIn ? 'who attended the forum hold ' : 'registered for the forum hold ') + fmtUsdWords(s.holdings.held) + ' of those issuers’ shares, ' +
        fmtPct(s.holdings.ratio) + ' of aggregate event market cap' +
        (s.holdings.priorRatio != null ? ', against ' + fmtPct(s.holdings.priorRatio) + ' last year.' : '.');
    }
    if (s.priorN) {
      lede += ' The roster is ' + upDown(s.n / s.priorN - 1) + ' on ' + (evt.year - 1) +
        ' by issuer count and ' + upDown(s.mcap / s.priorMcap - 1) + ' by market value.';
    }
    y = sections.lede(b, lede, y);

    var tiles = ['issuers', 'mcap', 'holdings', 'meetings', 'buyside', 'countries']
      .map(function(k) { return sections.tile(s, evt, k); }).filter(Boolean);
    y = sections.kpiRow(b, tiles, y);
    sections.roster(b, s, y, { upcoming: upcoming });
    b.footer(1, asOf);
  }

  function pageTwo(b, data, s, metal, asOf) {
    var evt = data.event;
    var y = sections.runningHead(b, data, 'Analyst briefing');
    var hasMetal = sections.marketFits(evt, metal);
    // A sparser page gets more air between sections
    var n = (s.holdings ? 1 : 0) + (s.audience ? 1 : 0) + (s.meetings ? 1 : 0) + (hasMetal ? 1 : 0);
    var gapY = n >= 4 ? 8 : 26;
    if (s.holdings) y = sections.holdings(b, s, evt, y) + gapY;
    if (s.audience) y = sections.audience(b, s, y, { rowH: n >= 4 ? 14.5 : 15.5 }) + gapY;
    if (s.meetings) y = sections.meetings(b, s, evt, y) + gapY;
    if (hasMetal) y = sections.market(b, evt, metal, y, { rowH: n >= 4 ? 12.5 : 14 });
    // When a section is missing the page has room to spare: use it to say who stands behind the forum
    if (PAGE_H - Brief.FOOTER_H - 8 - y > 96) sections.about(b, evt, y + gapY);
    b.footer(2, asOf, 3);
  }

  // After the forum: meetings by stage and metal, the webcasts and what is new in them, the forums to come
  function pageThree(b, data, s, assets, asOf) {
    var evt = data.event;
    var y = sections.runningHead(b, data, 'Analyst briefing');
    if (s.meetings && s.meetings.byStatus && s.meetings.byStatus.length) {
      y = b.sectionTitle('1x1 meetings by stage and metal', y, 'average per issuer taking meetings');
      y = sections.meetingsByGroup(b, s, y, 8) + 14;
    }
    if (s.webcast) y = sections.webcast(b, s, y, { noTable: true }) + 10;
    y = sections.recordings(b, evt, y) + 10;
    var forums = nextForums(evt.year);
    if (forums.length) {
      var h = 31 + sections.nextForums.CARD_H, bottom = PAGE_H - Brief.BACK_FOOTER_H - 10;
      if (bottom - y > h + 70) y = sections.about(b, evt, y) + 10;
      sections.nextForums(b, forums, assets, Math.max(y, bottom - h));
    } else if (PAGE_H - Brief.BACK_FOOTER_H - y > 70) sections.about(b, evt, y);
    b.footer(3, asOf, 3, { back: true });
  }

  // ── Entry point ──────────────────────────────────────
  function generate(PDFDocument, data, assets, metal) {
    var asOf = data.generated_at ? new Date(data.generated_at) : new Date();
    var evt = data.event;
    var doc = new PDFDocument({
      size: 'LETTER', margin: 0, autoFirstPage: true,
      info: {
        Title: evt.event_name + ' — Analyst Briefing',
        Author: 'Denver Gold Group',
        Subject: 'Key data points for ' + evt.event_name,
        Keywords: 'mining, gold, silver, copper, investor forum'
      }
    });
    var f = assets.fonts;
    doc.registerFont('regular', f.regular);
    doc.registerFont('bold', f.bold);
    doc.registerFont('black', f.black || f.bold);
    doc.registerFont('light', f.light || f.regular);
    doc.registerFont('italic', f.italic || f.regular);
    doc.registerFont('display', f.display || f.serif);

    var s = summarise(data, asOf);
    var b = new Brief(doc);
    pageOne(b, data, s, assets, asOf);
    doc.addPage({ size: 'LETTER', margin: 0 });
    pageTwo(b, data, s, metal, asOf);
    doc.addPage({ size: 'LETTER', margin: 0 });
    pageThree(b, data, s, assets, asOf);
    return doc;
  }

  var api = { generate: generate, summarise: summarise, sections: sections, nextForums: nextForums, NEXT_FORUMS: NEXT_FORUMS,
    // Shared with the Member Post-Show Briefing (member-brief.js)
    Brief: Brief, fmt: { int: fmtInt, usd: fmtUsd, usdWords: fmtUsdWords, pct: fmtPct, signed: fmtSigned, price: fmtPrice, date: fmtDate, dateRange: fmtDateRange, ordinal: ordinal, parseDate: parseDate },
    style: { INK: INK, ACCENT: ACCENT, ACCENT: ACCENT, INK: INK, TEXT: TEXT, MUTED: MUTED, RULE: RULE, TINT: TINT, TRACK: TRACK, UP: UP, DOWN: DOWN, PAGE_W: PAGE_W, PAGE_H: PAGE_H, M: M, CONTENT_W: CONTENT_W } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AnalystBrief = api;
})(typeof window !== 'undefined' ? window : this);
