// Analyst Briefing — a two-page, vector PDF summarizing an event for sell-side analysts.
// Pure layout: takes a PDFKit constructor, the 'analyst-brief-data' API payload, binary assets
// (fonts + logos) and the shared metal history, and returns the PDFKit document.
// Runs unchanged in the browser (pdfkit.standalone) and in node (tests).
(function(root) {
  'use strict';

  // The site's standing attendee projection rule (shared with the attendees view)
  var Projection = (typeof module !== 'undefined' && module.exports)
    ? require('./attendee-projection.js') : root.AttendeeProjection;

  // ── Brand ────────────────────────────────────────────
  var INK = '#0B0B0B';
  var GOLD = '#C4993B';
  var GOLD_DARK = '#8F6E22';
  var TEXT = '#2B2B2B';
  var MUTED = '#77736A';
  var RULE = '#E2DDD0';
  var TINT = '#F8F5EE';
  var TRACK = '#EFEAE0';
  var UP = '#1E7B45';
  var DOWN = '#B03A2E';

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
  function fmtDate(d) {
    return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
  }
  function fmtDateRange(a, b) {
    if (!a) return '';
    if (!b || a.getTime() === b.getTime()) return fmtDate(a);
    if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) {
      return MONTHS[a.getUTCMonth()] + ' ' + a.getUTCDate() + '–' + b.getUTCDate() + ', ' + a.getUTCFullYear();
    }
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
        var titled = people;
        csuite = {
          delegates: titled.length, ceo: ceo, cfo: cfo, other: otherChief, chairs: chairs, mds: mds, total: ceo + cfo + otherChief,
          share: (ceo + cfo + otherChief) / titled.length,
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
        if (c) { issuersMeeting[c.company_name] = 1; issuerMeetings += Number(t.meeting_count); }
      });
      var nIssuers = Object.keys(issuersMeeting).length;
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
        perInvestor: nInvestors && investorMeetings ? investorMeetings * factor / nInvestors : null,
        investors: Number(inputs.investors_with_meetings) || null,
        investorFirms: Number(inputs.investor_firms) || null
      };
    }

    // Shareholder representation
    var holdings = null;
    if (data.holdings && data.holdings.length) {
      var rows = data.holdings.map(function(h) {
        var mc = Number(h.total_mc) || 0, held = Number(h.attendee_holdings) || 0;
        return { label: h.mc_range, members: Number(h.members) || 0, mc: mc, avg: Number(h.average_mc) || 0, held: held, ratio: mc ? held / mc : null };
      });
      var tMc = rows.reduce(function(s, r) { return s + r.mc; }, 0);
      var tHeld = rows.reduce(function(s, r) { return s + r.held; }, 0);
      var tMembers = rows.reduce(function(s, r) { return s + r.members; }, 0);
      holdings = { rows: rows, mc: tMc, held: tHeld, members: tMembers, ratio: tMc ? tHeld / tMc : null, avg: tMembers ? tMc / tMembers : 0,
        priorRatio: inputs.holdings_ratio_prior != null ? Number(inputs.holdings_ratio_prior) : null };
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
      top: top, audience: audience, meetings: meetings, holdings: holdings, buyside: buyside, upcoming: upcoming
    };
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
    this.doc.font(opts.font || 'bold').fontSize(opts.size || 7).fillColor(opts.color || MUTED)
      .text(String(text).toUpperCase(), x, y, { characterSpacing: opts.spacing != null ? opts.spacing : 1.1, width: opts.width, align: opts.align || 'left', lineBreak: opts.width != null });
  };

  Brief.prototype.sectionTitle = function(title, y, kicker) {
    var doc = this.doc;
    doc.rect(M, y + 3, 3, 14).fill(GOLD);
    doc.font('serif').fontSize(14).fillColor(INK).text(title, M + 11, y, { lineBreak: false });
    if (kicker) {
      var w = doc.widthOfString(title);
      doc.font('regular').fontSize(8.5).fillColor(MUTED).text(kicker, M + 11 + w + 10, y + 5.5, { lineBreak: false });
    }
    doc.moveTo(M, y + 22).lineTo(PAGE_W - M, y + 22).lineWidth(0.5).strokeColor(RULE).stroke();
    return y + 31;
  };

  Brief.prototype.footer = function(pageNo, asOf) {
    var doc = this.doc, y = PAGE_H - 40;
    doc.moveTo(M, y).lineTo(PAGE_W - M, y).lineWidth(0.75).strokeColor(GOLD).stroke();
    doc.font('regular').fontSize(6.8).fillColor(MUTED)
      .text('© ' + asOf.getUTCFullYear() + ' Denver Gold Group. Prepared for information only; it is not investment advice or a recommendation. ' +
        'Issuer data as supplied to Denver Gold Group by participating members and public market sources.',
        M, y + 7, { width: CONTENT_W - 120, lineGap: 1 });
    doc.font('bold').fontSize(6.8).fillColor(TEXT)
      .text('Data as of ' + fmtDate(asOf), PAGE_W - M - 115, y + 7, { width: 115, align: 'right', lineBreak: false });
    doc.font('regular').fontSize(6.8).fillColor(MUTED)
      .text('Page ' + pageNo + ' of 2', PAGE_W - M - 115, y + 16.5, { width: 115, align: 'right', lineBreak: false });
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
      doc.roundedRect(barX, ry + 3.5, fw, 7, 1.5).fill(i === 0 && opts.leadDark ? GOLD_DARK : GOLD);
      var vx = barX + barW + 6;
      if (opts.shareOnly) {
        doc.font('bold').fontSize(8.3).fillColor(INK).text(fmtPct(it.count / totalCount), vx, ry + 2, { width: valueW, align: 'right', lineBreak: false });
        return;
      }
      doc.font('bold').fontSize(8.3).fillColor(INK).text(fmtInt(it.count), vx, ry + 2, { width: 24, align: 'right', lineBreak: false });
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
      if (isTotal) doc.rect(x, y, totalW, rowH).fill('#EFE7D3');
      else if (i % 2 === 1) doc.rect(x, y, totalW, rowH).fill(TINT);
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
    doc.rect(x, y, w, 2.2).fill(GOLD);
    doc.font('serif').fontSize(22).fillColor(INK).text(value, x + 9, y + 11, { width: w - 18, lineBreak: false });
    this.caps(label, x + 9, y + 40, { size: 6.4, spacing: 0.8, width: w - 18, color: TEXT });
    if (note) doc.font('regular').fontSize(7.2).fillColor(noteColor || MUTED).text(note, x + 9, y + 60, { width: w - 16, lineGap: 1, height: 30 });
  };

  // ── Sections ─────────────────────────────────────────
  // Each draws one block at y and returns the next y. The Analyst and Member briefings compose them.
  var sections = {};

  sections.headerBand = function(b, data, assets, kicker) {
    var doc = b.doc, evt = data.event;
    var start = parseDate(evt.start_date), end = parseDate(evt.end_date);
    doc.rect(0, 0, PAGE_W, 116).fill(INK);
    doc.rect(0, 116, PAGE_W, 2.5).fill(GOLD);
    var textX = M;
    if (assets.logos && assets.logos.event) {
      doc.image(assets.logos.event, M - 4, 17, { height: 82 });
      textX = M + 128;
    }
    if (assets.logos && assets.logos.dgg) doc.image(assets.logos.dgg, PAGE_W - M - 62, 30, { height: 52 });
    b.caps(kicker, textX, 30, { size: 7.5, spacing: 2.2, color: GOLD });
    doc.font('serif').fontSize(23).fillColor('#FFFFFF').text(evt.event_name, textX, 42, { lineBreak: false });
    var where = [evt.venue, evt.city].filter(Boolean).join(', ');
    doc.font('regular').fontSize(9.5).fillColor('#D9D4C7').text(fmtDateRange(start, end) + (where ? '   ·   ' + where : ''), textX, 73, { lineBreak: false });
    doc.font('italic').fontSize(8).fillColor('#A9A498')
      .text('Presented by the Denver Gold Group since 1989. Matching global capital with global mining.', textX, 88, { lineBreak: false });
    return 134;
  };

  sections.runningHead = function(b, data, kicker) {
    var doc = b.doc;
    doc.rect(0, 0, PAGE_W, 30).fill(INK);
    doc.rect(0, 30, PAGE_W, 2).fill(GOLD);
    b.caps(data.event.event_name, M, 11.5, { size: 7.2, spacing: 1.8, color: '#FFFFFF' });
    b.caps(kicker, PAGE_W - M - 190, 11.5, { size: 7.2, spacing: 1.8, color: GOLD, width: 190, align: 'right' });
    return 46;
  };

  sections.lede = function(b, text, y) {
    b.doc.font('regular').fontSize(10.4).fillColor(TEXT).text(text, M, y, { width: CONTENT_W, lineGap: 2.6 });
    return b.doc.y + 12;
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
      case 'issuers': return { v: fmtInt(s.n), l: 'Issuers presenting', n: versus(s.n, s.priorN, fmtInt), c: tone(s.n, s.priorN) };
      case 'mcap': return { v: fmtUsd(s.mcap), l: 'Aggregate MC', n: versus(s.mcap, s.priorMcap, fmtUsd), c: tone(s.mcap, s.priorMcap) };
      case 'holdings': return s.holdings ? { v: fmtPct(s.holdings.ratio), l: 'Shareholding',
        n: versus(s.holdings.ratio, s.holdings.priorRatio, function(r) { return fmtPct(r); }), c: tone(s.holdings.ratio, s.holdings.priorRatio) } : null;
      case 'meetings': return s.meetings ? { v: fmtInt(s.meetings.shownTotal), l: (s.meetings.projected ? 'Proj. accepted meetings' : (s.meetings.informal ? 'One-on-one meetings' : 'Accepted meetings')),
        n: versus(s.meetings.shownTotal, s.meetings.priorFinal, fmtInt) || s.meetings.mean.toFixed(1) + ' per issuer', c: tone(s.meetings.shownTotal, s.meetings.priorFinal) } : null;
      case 'buyside': return s.buyside ? { v: fmtInt(s.buyside.value), l: (s.buyside.projected ? 'Proj. buy-side' : 'Buy-side investors'),
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
    y = b.sectionTitle(opts.title || 'Who is presenting', y, 'issuers and aggregate market cap');
    b.caps('By stage of development', M, y, { color: GOLD_DARK });
    b.caps('By primary metal', x2, y, { color: GOLD_DARK });
    var yL = b.barList(s.byStatus, M, y + 13, colW, { labelW: 138, valueW: 70, rowH: rowH, secondary: secondary });
    var yR = b.barList(s.byMineral, x2, y + 13, colW, { labelW: 84, valueW: 70, rowH: rowH, secondary: secondary });
    y = Math.max(yL, yR) + 16;
    if (opts.compact) return y;
    y = b.sectionTitle('Where they operate and list', y, 'issuers and aggregate market cap');
    b.caps('By primary operations', M, y, { color: GOLD_DARK });
    b.caps('By primary stock exchange', x2, y, { color: GOLD_DARK });
    yL = b.barList(s.byCountry, M, y + 13, colW, { labelW: 104, valueW: 70, rowH: rowH, secondary: secondary });
    yR = b.barList(s.byExchange, x2, y + 13, colW, { labelW: 84, valueW: 70, rowH: rowH, secondary: secondary });
    return Math.max(yL, yR);
  };

  sections.holdings = function(b, s, evt, y) {
    var doc = b.doc, h = s.holdings;
    y = b.sectionTitle('Shareholder representation', y, 'what attending investors already own');
    doc.font('serif').fontSize(38).fillColor(GOLD_DARK).text(fmtPct(h.ratio), M, y - 4, { lineBreak: false });
    var bigW = doc.widthOfString(fmtPct(h.ratio));
    doc.font('regular').fontSize(9.6).fillColor(TEXT)
      .text('of aggregate event market cap is held by investors ' + (s.audience && s.audience.checkedIn ? 'who attended' : 'registered to attend') +
        (h.priorRatio != null ? ', against ' + fmtPct(h.priorRatio) + ' in ' + (evt.year - 1) : '') + ': ' +
        fmtUsd(h.held) + ' of ' + fmtUsd(h.mc) + ' across ' + fmtInt(h.members) + ' issuers.', M + bigW + 14, y + 2, { width: CONTENT_W - bigW - 14, lineGap: 2.2 });
    y += 40;
    var maxRatio = h.rows.reduce(function(m, r) { return Math.max(m, r.ratio || 0); }, 0) || 1;
    var tierRows = h.rows.concat([{ __total: true, label: 'All participating issuers', members: h.members, mc: h.mc, avg: h.avg, held: h.held, ratio: h.ratio }]);
    y = b.table([
      { label: 'Market-cap tier', w: 178, get: function(r) { return r.label; } },
      { label: 'Issuers', w: 62, align: 'right', get: function(r) { return fmtInt(r.members); } },
      { label: 'Market cap', w: 66, align: 'right', get: function(r) { return fmtUsd(r.mc); } },
      { label: 'Average', w: 56, align: 'right', get: function(r) { return fmtUsd(r.avg); } },
      { label: 'Attendee holdings', w: 98, align: 'right', font: 'bold', get: function(r) { return fmtUsd(r.held); } },
      { label: 'Share held', w: 80, get: function() { return ''; }, draw: function(d, r, cx, cy, cw, rh) {
        var bw = cw - 38;
        d.roundedRect(cx + 5, cy + rh / 2 - 3, bw, 6, 1.5).fill(r.__total ? '#DDD2B4' : TRACK);
        d.roundedRect(cx + 5, cy + rh / 2 - 3, Math.max(bw * (r.ratio || 0) / maxRatio, 1.5), 6, 1.5).fill(r.__total ? INK : GOLD);
        d.font('bold').fontSize(8.2).fillColor(INK).text(fmtPct(r.ratio), cx + bw + 8, cy + rh / 2 - 4.7, { width: 27, align: 'right', lineBreak: false });
      } }
    ], tierRows, M, y, { rowH: 16 });
    doc.font('italic').fontSize(7.2).fillColor(MUTED)
      .text('Attendee holdings: the value of shares in participating issuers held by investment firms ' + (s.audience && s.audience.checkedIn ? 'that attended the forum' : 'registered for the forum') + '. Source: Denver Gold Group.', M, y + 5, { width: CONTENT_W });
    return y + 16;
  };

  sections.audience = function(b, s, y, opts) {
    var doc = b.doc, a = s.audience;
    opts = opts || {};
    y = b.sectionTitle(opts.title || 'The audience', y, fmtInt(a.total) + ' ' + a.phrase +
      (a.countries.length ? ' from ' + a.countries.length + ' countries' : ''));
    var colW = (CONTENT_W - 24) / 2;
    b.caps(a.mixLabel, M, y, { color: GOLD_DARK });
    b.caps('Buy-side by type', M + colW + 24, y, { color: GOLD_DARK });
    var y1 = b.barList(a.mix, M, y + 13, colW, { labelW: 132, valueW: 62, rowH: 15.5 });
    var y2 = b.barList(a.buySubs, M + colW + 24, y + 13, colW, { labelW: 132, valueW: 62, rowH: 15.5, shareOnly: a.projected });
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
    b.caps('Attendees by country', M, y, { color: GOLD_DARK });
    b.caps('Buy-side investors by country', M + colW + 24, y, { color: GOLD_DARK });
    var y1 = b.barList(fold(a.countries), M, y + 13, colW, { labelW: 132, valueW: 62, rowH: 15.5 });
    var y2 = b.barList(fold(a.buyCountries), M + colW + 24, y + 13, colW, { labelW: 132, valueW: 62, rowH: 15.5 });
    return Math.max(y1, y2);
  };

  sections.csuite = function(b, s, y) {
    var doc = b.doc, c = s.audience.csuite, boxH = 40;
    // Lead with the strongest true statement: how many issuers bring their chief executive
    var lead = c.ceoCompanies && c.issuers ? c.ceoCompanies / c.issuers : c.share;
    var past = s.audience.checkedIn;
    doc.roundedRect(M, y, CONTENT_W, boxH, 3).fill(TINT);
    doc.rect(M, y, 3, boxH).fill(GOLD);
    doc.font('serif').fontSize(26).fillColor(GOLD_DARK).text(fmtPct(lead), M + 13, y + 5, { lineBreak: false });
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
    b.caps('C-suite representation', tx, y + 6, { size: 6.4, spacing: 1, color: GOLD_DARK });
    doc.font('regular').fontSize(8.4).fillColor(TEXT).text(line, tx, y + 15.5, { width: PAGE_W - M - tx - 10, lineGap: 1.2, height: 22, ellipsis: true });
    return y + boxH;
  };

  sections.meetings = function(b, s, evt, y) {
    var doc = b.doc, m = s.meetings;
    y = b.sectionTitle('One-on-one meetings', y, 'between issuers and investors');
    var cells = [[fmtInt(m.shownTotal), m.projected ? 'meetings, projected final tally' : 'meetings held']];
    if (m.priorFinal) cells.push([fmtSigned(m.shownTotal / m.priorFinal - 1), 'against ' + fmtInt(m.priorFinal) + ' final meetings in ' + (evt.year - 1)]);
    var projWord = m.projected ? ', projected' : '';
    if (m.perIssuer != null) cells.push([m.perIssuer.toFixed(1), 'average per issuer' + projWord + ' (' + fmtInt(m.issuersWithMeetings) + ' of ' + fmtInt(s.n) + ' issuers accepting meetings)']);
    if (m.perInvestor != null) cells.push([m.perInvestor.toFixed(1), 'average per investor' + projWord + ' (' + fmtInt(m.investors) + ' investors)']);
    var cellW = CONTENT_W / cells.length;
    cells.forEach(function(cell, i) {
      var cx = M + i * cellW;
      if (i) doc.moveTo(cx - 8, y + 2).lineTo(cx - 8, y + 50).lineWidth(0.5).strokeColor(RULE).stroke();
      doc.font('serif').fontSize(22).fillColor(i === 0 ? GOLD_DARK : INK).text(cell[0], cx, y, { lineBreak: false });
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

  sections.market = function(b, evt, metal, y) {
    var doc = b.doc, yr = evt.year;
    y = b.sectionTitle('Market backdrop', y, 'metal prices into the forum');
    var order = [0, 1, 4, 2, 3]; // gold, silver, copper, platinum, palladium
    var mrows = order.map(function(idx) {
      var sepNow = metal.SEP[yr][idx], sepPrev = metal.SEP[yr - 1][idx];
      var annNow = metal.ANN[yr] ? metal.ANN[yr][idx] : null, annPrev = metal.ANN[yr - 1] ? metal.ANN[yr - 1][idx] : null;
      return { name: metal.NAMES[idx], unit: metal.UNITS[idx], now: sepNow, prev: sepPrev,
        sepYoY: sepNow != null && sepPrev ? sepNow / sepPrev - 1 : null, annYoY: annNow != null && annPrev ? annNow / annPrev - 1 : null };
    });
    var partial = metal.PARTIAL_SEP === yr;
    var chg = function(key) {
      return function(d, r, cx, cy, cw, rh) {
        var v = r[key];
        d.font('bold').fontSize(8.2).fillColor(v == null ? MUTED : (v >= 0 ? UP : DOWN))
          .text(fmtSigned(v), cx + 5, cy + rh / 2 - 4.7, { width: cw - 10, align: 'right', lineBreak: false });
      };
    };
    y = b.table([
      { label: 'Metal', w: 120, font: 'bold', get: function(r) { return r.name; } },
      { label: 'September ' + (yr - 1), w: 100, align: 'right', get: function(r) { return fmtPrice(r.prev, r.unit); } },
      { label: 'September ' + yr + (partial ? ' †' : ''), w: 100, align: 'right', font: 'bold', get: function(r) { return fmtPrice(r.now, r.unit); } },
      { label: 'Change', w: 100, align: 'right', get: function() { return ''; }, draw: chg('sepYoY') },
      { label: '12 months to September', w: 120, align: 'right', get: function() { return ''; }, draw: chg('annYoY') }
    ], mrows, M, y, { rowH: 14 });
    doc.font('italic').fontSize(7).fillColor(MUTED)
      .text('Monthly averages; the last column compares the October–September year with the one before. Copper is the LME cash price. ' +
        (partial ? '† Part month, through ' + fmtDate(parseDate(metal.DATA_THROUGH)) + '.' : ''), M, y + 5, { width: CONTENT_W, lineBreak: false });
    return y + 18;
  };

  sections.about = function(b, evt, y) {
    y = b.sectionTitle('About the forum', y);
    b.doc.font('regular').fontSize(9.2).fillColor(TEXT)
      .text(evt.event_name + ' is organized by the Denver Gold Group, a not-for-profit association of the mining industry. ' +
        'It takes no commissions, deal flow or advisory fees from the issuers or investors that take part, ' +
        'and presenting issuers are scheduled on equal terms, by seniority.', M, y, { width: CONTENT_W, lineGap: 2.2 });
    return b.doc.y;
  };

  // ── Pages ────────────────────────────────────────────
  function pageOne(b, data, s, assets, asOf) {
    var evt = data.event;
    var start = parseDate(evt.start_date);
    var upcoming = start && asOf < start;
    var y = sections.headerBand(b, data, assets, 'Analyst briefing');

    var nth = evt.event_type === 'MFA' ? 'the ' + ordinal(evt.year - 1988) + ' annual ' : '';
    var lede = fmtInt(s.n) + ' mining issuers with an aggregate market capitalization of ' + fmtUsdWords(s.mcap) +
      (upcoming ? ' will present at ' : ' presented at ') + nth + evt.event_name + '.';
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
    sections.roster(b, s, y);
    b.footer(1, asOf);
  }

  function pageTwo(b, data, s, metal, asOf) {
    var evt = data.event;
    var y = sections.runningHead(b, data, 'Analyst briefing');
    var hasMetal = sections.marketFits(evt, metal);
    // A sparser page gets more air between sections
    var n = (s.holdings ? 1 : 0) + (s.audience ? 1 : 0) + (s.meetings ? 1 : 0) + (hasMetal ? 1 : 0);
    var gapY = n >= 4 ? 16 : 26;
    if (s.holdings) y = sections.holdings(b, s, evt, y) + gapY;
    if (s.audience) y = sections.audience(b, s, y) + gapY;
    if (s.meetings) y = sections.meetings(b, s, evt, y) + gapY;
    if (hasMetal) y = sections.market(b, evt, metal, y);
    // When a section is missing the page has room to spare: use it to say who stands behind the forum
    if (PAGE_H - 48 - y > 96) sections.about(b, evt, y + gapY);
    b.footer(2, asOf);
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
    doc.registerFont('serif', f.serif);

    var s = summarise(data, asOf);
    var b = new Brief(doc);
    pageOne(b, data, s, assets, asOf);
    doc.addPage({ size: 'LETTER', margin: 0 });
    pageTwo(b, data, s, metal, asOf);
    return doc;
  }

  var api = { generate: generate, summarise: summarise, sections: sections,
    // Shared with the Member Post-Show Briefing (member-brief.js)
    Brief: Brief, fmt: { int: fmtInt, usd: fmtUsd, usdWords: fmtUsdWords, pct: fmtPct, signed: fmtSigned, price: fmtPrice, date: fmtDate, dateRange: fmtDateRange, ordinal: ordinal, parseDate: parseDate },
    style: { INK: INK, GOLD: GOLD, GOLD_DARK: GOLD_DARK, TEXT: TEXT, MUTED: MUTED, RULE: RULE, TINT: TINT, TRACK: TRACK, UP: UP, DOWN: DOWN, PAGE_W: PAGE_W, PAGE_H: PAGE_H, M: M, CONTENT_W: CONTENT_W } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AnalystBrief = api;
})(typeof window !== 'undefined' ? window : this);
