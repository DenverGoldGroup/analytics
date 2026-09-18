// Analyst Briefing — a two-page, vector PDF summarising an event for sell-side analysts.
// Pure layout: takes a PDFKit constructor, the 'analyst-brief-data' API payload, binary assets
// (fonts + logos) and the shared metal history, and returns the PDFKit document.
// Runs unchanged in the browser (pdfkit.standalone) and in node (tests).
(function(root) {
  'use strict';

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
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function fmtDateRange(a, b) {
    if (!a) return '';
    if (!b || a.getTime() === b.getTime()) return fmtDate(a);
    if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) {
      return a.getUTCDate() + '–' + b.getUTCDate() + ' ' + MONTHS[a.getUTCMonth()] + ' ' + a.getUTCFullYear();
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
      var k = r[key] || 'Other';
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

  function summarise(data) {
    var cur = data.companies || [], prior = data.companies_prior || [];
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
    var useAttended = attended.length > 0;
    var pool = useAttended ? attended : att;
    var audience = null;
    if (pool.length >= 10) {
      var buy = pool.filter(function(a) { return a.category === 'Buy-Side'; });
      var sell = pool.filter(function(a) { return a.category === 'Sell-Side'; });
      var delegates = pool.filter(function(a) { return a.type === 'Delegate'; });
      var otherN = pool.length - buy.length - sell.length - delegates.filter(function(a) {
        return a.category !== 'Buy-Side' && a.category !== 'Sell-Side';
      }).length;
      var subMap = {};
      buy.forEach(function(a) {
        var s = String(a.subcategory || 'Unclassified');
        s = s === 'Institutional Investor: Other' ? 'Other institutional' : s.replace('Institutional Investor: ', '');
        subMap[s] = (subMap[s] || 0) + 1;
      });
      var subs = Object.keys(subMap).map(function(k) { return { label: k, count: subMap[k] }; })
        .sort(function(a, b) { return b.count - a.count; });
      var subTop = subs.slice(0, 4);
      var subRest = subs.slice(4).reduce(function(s, x) { return s + x.count; }, 0);
      if (subRest) subTop.push({ label: 'All other types', count: subRest });

      // C-suite representation among corporate delegates, read from job titles
      var csuite = null;
      var titled = delegates.filter(function(a) { return a.job_title; });
      if (titled.length >= 10) {
        var ceo = 0, cfo = 0, otherChief = 0, ceoCompanies = {};
        titled.forEach(function(a) {
          var level = executiveLevel(a.job_title);
          if (level === 'ceo') { ceo++; if (a.member_id) ceoCompanies[a.member_id] = 1; }
          else if (level === 'cfo') cfo++;
          else if (level === 'chief') otherChief++;
        });
        var companyIds = {};
        delegates.forEach(function(a) { if (a.member_id) companyIds[a.member_id] = 1; });
        csuite = {
          delegates: titled.length, ceo: ceo, cfo: cfo, other: otherChief, total: ceo + cfo + otherChief,
          share: (ceo + cfo + otherChief) / titled.length,
          ceoCompanies: Object.keys(ceoCompanies).length, companies: Object.keys(companyIds).length
        };
      }

      var cMap = {};
      pool.forEach(function(a) { if (a.country) cMap[a.country] = (cMap[a.country] || 0) + 1; });
      var countries = Object.keys(cMap).map(function(k) { return { label: k, count: cMap[k] }; })
        .sort(function(a, b) { return b.count - a.count; });

      audience = {
        mode: useAttended ? 'Attended' : 'Registered',
        phrase: useAttended ? 'attendees checked in' : 'registered attendees',
        csuite: csuite,
        total: pool.length,
        buy: buy.length, sell: sell.length, delegates: delegates.length, other: Math.max(otherN, 0),
        mix: [
          { label: 'Buy-side investors', count: buy.length },
          { label: 'Corporate delegates', count: delegates.length },
          { label: 'Sell-side analysts & bankers', count: sell.length },
          { label: 'Other participants', count: Math.max(otherN, 0) }
        ].filter(function(x) { return x.count > 0; }),
        buySubs: subTop,
        countries: countries
      };
    }

    // 1x1 meetings, from the member rankings
    var members = (data.top_meetings || []).filter(function(t) { return t.ranking_type === 'member'; });
    var meetings = null;
    if (members.length) {
      var totalMeet = members.reduce(function(s, t) { return s + (Number(t.meeting_count) || 0); }, 0);
      var active = members.filter(function(t) { return (Number(t.meeting_count) || 0) > 0; });
      var hasInbound = members.some(function(t) { return t.inbound_requests != null; });
      var totalInbound = members.reduce(function(s, t) { return s + (Number(t.inbound_requests) || 0); }, 0);
      var ranked = members.slice().sort(function(a, b) {
        return hasInbound
          ? ((Number(b.inbound_requests) || 0) - (Number(a.inbound_requests) || 0)) || ((b.meeting_count || 0) - (a.meeting_count || 0))
          : (b.meeting_count || 0) - (a.meeting_count || 0);
      });
      meetings = {
        total: totalMeet, hosts: active.length,
        mean: active.length ? totalMeet / active.length : 0,
        hasInbound: hasInbound, totalInbound: totalInbound,
        busy: members.filter(function(t) { return (Number(t.meeting_count) || 0) >= 20; }).length,
        ranked: ranked
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
      holdings = { rows: rows, mc: tMc, held: tHeld, members: tMembers, ratio: tMc ? tHeld / tMc : null, avg: tMembers ? tMc / tMembers : 0 };
    }

    return {
      n: cur.length, mcap: total(cur), priorN: prior.length, priorMcap: total(prior),
      countries: distinct(cur, 'primary_country'), exchanges: distinct(cur, 'primary_stock_exchange'),
      byStatus: foldTail(groupBy(cur, 'company_status', function(k) { return STATUS_LABELS[k] || k; }), 7),
      byMineral: foldTail(groupBy(cur, 'primary_mineral'), 7),
      top: top, audience: audience, meetings: meetings, holdings: holdings
    };
  }

  // 'ceo' = chief executive, president, managing director, executive chair or founder;
  // 'cfo' = finance chief; 'chief' = any other C-level officer. Vice presidents are not C-suite.
  function executiveLevel(title) {
    var t = ' ' + String(title || '').toLowerCase().replace(/vice[\s-]*president/g, 'vp').replace(/[.,&\/()\u2013\u2014-]/g, ' ') + ' ';
    if (/ ceo | chief executive| president | managing director | executive chair| chairman | chairwoman | chair | founder /.test(t)) return 'ceo';
    if (/ cfo | chief financial| finance director | financial director /.test(t)) return 'cfo';
    if (/ c[a-z]o | chief [a-z ]*officer/.test(t)) return 'chief';
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
        'Company data as supplied to Denver Gold Group by participating members and public market sources.',
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
      doc.font('bold').fontSize(6.6).fillColor('#FFFFFF')
        .text(String(c.label).toUpperCase(), cx + 5, y + 5.2, { width: c.w - 10, align: c.align || 'left', characterSpacing: 0.7, lineBreak: false });
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
    if (note) doc.font('regular').fontSize(7.2).fillColor(noteColor || MUTED).text(note, x + 9, y + h - 15, { width: w - 14, lineBreak: false });
  };

  // ── Pages ────────────────────────────────────────────
  function pageOne(b, data, s, assets, asOf) {
    var doc = b.doc, evt = data.event;
    var start = parseDate(evt.start_date), end = parseDate(evt.end_date);
    var upcoming = start && asOf < start;

    // Header band
    doc.rect(0, 0, PAGE_W, 116).fill(INK);
    doc.rect(0, 116, PAGE_W, 2.5).fill(GOLD);
    var textX = M;
    if (assets.logos && assets.logos.event) {
      doc.image(assets.logos.event, M - 4, 17, { height: 82 });
      textX = M + 128;
    }
    if (assets.logos && assets.logos.dgg) doc.image(assets.logos.dgg, PAGE_W - M - 62, 30, { height: 52 });
    b.caps('Analyst briefing', textX, 30, { size: 7.5, spacing: 2.2, color: GOLD });
    doc.font('serif').fontSize(23).fillColor('#FFFFFF').text(evt.event_name, textX, 42, { lineBreak: false });
    var where = [evt.venue, evt.city].filter(Boolean).join(', ');
    doc.font('regular').fontSize(9.5).fillColor('#D9D4C7').text(fmtDateRange(start, end) + (where ? '   ·   ' + where : ''), textX, 73, { lineBreak: false });
    doc.font('italic').fontSize(8).fillColor('#A9A498').text('Presented by Denver Gold Group', textX, 88, { lineBreak: false });

    // Lede
    var y = 134;
    var nth = evt.event_type === 'MFA' ? 'the ' + ordinal(evt.year - 1988) + ' annual ' : '';
    var lede = fmtInt(s.n) + ' mining companies with a combined market capitalisation of ' + fmtUsdWords(s.mcap) +
      (upcoming ? ' will present at ' : ' presented at ') + nth + evt.event_name + '.';
    if (s.holdings && s.holdings.ratio != null) {
      lede += ' Investors registered for the forum hold ' + fmtUsdWords(s.holdings.held) + ' of those companies’ shares, ' +
        fmtPct(s.holdings.ratio) + ' of their combined value.';
    }
    if (s.priorN) {
      lede += ' The roster is ' + fmtSigned(s.n / s.priorN - 1).replace('+', 'up ').replace('−', 'down ') + ' on ' + (evt.year - 1) +
        ' by company count and ' + fmtSigned(s.mcap / s.priorMcap - 1).replace('+', 'up ').replace('−', 'down ') + ' by market value.';
    }
    doc.font('regular').fontSize(10.4).fillColor(TEXT).text(lede, M, y, { width: CONTENT_W, lineGap: 2.6 });
    y = doc.y + 12;

    // KPI tiles — take the first five that have data
    var tiles = [];
    tiles.push({ v: fmtInt(s.n), l: 'Companies presenting', n: s.priorN ? fmtSigned(s.n / s.priorN - 1) + ' vs ' + fmtInt(s.priorN) + ' in ' + (evt.year - 1) : null, c: s.n >= s.priorN ? UP : DOWN });
    tiles.push({ v: fmtUsd(s.mcap), l: 'Combined market cap', n: s.priorMcap ? fmtSigned(s.mcap / s.priorMcap - 1) + ' vs ' + fmtUsd(s.priorMcap) : null, c: s.mcap >= s.priorMcap ? UP : DOWN });
    if (s.holdings) tiles.push({ v: fmtUsd(s.holdings.held), l: 'Held by attending investors', n: fmtPct(s.holdings.ratio) + ' of market cap' });
    if (s.meetings) tiles.push({ v: fmtInt(s.meetings.total), l: '1x1 meetings ' + (upcoming ? 'booked' : 'held'), n: s.meetings.mean.toFixed(1) + ' per company' });
    if (s.audience) tiles.push({ v: fmtInt(s.audience.buy), l: 'Buy-side investors', n: 'of ' + fmtInt(s.audience.total) + ' ' + (s.audience.mode === 'Attended' ? 'checked in' : 'registered') });
    tiles.push({ v: fmtInt(s.countries), l: 'Countries of operation', n: fmtInt(s.exchanges) + ' stock exchanges' });
    tiles = tiles.slice(0, 5);
    var gap = 8, tw = (CONTENT_W - gap * (tiles.length - 1)) / tiles.length;
    tiles.forEach(function(t, i) { b.kpi(M + i * (tw + gap), y, tw, 78, t.v, t.l, t.n, t.c); });
    y += 78 + 20;

    // Composition
    y = b.sectionTitle('Who is presenting', y, 'companies and combined market cap');
    var colW = (CONTENT_W - 24) / 2;
    b.caps('By stage of development', M, y, { color: GOLD_DARK });
    b.caps('By primary metal', M + colW + 24, y, { color: GOLD_DARK });
    var secondary = function(it) { return fmtUsd(it.mcap); };
    var yL = b.barList(s.byStatus, M, y + 13, colW, { labelW: 138, valueW: 70, secondary: secondary });
    var yR = b.barList(s.byMineral, M + colW + 24, y + 13, colW, { labelW: 84, valueW: 70, secondary: secondary });
    y = Math.max(yL, yR) + 14;

    // Largest companies — as many rows as the page has room for
    y = b.sectionTitle('Largest participating companies', y, 'by market capitalisation');
    var room = Math.floor((PAGE_H - 58 - y - 16) / 15.5);
    var rows = s.top.slice(0, Math.max(5, Math.min(14, room)));
    b.table([
      { label: '#', w: 22, align: 'right', color: MUTED, get: function(r, i) { return i + 1; } },
      { label: 'Company', w: 186, font: 'bold', get: function(r) { return r.company_name; } },
      { label: 'Ticker', w: 58, get: function(r) { return shortTicker(r.ticker); } },
      { label: 'Exchange', w: 62, get: function(r) { return shortExchange(r.primary_stock_exchange); } },
      { label: 'Primary metal', w: 72, get: function(r) { return r.primary_mineral || ''; } },
      { label: 'Stage', w: 68, get: function(r) { return STATUS_SHORT[r.company_status] || r.company_status || ''; } },
      { label: 'Market cap', w: 72, align: 'right', font: 'bold', get: function(r) { return fmtUsd(r.market_cap_usd); } }
    ], rows, M, y);

    b.footer(1, asOf);
  }

  function pageTwo(b, data, s, metal, asOf) {
    var doc = b.doc, evt = data.event;
    var start = parseDate(evt.start_date);
    var upcoming = start && asOf < start;

    // Slim running head
    doc.rect(0, 0, PAGE_W, 30).fill(INK);
    doc.rect(0, 30, PAGE_W, 2).fill(GOLD);
    b.caps(evt.event_name, M, 11.5, { size: 7.2, spacing: 1.8, color: '#FFFFFF' });
    b.caps('Analyst briefing', PAGE_W - M - 150, 11.5, { size: 7.2, spacing: 1.8, color: GOLD, width: 150, align: 'right' });
    var y = 46;

    // A sparser page gets more air between sections
    // The metal table is built on September prices, so it only suits a forum held around then
    var month = start ? start.getUTCMonth() : -1;
    if (month < 7 || month > 9) metal = null;
    var sections = (s.holdings ? 1 : 0) + (s.audience ? 1 : 0) + (s.meetings ? 1 : 0) + (metal ? 1 : 0);
    var gapY = sections >= 4 ? 11 : 24;

    // ── Shareholder representation ──
    if (s.holdings) {
      var h = s.holdings;
      y = b.sectionTitle('Shareholder representation', y, 'what attending investors already own');
      doc.font('serif').fontSize(38).fillColor(GOLD_DARK).text(fmtPct(h.ratio), M, y - 4, { lineBreak: false });
      var bigW = doc.widthOfString(fmtPct(h.ratio));
      doc.font('regular').fontSize(9.6).fillColor(TEXT)
        .text('of participating companies’ combined market capitalisation is held by investors registered to attend: ' +
          fmtUsd(h.held) + ' of ' + fmtUsd(h.mc) + ' across ' + fmtInt(h.members) + ' companies. ' +
          leadTier(h), M + bigW + 14, y + 2, { width: CONTENT_W - bigW - 14, lineGap: 2.2 });
      y += 42;

      var maxRatio = h.rows.reduce(function(m, r) { return Math.max(m, r.ratio || 0); }, 0) || 1;
      var tierRows = h.rows.concat([{ __total: true, label: 'All participating companies', members: h.members, mc: h.mc, avg: h.avg, held: h.held, ratio: h.ratio }]);
      y = b.table([
        { label: 'Market-cap tier', w: 178, get: function(r) { return r.label; } },
        { label: 'Companies', w: 62, align: 'right', get: function(r) { return fmtInt(r.members); } },
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
        .text('Attendee holdings: the value of shares in participating companies held by investment firms registered for the forum. Source: Denver Gold Group.', M, y + 5, { width: CONTENT_W });
      y += 16 + gapY;
    }

    // ── Audience ──
    if (s.audience) {
      var a = s.audience;
      y = b.sectionTitle('The audience', y, fmtInt(a.total) + ' ' + a.phrase +
        (a.countries.length ? ' from ' + a.countries.length + ' countries' : ''));
      var colW = (CONTENT_W - 24) / 2;
      b.caps('Attendee mix', M, y, { color: GOLD_DARK });
      b.caps('Buy-side investors by type', M + colW + 24, y, { color: GOLD_DARK });
      var y1 = b.barList(a.mix, M, y + 13, colW, { labelW: 132, valueW: 62, rowH: 15.5 });
      var y2 = b.barList(a.buySubs, M + colW + 24, y + 13, colW, { labelW: 132, valueW: 62, rowH: 15.5 });
      y = Math.max(y1, y2) + 4;
      if (a.csuite && a.csuite.total) {
        var c = a.csuite, boxH = 40;
        doc.roundedRect(M, y, CONTENT_W, boxH, 3).fill(TINT);
        doc.rect(M, y, 3, boxH).fill(GOLD);
        doc.font('serif').fontSize(26).fillColor(GOLD_DARK).text(fmtPct(c.share), M + 13, y + 5, { lineBreak: false });
        var cw = doc.widthOfString(fmtPct(c.share));
        var parts = [fmtInt(c.ceo) + ' chief executives and presidents', fmtInt(c.cfo) + ' chief financial officers'];
        if (c.other) parts.push(fmtInt(c.other) + ' other C-level officers');
        var line = 'of corporate delegates are C-suite executives: ' + parts.join(', ').replace(/, ([^,]*)$/, ' and $1') + '.';
        if (c.ceoCompanies && c.companies) {
          line += ' ' + fmtInt(c.ceoCompanies) + ' of the ' + fmtInt(c.companies) + ' companies sending delegates bring their chief executive.';
        }
        var tx = M + 26 + cw;
        b.caps('C-suite representation', tx, y + 6, { size: 6.4, spacing: 1, color: GOLD_DARK });
        doc.font('regular').fontSize(8.4).fillColor(TEXT).text(line, tx, y + 15.5, { width: PAGE_W - M - tx - 10, lineGap: 1.2, height: 22, ellipsis: true });
        y += boxH + 2;
      }
      y += gapY;
    }

    // ── 1x1 meetings ──
    if (s.meetings) {
      var m = s.meetings;
      y = b.sectionTitle('One-on-one meetings', y, upcoming ? 'confirmed ahead of the forum' : 'confirmed at the forum');
      var leftW = 150;
      var stats = [
        [fmtInt(m.total), 'meetings ' + (upcoming ? 'booked' : 'held')],
        [m.mean.toFixed(1), 'average per company'],
        [fmtInt(m.busy), 'companies with 20 or more']
      ];
      if (m.hasInbound) stats.push([fmtInt(m.totalInbound), 'investor requests']);
      // Leave room for the market table (title, header, five rows, note) above the footer
      var reserve = metal ? 31 + 16 + 5 * 14 + 16 + gapY : 0;
      var listRows = Math.floor((PAGE_H - 46 - reserve - (y + 16)) / 14.5);
      listRows = Math.max(5, Math.min(10, listRows));
      var meetY = y;
      // The stat grid needs the height of at least five rows even when the ranking is short
      var blockH = 16 + Math.max(5, Math.min(listRows, m.ranked.length)) * 14.5;
      var perCol = Math.ceil(stats.length / 2), cellH = blockH / perCol, cellW = leftW / 2;
      stats.forEach(function(st, i) {
        var sx = M + (i % 2) * cellW, sy = y + Math.floor(i / 2) * cellH + 2;
        doc.font('serif').fontSize(17).fillColor(INK).text(st[0], sx, sy, { lineBreak: false });
        doc.font('regular').fontSize(7.2).fillColor(MUTED).text(st[1], sx, sy + 20, { width: cellW - 8, lineGap: 0.5, height: 20 });
      });
      var ranked = m.ranked.slice(0, listRows);
      var cols = [
        { label: '#', w: 20, align: 'right', color: MUTED, get: function(r, i) { return i + 1; } },
        { label: m.hasInbound ? 'Most requested companies' : 'Most active companies', w: m.hasInbound ? 160 : 270, font: 'bold', get: function(r) { return r.entity_name || r.company_name; } }
      ];
      if (m.hasInbound) cols.push({ label: 'Requests received', w: 102, align: 'right', get: function(r) { return r.inbound_requests == null ? '—' : fmtInt(r.inbound_requests); } });
      cols.push({ label: 'Meetings', w: 54, align: 'right', font: 'bold', get: function(r) { return fmtInt(r.meeting_count); } });
      if (m.hasInbound) cols.push({ label: 'Accepted', w: 54, align: 'right', get: function(r) { return r.accepted_inbound == null ? '—' : fmtPct(Number(r.accepted_inbound)); } });
      y = Math.max(b.table(cols, ranked, M + leftW, y, { rowH: 14.5, size: 8 }), meetY + blockH) + gapY;
    }

    // ── Market backdrop ──
    if (metal && metal.SEP[evt.year] && metal.SEP[evt.year - 1]) {
      var yr = evt.year;
      y = b.sectionTitle('Market backdrop', y, 'metal prices into the forum');
      var order = [0, 1, 4, 2, 3]; // gold, silver, copper, platinum, palladium
      var mrows = order.map(function(idx) {
        var sepNow = metal.SEP[yr][idx], sepPrev = metal.SEP[yr - 1][idx];
        var annNow = metal.ANN[yr] ? metal.ANN[yr][idx] : null, annPrev = metal.ANN[yr - 1] ? metal.ANN[yr - 1][idx] : null;
        return {
          name: metal.NAMES[idx], unit: metal.UNITS[idx], now: sepNow, prev: sepPrev,
          sepYoY: sepNow != null && sepPrev ? sepNow / sepPrev - 1 : null,
          annYoY: annNow != null && annPrev ? annNow / annPrev - 1 : null
        };
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
          (partial ? '† Part month, through ' + fmtDate(parseDate(metal.DATA_THROUGH)) + '.' : ''),
          M, y + 5, { width: CONTENT_W, lineBreak: false });
      y += 18;
    }

    // When a section is missing the page has room to spare: use it to say who stands behind the forum
    if (PAGE_H - 48 - y > 96) {
      y += gapY;
      y = b.sectionTitle('About the forum', y);
      doc.font('regular').fontSize(9.2).fillColor(TEXT)
        .text(evt.event_name + ' is organised by Denver Gold Group, a not-for-profit association of the mining industry. ' +
          'It takes no commissions, deal flow or advisory fees from the companies or investors that take part, ' +
          'and presenting companies are scheduled on equal terms, by seniority.', M, y, { width: CONTENT_W, lineGap: 2.2 });
    }

    b.footer(2, asOf);
  }

  // One sentence on where representation is deepest
  function leadTier(h) {
    var best = null;
    h.rows.forEach(function(r) { if (r.ratio != null && r.members >= 5 && (!best || r.ratio > best.ratio)) best = r; });
    if (!best) return '';
    var name = String(best.label).split(':')[0].toLowerCase();
    return 'Representation is deepest among ' + name + ' companies, at ' + fmtPct(best.ratio) + '.';
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

    var s = summarise(data);
    var b = new Brief(doc);
    pageOne(b, data, s, assets, asOf);
    doc.addPage({ size: 'LETTER', margin: 0 });
    pageTwo(b, data, s, metal, asOf);
    return doc;
  }

  var api = { generate: generate, summarise: summarise };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AnalystBrief = api;
})(typeof window !== 'undefined' ? window : this);
