// psr-report.js — Post Show Report renderer
// Fetches data from /api/psr and renders all report sections

(function() {
  'use strict';

  var API = '/api/psr';
  var currentEvent = null;
  var reportData = null;

  // Virtual-only event years (used across all historical charts/tables)
  var VIRTUAL_YEARS = { 2020: true, 2021: true, 2022: true };

  // ── CPI-U April values (BLS, 1982-84=100) ───────────
  var CPI = {
    1997: 160.2,   1998: 162.5,   1999: 166.2,   2000: 171.3,
    2001: 176.2,   2002: 179.8,
    2003: 183.8,   2004: 188.0,   2005: 194.6,   2006: 201.5,
    2007: 206.686, 2008: 214.823, 2009: 213.240, 2010: 218.009,
    2011: 224.906, 2012: 230.085, 2013: 232.531, 2014: 237.072,
    2015: 236.599, 2016: 239.261, 2017: 244.524, 2018: 250.546,
    2019: 255.548, 2020: 256.389, 2021: 267.054, 2022: 289.109,
    2023: 303.363, 2024: 313.548, 2025: 320.795
  };
  var inflationMode = 'nominal'; // 'nominal' or 'real'
  var baseYear = 2025;
  var marketCharts = [];  // track chart instances for cleanup
  var userRole = 'viewer'; // 'viewer' or 'admin'

  // ── Auth ──────────────────────────────────────────────
  function getToken() {
    return sessionStorage.getItem('admin_token') || sessionStorage.getItem('psr_token');
  }

  function detectRole() {
    if (sessionStorage.getItem('admin_token')) return 'admin';
    var t = sessionStorage.getItem('psr_token');
    if (!t) return null;
    var parts = t.split('.');
    if (parts.length === 5 && parts[0] === 'psr') {
      var role = parts[2];
      if (role === 'admin' || role === 'viewer') return role;
    }
    return null;
  }

  function getSlugFromUrl() {
    var match = window.location.pathname.match(/\/psr\/([A-Za-z0-9]+)/);
    return match ? match[1] : null;
  }

  function isAdmin() { return userRole === 'admin'; }

  function authHeaders() {
    var t = getToken();
    return t ? { 'Authorization': 'Bearer ' + t } : {};
  }

  // ── API helpers ──────────────────────────────────────
  function fetchJSON(params) {
    var qs = Object.keys(params).map(function(k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return fetch(API + '?' + qs, { headers: authHeaders() })
      .then(function(r) { return r.json(); });
  }

  // ── Number formatting ────────────────────────────────
  function fmt(n, decimals) {
    if (n == null || n === '') return '—';
    var d = decimals != null ? decimals : 0;
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function fmtDollar(n) {
    if (n == null || n === '') return '—';
    var v = Number(n);
    var prefix = v < 0 ? '-$' : '$';
    return prefix + fmt(Math.abs(v));
  }

  function fmtPct(current, prior) {
    if (current == null || prior == null || Number(prior) === 0) return '';
    var pct = ((Number(current) - Number(prior)) / Math.abs(Number(prior)) * 100).toFixed(1);
    var cls = Number(pct) >= 0 ? 'var-up' : 'var-down';
    var sign = Number(pct) >= 0 ? '+' : '';
    return '<span class="' + cls + '">' + sign + pct + '%</span>';
  }

  function varianceClass(current, prior) {
    if (current == null || prior == null) return '';
    return Number(current) >= Number(prior) ? 'var-up' : 'var-down';
  }

  // Engagement number formatting (with commas, supports decimals)
  function fmtEngNum(n) {
    if (n == null || n === '' || n === 0) return '0';
    var v = Number(n);
    if (isNaN(v)) return '0';
    // Preserve decimals if present (e.g. 3.9, 63.7)
    var s = String(v);
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }
  function parseEngNum(s) {
    if (s == null || s === '') return 0;
    var v = Number(String(s).replace(/,/g, ''));
    return isNaN(v) ? 0 : v;
  }
  // HTML escape
  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Expose globally for inline handlers
  window.fmtEngNum = fmtEngNum;
  window.parseEngNum = parseEngNum;

  // ── Date formatting ──────────────────────────────────
  function fmtDate(d) {
    if (!d) return '';
    var dt = new Date(d + 'T00:00:00');
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[dt.getMonth()] + ' ' + dt.getDate() + ', ' + dt.getFullYear();
  }

  function fmtDateShort(d) {
    if (!d) return '';
    var dt = new Date(d + 'T00:00:00');
    var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return days[dt.getDay()] + ' ' + months[dt.getMonth()] + ' ' + dt.getDate();
  }

  // ── Init ─────────────────────────────────────────────
  function init() {
    userRole = detectRole();
    if (!userRole) {
      // Redirect to appropriate login
      var slug = getSlugFromUrl();
      if (slug || window.location.pathname.indexOf('/psr') === 0) {
        var redirect = slug ? '/psr/' + slug : '/psr/MFE26';
        window.location.href = '/psr-login?redirect=' + encodeURIComponent(redirect);
      } else {
        window.location.href = '/admin';
      }
      return;
    }
    loadEvents();
  }

  function loadEvents() {
    fetchJSON({ action: 'events' }).then(function(res) {
      if (!res.ok || !res.events || !res.events.length) {
        document.getElementById('report-content').innerHTML =
          '<div style="text-align:center;padding:60px;color:#C0392B"><h3>No events found</h3></div>';
        return;
      }
      renderEventSelector(res.events);
      // Auto-select by URL slug, or default to first event
      var slug = getSlugFromUrl();
      var target = res.events[0];
      if (slug) {
        for (var i = 0; i < res.events.length; i++) {
          if (res.events[i].event_code === slug) { target = res.events[i]; break; }
        }
      }
      selectEvent(target);
    });
  }

  // ── Event selector ───────────────────────────────────
  function renderEventSelector(events) {
    var el = document.getElementById('event-selector');
    el.innerHTML = '';
    // Hide selector when only one event — avoids duplicate label
    if (events.length <= 1) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    events.forEach(function(evt) {
      var btn = document.createElement('button');
      btn.className = 'event-sel-btn';
      btn.textContent = 'PSR-' + evt.event_code;
      btn.setAttribute('data-code', evt.event_code);
      btn.onclick = function() { selectEvent(evt); };
      el.appendChild(btn);
    });
  }

  // ── Event color theming ─────────────────────────────
  var EVENT_COLORS = {
    MFE: { primary: '#1B5E20', dark: '#0D3B13', theme: 'mfe-theme', gradient: 'linear-gradient(135deg, #0D3B13, #1B5E20)' },
    MFA: { primary: '#1A237E', dark: '#0D1252', theme: 'mfa-theme', gradient: 'linear-gradient(135deg, #0D1252, #1A237E)' }
  };
  var DEFAULT_COLORS = { primary: '#8B6914', dark: '#6B5010', theme: 'dgg-theme', gradient: 'linear-gradient(135deg, #1B2631, #3E2F0F)' };

  function getEventColors(eventType) {
    return EVENT_COLORS[eventType] || DEFAULT_COLORS;
  }

  function applyEventTheme(evt) {
    var colors = getEventColors(evt.event_type);
    // Page header stays DGG dark — do not theme it per event
    // Event selector active button color + section numbers + report header
    var style = document.getElementById('event-theme-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'event-theme-style';
      document.head.appendChild(style);
    }
    style.textContent =
      '.event-sel-btn.active { background: ' + colors.primary + ' !important; border-color: ' + colors.primary + ' !important; }' +
      '.psr-section-header .section-num { background: ' + colors.primary + ' !important; }' +
      '.report-header { background: ' + colors.gradient + ' !important; }';
  }

  function selectEvent(evt) {
    currentEvent = evt;
    // Update URL if on PSR page
    if (window.location.pathname.indexOf('/psr/') === 0) {
      history.replaceState(null, '', '/psr/' + evt.event_code);
    }
    // Apply event-specific theming
    applyEventTheme(evt);
    // Update page title
    document.title = 'PSR-' + evt.event_code + ' — Post Show Report';
    // Update active button
    var btns = document.querySelectorAll('.event-sel-btn');
    btns.forEach(function(b) {
      b.classList.toggle('active', b.getAttribute('data-code') === evt.event_code);
    });
    // Load full report
    document.getElementById('report-content').innerHTML =
      '<div style="text-align:center;padding:60px;color:#7F8C8D"><h3>Loading report...</h3></div>';

    fetchJSON({ action: 'full-report', event_code: evt.event_code }).then(function(res) {
      if (!res.ok) {
        document.getElementById('report-content').innerHTML =
          '<div style="text-align:center;padding:60px;color:#C0392B"><h3>Error: ' + (res.error || 'Unknown') + '</h3></div>';
        return;
      }
      reportData = res;
      renderReport(res);
      // Load persisted cover page
      loadCoverPage(evt.event_code);
    });
  }

  // ── Main render ──────────────────────────────────────
  function renderReport(d) {
    var evt = d.event;
    var html = '';

    // Report header
    var logoFile = evt.event_code.toLowerCase() + '-logo.png';
    html += '<div class="report-header">';
    html += '<div class="rh-content">';
    html += '<h1>' + esc(evt.event_name) + '</h1>';
    html += '<div class="rh-sub">Post Show Report</div>';
    html += '<div class="rh-meta">';
    html += '<span>' + esc(evt.venue) + ', ' + esc(evt.city) + ', ' + esc(evt.country) + '</span>';
    html += '<span>' + fmtDate(evt.start_date) + ' — ' + fmtDate(evt.end_date) + '</span>';
    html += '</div></div>';
    html += '<div class="rh-logo"><img src="/logos/' + logoFile + '" alt="' + esc(evt.event_code) + '"></div>';
    html += '</div>';

    var sectionNum = 0;

    // 1. Glossary
    if (d.glossary && d.glossary.length) {
      sectionNum++;
      html += renderSection(sectionNum, 'Glossary of Terms', renderGlossary(d.glossary));
    }

    // 2. Venue History
    if (d.venues && d.venues.length) {
      sectionNum++;
      html += renderSection(sectionNum, 'Venue History', renderVenueHistory(d.venues, evt));
    }

    // 3. SWOT
    if (d.swot && d.swot.length) {
      sectionNum++;
      html += renderSection(sectionNum, 'SWOT Analysis', renderSWOT(d.swot));
    }

    // 4. Market Context
    if (d.market_data && d.market_data.length) {
      sectionNum++;
      marketSectionId = 'section-' + sectionNum;
      html += renderSection(sectionNum, 'Market Context', renderMarketContext(d.market_data, evt));
    }

    // 5. Member Data (composition from analytics)
    if (d.composition) {
      sectionNum++;
      html += renderSection(sectionNum, 'Member Data',
        renderMemberData(d.composition || {}, evt));
    }

    // 6. Member Tracking
    if (d.members && d.members.length) {
      sectionNum++;
      html += renderSection(sectionNum, 'Member Tracking', renderMembersList(d.members));
    }

    // 7. Member Cancellations
    if ((d.cancellations && d.cancellations.length) || isAdmin()) {
      sectionNum++;
      html += renderSection(sectionNum, 'Member Cancellations', renderCancellations(d.cancellations || []));
    }

    // 8. Member Historical Data
    if (d.member_history && d.member_history.length) {
      sectionNum++;
      html += renderSection(sectionNum, 'Member Historical Data', renderMemberHistory(d.member_history, d.composition, evt));
    }

    // 8. Financials
    if (d.financials && d.financials.length) {
      sectionNum++;
      html += renderSection(sectionNum, 'Financial Summary', renderFinancials(d.financials, evt, d.financials_source));
    }

    // 9. Historical Financials
    histFinSectionId = 'section-' + (sectionNum + 1);
    sectionNum++;
    html += renderSection(sectionNum, 'Historical Financials', renderHistoricalFinancials(d.financials, evt, d.historical_actuals));

    // Sponsors
    if (d.sponsors && d.sponsors.length) {
      sectionNum++;
      html += renderSection(sectionNum, 'Sponsorship', renderSponsors(d.sponsors));
    }

    // 9. Registration & Attendance
    if (d.attendance && d.attendance.length) {
      var regData = d.attendance.filter(function(r) {
        return r.section === 'registration' || r.section === 'attendee_class' || r.section === 'attendee_country';
      });
      if (regData.length) {
        regAttSectionId = 'section-' + (sectionNum + 1);
        sectionNum++;
        html += renderSection(sectionNum, 'Registration & Attendance', renderRegistration(regData, evt));
      }
    }

    // Registration Historical Data
    sectionNum++;
    html += renderSection(sectionNum, 'Registration Historical Data', renderRegHistory(evt));

    // Registration Reconciliation
    if ((d.reg_recon && d.reg_recon.length) || isAdmin()) {
      regReconSectionId = 'section-' + (sectionNum + 1);
      sectionNum++;
      html += renderSection(sectionNum, 'Registration Reconciliation', renderRegRecon(d.reg_recon || [], evt));
    }

    // 10. Hotel Pickup
    if (d.hotel && d.hotel.length) {
      hotelSectionId = 'section-' + (sectionNum + 1);
      sectionNum++;
      html += renderSection(sectionNum, 'Hotel Room Pickup', renderHotel(d.hotel, evt));
    }

    // 12. Engagement
    if (d.engagement && d.engagement.length) {
      engagementSectionId = 'section-' + (sectionNum + 1);
      sectionNum++;
      html += renderSection(sectionNum, 'Engagement Metrics', renderEngagement(d.engagement, evt));
    }

    // 13. Webcast Metrics
    if ((d.webcasts && d.webcasts.length) || isAdmin()) {
      webcastSectionId = 'section-' + (sectionNum + 1);
      sectionNum++;
      html += renderSection(sectionNum, 'Webcast Metrics', renderWebcasts(d.webcasts || [], evt));
    }

    // 14. Meetings
    if ((d.meetings && d.meetings.length) || isAdmin()) {
      meetingsSectionId = 'section-' + (sectionNum + 1);
      sectionNum++;
      html += renderSection(sectionNum, '1x1 Meetings', renderMeetings(d.meetings || [], d.top_meetings || [], evt));
    }

    // 1x1 Meetings Historical Data
    sectionNum++;
    html += renderSection(sectionNum, '1x1 Meetings Historical Data', renderMeetingsHistory(evt));

    document.getElementById('report-content').innerHTML = html;

    // All sections start collapsed
    document.querySelectorAll('.psr-section').forEach(function(s) {
      s.classList.add('collapsed');
    });

    // Track which sections have had their charts initialized
    var chartInited = {};

    // Bind collapse toggles
    document.querySelectorAll('.psr-section-header').forEach(function(h) {
      h.addEventListener('click', function() {
        var section = h.parentElement;
        var wasCollapsed = section.classList.contains('collapsed');
        section.classList.toggle('collapsed');
        // Init charts on first expand
        if (wasCollapsed && !chartInited[section.id]) {
          chartInited[section.id] = true;
          setTimeout(function() { initCharts(d); }, 50);
        }
      });
    });

    // Bind tracking table click delegation (event delegation on container)
    var rc = document.getElementById('report-content');
    if (rc) {
      rc.addEventListener('click', function(e) {
        var td = e.target.closest('.tracking-clickable');
        if (td) {
          e.stopPropagation();
          var status = td.getAttribute('data-status');
          var track = td.getAttribute('data-track');
          if (status && track) PSR.showTrackingDetail(status, track);
        }
      });
    }
  }

  // ── Section wrapper ──────────────────────────────────
  function renderSection(num, title, body) {
    return '<div class="psr-section" id="section-' + num + '">' +
      '<div class="psr-section-header">' +
        '<span class="section-num">' + num + '</span>' +
        '<h3>' + esc(title) + '</h3>' +
        '<span class="toggle-icon">&#9660;</span>' +
      '</div>' +
      '<div class="psr-section-body">' + body + '</div>' +
    '</div>';
  }

  // ── 1. Glossary ──────────────────────────────────────
  function renderGlossary(items) {
    var html = '<div class="glossary-grid">';
    items.forEach(function(g) {
      html += '<div class="glossary-item">';
      html += '<span class="glossary-term">' + esc(g.term) + '</span>';
      html += '<span class="glossary-def">' + esc(g.definition) + '</span>';
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  // ── 2. Venue History ─────────────────────────────────
  function renderVenueHistory(venues, evt) {
    var html = '<div class="venue-grid">';

    // Current year goes with past; strictly future years are future holds
    var past = venues.filter(function(v) { return !v.is_future || v.year === evt.year; });
    var future = venues.filter(function(v) { return v.is_future && v.year !== evt.year; });

    html += '<div class="venue-list">';
    html += '<h4>Past Venues</h4>';
    html += '<table class="psr-table"><thead><tr><th>Year</th><th>Venue</th><th>Dates</th></tr></thead><tbody>';
    past.forEach(function(v) {
      var highlight = v.year === evt.year ? ' style="background:#FFF9E6;font-weight:600"' : '';
      html += '<tr' + highlight + '>';
      html += '<td class="num">' + v.year + '</td>';
      html += '<td>' + esc(v.venue) + '</td>';
      html += '<td>' + esc(v.program_dates || '') + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    if (future.length) {
      html += '<div class="venue-list">';
      html += '<h4>Future Holds</h4>';
      html += '<table class="psr-table"><thead><tr><th>Year</th><th>Venue</th><th>Dates</th></tr></thead><tbody>';
      future.forEach(function(v) {
        html += '<tr data-venue-id="' + v.id + '">';
        html += '<td class="num">' + v.year + '</td>';
        if (isAdmin()) {
          html += '<td class="venue-editable" contenteditable="true" ' +
            'data-field="venue" data-id="' + v.id + '" ' +
            'onblur="PSR.saveVenueField(this)" ' +
            'onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}">' +
            esc(v.venue) + '</td>';
          html += '<td class="venue-editable" contenteditable="true" ' +
            'data-field="program_dates" data-id="' + v.id + '" ' +
            'onblur="PSR.saveVenueField(this)" ' +
            'onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}">' +
            esc(v.program_dates || '') + '</td>';
        } else {
          html += '<td>' + esc(v.venue) + '</td>';
          html += '<td>' + esc(v.program_dates || '') + '</td>';
        }
        html += '</tr>';
      });
      html += '</tbody></table></div>';
    }

    html += '</div>';
    return html;
  }

  // ── 3. SWOT ──────────────────────────────────────────
  function renderSWOT(items) {
    var grouped = { strength: [], weakness: [], opportunity: [], threat: [] };
    items.forEach(function(s) {
      var cat = s.category.toLowerCase();
      if (grouped[cat]) grouped[cat].push(s);
    });

    var cards = [
      { key: 'strength', label: 'Strengths', cls: 'swot-strengths' },
      { key: 'weakness', label: 'Weaknesses', cls: 'swot-weaknesses' },
      { key: 'opportunity', label: 'Opportunities', cls: 'swot-opportunities' },
      { key: 'threat', label: 'Threats', cls: 'swot-threats' }
    ];

    var html = '<div class="swot-grid">';
    cards.forEach(function(card) {
      html += '<div class="swot-card ' + card.cls + '">';
      html += '<h4>' + card.label + '</h4>';
      html += '<ul id="swot-list-' + card.key + '">';
      grouped[card.key].forEach(function(item) {
        html += renderSwotItem(item);
      });
      html += '</ul>';
      if (isAdmin()) html += '<button class="swot-add-btn" onclick="PSR.addSwotItem(\'' + card.key + '\')">+ Add</button>';
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderSwotItem(item) {
    var ed = isAdmin();
    return '<li class="swot-item" data-id="' + item.id + '">' +
      '<span class="swot-item-text"' +
        (ed ? ' contenteditable="true" onblur="PSR.saveSwotItem(' + item.id + ', this)" onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}"' : '') +
        '>' + esc(item.item_text) + '</span>' +
      (ed ? '<span class="swot-item-actions"><button class="swot-btn-icon delete" onclick="PSR.deleteSwotItem(' + item.id + ', this)" title="Delete">&#10005;</button></span>' : '') +
    '</li>';
  }

  // ── 4. Market Context (historical charts + tables) ──

  // Build lookup: { "metric|year": id }
  var marketIdMap = {};

  function buildMarketIdMap(marketData) {
    marketIdMap = {};
    marketData.forEach(function(r) {
      marketIdMap[r.metric + '|' + r.year] = r.id;
    });
  }

  // Adjust value for inflation: convert from year's dollars to baseYear dollars
  function adj(value, year) {
    if (inflationMode !== 'real' || !value) return Number(value);
    var cpiYear = CPI[year];
    var cpiBase = CPI[baseYear];
    if (!cpiYear || !cpiBase) return Number(value);
    return Number(value) * (cpiBase / cpiYear);
  }

  function fmtInput(val, decimals) {
    var d = decimals != null ? decimals : 0;
    return Number(val).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  // Heatmap: interpolate between red (low) → yellow (mid) → green (high)
  function heatmapBg(value, min, max) {
    if (value == null || min === max) return '';
    var t = (value - min) / (max - min); // 0..1
    // Red(220,53,69) → Yellow(255,193,7) → Green(40,167,69)
    var r, g, b;
    if (t < 0.5) {
      var s = t * 2; // 0..1 within first half
      r = Math.round(220 + (255 - 220) * s);
      g = Math.round(53 + (193 - 53) * s);
      b = Math.round(69 + (7 - 69) * s);
    } else {
      var s = (t - 0.5) * 2; // 0..1 within second half
      r = Math.round(255 + (40 - 255) * s);
      g = Math.round(193 + (167 - 193) * s);
      b = Math.round(7 + (69 - 7) * s);
    }
    return 'background:rgba(' + r + ',' + g + ',' + b + ',0.18)';
  }

  var _heatRanges = {}; // { metric: { min, max } }

  function marketCell(metric, year, value, decimals, skipAdj) {
    var id = marketIdMap[metric + '|' + year];
    if (!id) return '<td class="num">—</td>';
    var prefix = metric.indexOf('price') >= 0 || metric.indexOf('mcap') >= 0 ? '$' : '';
    var d = decimals != null ? decimals : 0;
    var raw = value != null ? Number(value) : 0;
    var display = (inflationMode === 'real' && !skipAdj) ? adj(raw, year) : raw;
    var heatStyle = '';
    var range = _heatRanges[metric];
    if (range && raw > 0) heatStyle = heatmapBg(display, range.min, range.max);
    // In real mode or viewer mode, show display-only
    if (inflationMode === 'real' || !isAdmin()) {
      return '<td class="num"' + (heatStyle ? ' style="' + heatStyle + '"' : '') + '>' + prefix + fmt(display, d) + '</td>';
    }
    return '<td class="num editable"' + (heatStyle ? ' style="' + heatStyle + '"' : '') + '>' +
      '<input type="text" value="' + fmtInput(raw, d) + '" ' +
        'data-raw="' + raw + '" ' +
        'data-id="' + id + '" data-prefix="' + prefix + '" data-decimals="' + d + '" ' +
        'onblur="PSR.blurMarketCell(this)" ' +
        'onfocus="PSR.focusMarketCell(this)" ' +
        'onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}">' +
    '</td>';
  }

  function renderInflationControls(years) {
    var html = '<div class="inflation-controls">';
    html += '<div class="inflation-toggle">';
    html += '<button ' + (inflationMode === 'nominal' ? 'class="active"' : '') + ' onclick="PSR.setInflation(\'nominal\')">Nominal</button>';
    html += '<button ' + (inflationMode === 'real' ? 'class="active"' : '') + ' onclick="PSR.setInflation(\'real\')">Real (Inflation-Adjusted)</button>';
    html += '</div>';
    html += '<div class="base-year-wrap">';
    html += '<label>Base year:</label>';
    html += '<select onchange="PSR.setBaseYear(Number(this.value))">';
    var sortedYears = years.slice().sort(function(a,b){ return b - a; });
    sortedYears.forEach(function(y) {
      html += '<option value="' + y + '"' + (y === baseYear ? ' selected' : '') + '>' + y + '</option>';
    });
    html += '</select></div>';
    if (inflationMode === 'real') {
      html += '<span class="inflation-note">Constant ' + baseYear + ' USD (CPI-U, BLS)</span>';
    }
    if (isAdmin()) {
      html += '<button class="btn-refresh-mcaps" id="btn-refresh-mcaps" onclick="PSR.refreshMcaps()" title="Refresh gold &amp; silver market caps from latest analytics uploads">&#x21bb; Refresh MCaps</button>';
    }
    html += '</div>';
    return html;
  }

  function renderMarketContext(marketData, evt) {
    buildMarketIdMap(marketData);
    var html = '';

    // Pivot data: { metric: { year: value } }
    var pivot = {};
    var years = [];
    marketData.forEach(function(r) {
      if (!pivot[r.metric]) pivot[r.metric] = {};
      pivot[r.metric][r.year] = Number(r.value);
      if (years.indexOf(r.year) === -1) years.push(r.year);
    });
    years.sort();

    // Build heatmap ranges per metric
    _heatRanges = {};
    var heatMetrics = ['gold_price', 'silver_price', 'platinum_price', 'palladium_price',
                       'gold_mcap_bn', 'silver_mcap_bn', 'hui_index', 'dji_index'];
    heatMetrics.forEach(function(m) {
      if (!pivot[m]) return;
      var vals = [];
      var skipAdj = (m === 'hui_index' || m === 'dji_index');
      years.forEach(function(y) {
        var raw = pivot[m][y];
        if (raw != null && Number(raw) > 0) {
          var display = (inflationMode === 'real' && !skipAdj) ? adj(Number(raw), y) : Number(raw);
          vals.push(display);
        }
      });
      if (vals.length > 1) {
        _heatRanges[m] = { min: Math.min.apply(null, vals), max: Math.max.apply(null, vals) };
      }
    });

    // Inflation controls
    html += renderInflationControls(years);

    // Metrics that should NOT be inflation-adjusted (ratios, indices)
    var noAdjust = { au_ag_ratio: true };

    // Charts row
    var labelSuffix = inflationMode === 'real' ? ' (' + baseYear + ' USD)' : '';
    html += '<div class="chart-row">';
    html += '<div class="chart-box"><h4>Gold Price' + labelSuffix + '</h4><canvas id="chart-gold-price"></canvas></div>';
    html += '<div class="chart-box"><h4>Silver Price' + labelSuffix + '</h4><canvas id="chart-silver-price"></canvas></div>';
    html += '</div>';

    html += '<div class="chart-row">';
    html += '<div class="chart-box"><h4>Gold & Silver Market Cap' + labelSuffix + '</h4><canvas id="chart-mcap"></canvas></div>';
    html += '<div class="chart-box"><h4>HUI vs DJI (Indexed, Base Year = 100)' + labelSuffix + '</h4><canvas id="chart-indices"></canvas></div>';
    html += '</div>';

    // Metals price table (collapsible)
    var inflNote = inflationMode === 'real' ? '<div style="font-size:10px;color:#999;margin-top:4px;font-style:italic">Values adjusted to constant ' + baseYear + ' USD using CPI-U (Bureau of Labor Statistics). Au:Ag ratio is not adjusted.</div>' : '';
    var hdr = inflationMode === 'real' ? ' (' + baseYear + ' USD)' : '';
    html += '<details style="margin:16px 0 8px"><summary style="cursor:pointer;font-size:13px;font-weight:700;color:var(--header-mid);user-select:none">Metal Prices at Event Date' + hdr + '</summary>';
    html += '<table class="psr-table" id="table-metals" style="margin-top:8px"><thead><tr><th>Year</th><th class="num">Gold</th><th class="num">Silver</th><th class="num">Platinum</th><th class="num">Palladium</th><th class="num">Au:Ag</th>';
    html += '</tr></thead><tbody>';
    years.forEach(function(y) {
      var isCurrentYear = y === evt.year;
      var style = isCurrentYear ? ' style="font-weight:600"' : '';
      html += '<tr' + style + ' data-year="' + y + '">';
      html += '<td class="num">' + y + '</td>';
      html += marketCell('gold_price', y, pivot.gold_price ? pivot.gold_price[y] : null);
      html += marketCell('silver_price', y, pivot.silver_price ? pivot.silver_price[y] : null, 2);
      html += marketCell('platinum_price', y, pivot.platinum_price ? pivot.platinum_price[y] : null);
      html += marketCell('palladium_price', y, pivot.palladium_price ? pivot.palladium_price[y] : null);
      // Au:Ag ratio — never adjust
      var auag = pivot.au_ag_ratio ? pivot.au_ag_ratio[y] : null;
      var auagId = marketIdMap['au_ag_ratio|' + y];
      if (inflationMode === 'real' || !isAdmin()) {
        html += '<td class="num">' + fmt(auag, 1) + '</td>';
      } else {
        html += '<td class="num editable"><input type="text" value="' + fmtInput(auag || 0, 1) + '" data-raw="' + (auag || 0) + '" data-id="' + auagId + '" data-prefix="" data-decimals="1" onblur="PSR.blurMarketCell(this)" onfocus="PSR.focusMarketCell(this)" onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}"></td>';
      }
      html += '</tr>';
    });
    html += '</tbody></table>';
    html += inflNote;
    html += '</details>';

    // Market cap & indices table (collapsible)
    var mcapHdr = inflationMode === 'real' ? ' (' + baseYear + ' USD)' : '';
    html += '<details style="margin:16px 0 8px"><summary style="cursor:pointer;font-size:13px;font-weight:700;color:var(--header-mid);user-select:none">Market Capitalization &amp; Indices' + mcapHdr + '</summary>';
    html += '<table class="psr-table" id="table-indices" style="margin-top:8px"><thead><tr><th>Year</th><th class="num">Gold MCap ($Bn)' + mcapHdr + '</th><th class="num">Silver MCap ($Bn)' + mcapHdr + '</th><th class="num">Total MCap ($Bn)' + mcapHdr + '</th><th class="num">HUI</th><th class="num">DJI</th></tr></thead><tbody>';
    years.forEach(function(y) {
      var isCurrentYear = y === evt.year;
      var style = isCurrentYear ? ' style="font-weight:600"' : '';
      html += '<tr' + style + '>';
      html += '<td class="num">' + y + '</td>';
      html += marketCell('gold_mcap_bn', y, pivot.gold_mcap_bn ? pivot.gold_mcap_bn[y] : null);
      html += marketCell('silver_mcap_bn', y, pivot.silver_mcap_bn ? pivot.silver_mcap_bn[y] : null);
      // Total MCap (computed, read-only)
      var gm = pivot.gold_mcap_bn ? Number(pivot.gold_mcap_bn[y]) || 0 : 0;
      var sm = pivot.silver_mcap_bn ? Number(pivot.silver_mcap_bn[y]) || 0 : 0;
      var total = adj(gm, y) + adj(sm, y);
      // Heatmap for total mcap
      var totalRange = _heatRanges['gold_mcap_bn'];
      var totalHeat = totalRange ? heatmapBg(total, totalRange.min * 0.5, totalRange.max * 2) : '';
      html += '<td class="num" style="font-weight:600;' + totalHeat + '">$' + fmt(total) + '</td>';
      // HUI & DJI are indices — never inflation-adjust
      html += marketCell('hui_index', y, pivot.hui_index ? pivot.hui_index[y] : null, 1, true);
      html += marketCell('dji_index', y, pivot.dji_index ? pivot.dji_index[y] : null, 0, true);
      html += '</tr>';
    });
    html += '</tbody></table>';
    if (inflationMode === 'real') {
      html += '<div style="font-size:10px;color:#999;margin-top:4px;font-style:italic">Market cap values adjusted to constant ' + baseYear + ' USD using CPI-U (Bureau of Labor Statistics). HUI and DJI indices are nominal (not adjusted).</div>';
    }
    html += '</details>';



    return html;
  }

  // ── 5. Member Data ──────────────────────────────────

  // Color palettes matching design system
  var MINERAL_COLORS = {
    'Gold': '#D4A017', 'Silver': '#7F8C8D', 'PGMs': '#8E44AD',
    'Copper': '#CA6F1E', 'Lithium': '#2ECC71', 'Titanium': '#3498DB',
    'Other': '#27AE60'
  };
  var STATUS_COLORS = {
    'Producer': '#27AE60', 'Royalty / Streaming': '#2980B9',
    'Developer (construction/feasibility)': '#E67E22', 'Developer (PEA/scoping)': '#F39C12',
    'Explorer (advanced)': '#9B59B6', 'Explorer (early-stage)': '#1ABC9C',
    'Bullion Dealer': '#95A5A6', 'Developer': '#D35400'
  };
  var STATUS_SHORT = {
    'Producer': 'Producer', 'Royalty / Streaming': 'Royalty / Strm',
    'Developer (construction/feasibility)': 'Dev (c/f)',
    'Developer (PEA/scoping)': 'Dev (PEA)',
    'Explorer (advanced)': 'Exp (adv)',
    'Explorer (early-stage)': 'Exp (early)',
    'Bullion Dealer': 'Bullion', 'Developer': 'Developer'
  };
  // Longer labels for tables
  var STATUS_TABLE = {
    'Producer': 'Producer', 'Royalty / Streaming': 'Royalty / Streaming',
    'Developer (construction/feasibility)': 'Developer (c/f)',
    'Developer (PEA/scoping)': 'Developer (PEA)',
    'Explorer (advanced)': 'Explorer (adv)',
    'Explorer (early-stage)': 'Explorer (early)',
    'Bullion Dealer': 'Bullion Dealer', 'Developer': 'Developer'
  };

  function fmtMcap(n) {
    if (n == null || n === 0) return '—';
    var v = Number(n);
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(0) + 'M';
    return '$' + fmt(v);
  }

  // Aggregate helper: group array by key, sum count and market_cap
  function aggregate(rows, keyFn) {
    var map = {};
    rows.forEach(function(r) {
      var k = keyFn(r) || 'Other';
      if (!map[k]) map[k] = { count: 0, mcap: 0 };
      map[k].count++;
      map[k].mcap += Number(r.market_cap_usd || 0);
    });
    return map;
  }

  function renderMemberData(comp, evt) {
    var html = '';
    var curYear = evt.year;
    var priorYear = curYear - 1;
    var cur = comp.current || [];
    var prior = comp.prior || [];

    if (!cur.length) return html;

    // ── Aggregate data ──
    var curByMineral = aggregate(cur, function(r) { return r.primary_mineral; });
    var priorByMineral = aggregate(prior, function(r) { return r.primary_mineral; });
    var curByStatus = aggregate(cur, function(r) { return r.company_status; });
    var priorByStatus = aggregate(prior, function(r) { return r.company_status; });

    // Collect all keys
    var allMinerals = Object.keys(curByMineral);
    Object.keys(priorByMineral).forEach(function(k) { if (allMinerals.indexOf(k) === -1) allMinerals.push(k); });
    // Sort: Gold first, then Silver, then alphabetical
    var mineralPriority = ['Gold', 'Silver', 'PGMs', 'Copper'];
    allMinerals.sort(function(a, b) {
      var ia = mineralPriority.indexOf(a), ib = mineralPriority.indexOf(b);
      if (ia === -1) ia = 99; if (ib === -1) ib = 99;
      return ia !== ib ? ia - ib : a.localeCompare(b);
    });

    var statusOrder = ['Producer', 'Developer (construction/feasibility)', 'Developer (PEA/scoping)',
      'Explorer (advanced)', 'Explorer (early-stage)', 'Royalty / Streaming', 'Bullion Dealer', 'Developer'];
    var allStatuses = [];
    statusOrder.forEach(function(s) {
      if (curByStatus[s] || priorByStatus[s]) allStatuses.push(s);
    });
    // Add any statuses not in the order
    Object.keys(curByStatus).concat(Object.keys(priorByStatus)).forEach(function(s) {
      if (allStatuses.indexOf(s) === -1) allStatuses.push(s);
    });

    // ── Charts: 4 doughnuts per row (prior mineral, current mineral, prior status, current status) ──
    var chartId = 'md-' + Date.now();
    var chartCell = 'flex:1;min-width:140px;max-width:180px;text-align:center';
    var chartLabel = 'font-size:10px;font-weight:600;color:#666;margin-bottom:4px';

    // Row 1: Company Count
    html += '<div style="height:20px"></div>';
    html += '<h4 style="font-size:13px;font-weight:700;margin:0 0 8px;color:var(--header-mid)">Composition by Company Count</h4>';
    html += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;justify-content:center">';
    html += '<div style="' + chartCell + '"><div style="' + chartLabel + '">Mineral ' + priorYear + '</div><canvas id="' + chartId + '-pm-cnt" height="160"></canvas></div>';
    html += '<div style="' + chartCell + '"><div style="' + chartLabel + '">Mineral ' + curYear + '</div><canvas id="' + chartId + '-cm-cnt" height="160"></canvas></div>';
    html += '<div style="' + chartCell + '"><div style="' + chartLabel + '">Status ' + priorYear + '</div><canvas id="' + chartId + '-ps-cnt" height="160"></canvas></div>';
    html += '<div style="' + chartCell + '"><div style="' + chartLabel + '">Status ' + curYear + '</div><canvas id="' + chartId + '-cs-cnt" height="160"></canvas></div>';
    html += '</div>';

    // Row 2: Market Cap
    html += '<h4 style="font-size:13px;font-weight:700;margin:0 0 8px;color:var(--header-mid)">Corporate Composition by Market Cap</h4>';
    html += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;justify-content:center">';
    html += '<div style="' + chartCell + '"><div style="' + chartLabel + '">Mineral ' + priorYear + '</div><canvas id="' + chartId + '-pm-mcap" height="160"></canvas></div>';
    html += '<div style="' + chartCell + '"><div style="' + chartLabel + '">Mineral ' + curYear + '</div><canvas id="' + chartId + '-cm-mcap" height="160"></canvas></div>';
    html += '<div style="' + chartCell + '"><div style="' + chartLabel + '">Status ' + priorYear + '</div><canvas id="' + chartId + '-ps-mcap" height="160"></canvas></div>';
    html += '<div style="' + chartCell + '"><div style="' + chartLabel + '">Status ' + curYear + '</div><canvas id="' + chartId + '-cs-mcap" height="160"></canvas></div>';
    html += '</div>';

    // ── Table: Composition by Mineral (YoY) ──
    html += '<h4 style="font-size:13px;font-weight:700;margin:16px 0 8px;color:var(--header-mid)">Composition by Primary Mineral</h4>';
    html += '<table class="psr-table"><thead><tr>';
    html += '<th>Mineral</th><th class="num">Companies ' + curYear + '</th><th class="num">Companies ' + priorYear + '</th><th class="num">Var</th>';
    html += '<th class="num">Market Cap ' + curYear + '</th><th class="num">Market Cap ' + priorYear + '</th><th class="num">Var</th>';
    html += '</tr></thead><tbody>';
    var totCurCnt = 0, totPriorCnt = 0, totCurMcap = 0, totPriorMcap = 0;
    allMinerals.forEach(function(m) {
      var c = curByMineral[m] || { count: 0, mcap: 0 };
      var p = priorByMineral[m] || { count: 0, mcap: 0 };
      totCurCnt += c.count; totPriorCnt += p.count;
      totCurMcap += c.mcap; totPriorMcap += p.mcap;
      var dot = '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' +
        (MINERAL_COLORS[m] || '#999') + ';margin-right:6px;vertical-align:middle"></span>';
      html += '<tr><td>' + dot + esc(m) + '</td>';
      html += '<td class="num">' + c.count + '</td><td class="num">' + p.count + '</td>';
      html += '<td class="pct">' + fmtPct(c.count, p.count) + '</td>';
      html += '<td class="num">' + fmtMcap(c.mcap) + '</td><td class="num">' + fmtMcap(p.mcap) + '</td>';
      html += '<td class="pct">' + fmtPct(c.mcap, p.mcap) + '</td></tr>';
    });
    html += '</tbody><tfoot><tr><td style="font-weight:700">Total</td>';
    html += '<td class="num" style="font-weight:700">' + totCurCnt + '</td>';
    html += '<td class="num" style="font-weight:700">' + totPriorCnt + '</td>';
    html += '<td class="pct" style="font-weight:700">' + fmtPct(totCurCnt, totPriorCnt) + '</td>';
    html += '<td class="num" style="font-weight:700">' + fmtMcap(totCurMcap) + '</td>';
    html += '<td class="num" style="font-weight:700">' + fmtMcap(totPriorMcap) + '</td>';
    html += '<td class="pct" style="font-weight:700">' + fmtPct(totCurMcap, totPriorMcap) + '</td>';
    html += '</tr></tfoot></table>';

    // ── Table: Composition by Status (YoY) ──
    html += '<h4 style="font-size:13px;font-weight:700;margin:16px 0 8px;color:var(--header-mid)">Composition by Company Status</h4>';
    html += '<table class="psr-table"><thead><tr>';
    html += '<th>Status</th><th class="num">Companies ' + curYear + '</th><th class="num">Companies ' + priorYear + '</th><th class="num">Var</th>';
    html += '<th class="num">Market Cap ' + curYear + '</th><th class="num">Market Cap ' + priorYear + '</th><th class="num">Var</th>';
    html += '</tr></thead><tbody>';
    totCurCnt = 0; totPriorCnt = 0; totCurMcap = 0; totPriorMcap = 0;
    allStatuses.forEach(function(s) {
      var c = curByStatus[s] || { count: 0, mcap: 0 };
      var p = priorByStatus[s] || { count: 0, mcap: 0 };
      totCurCnt += c.count; totPriorCnt += p.count;
      totCurMcap += c.mcap; totPriorMcap += p.mcap;
      var dot = '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' +
        (STATUS_COLORS[s] || '#999') + ';margin-right:6px;vertical-align:middle"></span>';
      html += '<tr><td>' + dot + esc(STATUS_TABLE[s] || s) + '</td>';
      html += '<td class="num">' + c.count + '</td><td class="num">' + p.count + '</td>';
      html += '<td class="pct">' + fmtPct(c.count, p.count) + '</td>';
      html += '<td class="num">' + fmtMcap(c.mcap) + '</td><td class="num">' + fmtMcap(p.mcap) + '</td>';
      html += '<td class="pct">' + fmtPct(c.mcap, p.mcap) + '</td></tr>';
    });
    html += '</tbody><tfoot><tr><td style="font-weight:700">Total</td>';
    html += '<td class="num" style="font-weight:700">' + totCurCnt + '</td>';
    html += '<td class="num" style="font-weight:700">' + totPriorCnt + '</td>';
    html += '<td class="pct" style="font-weight:700">' + fmtPct(totCurCnt, totPriorCnt) + '</td>';
    html += '<td class="num" style="font-weight:700">' + fmtMcap(totCurMcap) + '</td>';
    html += '<td class="num" style="font-weight:700">' + fmtMcap(totPriorMcap) + '</td>';
    html += '<td class="pct" style="font-weight:700">' + fmtPct(totCurMcap, totPriorMcap) + '</td>';
    html += '</tr></tfoot></table>';

    // ── Table: Market Cap by Mineral × Status (current year) ──
    html += '<h4 style="font-size:13px;font-weight:700;margin:16px 0 8px;color:var(--header-mid)">Market Cap by Mineral &times; Status (' + curYear + ')</h4>';
    html += '<div style="overflow-x:auto">';
    html += '<table class="psr-table"><thead><tr><th>Status</th>';
    allMinerals.forEach(function(m) {
      html += '<th class="num">' + esc(m) + '</th>';
    });
    html += '<th class="num">Total</th></tr></thead><tbody>';

    // Cross-tab: status × mineral market cap
    var crossMcap = {};
    cur.forEach(function(r) {
      var s = r.company_status || 'Other';
      var m = r.primary_mineral || 'Other';
      if (!crossMcap[s]) crossMcap[s] = {};
      crossMcap[s][m] = (crossMcap[s][m] || 0) + Number(r.market_cap_usd || 0);
    });
    var colTotals = {};
    allMinerals.forEach(function(m) { colTotals[m] = 0; });
    var grandTotal = 0;

    allStatuses.forEach(function(s) {
      var rowData = crossMcap[s] || {};
      var rowTotal = 0;
      html += '<tr><td>' + esc(STATUS_TABLE[s] || s) + '</td>';
      allMinerals.forEach(function(m) {
        var v = rowData[m] || 0;
        rowTotal += v;
        colTotals[m] += v;
        html += '<td class="num">' + (v ? fmtMcap(v) : '—') + '</td>';
      });
      grandTotal += rowTotal;
      html += '<td class="num" style="font-weight:600">' + fmtMcap(rowTotal) + '</td></tr>';
    });

    html += '</tbody><tfoot><tr><td style="font-weight:700">Total</td>';
    allMinerals.forEach(function(m) {
      html += '<td class="num" style="font-weight:700">' + fmtMcap(colTotals[m]) + '</td>';
    });
    html += '<td class="num" style="font-weight:700">' + fmtMcap(grandTotal) + '</td>';
    html += '</tr></tfoot></table></div>';

    // ── Deferred chart rendering (after DOM insert) ──
    setTimeout(function() {
      var smallLegend = { position: 'bottom', labels: { font: { family: 'Inter', size: 9 }, padding: 4, boxWidth: 8 } };
      var cntTooltip = {
        callbacks: {
          label: function(ctx) {
            var total = ctx.dataset.data.reduce(function(a, b) { return a + b; }, 0);
            var pct = total ? ((ctx.raw / total) * 100).toFixed(0) : 0;
            return ctx.label + ': ' + ctx.raw + ' (' + pct + '%)';
          }
        }
      };
      var mcapTooltip = {
        callbacks: {
          label: function(ctx) {
            var total = ctx.dataset.data.reduce(function(a, b) { return a + b; }, 0);
            var pct = total ? ((ctx.raw / total) * 100).toFixed(0) : 0;
            var v = ctx.raw >= 1e9 ? '$' + (ctx.raw / 1e9).toFixed(1) + 'B' : '$' + (ctx.raw / 1e6).toFixed(0) + 'M';
            return ctx.label + ': ' + v + ' (' + pct + '%)';
          }
        }
      };
      var cntOpts = { responsive: true, maintainAspectRatio: true, cutout: '50%', plugins: { legend: smallLegend, tooltip: cntTooltip } };
      var mcapOpts = { responsive: true, maintainAspectRatio: true, cutout: '50%', plugins: { legend: smallLegend, tooltip: mcapTooltip } };

      var mineralLabels = allMinerals;
      var mineralColors = allMinerals.map(function(m) { return MINERAL_COLORS[m] || '#999'; });
      var statusLabels = allStatuses.map(function(s) { return STATUS_SHORT[s] || s; });
      var statusColors = allStatuses.map(function(s) { return STATUS_COLORS[s] || '#999'; });

      function makeDoughnut(id, labels, data, colors, opts) {
        var el = document.getElementById(id);
        if (!el) return;
        new Chart(el.getContext('2d'), {
          type: 'doughnut',
          data: { labels: labels, datasets: [{ data: data, backgroundColor: colors }] },
          options: opts
        });
      }

      // Row 1: Company count — prior mineral, current mineral, prior status, current status
      makeDoughnut(chartId + '-pm-cnt', mineralLabels,
        allMinerals.map(function(m) { return (priorByMineral[m] || {}).count || 0; }), mineralColors, cntOpts);
      makeDoughnut(chartId + '-cm-cnt', mineralLabels,
        allMinerals.map(function(m) { return (curByMineral[m] || {}).count || 0; }), mineralColors, cntOpts);
      makeDoughnut(chartId + '-ps-cnt', statusLabels,
        allStatuses.map(function(s) { return (priorByStatus[s] || {}).count || 0; }), statusColors, cntOpts);
      makeDoughnut(chartId + '-cs-cnt', statusLabels,
        allStatuses.map(function(s) { return (curByStatus[s] || {}).count || 0; }), statusColors, cntOpts);

      // Row 2: Market cap — prior mineral, current mineral, prior status, current status
      makeDoughnut(chartId + '-pm-mcap', mineralLabels,
        allMinerals.map(function(m) { return (priorByMineral[m] || {}).mcap || 0; }), mineralColors, mcapOpts);
      makeDoughnut(chartId + '-cm-mcap', mineralLabels,
        allMinerals.map(function(m) { return (curByMineral[m] || {}).mcap || 0; }), mineralColors, mcapOpts);
      makeDoughnut(chartId + '-ps-mcap', statusLabels,
        allStatuses.map(function(s) { return (priorByStatus[s] || {}).mcap || 0; }), statusColors, mcapOpts);
      makeDoughnut(chartId + '-cs-mcap', statusLabels,
        allStatuses.map(function(s) { return (curByStatus[s] || {}).mcap || 0; }), statusColors, mcapOpts);
    }, 100);

    return html;
  }

  // ── 6. Member Tracking ──────────────────────────────

  // Store members data for modal access
  var _trackingMembers = [];

  function showTrackingModal(title, list, showReason) {
    // Remove existing modal
    var existing = document.getElementById('tracking-modal');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'tracking-modal';
    overlay.className = 'tracking-modal-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    var modal = document.createElement('div');
    modal.className = 'tracking-modal';

    // Header
    var head = document.createElement('div');
    head.className = 'tracking-modal-head';
    head.innerHTML = '<h3>' + esc(title) + '<span class="modal-count">(' + list.length + ')</span></h3>' +
      '<button class="tracking-modal-close" onclick="document.getElementById(\'tracking-modal\').remove()">&times;</button>';
    modal.appendChild(head);

    // Body with table
    var body = document.createElement('div');
    body.className = 'tracking-modal-body';
    var html = '<table class="psr-table"><thead><tr>';
    html += '<th>Company</th><th>Status</th><th>Mineral</th><th>Country</th>';
    html += showReason ? '<th>Reason</th>' : '<th class="num">MCap ($M)</th>';
    html += '</tr></thead><tbody>';
    list.forEach(function(m) {
      html += '<tr>';
      html += '<td>' + esc(m.company_name) + '</td>';
      html += '<td>' + esc(m.company_status || '') + '</td>';
      html += '<td>' + esc(m.primary_mineral || '') + '</td>';
      html += '<td>' + esc(m.primary_country || '') + '</td>';
      if (showReason) {
        html += '<td><span class="member-reason">' + esc(m.reason || '') + '</span></td>';
      } else {
        html += '<td class="num">' + (m.market_cap_usd ? Number(m.market_cap_usd).toLocaleString('en-US') : '—') + '</td>';
      }
      html += '</tr>';
    });
    html += '</tbody></table>';
    body.innerHTML = html;
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Escape key closes
    var escHandler = function(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);
  }

  // Expose for onclick
  window.PSR = window.PSR || {};
  PSR.showTrackingDetail = function(status, track) {
    var filtered = _trackingMembers.filter(function(m) {
      var matchStatus = status === '_all' || m.company_status === status;
      var matchTrack;
      if (track === '_total') {
        matchTrack = m.tracking_status !== 'not_returning';
      } else {
        matchTrack = m.tracking_status === track;
      }
      return matchStatus && matchTrack;
    });
    var trackLabels = { 'new': 'New', 'repeating': 'Repeating', 'returning': 'Returning', 'not_returning': 'Not Returning', '_total': 'Total Active' };
    var statusLabel = status === '_all' ? 'All Statuses' : status;
    var title = (trackLabels[track] || track) + ' — ' + statusLabel;
    var showReason = track === 'not_returning';
    showTrackingModal(title, filtered, showReason);
  };

  function renderMembersList(members) {
    _trackingMembers = members;

    var html = '';

    // Cross-tab: Status × Track
    var statusOrder = ['Producer', 'Developer (construction/feasibility)', 'Developer (PEA/scoping)',
      'Explorer (advanced)', 'Explorer (early-stage)', 'Royalty / Streaming', 'Bullion Dealer'];
    var trackCols = ['new', 'repeating', 'returning', 'not_returning'];
    var trackLabels = { 'new': 'New', 'repeating': 'Repeating', 'returning': 'Returning', 'not_returning': 'Not Returning' };

    // Build counts
    var grid = {};
    statusOrder.forEach(function(s) { grid[s] = { new: 0, repeating: 0, returning: 0, not_returning: 0, total: 0 }; });
    var totals = { new: 0, repeating: 0, returning: 0, not_returning: 0, total: 0 };

    members.forEach(function(m) {
      var status = m.company_status || '';
      var track = m.tracking_status || '';
      if (!grid[status]) grid[status] = { new: 0, repeating: 0, returning: 0, not_returning: 0, total: 0 };
      if (grid[status][track] !== undefined) grid[status][track]++;
      if (track !== 'not_returning') grid[status].total++;
      if (totals[track] !== undefined) totals[track]++;
      if (track !== 'not_returning') totals.total++;
    });

    // Helper: make a clickable cell using data attributes (avoids escaping issues in onclick)
    function clickCell(count, status, track, bold) {
      if (!count) return '<td class="num">0</td>';
      var style = bold ? ' style="font-weight:600"' : '';
      return '<td class="num tracking-clickable"' + style +
        ' data-status="' + esc(status) + '" data-track="' + track + '">' +
        count + '</td>';
    }
    function clickCellFoot(count, track) {
      return '<td class="num tracking-clickable" style="font-weight:700"' +
        ' data-status="_all" data-track="' + track + '">' + count + '</td>';
    }

    html += '<h4 style="font-size:13px;font-weight:700;margin:0 0 8px;color:var(--header-mid)">Member Tracking Summary</h4>';
    html += '<div style="font-size:10px;color:#999;margin-bottom:8px">Click any number to see company details</div>';
    html += '<table class="psr-table"><thead><tr>';
    html += '<th>Status</th><th class="num">Total</th>';
    trackCols.forEach(function(t) { html += '<th class="num">' + trackLabels[t] + '</th>'; });
    html += '</tr></thead><tbody>';

    statusOrder.forEach(function(s) {
      var row = grid[s];
      if (!row) row = { new: 0, repeating: 0, returning: 0, not_returning: 0, total: 0 };
      html += '<tr><td>' + esc(s) + '</td>';
      html += clickCell(row.total, s, '_total', true);
      trackCols.forEach(function(t) {
        html += clickCell(row[t], s, t, false);
      });
      html += '</tr>';
    });

    html += '</tbody><tfoot><tr>';
    html += '<td style="font-weight:700">Total</td>';
    html += clickCellFoot(totals.total, '_total');
    trackCols.forEach(function(t) {
      html += clickCellFoot(totals[t], t);
    });
    html += '</tr></tfoot></table>';

    return html;
  }

  // ── 7. Member Cancellations ─────────────────────────
  function renderCancellations(cancellations) {
    if (!cancellations || !cancellations.length) return '<div style="padding:20px;color:#7F8C8D;text-align:center;font-size:13px">No cancellation data uploaded.</div>';

    var html = '';

    // Summary stats
    var total = cancellations.length;
    var byReason = {};
    var byResponse = {};
    var totalMcap = 0;
    var privateCount = 0;
    cancellations.forEach(function(c) {
      var reason = c.company_reason || 'Unknown';
      byReason[reason] = (byReason[reason] || 0) + 1;
      var resp = c.dgg_response || 'Unknown';
      byResponse[resp] = (byResponse[resp] || 0) + 1;
      if (c.market_cap && Number(c.market_cap) > 0) totalMcap += Number(c.market_cap);
      else privateCount++;
    });

    // Summary row
    html += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">';
    html += '<div style="background:#FDEDEC;border-radius:8px;padding:12px 18px;text-align:center"><div style="font-size:22px;font-weight:700;color:#C0392B">' + total + '</div><div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.5px">Cancellations</div></div>';
    if (totalMcap > 0) {
      var mcapStr = totalMcap >= 1e9 ? '$' + (totalMcap / 1e9).toFixed(1) + 'B' : '$' + (totalMcap / 1e6).toFixed(0) + 'M';
      html += '<div style="background:#FEF9E7;border-radius:8px;padding:12px 18px;text-align:center"><div style="font-size:22px;font-weight:700;color:#7D6608">' + mcapStr + '</div><div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.5px">Lost Market Cap</div></div>';
    }
    html += '</div>';

    // Detail table
    html += '<table class="psr-table"><thead><tr>';
    html += '<th>#</th><th>Company</th><th>Status</th><th>Mineral</th><th>Country</th>';
    html += '<th class="num">Market Cap</th><th>CXL Date</th><th>Reason</th><th>DGG Response</th>';
    html += '</tr></thead><tbody>';

    cancellations.forEach(function(c, i) {
      html += '<tr>';
      html += '<td style="color:#999;font-size:10px">' + (i + 1) + '</td>';
      html += '<td style="font-weight:600">' + esc(c.company || '') + '</td>';
      html += '<td style="font-size:11px">' + esc(c.status || '—') + '</td>';
      html += '<td style="font-size:11px">' + esc(c.mineral || '—') + '</td>';
      html += '<td style="font-size:11px">' + esc(c.primary_country || '—') + '</td>';
      html += '<td class="num" style="font-size:11px">' + formatCxlMcap(c.market_cap) + '</td>';
      html += '<td style="font-size:11px;white-space:nowrap">' + formatCxlDate(c.cxl_date) + '</td>';
      html += '<td style="font-size:11px">' + esc(c.company_reason || '—') + '</td>';
      html += '<td style="font-size:11px">' + esc(c.dgg_response || '—') + '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';

    // Breakdown by DGG Response
    var respEntries = Object.entries(byResponse).sort(function(a, b) { return b[1] - a[1]; });
    html += '<div style="margin-top:16px"><h4 style="font-size:12px;font-weight:700;color:var(--header-mid);margin:0 0 8px">DGG Response Summary</h4>';
    html += '<table class="psr-table" style="max-width:400px"><thead><tr><th>Response</th><th class="num">Count</th></tr></thead><tbody>';
    respEntries.forEach(function(e) {
      html += '<tr><td>' + esc(e[0]) + '</td><td class="num">' + e[1] + '</td></tr>';
    });
    html += '</tbody></table></div>';

    return html;
  }

  function formatCxlMcap(val) {
    if (!val || Number(val) === 0) return '<span style="color:#999">Private</span>';
    var n = Number(val);
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    return '$' + Math.round(n).toLocaleString();
  }

  function formatCxlDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    return mon + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  // ── 8. Member Historical Data ─────────────────────────
  function renderMemberHistory(history, composition, evt) {
    var html = '';

    // Auto-append current event year from live composition data if not already present
    if (composition && composition.current && composition.current.length && evt) {
      var currentYear = evt.year;
      var alreadyHas = history.some(function(r) { return r.year === currentYear; });
      if (!alreadyHas) {
        var total = composition.current.length;
        var mineralCounts = { Gold: 0, Silver: 0, PGMs: 0, Other: 0 };
        var statusCounts = { Producer: 0, Royalty: 0, Developer: 0, Explorer: 0 };
        composition.current.forEach(function(c) {
          var min = c.primary_mineral || '';
          if (min === 'Gold') mineralCounts.Gold++;
          else if (min === 'Silver') mineralCounts.Silver++;
          else if (min === 'PGMs' || min === 'Platinum' || min === 'Palladium') mineralCounts.PGMs++;
          else mineralCounts.Other++;

          var st = (c.company_status || '').toLowerCase();
          if (st.indexOf('producer') >= 0) statusCounts.Producer++;
          else if (st.indexOf('royalty') >= 0) statusCounts.Royalty++;
          else if (st.indexOf('developer') >= 0 || st.indexOf('dev') >= 0) statusCounts.Developer++;
          else if (st.indexOf('explorer') >= 0 || st.indexOf('exp') >= 0) statusCounts.Explorer++;
        });
        if (total > 0) {
          // Compute gold & silver member market caps
          var goldMcapSum = 0, silverMcapSum = 0;
          composition.current.forEach(function(c) {
            var min = c.primary_mineral || '';
            var mcap = Number(c.market_cap_usd) || 0;
            if (min === 'Gold') goldMcapSum += mcap;
            else if (min === 'Silver') silverMcapSum += mcap;
          });
          var goldMcapBn = goldMcapSum > 0 ? Math.round(goldMcapSum / 1e9 * 10) / 10 : null;
          var silverMcapBn = silverMcapSum > 0 ? Math.round(silverMcapSum / 1e9 * 10) / 10 : null;

          // Compute oz per $1M mcap = member_mcap_bn * 1000 / metal_price
          var goldOzPer1m = null, silverOzPer1m = null;
          if (reportData && reportData.market_data) {
            reportData.market_data.forEach(function(r) {
              if (r.year === currentYear && Number(r.value) > 0) {
                if (r.metric === 'gold_price' && goldMcapBn) {
                  goldOzPer1m = Math.round(goldMcapBn * 1000 / Number(r.value) * 100) / 100;
                }
                if (r.metric === 'silver_price' && silverMcapBn) {
                  silverOzPer1m = Math.round(silverMcapBn * 1000 / Number(r.value) * 100) / 100;
                }
              }
            });
          }

          history = history.concat([{
            year: currentYear,
            pct_gold: mineralCounts.Gold / total,
            pct_silver: mineralCounts.Silver / total,
            pct_pgms: mineralCounts.PGMs / total,
            pct_other: mineralCounts.Other / total,
            pct_producer: statusCounts.Producer / total,
            pct_royalty: statusCounts.Royalty / total,
            pct_developer: statusCounts.Developer / total,
            pct_explorer: statusCounts.Explorer / total,
            gold_oz_per_1m_mcap: goldOzPer1m,
            gold_member_mcap_bn: goldMcapBn,
            silver_oz_per_1m_mcap: silverOzPer1m,
            silver_member_mcap_bn: silverMcapBn,
            total_au_ag_mcap_bn: (goldMcapBn || 0) + (silverMcapBn || 0) || null,
            weighted_oz_per_1m_mcap: (goldMcapBn && silverMcapBn && goldOzPer1m != null && silverOzPer1m != null)
              ? Math.round((goldMcapBn * goldOzPer1m + silverMcapBn * silverOzPer1m) / ((goldMcapBn || 0) + (silverMcapBn || 0)) * 100) / 100
              : null
          }]);
          // Update reportData so initCharts uses the augmented array
          if (reportData) reportData.member_history = history;
        }
      }
    }

    // --- Chart 1: Mineral composition ---
    html += '<h4 style="margin:0 0 8px">Corporate Composition by Primary Mineral</h4>';
    html += '<div class="chart-row"><div class="chart-box chart-full">';
    html += '<canvas id="chart-hist-mineral"></canvas></div></div>';

    // Collapsible table 1
    html += '<details style="margin:8px 0 24px"><summary style="cursor:pointer;font-size:12px;color:#5D6D7E;user-select:none">Show data table</summary>';
    html += '<table class="psr-table" style="margin-top:8px"><thead><tr><th>Year</th><th class="num">Gold</th><th class="num">Silver</th><th class="num">PGMs</th><th class="num">Other</th></tr></thead><tbody>';
    history.forEach(function(r) {
      html += '<tr>';
      html += '<td>' + r.year + '</td>';
      html += '<td class="num">' + fmtPctVal(r.pct_gold) + '</td>';
      html += '<td class="num">' + fmtPctVal(r.pct_silver) + '</td>';
      html += '<td class="num">' + fmtPctVal(r.pct_pgms) + '</td>';
      html += '<td class="num">' + fmtPctVal(r.pct_other) + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></details>';

    // --- Chart 2: Status composition ---
    html += '<h4 style="margin:0 0 8px">Corporate Composition by Status</h4>';
    html += '<div class="chart-row"><div class="chart-box chart-full">';
    html += '<canvas id="chart-hist-status"></canvas></div></div>';

    // Collapsible table 2
    html += '<details style="margin:8px 0 0"><summary style="cursor:pointer;font-size:12px;color:#5D6D7E;user-select:none">Show data table</summary>';
    html += '<table class="psr-table" style="margin-top:8px"><thead><tr><th>Year</th><th class="num">Producer</th><th class="num">Royalty</th><th class="num">Developer</th><th class="num">Explorer</th></tr></thead><tbody>';
    history.forEach(function(r) {
      html += '<tr>';
      html += '<td>' + r.year + '</td>';
      html += '<td class="num">' + fmtPctVal(r.pct_producer) + '</td>';
      html += '<td class="num">' + fmtPctVal(r.pct_royalty) + '</td>';
      html += '<td class="num">' + fmtPctVal(r.pct_developer) + '</td>';
      html += '<td class="num">' + fmtPctVal(r.pct_explorer) + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></details>';

    // --- Chart 3: Gold Issuer Valuations (dual-axis) ---
    // Filter to rows that have valuation data (2008+)
    var valRows = history.filter(function(r) { return r.gold_oz_per_1m_mcap != null; });
    if (valRows.length) {
      html += '<h4 style="margin:24px 0 8px">Issuer Valuations — Primary Metal: Gold</h4>';
      html += '<div class="chart-row"><div class="chart-box chart-full">';
      html += '<canvas id="chart-gold-valuation"></canvas></div></div>';

      // Collapsible table
      html += '<details style="margin:8px 0 0"><summary style="cursor:pointer;font-size:12px;color:#5D6D7E;user-select:none">Show data table</summary>';
      html += '<table class="psr-table" style="margin-top:8px"><thead><tr><th>Year</th><th class="num">Gold oz / $1M MCap</th><th class="num">Gold Member MCap ($B)</th></tr></thead><tbody>';
      valRows.forEach(function(r) {
        html += '<tr><td>' + r.year + '</td>';
        html += '<td class="num">' + fmtNum(r.gold_oz_per_1m_mcap, 1) + '</td>';
        html += '<td class="num">' + fmtNum(r.gold_member_mcap_bn, 1) + '</td></tr>';
      });
      html += '</tbody></table></details>';
    }

    // --- Chart 4: Silver Issuer Valuations (dual-axis) ---
    var silValRows = history.filter(function(r) { return r.silver_oz_per_1m_mcap != null || r.silver_member_mcap_bn != null; });
    if (silValRows.length) {
      html += '<h4 style="margin:24px 0 8px">Issuer Valuations — Primary Metal: Silver</h4>';
      html += '<div class="chart-row"><div class="chart-box chart-full">';
      html += '<canvas id="chart-silver-valuation"></canvas></div></div>';

      // Collapsible table
      html += '<details style="margin:8px 0 0"><summary style="cursor:pointer;font-size:12px;color:#5D6D7E;user-select:none">Show data table</summary>';
      html += '<table class="psr-table" style="margin-top:8px"><thead><tr><th>Year</th><th class="num">Silver oz / $1M MCap</th><th class="num">Silver Member MCap ($B)</th></tr></thead><tbody>';
      silValRows.forEach(function(r) {
        html += '<tr><td>' + r.year + '</td>';
        html += '<td class="num">' + fmtNum(r.silver_oz_per_1m_mcap, 1) + '</td>';
        html += '<td class="num">' + fmtNum(r.silver_member_mcap_bn, 1) + '</td></tr>';
      });
      html += '</tbody></table></details>';
    }

    // --- Chart 5: Au & Ag Weighted Avg Valuations (dual-axis) ---
    var wgtRows = history.filter(function(r) { return r.weighted_oz_per_1m_mcap != null || r.total_au_ag_mcap_bn != null; });
    if (wgtRows.length) {
      html += '<h4 style="margin:24px 0 8px">Issuer Valuations — Au &amp; Ag Weighted Avg</h4>';
      html += '<div class="chart-row"><div class="chart-box chart-full">';
      html += '<canvas id="chart-weighted-valuation"></canvas></div></div>';

      // Collapsible table
      html += '<details style="margin:8px 0 0"><summary style="cursor:pointer;font-size:12px;color:#5D6D7E;user-select:none">Show data table</summary>';
      html += '<table class="psr-table" style="margin-top:8px"><thead><tr><th>Year</th><th class="num">Weighted Avg oz / $1M MCap</th><th class="num">Total Au + Ag MCap ($B)</th></tr></thead><tbody>';
      wgtRows.forEach(function(r) {
        html += '<tr><td>' + r.year + '</td>';
        html += '<td class="num">' + fmtNum(r.weighted_oz_per_1m_mcap, 1) + '</td>';
        html += '<td class="num">' + fmtNum(r.total_au_ag_mcap_bn, 1) + '</td></tr>';
      });
      html += '</tbody></table></details>';
    }

    return html;
  }

  function fmtNum(v, decimals) {
    if (v == null) return '—';
    return Number(v).toFixed(decimals != null ? decimals : 0);
  }

  function fmtPctVal(v) {
    if (v == null) return '—';
    return (Number(v) * 100).toFixed(1) + '%';
  }

  // ── 8. Financials ────────────────────────────────────
  function renderFinancials(rows, evt, source) {
    var revenue = rows.filter(function(r) { return r.category === 'revenue'; });
    var expenses = rows.filter(function(r) { return r.category === 'expense'; });
    var isBudget = source === 'budget';
    var priorYear = evt.year - 1;

    // Variance helpers
    function varDollar(a, b) {
      if (a == null || b == null) return '';
      var diff = Number(a) - Number(b);
      if (diff === 0 && Number(a) === 0) return '';
      var cls = diff >= 0 ? 'var-up' : 'var-down';
      var prefix = diff >= 0 ? '+' : '-';
      return '<span class="' + cls + '">' + prefix + '$' + fmt(Math.abs(diff)) + '</span>';
    }
    function varRatio(a, b) {
      if (a == null || b == null || Number(b) === 0) return '';
      var diff = Number(a) - Number(b);
      if (diff === 0) return '';
      var pct = (diff / Math.abs(Number(b)) * 100);
      var cls = pct >= 0 ? 'var-up' : 'var-down';
      return '<span class="' + cls + '">' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '</span>';
    }

    // Source badge
    var html = '';
    if (isBudget) {
      html += '<div style="margin-bottom:10px;font-size:11px;color:#6B7280">';
      html += '<span style="display:inline-block;background:#E8F5E9;color:#2E7D32;padding:2px 8px;border-radius:10px;font-weight:600;font-size:10px;vertical-align:middle">LIVE</span> ';
      html += 'Synced from <a href="https://budget.denvergold.org" target="_blank" style="color:#1A73E8;text-decoration:none">budget.denvergold.org</a>';
      html += '</div>';
    }

    // Budget-style table (GL | Account | Prior Actual | Budget | Δ Prior $ | Δ Prior | Actual | Δ Budget $ | Δ Bgt)
    if (isBudget) {
      html += '<table class="psr-table" style="font-size:12px"><thead><tr>';
      html += '<th style="width:40px">GL</th><th>Account</th>';
      html += '<th class="num">' + priorYear + ' Actual</th>';
      html += '<th class="num">' + evt.year + ' Budget</th>';
      html += '<th class="num" style="background:#FFFDE7;font-weight:700">' + evt.year + ' Actual</th>';
      html += '<th class="num">&Delta; ' + priorYear + ' $</th><th class="num">&Delta; ' + priorYear + '</th>';
      html += '<th class="num">&Delta; Budget $</th><th class="num">&Delta; Bgt</th>';
      html += '</tr></thead><tbody>';

      // Revenue section header
      html += '<tr style="background:#F5F5F5;font-weight:700"><td colspan="9">Revenue</td></tr>';
      var totPrior = 0, totBudget = 0, totActual = 0;
      revenue.forEach(function(r) {
        var prior = Number(r.prior_year_amount) || 0;
        var budget = Number(r.budget_amount) || 0;
        var actual = Number(r.actual_amount) || 0;
        totPrior += prior;
        totBudget += budget;
        totActual += actual;
        html += '<tr>';
        html += '<td style="color:#9E9E9E;font-size:11px">' + esc(r.gl_code || '') + '</td>';
        html += '<td>' + esc(r.line_item) + '</td>';
        html += '<td class="num">' + (prior ? fmtDollar(prior) : '&mdash;') + '</td>';
        html += '<td class="num">' + (budget ? fmtDollar(budget) : '&mdash;') + '</td>';
        html += '<td class="num" style="background:#FFFDE7;font-weight:600">' + (actual ? fmtDollar(actual) : '&mdash;') + '</td>';
        html += '<td class="num" style="font-size:11px">' + varDollar(actual, prior) + '</td>';
        html += '<td class="num" style="font-size:11px">' + varRatio(actual, prior) + '</td>';
        html += '<td class="num" style="font-size:11px">' + varDollar(actual, budget) + '</td>';
        html += '<td class="num" style="font-size:11px">' + varRatio(actual, budget) + '</td>';
        html += '</tr>';
      });
      // Total Revenue
      html += '<tr style="font-weight:700;background:#F8F9FB;border-top:2px solid #E0E0E0">';
      html += '<td></td><td>Total Revenue</td>';
      html += '<td class="num">' + fmtDollar(totPrior) + '</td>';
      html += '<td class="num">' + fmtDollar(totBudget) + '</td>';
      html += '<td class="num" style="background:#FFFDE7">' + fmtDollar(totActual) + '</td>';
      html += '<td class="num" style="font-size:11px">' + varDollar(totActual, totPrior) + '</td>';
      html += '<td class="num" style="font-size:11px">' + varRatio(totActual, totPrior) + '</td>';
      html += '<td class="num" style="font-size:11px">' + varDollar(totActual, totBudget) + '</td>';
      html += '<td class="num" style="font-size:11px">' + varRatio(totActual, totBudget) + '</td>';
      html += '</tr>';

      // Expenses section
      if (expenses.length) {
        html += '<tr style="background:#F5F5F5;font-weight:700"><td colspan="9">Expenses</td></tr>';
        var totExpPrior = 0, totExpBudget = 0, totExpActual = 0;
        expenses.forEach(function(r) {
          var prior = Math.abs(Number(r.prior_year_amount)) || 0;
          var budget = Math.abs(Number(r.budget_amount)) || 0;
          var actual = Math.abs(Number(r.actual_amount)) || 0;
          totExpPrior += prior;
          totExpBudget += budget;
          totExpActual += actual;
          html += '<tr>';
          html += '<td style="color:#9E9E9E;font-size:11px">' + esc(r.gl_code || '') + '</td>';
          html += '<td>' + esc(r.line_item) + '</td>';
          html += '<td class="num">' + (prior ? fmtDollar(prior) : '&mdash;') + '</td>';
          html += '<td class="num">' + (budget ? fmtDollar(budget) : '&mdash;') + '</td>';
          html += '<td class="num" style="background:#FFFDE7;font-weight:600">' + (actual ? fmtDollar(actual) : '&mdash;') + '</td>';
          html += '<td class="num" style="font-size:11px">' + varDollar(actual, prior) + '</td>';
          html += '<td class="num" style="font-size:11px">' + varRatio(actual, prior) + '</td>';
          html += '<td class="num" style="font-size:11px">' + varDollar(actual, budget) + '</td>';
          html += '<td class="num" style="font-size:11px">' + varRatio(actual, budget) + '</td>';
          html += '</tr>';
        });
      }

      // Net result
      var netPrior = totPrior - (totExpPrior || 0);
      var netBudget = totBudget - (totExpBudget || 0);
      var netActual = totActual - (totExpActual || 0);
      html += '</tbody><tfoot><tr style="font-weight:700;border-top:2px solid #333">';
      html += '<td></td><td>Net Result</td>';
      html += '<td class="num">' + fmtDollar(netPrior) + '</td>';
      html += '<td class="num">' + fmtDollar(netBudget) + '</td>';
      html += '<td class="num ' + (netActual >= 0 ? 'var-up' : 'var-down') + '" style="background:#FFFDE7">' + fmtDollar(netActual) + '</td>';
      html += '<td class="num" style="font-size:11px">' + varDollar(netActual, netPrior) + '</td>';
      html += '<td class="num" style="font-size:11px">' + varRatio(netActual, netPrior) + '</td>';
      html += '<td class="num" style="font-size:11px">' + varDollar(netActual, netBudget) + '</td>';
      html += '<td class="num" style="font-size:11px">' + varRatio(netActual, netBudget) + '</td>';
      html += '</tr></tfoot></table>';

    } else {
      // Legacy manual format (simpler table)
      html += '<table class="psr-table"><thead><tr>';
      html += '<th>Line Item</th><th class="num">Actual ' + evt.year + '</th><th class="num">Budget ' + evt.year + '</th><th class="num">Var</th><th class="num">Prior Year</th>';
      html += '</tr></thead><tbody>';
      html += '<tr><td class="section-label" colspan="5">Revenue</td></tr>';
      var totalRevActual = 0, totalRevBudget = 0, totalRevPrior = 0;
      revenue.forEach(function(r) {
        totalRevActual += Number(r.actual_amount) || 0;
        totalRevBudget += Number(r.budget_amount) || 0;
        totalRevPrior += Number(r.prior_year_amount) || 0;
        html += '<tr><td>' + esc(r.line_item) + '</td>';
        html += '<td class="num">' + fmtDollar(r.actual_amount) + '</td>';
        html += '<td class="num">' + fmtDollar(r.budget_amount) + '</td>';
        html += '<td class="pct">' + fmtPct(r.actual_amount, r.budget_amount) + '</td>';
        html += '<td class="num">' + fmtDollar(r.prior_year_amount) + '</td></tr>';
      });
      html += '<tr style="font-weight:600;background:#F8F9FB"><td>Total Revenue</td>';
      html += '<td class="num">' + fmtDollar(totalRevActual) + '</td>';
      html += '<td class="num">' + fmtDollar(totalRevBudget) + '</td>';
      html += '<td class="pct">' + fmtPct(totalRevActual, totalRevBudget) + '</td>';
      html += '<td class="num">' + fmtDollar(totalRevPrior) + '</td></tr>';
      html += '<tr><td class="section-label" colspan="5">Expenses</td></tr>';
      expenses.forEach(function(r) {
        html += '<tr><td>' + esc(r.line_item) + '</td>';
        html += '<td class="num">' + fmtDollar(r.actual_amount) + '</td>';
        html += '<td class="num">' + fmtDollar(r.budget_amount) + '</td>';
        html += '<td class="pct">' + fmtPct(Math.abs(Number(r.actual_amount)), Math.abs(Number(r.budget_amount))) + '</td>';
        html += '<td class="num">' + fmtDollar(r.prior_year_amount) + '</td></tr>';
      });
      var expActual = expenses.reduce(function(s, r) { return s + (Number(r.actual_amount) || 0); }, 0);
      var expBudget = expenses.reduce(function(s, r) { return s + (Number(r.budget_amount) || 0); }, 0);
      var expPrior = expenses.reduce(function(s, r) { return s + (Number(r.prior_year_amount) || 0); }, 0);
      var netActual = totalRevActual + expActual;
      var netBudget = totalRevBudget + expBudget;
      var netPrior = totalRevPrior + expPrior;
      html += '</tbody><tfoot><tr><td>Net Result</td>';
      html += '<td class="num ' + (netActual >= 0 ? 'var-up' : 'var-down') + '">' + fmtDollar(netActual) + '</td>';
      html += '<td class="num">' + fmtDollar(netBudget) + '</td>';
      html += '<td class="pct">' + fmtPct(netActual, netBudget) + '</td>';
      html += '<td class="num">' + fmtDollar(netPrior) + '</td></tr></tfoot></table>';
    }

    // Indexed chart (prior year = 100)
    html += '<div class="chart-row" style="margin-top:16px">';
    html += '<div class="chart-box chart-full"><h4>Revenue &amp; Expenses — Indexed (' + priorYear + ' = 100)</h4><canvas id="chart-financials"></canvas></div>';
    html += '</div>';

    return html;
  }

  // ── 9. Historical Financials ─────────────────────────
  // Historical nominal direct operating revenue & expenses (MFE only)
  // [year, revenue, expenses (negative)]
  var HIST_FINANCIALS = [
    [1997,  250000,  -188490],
    [1998,  220000,  -164484],
    [2000,  100000,  -159049],
    [2003,  205455,  -153586],
    [2004,  257840,  -162514],
    [2005,  256925,  -146357],
    [2006,  302457,  -247593],
    [2007,  528552,  -336210],
    [2008,  752685,  -493685],
    [2009,  647401,  -493685],
    [2010, 1081795,  -616892],
    [2011, 1241625,  -712905],
    [2012, 1443200,  -767452],
    [2013, 1308217,  -640127],
    [2014,  656360,  -570588],
    [2015,  596250,  -423962],
    [2016,  596250,  -421835],
    [2017,  842052,  -571873],
    [2018,  853250,  -584499],
    [2019,  771720,  -505206],
    [2020,  152269,  -299665],
    [2021,  424895,   -87286],
    [2022,  215003,   -62569],
    [2023,  571214,  -671894],
    [2024,  565431,  -553817]
  ];

  function buildHistRows(financials, evt, histActuals) {
    var rows = HIST_FINANCIALS.slice();

    // Override with live actuals from budget Supabase
    if (histActuals && histActuals.length) {
      histActuals.forEach(function(ha) {
        rows = rows.filter(function(r) { return r[0] !== ha.year; });
        // expenses come as negative in our convention
        var exp = Number(ha.expenses) || 0;
        if (exp > 0) exp = -exp; // ensure negative
        rows.push([ha.year, Number(ha.revenue) || 0, exp]);
      });
    }

    // Auto-compute current year from financials
    if (financials && financials.length && evt) {
      var rev = financials.filter(function(r) { return r.category === 'revenue'; });
      var exp = financials.filter(function(r) { return r.category === 'expense'; });
      var totRev = rev.reduce(function(s, r) { return s + (Number(r.actual_amount) || 0); }, 0);
      var totExp = exp.reduce(function(s, r) { return s + (Number(r.actual_amount) || 0); }, 0);
      if (totRev || totExp) {
        rows = rows.filter(function(r) { return r[0] !== evt.year; });
        rows.push([evt.year, totRev, totExp]);
      }
    }

    rows.sort(function(a, b) { return a[0] - b[0]; });
    return rows;
  }

  function renderHistoricalFinancials(financials, evt, histActuals) {
    var rows = buildHistRows(financials, evt, histActuals);
    var isReal = inflationMode === 'real';
    var years = rows.map(function(r) { return r[0]; });

    // Inflation controls
    var html = '<div class="inflation-controls">';
    html += '<div class="inflation-toggle">';
    html += '<button ' + (inflationMode === 'nominal' ? 'class="active"' : '') + ' onclick="PSR.setInflation(\'nominal\')">Nominal</button>';
    html += '<button ' + (inflationMode === 'real' ? 'class="active"' : '') + ' onclick="PSR.setInflation(\'real\')">Real (Inflation-Adjusted)</button>';
    html += '</div>';
    html += '<div class="base-year-wrap">';
    html += '<label>Base year:</label>';
    html += '<select onchange="PSR.setBaseYear(Number(this.value))">';
    var sortedYears = years.slice().sort(function(a,b){ return b - a; });
    sortedYears.forEach(function(y) {
      html += '<option value="' + y + '"' + (y === baseYear ? ' selected' : '') + '>' + y + '</option>';
    });
    html += '</select></div>';
    if (isReal) {
      html += '<span class="inflation-note">Constant ' + baseYear + ' USD (CPI-U, BLS)</span>';
    }
    html += '</div>';

    // Chart first (above the table)
    var suffix = isReal ? ' (Constant ' + baseYear + ' USD)' : ' (USD)';
    html += '<div class="chart-row" style="margin-top:8px">';
    html += '<div class="chart-box chart-full">';
    html += '<h4 style="font-size:14px;font-weight:700;text-transform:uppercase">Direct Operating Revenue &amp; Expenses' + (isReal ? ' <span style="font-size:11px;font-weight:400;text-transform:none;color:#999">' + baseYear + ' USD</span>' : '') + '</h4>';
    html += '<canvas id="chart-hist-financials"></canvas>';
    html += '<p style="font-size:11px;color:#888;margin:4px 0 0;font-style:italic">* Virtual-only event (dashed lines)</p>';
    html += '</div></div>';

    // Collapsible data table
    html += '<div style="margin-top:12px">';
    html += '<div onclick="PSR.toggleHistTable(this)" style="cursor:pointer;display:flex;align-items:center;gap:6px;padding:6px 0;color:#666;font-size:12px;font-weight:600;user-select:none">';
    html += '<span class="hist-table-arrow" style="display:inline-block;transition:transform 0.2s;transform:rotate(0deg);font-size:10px">&#9654;</span> Data Table';
    html += '</div>';
    html += '<div class="hist-table-wrap" style="display:none">';
    html += '<table class="psr-table" style="font-size:12px"><thead><tr>';
    html += '<th>Year</th><th class="num">Direct Revenue</th><th class="num">Direct Expenses</th><th class="num">Net Operating Income</th>';
    html += '</tr></thead><tbody>';

    rows.forEach(function(r) {
      var year = r[0];
      var rev = isReal ? adj(r[1], year) : r[1];
      var exp = isReal ? adj(r[2], year) : r[2];
      var net = rev + exp;
      var isCurrent = evt && year === evt.year;
      var isVirtual = VIRTUAL_YEARS[year];
      var rowStyle = '';
      if (isCurrent) rowStyle = ' style="background:#FFFDE7;font-weight:600"';
      else if (isVirtual) rowStyle = ' style="background:#FFF8E1;font-style:italic"';
      html += '<tr' + rowStyle + '>';
      var yearLabel = String(year);
      if (isCurrent) yearLabel += ' **';
      else if (isVirtual) yearLabel += ' *';
      html += '<td>' + yearLabel + '</td>';
      html += '<td class="num">' + fmtDollar(rev) + '</td>';
      html += '<td class="num">' + fmtDollar(exp) + '</td>';
      html += '<td class="num ' + (net >= 0 ? 'var-up' : 'var-down') + '">' + fmtDollar(net) + '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';
    html += '<div style="font-size:10px;color:#9E9E9E;margin-top:4px">';
    html += '* Virtual-only event';
    if (evt) html += ' &nbsp;&middot;&nbsp; ** ' + evt.year + ' computed from current financials';
    html += '</div>';
    html += '</div></div>';

    return html;
  }

  function toggleHistTable(el) {
    var wrap = el.nextElementSibling;
    var arrow = el.querySelector('.hist-table-arrow');
    if (wrap.style.display === 'none') {
      wrap.style.display = 'block';
      arrow.style.transform = 'rotate(90deg)';
    } else {
      wrap.style.display = 'none';
      arrow.style.transform = 'rotate(0deg)';
    }
  }

  // ── Sponsors ──────────────────────────────────────
  function renderSponsors(sponsors) {
    var html = '<table class="psr-table"><thead><tr>';
    html += '<th>Sponsor</th><th class="num">Amount</th><th>Description</th>';
    html += '</tr></thead><tbody>';

    var total = 0;
    sponsors.forEach(function(s) {
      total += Number(s.amount_usd) || 0;
      html += '<tr>';
      html += '<td>' + esc(s.sponsor_name) + '</td>';
      html += '<td class="num">' + fmtDollar(s.amount_usd) + '</td>';
      html += '<td>' + esc(s.description || '') + '</td>';
      html += '</tr>';
    });

    html += '</tbody>';
    if (sponsors.length > 1) {
      html += '<tfoot><tr><td>Total</td><td class="num">' + fmtDollar(total) + '</td><td></td></tr></tfoot>';
    }
    html += '</table>';
    return html;
  }

  // ── 9. Registration & Attendance ─────────────────────
  // Proper-case metric names (remove underscores, title case)
  function metricLabel(m) {
    var overrides = {
      'total_event_members': 'Total Event Members',
      'presenting_members': 'Presenting Members',
      'presentation_slots': 'Presentation Slots',
      'event_sponsors': 'Event Sponsors',
      'cancellations_withdrawals': 'Cancellations / Withdrawals',
      'new_membership_from_event': 'New Membership from Event',
      'no_response': 'No Response',
      'opted_out': 'Opted Out',
      'accepted_cancelled': 'Accepted — Cancelled',
      'total_preregistered': 'Total Pre-Registered',
      'checked_in': 'Checked In',
      'walk_up': 'Walk-Up',
      'no_show': 'No Show',
      'attended_in_person': 'Attended In Person'
    };
    if (overrides[m]) return overrides[m];
    // Fallback: replace underscores, title case
    return m.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
  }

  function renderRegistration(rows, evt) {
    var html = '';
    var priorYear = evt.year - 1;

    // ── Registration Funnel ──
    var regItems = rows.filter(function(r) { return r.section === 'registration'; });
    if (regItems.length) {
      // Define funnel order, subtotal/total rows
      var funnelOrder = ['invited','no_response','declined','opted_out','substituted','accepted_cancelled','accepted',
        'total_preregistered','checked_in','walk_up','no_show','attended_in_person'];
      var subtotalKeys = { 'total_preregistered': true };
      var grandTotalKeys = { 'attended_in_person': true };
      // Build lookup
      var regMap = {};
      regItems.forEach(function(r) { regMap[r.metric] = r; });

      // Totals for % of total columns
      var invitedCurrent = regMap['invited'] ? Number(regMap['invited'].value_current) || 0 : 0;
      var invitedPrior = regMap['invited'] ? Number(regMap['invited'].value_prior) || 0 : 0;

      html += '<h4 style="font-size:13px;font-weight:700;margin:16px 0 8px;color:var(--header-mid)">Registration Funnel</h4>';
      html += '<table class="psr-table"><thead><tr>';
      html += '<th>Metric</th><th class="num">' + evt.year + '</th><th class="pct">%</th>';
      html += '<th class="num">' + priorYear + '</th><th class="pct">%</th>';
      html += '<th class="num">&Delta; ' + priorYear + '</th><th class="num">Var</th>';
      html += '</tr></thead><tbody>';

      // Attended In Person = Checked In + Walk-Up (excludes No Show)
      // Balance: Total Pre-Registered = Checked In + Walk-Up + |No Show|
      var checkedIn = regMap['checked_in'] ? Number(regMap['checked_in'].value_current) || 0 : 0;
      var walkUp = regMap['walk_up'] ? Number(regMap['walk_up'].value_current) || 0 : 0;
      var computedAttended = checkedIn + walkUp;
      var priorCheckedIn = regMap['checked_in'] ? Number(regMap['checked_in'].value_prior) || 0 : 0;
      var priorWalkUp = regMap['walk_up'] ? Number(regMap['walk_up'].value_prior) || 0 : 0;
      var computedAttendedPrior = priorCheckedIn + priorWalkUp;

      funnelOrder.forEach(function(key) {
        var r = regMap[key];
        if (!r) return;
        var isSubtotal = subtotalKeys[key];
        var isGrandTotal = grandTotalKeys[key];
        var val, prior;

        if (isGrandTotal) {
          val = computedAttended;
          prior = computedAttendedPrior;
        } else {
          val = Number(r.value_current) || 0;
          prior = r.value_prior != null ? Number(r.value_prior) || 0 : null;
        }

        var isNeg = val < 0;
        var rowStyle = '';
        if (isGrandTotal) rowStyle = ' style="font-weight:700;border-top:2px solid #333"';
        else if (isSubtotal) rowStyle = ' style="font-weight:700;background:#F8F9FB;border-top:2px solid #E0E0E0"';

        html += '<tr' + rowStyle + '>';
        html += '<td>' + metricLabel(key) + '</td>';
        // Current value + %
        html += '<td class="num">' + (isNeg ? '(' + fmt(Math.abs(val)) + ')' : fmt(val)) + '</td>';
        html += '<td class="pct" style="color:#888">' + (invitedCurrent ? (Math.abs(val) / invitedCurrent * 100).toFixed(1) + '%' : '') + '</td>';
        // Prior value + %
        if (prior != null) {
          html += '<td class="num">' + (prior < 0 ? '(' + fmt(Math.abs(prior)) + ')' : fmt(prior)) + '</td>';
          html += '<td class="pct" style="color:#888">' + (invitedPrior ? (Math.abs(prior) / invitedPrior * 100).toFixed(1) + '%' : '') + '</td>';
        } else {
          html += '<td class="num">&mdash;</td><td class="pct"></td>';
        }
        // Delta (difference)
        if (prior != null) {
          var diff = val - prior;
          // For negative funnel items, a more-negative value is worse (down), less-negative is better (up)
          var cls = isNeg ? (diff <= 0 ? 'var-up' : 'var-down') : (diff >= 0 ? 'var-up' : 'var-down');
          var absDiff = Math.abs(diff);
          var sign = diff >= 0 ? '+' : '-';
          html += '<td class="num"><span class="' + cls + '">' + (diff === 0 ? fmt(0) : sign + fmt(absDiff)) + '</span></td>';
        } else {
          html += '<td class="num"></td>';
        }
        // Var %
        if (prior != null && prior !== 0) {
          var absVal = Math.abs(val);
          var absPrior = Math.abs(prior);
          var pctChange = ((absVal - absPrior) / absPrior * 100).toFixed(1);
          var pctCls = isNeg ? (Number(pctChange) <= 0 ? 'var-up' : 'var-down') : (Number(pctChange) >= 0 ? 'var-up' : 'var-down');
          var pctSign = Number(pctChange) >= 0 ? '+' : '';
          html += '<td class="pct"><span class="' + pctCls + '">' + pctSign + pctChange + '%</span></td>';
        } else {
          html += '<td class="pct"></td>';
        }
        html += '</tr>';
      });

      html += '</tbody></table>';
    }

    // ── Attendee Class & Country (simple tables with delta) ──
    var simpleSections = [
      { key: 'attendee_class', title: 'Attendees by Classification' },
      { key: 'attendee_country', title: 'Attendees by Country' }
    ];

    simpleSections.forEach(function(sec) {
      var items = rows.filter(function(r) { return r.section === sec.key; });
      if (!items.length) return;

      html += '<h4 style="font-size:13px;font-weight:700;margin:16px 0 8px;color:var(--header-mid)">' + sec.title + '</h4>';
      html += '<table class="psr-table"><thead><tr>';
      html += '<th>Metric</th><th class="num">' + evt.year + '</th><th class="num">' + priorYear + '</th>';
      html += '<th class="num">&Delta; ' + priorYear + '</th><th class="num">Var</th>';
      html += '</tr></thead><tbody>';

      var totalCurrent = 0, totalPrior = 0, hasPrior = false;
      items.forEach(function(r) {
        var val = Number(r.value_current) || 0;
        var prior = r.value_prior != null ? Number(r.value_prior) || 0 : null;
        totalCurrent += val;
        if (prior != null) { totalPrior += prior; hasPrior = true; }

        html += '<tr>';
        html += '<td>' + metricLabel(r.metric) + '</td>';
        html += '<td class="num">' + fmt(val) + '</td>';
        if (prior != null) {
          html += '<td class="num">' + fmt(prior) + '</td>';
          var diff = val - prior;
          var cls = diff >= 0 ? 'var-up' : 'var-down';
          var sign = diff >= 0 ? '+' : '';
          html += '<td class="num"><span class="' + cls + '">' + sign + fmt(diff) + '</span></td>';
          html += '<td class="pct">' + (prior > 0 ? fmtPct(val, prior) : '') + '</td>';
        } else {
          html += '<td class="num">&mdash;</td><td class="num"></td><td class="pct"></td>';
        }
        html += '</tr>';
      });

      // Total row
      html += '<tr style="font-weight:700;border-top:2px solid #333">';
      html += '<td>Total</td>';
      html += '<td class="num">' + fmt(totalCurrent) + '</td>';
      if (hasPrior) {
        html += '<td class="num">' + fmt(totalPrior) + '</td>';
        var tDiff = totalCurrent - totalPrior;
        var tCls = tDiff >= 0 ? 'var-up' : 'var-down';
        var tSign = tDiff >= 0 ? '+' : '';
        html += '<td class="num"><span class="' + tCls + '">' + tSign + fmt(tDiff) + '</span></td>';
        html += '<td class="pct">' + (totalPrior > 0 ? fmtPct(totalCurrent, totalPrior) : '') + '</td>';
      } else {
        html += '<td class="num">&mdash;</td><td class="num"></td><td class="pct"></td>';
      }
      html += '</tr>';

      html += '</tbody></table>';
    });

    // Attendance charts
    html += '<div class="chart-row" style="margin-top:16px">';
    html += '<div class="chart-box"><h4>Attendees by Classification</h4><canvas id="chart-attendee-class"></canvas></div>';
    html += '<div class="chart-box"><h4>Top Countries</h4><canvas id="chart-attendee-country"></canvas></div>';
    html += '</div>';

    return html;
  }

  // ── Registration Historical Data ─────────────────────
  var HIST_ATTENDANCE = [
    [2003, 63, 19, 44, 5, 9],
    [2004, 100, 19, 55, 4, 10],
    [2005, 99, 12, 57, 7, 1],
    [2006, 119, 26, 53, 5, 14],
    [2007, 141, 15, 113, 15, 34],
    [2008, 194, 27, 124, 10, 19],
    [2009, 232, 28, 118, 13, 29],
    [2010, 220, 49, 183, 17, 39],
    [2011, 279, 49, 188, 13, 59],
    [2012, 283, 49, 215, 21, 49],
    [2013, 255, 42, 214, 16, 28],
    [2014, 248, 23, 139, 19, 19],
    [2015, 206, 22, 122, 7, 22],
    [2016, 211, 18, 113, 8, 29],
    [2017, 224, 25, 170, 14, 20],
    [2018, 206, 25, 176, 9, 24],
    [2019, 214, 21, 163, 13, 25],
    [2020, 209, 44, 247, 16, 78],
    [2021, 168, 38, 320, 10, 47],
    [2022, 77, 22, 107, 2, 19],
    [2023, 147, 7, 86, 7, 34],
    [2024, 172, 9, 87, 8, 32],
    [2025, 187, 12, 90, 7, 22]
  ];
  var HIST_ATT_CATS = ['Buy-Side', 'Sell-Side', 'Member Delegates', 'Media', 'Other'];
  var HIST_ATT_COLORS = ['#2471A3', '#27AE60', '#D4AC0D', '#7F8C8D', '#C0392B'];

  // Create a striped pattern for virtual-only years
  function makeStripePattern(baseColor, alpha) {
    var c = document.createElement('canvas');
    c.width = 10; c.height = 10;
    var ctx = c.getContext('2d');
    ctx.fillStyle = baseColor;
    ctx.globalAlpha = alpha || 0.4;
    ctx.fillRect(0, 0, 10, 10);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 10); ctx.lineTo(10, 0);
    ctx.stroke();
    return ctx.createPattern(c, 'repeat');
  }

  // Map reg_recon categories → HIST_ATT_CATS index
  var RECON_TO_HIST = {
    'Buy-Side': 0,
    'Sell-Side': 1,
    'Member Delegates': 2,
    'Media': 3,
    'Academic / Researcher': 4,
    'Banking / Corporate Finance': 4,
    'Market Professional': 4,
    'Consulting': 4,
    'Government': 4,
    'Association': 4,
    'Speakers / VIP': 4,
    'Staff / Organizer': 4,
    'Other': 4
  };

  // Build attendance history including current year from reg_recon data
  function buildAttendanceHistory() {
    var rows = HIST_ATTENDANCE.slice();
    if (reportData && reportData.reg_recon && reportData.event) {
      var yr = reportData.event.year;
      // Reg recon now uses attended-only data, so total = new + repeating + returning
      var buckets = [0, 0, 0, 0, 0]; // Buy-Side, Sell-Side, Member Delegates, Media, Other
      reportData.reg_recon.forEach(function(r) {
        if (!r.is_total) return;
        var attended = (Number(r.value_new) || 0) + (Number(r.value_repeating) || 0) + (Number(r.value_returning) || 0);
        if (attended === 0) return;
        var idx = RECON_TO_HIST[r.category];
        if (idx == null) idx = 4; // default to Other
        buckets[idx] += attended;
      });
      var total = buckets[0] + buckets[1] + buckets[2] + buckets[3] + buckets[4];
      if (total > 0) {
        // Remove if year already exists
        rows = rows.filter(function(r) { return r[0] !== yr; });
        rows.push([yr, buckets[0], buckets[1], buckets[2], buckets[3], buckets[4]]);
        rows.sort(function(a, b) { return a[0] - b[0]; });
      }
    }
    return rows;
  }

  var histAttChart = null;
  function initHistAttChart() {
    var canvas = document.getElementById('chart-hist-attendance');
    if (!canvas) return;
    if (histAttChart) { histAttChart.destroy(); histAttChart = null; }

    var histData = buildAttendanceHistory();
    var labels = histData.map(function(r) { return r[0]; });
    var datasets = HIST_ATT_CATS.map(function(cat, i) {
      var baseColor = HIST_ATT_COLORS[i];
      var stripe = makeStripePattern(baseColor, 0.45);
      return {
        label: cat,
        data: histData.map(function(r) { return r[i + 1]; }),
        backgroundColor: histData.map(function(r) {
          return VIRTUAL_YEARS[r[0]] ? stripe : baseColor;
        }),
        borderWidth: histData.map(function(r) {
          return VIRTUAL_YEARS[r[0]] ? 1 : 0;
        }),
        borderColor: histData.map(function(r) {
          return VIRTUAL_YEARS[r[0]] ? 'rgba(0,0,0,0.15)' : 'transparent';
        }),
        yAxisID: 'y',
        order: 2
      };
    });

    // Overlay: Au & Ag Weighted Avg oz / $1M MCap from member_history
    var wgtMap = {};
    if (reportData && reportData.member_history) {
      reportData.member_history.forEach(function(r) {
        if (r.weighted_oz_per_1m_mcap != null) wgtMap[r.year] = Number(r.weighted_oz_per_1m_mcap);
      });
    }
    var wgtData = labels.map(function(yr) { return wgtMap[yr] != null ? wgtMap[yr] : null; });
    var hasWgt = wgtData.some(function(v) { return v != null; });

    if (hasWgt) {
      datasets.push({
        label: 'Au & Ag Wtd Avg oz / $1M MCap',
        data: wgtData,
        type: 'line',
        borderColor: '#2C3E50',
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: '#fff',
        pointBorderColor: '#2C3E50',
        pointBorderWidth: 2,
        borderWidth: 2,
        yAxisID: 'y1',
        order: 0,
        spanGaps: true
      });
    }

    histAttChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, padding: 16, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                if (ctx.dataset.yAxisID === 'y1') {
                  return ctx.dataset.label + ': ' + (ctx.raw != null ? ctx.raw.toFixed(0) + ' oz' : '—');
                }
                return ctx.dataset.label + ': ' + fmt(ctx.raw);
              },
              footer: function(items) {
                var barItems = items.filter(function(i) { return i.dataset.yAxisID !== 'y1'; });
                var total = 0;
                barItems.forEach(function(i) { total += i.raw; });
                var yr = labels[items[0].dataIndex];
                return 'Total: ' + fmt(total) + (VIRTUAL_YEARS[yr] ? '  (Virtual Only)' : '');
              }
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: {
              font: { size: 10 },
              callback: function(val, idx) {
                var yr = labels[idx];
                return VIRTUAL_YEARS[yr] ? yr + ' *' : yr;
              }
            }
          },
          y: {
            stacked: true,
            position: 'left',
            title: { display: true, text: 'Attendees', font: { size: 10 } },
            ticks: { callback: function(v) { return fmt(v); }, font: { size: 10 } },
            grid: { color: '#eee' }
          },
          y1: hasWgt ? {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'oz / $1M MCap', font: { size: 10 } },
            ticks: { font: { size: 10 } },
            grid: { drawOnChartArea: false },
            beginAtZero: true
          } : undefined
        }
      }
    });
  }

  function renderRegHistory(evt) {
    var html = '';

    // Chart
    html += '<div style="height:360px;margin-bottom:4px"><canvas id="chart-hist-attendance"></canvas></div>';
    html += '<p style="font-size:11px;color:#888;margin:0 0 12px;font-style:italic">* Virtual-only event (striped bars)</p>';

    // Collapsible data table
    html += '<div style="margin-top:12px">';
    html += '<div onclick="PSR.toggleRegHistTable(this)" style="cursor:pointer;display:flex;align-items:center;gap:6px;padding:6px 0;color:#666;font-size:12px;font-weight:600;user-select:none">';
    html += '<span class="reg-hist-arrow" style="display:inline-block;transition:transform 0.2s;transform:rotate(0deg);font-size:10px">&#9654;</span> Data Table';
    html += '</div>';
    html += '<div class="reg-hist-table-wrap" style="display:none">';
    html += '<table class="psr-table"><thead><tr>';
    html += '<th>Year</th>';
    HIST_ATT_CATS.forEach(function(c) { html += '<th class="num">' + c + '</th>'; });
    html += '<th class="num" style="font-weight:700">Total</th>';
    html += '</tr></thead><tbody>';

    var histAttData = buildAttendanceHistory();
    histAttData.forEach(function(r) {
      var total = r[1] + r[2] + r[3] + r[4] + r[5];
      var isVirtual = VIRTUAL_YEARS[r[0]];
      var rowStyle = isVirtual ? ' style="background:#FFF8E1;font-style:italic"' : '';
      html += '<tr' + rowStyle + '>';
      html += '<td>' + r[0] + (isVirtual ? ' *' : '') + '</td>';
      for (var i = 1; i <= 5; i++) html += '<td class="num">' + fmt(r[i]) + '</td>';
      html += '<td class="num" style="font-weight:700">' + fmt(total) + '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';
    html += '<p style="font-size:11px;color:#888;margin:6px 0 0;font-style:italic">* Virtual-only event</p>';
    html += '</div></div>';
    return html;
  }

  window.PSR = window.PSR || {};
  PSR.toggleRegHistTable = function(el) {
    var wrap = el.nextElementSibling;
    var arrow = el.querySelector('.reg-hist-arrow');
    if (wrap.style.display === 'none') {
      wrap.style.display = 'block';
      arrow.style.transform = 'rotate(90deg)';
    } else {
      wrap.style.display = 'none';
      arrow.style.transform = 'rotate(0deg)';
    }
  };

  // ── Registration Reconciliation ──────────────────────
  var regAttSectionId = null;
  var regReconSectionId = null;

  function renderRegRecon(rows, evt) {
    var ed = isAdmin();
    var html = '';
    var yearCurrent = evt ? evt.year : 2026;
    var yearPrior = yearCurrent - 1;

    // Refresh button (admin only)
    if (ed) {
      html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">';
      html += '<label class="psr-btn" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:6px 14px;background:#1B5E20;color:#fff;border-radius:4px;font-size:12px;font-weight:600">';
      html += '<input type="file" accept=".json" onchange="PSR.refreshRegRecon(this)" style="display:none">';
      html += '&#8635; Refresh from Contacts JSON';
      html += '</label>';
      html += '<span id="reg-recon-status" style="font-size:11px;color:#888"></span>';
      html += '</div>';
    }

    if (!rows || !rows.length) {
      html += '<p style="color:#999;font-style:italic">No reconciliation data. Upload a contacts JSON to populate.</p>';
      return html;
    }

    // Compute grand totals
    var grandNew = 0, grandRep = 0, grandRet = 0, grandTotal = 0, grandPrior = 0;
    var grandCheckedIn = 0, grandWalkUp = 0, grandNoShow = 0;
    rows.forEach(function(r) {
      if (r.is_total) {
        grandNew += Number(r.value_new) || 0;
        grandRep += Number(r.value_repeating) || 0;
        grandRet += Number(r.value_returning) || 0;
        grandTotal += (Number(r.value_new) || 0) + (Number(r.value_repeating) || 0) + (Number(r.value_returning) || 0);
        grandPrior += Number(r.prior_total) || 0;
        grandCheckedIn += Number(r.value_checked_in) || 0;
        grandWalkUp += Number(r.value_walk_up) || 0;
        grandNoShow += Number(r.value_no_show) || 0;
      }
    });
    var hasAttendance = grandCheckedIn > 0 || grandWalkUp > 0 || grandNoShow > 0;
    var grandAttended = grandCheckedIn + grandWalkUp;

    // Last refreshed timestamp
    var maxUpdated = null;
    rows.forEach(function(r) {
      if (r.updated_at) {
        var d = new Date(r.updated_at);
        if (!maxUpdated || d > maxUpdated) maxUpdated = d;
      }
    });
    if (maxUpdated) {
      html += '<p style="font-size:11px;color:#888;margin:0 0 8px">Last refreshed: ' + maxUpdated.toLocaleString() + '</p>';
    }

    // Summary bar
    html += '<div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap">';
    html += reconSummaryCard('Total Accepted', grandTotal, grandPrior);
    html += reconSummaryCard('New', grandNew, null, '#27AE60');
    html += reconSummaryCard('Repeating', grandRep, null, '#2980B9');
    html += reconSummaryCard('Returning', grandRet, null, '#8E44AD');
    html += '</div>';

    // Table
    html += '<table class="psr-table"><thead><tr>';
    html += '<th style="text-align:left">Category</th>';
    html += '<th class="num">New</th>';
    html += '<th class="num">Repeating</th>';
    html += '<th class="num">Returning</th>';
    html += '<th class="num" style="font-weight:700">Total ' + yearCurrent + '</th>';
    html += '<th class="num">Total ' + yearPrior + '</th>';
    html += '<th class="num">VAR</th>';
    html += '</tr></thead><tbody>';

    var currentCat = null;
    rows.forEach(function(r) {
      var vNew = Number(r.value_new) || 0;
      var vRep = Number(r.value_repeating) || 0;
      var vRet = Number(r.value_returning) || 0;
      var total = vNew + vRep + vRet;
      var prior = Number(r.prior_total) || 0;
      var vCI = Number(r.value_checked_in) || 0;
      var vWU = Number(r.value_walk_up) || 0;
      var vNS = Number(r.value_no_show) || 0;

      if (r.is_total) {
        // Category header row (bold)
        currentCat = r.category;
        html += '<tr style="background:#f5f5f5;font-weight:700">';
        html += '<td>' + escHtml(r.category) + '</td>';
        html += '<td class="num">' + fmt(vNew) + '</td>';
        html += '<td class="num">' + fmt(vRep) + '</td>';
        html += '<td class="num">' + fmt(vRet) + '</td>';
        html += '<td class="num" style="font-weight:700">' + fmt(total) + '</td>';
        html += '<td class="num">' + fmt(prior) + '</td>';
        html += '<td class="num">' + reconVar(total, prior) + '</td>';
        html += '</tr>';
      } else {
        // Subcategory detail row (indented)
        html += '<tr>';
        html += '<td style="padding-left:24px;color:#555">' + escHtml(r.subcategory || '') + '</td>';
        html += '<td class="num" style="color:#666">' + fmt(vNew) + '</td>';
        html += '<td class="num" style="color:#666">' + fmt(vRep) + '</td>';
        html += '<td class="num" style="color:#666">' + fmt(vRet) + '</td>';
        html += '<td class="num" style="font-weight:600">' + fmt(total) + '</td>';
        html += '<td class="num" style="color:#999">' + fmt(prior) + '</td>';
        html += '<td class="num">' + reconVar(total, prior) + '</td>';
        html += '</tr>';
      }
    });

    // Grand total row
    html += '<tr style="border-top:2px solid #333;font-weight:700;background:#E8F5E9">';
    html += '<td>Grand Total</td>';
    html += '<td class="num">' + fmt(grandNew) + '</td>';
    html += '<td class="num">' + fmt(grandRep) + '</td>';
    html += '<td class="num">' + fmt(grandRet) + '</td>';
    html += '<td class="num">' + fmt(grandTotal) + '</td>';
    html += '<td class="num">' + (grandPrior > 0 ? fmt(grandPrior) : '\u2014') + '</td>';
    html += '<td class="num">' + reconVar(grandTotal, grandPrior) + '</td>';
    html += '</tr>';

    // Percentage of current year total row
    if (grandTotal > 0) {
      html += '<tr style="font-size:11px;color:#666;font-style:italic">';
      html += '<td>Percentage of ' + yearCurrent + ' Total</td>';
      html += '<td class="num">' + Math.round(grandNew / grandTotal * 100) + '%</td>';
      html += '<td class="num">' + Math.round(grandRep / grandTotal * 100) + '%</td>';
      html += '<td class="num">' + Math.round(grandRet / grandTotal * 100) + '%</td>';
      html += '<td class="num">100%</td>';
      html += '<td class="num">' + (grandPrior > 0 ? Math.round(grandPrior / grandTotal * 100) + '%' : '') + '</td>';
      html += '<td class="num">' + reconVar(grandTotal, grandPrior) + '</td>';
      html += '</tr>';
    }

    // Percentage of prior year total row
    if (grandPrior > 0) {
      html += '<tr style="font-size:11px;color:#666;font-style:italic">';
      html += '<td>Percentage of ' + yearPrior + ' Total</td>';
      html += '<td class="num">' + Math.round(grandNew / grandPrior * 100) + '%</td>';
      html += '<td class="num">' + Math.round(grandRep / grandPrior * 100) + '%</td>';
      html += '<td class="num">' + Math.round(grandRet / grandPrior * 100) + '%</td>';
      html += '<td class="num">' + Math.round(grandTotal / grandPrior * 100) + '%</td>';
      html += '<td class="num">100%</td>';
      html += '<td class="num">' + reconVar(grandTotal, grandPrior) + '</td>';
      html += '</tr>';
    }

    html += '</tbody></table>';
    return html;
  }

  function reconSummaryCard(label, value, compare, color) {
    var bg = color ? color + '15' : '#f5f5f5';
    var fg = color || '#333';
    var s = '<div style="background:' + bg + ';border-radius:6px;padding:10px 16px;min-width:100px">';
    s += '<div style="font-size:11px;color:#888;margin-bottom:2px">' + label + '</div>';
    s += '<div style="font-size:22px;font-weight:700;color:' + fg + '">' + fmt(value) + '</div>';
    if (compare != null && compare > 0) {
      var pct = ((value - compare) / Math.abs(compare) * 100).toFixed(1);
      var cls = Number(pct) >= 0 ? 'var-up' : 'var-down';
      var sign = Number(pct) >= 0 ? '+' : '';
      s += '<div style="font-size:11px;margin-top:2px"><span class="' + cls + '">' + sign + pct + '% vs prior</span></div>';
    }
    s += '</div>';
    return s;
  }

  // Variance formatter for reconciliation: shows percentage like "110%"
  function reconVar(current, prior) {
    if (prior === 0 && current === 0) return '0%';
    if (prior === 0) return '';
    var pct = Math.round(current / prior * 100);
    return pct + '%';
  }

  // Category mapping: contacts category → reconciliation category
  var RECON_CAT_MAP = {
    'Buy-Side': 'Buy-Side',
    'Retail Investor': 'Buy-Side',
    'Member': 'Member Delegates',
    'Sell-Side': 'Sell-Side',
    'Media': 'Media',
    'Media Sales': 'Media',
    'Banking & Corporate Finance Services': 'Banking / Corporate Finance',
    'Mining Services & Investment Consulting': 'Consulting',
    'Government': 'Government',
    'Government & Regulatory': 'Government',
    'Government/Regulatory': 'Government',
    'Association': 'Association',
    'Industry Association': 'Association',
    'Mining Association': 'Association',
    'Speaker': 'Speakers / VIP',
    'Speakers': 'Speakers / VIP',
    'VIP': 'Speakers / VIP',
    'Staff': 'Staff / Organizer',
    'Organizer': 'Staff / Organizer',
    'DGG Staff': 'Staff / Organizer',
    'Legal': 'Banking / Corporate Finance',
    'Legal Services': 'Banking / Corporate Finance'
  };

  // Subcategory name mapping: contacts subcategory → short display name
  var RECON_SUB_MAP = {
    'Institutional Investor: Family Office': 'Family Office',
    'Institutional Investor: Hedge Fund': 'Hedge Fund',
    'Institutional Investor: Other': 'Other',
    'Institutional Investor: Open End Fund': 'Open End Fund',
    'Institutional Investor: Private Equity': 'Private Equity',
    'Institutional Investor: Closed End Fund': 'Closed End Fund',
    'Institutional Investor: Bullion Fund': 'Bullion Fund',
    'Institutional Investor: Pension Fund': 'Pension Fund',
    'Institutional Investor: Fixed Income': 'Fixed Income',
    'Institutional Investor: Exchange Traded Fund': 'Exchange Traded Fund',
    'Institutional Investor: Royalties & Streaming': 'Royalties & Streaming',
    'Discretionary Investment Manager': 'Discretionary Invst Manager',
    'Securities Analyst: Buy Side': 'Securities Analyst',
    'Securities Analyst: Sell Side': 'Analyst',
    'Equity Sales Professional': 'Equity Sales Pro',
    'Sophisticated Retail Investor': 'Sophisticated Retail',
    'Mining Professional: Member': null,
    'Banking, Corporate Finance, & Legal Services': null,
    'Mining Services and Consulting': null,
    'Government Official': 'Government Official',
    'Mining Business Association Professional': 'Association Professional'
  };

  var RECON_CAT_ORDER = ['Academic / Researcher', 'Buy-Side', 'Sell-Side', 'Banking / Corporate Finance', 'Market Professional', 'Media', 'Consulting', 'Government', 'Association', 'Speakers / VIP', 'Staff / Organizer', 'Member Delegates', 'Other'];

  // Walk-in detection: invitation_status = Attended AND registration_date is on event start day (April 13)
  function isWalkIn(contact, eventStartDate) {
    var regDate = contact.registration_date || contact['Registration Date'] || '';
    if (!regDate) return false;
    // Parse and compare date portion only (YYYY-MM-DD)
    var rd = new Date(regDate);
    if (isNaN(rd.getTime())) return false;
    // Extract YYYY-MM-DD from both
    var regDay = rd.toISOString().slice(0, 10);
    return regDay === eventStartDate;
  }

  function getAttendanceStatus(contact, eventStartDate) {
    // Determine attendance from invitation_status field
    // Attended + registration_date on event day = walk_up (walk-in)
    // Attended (otherwise) = checked_in
    // Invited = no_show
    // Walk-ins are EXCLUDED from checked_in so totals balance
    var invStatus = (contact.invitation_status || '').trim();
    if (invStatus === 'Attended') {
      if (isWalkIn(contact, eventStartDate)) return 'walk_up';
      return 'checked_in';
    }
    if (invStatus === 'Accepted') return 'no_show';
    return null;
  }

  function aggregateContacts(contacts) {
    // Only count Attended contacts (attended in person) for reg recon
    var accepted = contacts.filter(function(c) {
      return (c.invitation_status || '').trim() === 'Attended';
    });
    var agg = {};
    var catOrder = RECON_CAT_ORDER.slice();
    var emptyBucket = function() { return { New: 0, Repeating: 0, Returning: 0, checked_in: 0, walk_up: 0, no_show: 0 }; };
    catOrder.forEach(function(c) { agg[c] = { __cat__: emptyBucket() }; });

    // Determine event start date for walk-up detection
    var eventStart = currentEvent && currentEvent.start_date ? currentEvent.start_date : '2026-04-13';

    accepted.forEach(function(c) {
      var reconCat = RECON_CAT_MAP[c.category];
      if (!reconCat) {
        var rawCat = (c.category || 'Other').trim();
        var matched = false;
        for (var i = 0; i < catOrder.length; i++) {
          if (catOrder[i].toLowerCase() === rawCat.toLowerCase()) {
            reconCat = catOrder[i];
            matched = true;
            break;
          }
        }
        if (!matched) {
          reconCat = rawCat;
          var otherIdx = catOrder.indexOf('Other');
          if (otherIdx >= 0) {
            catOrder.splice(otherIdx, 0, reconCat);
          } else {
            catOrder.push(reconCat);
          }
        }
      }
      var rawSub = c.subcategory || c.category || 'Unknown';
      var subcat = RECON_SUB_MAP.hasOwnProperty(rawSub) ? RECON_SUB_MAP[rawSub] : rawSub;
      var hist = c.history || 'New';
      if (hist !== 'New' && hist !== 'Repeating' && hist !== 'Returning') hist = 'New';

      // Attendance status
      var attStatus = getAttendanceStatus(c, eventStart);

      if (!agg[reconCat]) agg[reconCat] = { __cat__: emptyBucket() };
      agg[reconCat]['__cat__'][hist]++;
      if (attStatus) agg[reconCat]['__cat__'][attStatus]++;

      if (subcat !== null) {
        if (!agg[reconCat][subcat]) agg[reconCat][subcat] = emptyBucket();
        agg[reconCat][subcat][hist]++;
        if (attStatus) agg[reconCat][subcat][attStatus]++;
      }
    });

    // Compute attendance totals
    // checked_in and walk_up come from the Attended pool (already in agg)
    // no_show = Accepted contacts (not in the Attended pool, counted separately)
    var attTotals = { checked_in: 0, walk_up: 0, no_show: 0 };
    catOrder.forEach(function(cat) {
      if (agg[cat] && agg[cat]['__cat__']) {
        attTotals.checked_in += agg[cat]['__cat__'].checked_in || 0;
        attTotals.walk_up += agg[cat]['__cat__'].walk_up || 0;
      }
    });
    attTotals.no_show = contacts.filter(function(c) {
      return (c.invitation_status || '').trim() === 'Accepted';
    }).length;

    // ── Attendee Classification & Country (attended-only) ──
    // Map recon categories → attendee_class buckets
    var CLASS_MAP = {
      'Buy-Side': 'Buy-Side',
      'Sell-Side': 'Sell-Side',
      'Speakers / VIP': 'VIPs',
      'Member Delegates': 'Member Delegates',
      'Media': 'Media'
      // Everything else → 'Sponsors, Bankers, Other'
    };
    var TOP_COUNTRIES = ['Switzerland', 'Canada', 'United States', 'United Kingdom', 'Germany'];

    var classCounts = {};
    var countryCounts = {};
    var attended = contacts.filter(function(c) { return (c.invitation_status || '').trim() === 'Attended'; });

    attended.forEach(function(c) {
      // Classification
      var reconCat = RECON_CAT_MAP[c.category] || (c.category || 'Other').trim();
      var classBucket = CLASS_MAP[reconCat] || 'Sponsors, Bankers, Other';
      classCounts[classBucket] = (classCounts[classBucket] || 0) + 1;

      // Country
      var country = (c.country || c.Country || c['Country/Region'] || '').trim();
      if (country) {
        if (TOP_COUNTRIES.indexOf(country) >= 0) {
          countryCounts[country] = (countryCounts[country] || 0) + 1;
        } else {
          countryCounts['All other'] = (countryCounts['All other'] || 0) + 1;
        }
      }
    });

    return {
      agg: agg, accepted_count: accepted.length, total_contacts: contacts.length,
      cat_order: catOrder, attendance: attTotals,
      attendee_class: classCounts, attendee_country: countryCounts
    };
  }

  function refreshRegRecon(fileInput) {
    var file = fileInput.files[0];
    if (!file) return;
    var statusEl = document.getElementById('reg-recon-status');
    if (statusEl) statusEl.textContent = 'Processing...';

    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var contacts = JSON.parse(e.target.result);
      } catch (err) {
        if (statusEl) statusEl.textContent = 'Error: Invalid JSON file';
        return;
      }

      // Process client-side — only send small aggregated data to API
      var result = aggregateContacts(contacts);

      fetch(API, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
        body: JSON.stringify({
          action: 'reg-recon-save',
          event_code: currentEvent.event_code,
          aggregation: result.agg,
          cat_order: result.cat_order || RECON_CAT_ORDER,
          attendance: result.attendance || {},
          attendee_class: result.attendee_class || {},
          attendee_country: result.attendee_country || {}
        })
      })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (!res.ok) {
          if (statusEl) statusEl.textContent = 'Error: ' + (res.error || 'Unknown');
          return;
        }
        var att = result.attendance || {};
        var attMsg = (att.checked_in || att.walk_up) ? ' | Attended: ' + ((att.checked_in||0) + (att.walk_up||0)) + ' (CI: ' + (att.checked_in||0) + ', WU: ' + (att.walk_up||0) + ', NS: ' + (att.no_show||0) + ')' : '';
        if (statusEl) statusEl.textContent = 'Refreshed — ' + result.accepted_count + ' accepted of ' + result.total_contacts + ' contacts' + attMsg;
        // Update stored data and re-render section
        reportData.reg_recon = res.reg_recon;
        // Update local attendance data if API returned updated values
        if (res.attendance_updated && reportData.attendance) {
          var att2 = result.attendance || {};
          reportData.attendance.forEach(function(r) {
            if (r.section === 'registration' && r.metric === 'checked_in') r.value_current = att2.checked_in || 0;
            if (r.section === 'registration' && r.metric === 'walk_up') r.value_current = att2.walk_up || 0;
            if (r.section === 'registration' && r.metric === 'no_show') r.value_current = -(Math.abs(att2.no_show || 0));
          });
          // Update attendee_class rows from attended-only data
          var clsData = result.attendee_class || {};
          reportData.attendance.forEach(function(r) {
            if (r.section === 'attendee_class') r.value_current = clsData[r.metric] || 0;
          });
          // Update attendee_country rows from attended-only data
          var ctyData = result.attendee_country || {};
          reportData.attendance.forEach(function(r) {
            if (r.section === 'attendee_country') r.value_current = ctyData[r.metric] || 0;
          });
          // Re-render Section 11 (Registration & Attendance) with updated data
          if (regAttSectionId) {
            var attSection = document.getElementById(regAttSectionId);
            if (attSection) {
              var attBody = attSection.querySelector('.psr-section-body');
              if (attBody) {
                var regData = reportData.attendance.filter(function(r) {
                  return r.section === 'registration' || r.section === 'attendee_class' || r.section === 'attendee_country';
                });
                attBody.innerHTML = renderRegistration(regData, reportData.event);
              }
            }
          }
        }
        var section = document.getElementById(regReconSectionId);
        if (!section) return;
        var body = section.querySelector('.psr-section-body');
        if (!body) return;
        body.innerHTML = renderRegRecon(reportData.reg_recon, reportData.event);
      })
      .catch(function(err) {
        if (statusEl) statusEl.textContent = 'Error: ' + err.message;
      });
    };
    reader.readAsText(file);
  }

  // ── 10. Hotel Pickup ─────────────────────────────────
  var hotelSectionId = null;
  var meetingsSectionId = null;
  var engagementSectionId = null;
  var webcastSectionId = null;

  function renderHotel(hotel, evt) {
    var ed = isAdmin();
    var html = '';

    // Group rows by hotel_name, preserving order
    var hotelNames = [];
    var hotelGroups = {};
    hotel.forEach(function(h) {
      if (!hotelGroups[h.hotel_name]) {
        hotelGroups[h.hotel_name] = [];
        hotelNames.push(h.hotel_name);
      }
      hotelGroups[h.hotel_name].push(h);
    });

    var totalContracted = 0, totalActual = 0;

    html += '<table class="psr-table" id="hotel-table"><thead><tr>';
    html += '<th>Hotel</th><th>Night</th><th class="num">Contracted</th><th class="num">Actual</th><th class="num">Utilization</th>';
    if (ed) html += '<th></th>';
    html += '</tr></thead><tbody>';

    hotelNames.forEach(function(name) {
      var rows = hotelGroups[name];
      rows.forEach(function(h, idx) {
        var contracted = Number(h.contracted) || 0;
        var actual = Number(h.actual) || 0;
        totalContracted += contracted;
        totalActual += actual;
        var util = contracted ? ((actual / contracted) * 100).toFixed(0) + '%' : '—';

        html += '<tr data-hotel-id="' + h.id + '">';

        // Hotel name: rowspan for first row of each hotel block
        if (idx === 0) {
          if (ed) {
            html += '<td rowspan="' + rows.length + '" style="vertical-align:top;font-weight:600">' +
              '<input type="text" value="' + esc(name) + '" ' +
              'style="font-size:12px;font-weight:600;border:1px solid transparent;border-radius:4px;padding:2px 6px;width:100%;font-family:inherit;background:transparent" ' +
              'onfocus="this.style.borderColor=\'#D4A017\';this.style.background=\'#fff\'" ' +
              'onblur="this.style.borderColor=\'transparent\';this.style.background=\'transparent\';PSR.saveHotelName(this,\'' + esc(name).replace(/'/g, "\\'") + '\')" ' +
              'onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}">' +
            '</td>';
          } else {
            html += '<td rowspan="' + rows.length + '" style="vertical-align:top;font-weight:600">' + esc(name) + '</td>';
          }
        }

        // Night date
        if (ed) {
          html += '<td><input type="date" value="' + (h.night_date || '') + '" ' +
            'style="font-size:12px;border:1px solid transparent;border-radius:4px;padding:2px 4px;font-family:inherit;background:transparent" ' +
            'onfocus="this.style.borderColor=\'#D4A017\';this.style.background=\'#fff\'" ' +
            'onblur="this.style.borderColor=\'transparent\';this.style.background=\'transparent\';PSR.saveHotelCell(' + h.id + ',\'night_date\',this.value)">' +
          '</td>';
        } else {
          html += '<td>' + fmtDateShort(h.night_date) + '</td>';
        }

        // Contracted
        if (ed) {
          html += '<td class="num"><input type="number" value="' + contracted + '" min="0" ' +
            'style="font-size:12px;text-align:right;border:1px solid transparent;border-radius:4px;padding:2px 6px;width:60px;font-family:inherit;background:transparent" ' +
            'onfocus="this.style.borderColor=\'#D4A017\';this.style.background=\'#fff\'" ' +
            'onblur="this.style.borderColor=\'transparent\';this.style.background=\'transparent\';PSR.saveHotelCell(' + h.id + ',\'contracted\',this.value)"  ' +
            'onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}">' +
          '</td>';
        } else {
          html += '<td class="num">' + fmt(contracted) + '</td>';
        }

        // Actual
        if (ed) {
          html += '<td class="num"><input type="number" value="' + actual + '" min="0" ' +
            'style="font-size:12px;text-align:right;border:1px solid transparent;border-radius:4px;padding:2px 6px;width:60px;font-family:inherit;background:transparent" ' +
            'onfocus="this.style.borderColor=\'#D4A017\';this.style.background=\'#fff\'" ' +
            'onblur="this.style.borderColor=\'transparent\';this.style.background=\'transparent\';PSR.saveHotelCell(' + h.id + ',\'actual\',this.value)" ' +
            'onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}">' +
          '</td>';
        } else {
          html += '<td class="num">' + fmt(actual) + '</td>';
        }

        // Utilization (always computed)
        html += '<td class="num">' + util + '</td>';

        // Delete row (admin)
        if (ed) {
          html += '<td><span class="market-del-year" onclick="PSR.deleteHotelRow(' + h.id + ')" title="Delete night" style="cursor:pointer;color:#C0392B;font-size:11px">del</span></td>';
        }

        html += '</tr>';
      });
    });

    var totalUtil = totalContracted ? ((totalActual / totalContracted) * 100).toFixed(0) + '%' : '—';
    html += '</tbody><tfoot><tr>';
    html += '<td colspan="2" style="font-weight:700">Total</td>';
    html += '<td class="num" style="font-weight:700">' + fmt(totalContracted) + '</td>';
    html += '<td class="num" style="font-weight:700">' + fmt(totalActual) + '</td>';
    html += '<td class="num" style="font-weight:700">' + totalUtil + '</td>';
    if (ed) html += '<td></td>';
    html += '</tr></tfoot></table>';

    // Admin controls: add night / add hotel
    if (ed) {
      html += '<div style="display:flex;gap:12px;margin-top:12px;flex-wrap:wrap">';
      // Add night to existing hotel
      html += '<div style="display:flex;gap:6px;align-items:center">';
      html += '<select id="hotel-add-select" style="font-size:12px;padding:4px 8px;border:1px solid #E0E0E0;border-radius:4px;font-family:inherit">';
      hotelNames.forEach(function(n) {
        html += '<option value="' + esc(n) + '">' + esc(n) + '</option>';
      });
      html += '</select>';
      html += '<button onclick="PSR.addHotelNight()" style="font-size:12px;padding:4px 12px;border:1px solid #E0E0E0;border-radius:4px;background:#fff;cursor:pointer;font-family:inherit">+ Add Night</button>';
      html += '</div>';
      // Add new hotel
      html += '<div style="display:flex;gap:6px;align-items:center">';
      html += '<input type="text" id="hotel-new-name" placeholder="New hotel name" style="font-size:12px;padding:4px 8px;border:1px solid #E0E0E0;border-radius:4px;font-family:inherit;width:160px">';
      html += '<button onclick="PSR.addNewHotel()" style="font-size:12px;padding:4px 12px;border:1px solid #E0E0E0;border-radius:4px;background:#fff;cursor:pointer;font-family:inherit">+ Add Hotel</button>';
      html += '</div>';
      html += '</div>';
    }

    // Hotel chart
    html += '<div class="chart-row" style="margin-top:16px">';
    html += '<div class="chart-box chart-full"><h4>Nightly Room Pickup</h4><canvas id="chart-hotel"></canvas></div>';
    html += '</div>';

    return html;
  }

  // ── 12. Engagement ───────────────────────────────────
  function renderEngagement(items, evt) {
    var ed = isAdmin();
    var html = '<table class="psr-table" id="engagement-table"><thead><tr>';
    if (ed) html += '<th style="width:20px"></th>';
    html += '<th>Metric</th><th class="num">' + evt.year + '</th><th class="num">' + (evt.year - 1) + '</th><th class="num">Var</th>';
    if (ed) html += '<th></th>';
    html += '</tr></thead><tbody id="engagement-tbody">';

    items.forEach(function(r) {
      html += '<tr data-row-id="' + r.id + '">';
      if (ed) {
        html += '<td class="eng-drag-handle" title="Drag to reorder" style="cursor:grab;color:#B0B0B0;user-select:none;text-align:center;font-size:14px;line-height:1">&#x2630;</td>';
        html += '<td><input type="text" value="' + esc(r.metric) + '" '
          + 'style="font-size:12px;border:1px solid transparent;border-radius:4px;padding:2px 6px;width:100%;font-family:inherit;background:transparent" '
          + 'onfocus="this.style.borderColor=\'#D4A017\';this.style.background=\'#fff\'" '
          + 'onblur="this.style.borderColor=\'transparent\';this.style.background=\'transparent\';PSR.saveEngagementCell(' + r.id + ',\'metric\',this.value)" '
          + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}"></td>';
        html += '<td class="num"><input type="text" value="' + fmtEngNum(r.value_current) + '" '
          + 'style="font-size:12px;text-align:right;border:1px solid transparent;border-radius:4px;padding:2px 6px;width:80px;font-family:inherit;background:transparent" '
          + 'onfocus="this.style.borderColor=\'#D4A017\';this.style.background=\'#fff\';this.value=parseEngNum(this.value)" '
          + 'onblur="this.style.borderColor=\'transparent\';this.style.background=\'transparent\';var v=parseEngNum(this.value);this.value=fmtEngNum(v);PSR.saveEngagementCell(' + r.id + ',\'value_current\',v)" '
          + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}"></td>';
        html += '<td class="num"><input type="text" value="' + fmtEngNum(r.value_prior) + '" '
          + 'style="font-size:12px;text-align:right;border:1px solid transparent;border-radius:4px;padding:2px 6px;width:80px;font-family:inherit;background:transparent" '
          + 'onfocus="this.style.borderColor=\'#D4A017\';this.style.background=\'#fff\';this.value=parseEngNum(this.value)" '
          + 'onblur="this.style.borderColor=\'transparent\';this.style.background=\'transparent\';var v=parseEngNum(this.value);this.value=fmtEngNum(v);PSR.saveEngagementCell(' + r.id + ',\'value_prior\',v)" '
          + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}"></td>';
      } else {
        html += '<td>' + esc(r.metric) + '</td>';
        html += '<td class="num">' + fmt(r.value_current) + '</td>';
        html += '<td class="num">' + fmt(r.value_prior) + '</td>';
      }
      html += '<td class="pct">' + fmtPct(r.value_current, r.value_prior) + '</td>';
      if (ed) {
        html += '<td><span class="market-del-year" onclick="PSR.deleteEngagementRow(' + r.id + ')" title="Delete row" style="cursor:pointer;color:#C0392B;font-size:11px">del</span></td>';
      }
      html += '</tr>';
    });

    html += '</tbody></table>';

    if (ed) {
      html += '<div style="display:flex;gap:6px;align-items:center;margin-top:12px">';
      html += '<input type="text" id="engagement-new-metric" placeholder="Metric name" '
        + 'style="font-size:12px;padding:4px 8px;border:1px solid #E0E0E0;border-radius:4px;font-family:inherit;width:200px">';
      html += '<input type="number" id="engagement-new-current" placeholder="' + evt.year + '" '
        + 'style="font-size:12px;padding:4px 8px;border:1px solid #E0E0E0;border-radius:4px;font-family:inherit;width:80px;text-align:right">';
      html += '<input type="number" id="engagement-new-prior" placeholder="' + (evt.year - 1) + '" '
        + 'style="font-size:12px;padding:4px 8px;border:1px solid #E0E0E0;border-radius:4px;font-family:inherit;width:80px;text-align:right">';
      html += '<button onclick="PSR.addEngagementRow()" style="font-size:12px;padding:4px 12px;border:1px solid #E0E0E0;border-radius:4px;background:#fff;cursor:pointer;font-family:inherit">+ Add Row</button>';
      html += '</div>';
      setTimeout(initEngagementDragDrop, 0);
    }

    return html;
  }

  // ── Engagement drag-and-drop reordering ──────────────
  function initEngagementDragDrop() {
    var tbody = document.getElementById('engagement-tbody');
    if (!tbody) return;
    var dragRow = null;
    var rows = tbody.querySelectorAll('tr[data-row-id]');

    // Handle-triggered drag: row is only draggable while user mouses down on the grip.
    // This avoids conflicts with the <input> cells that make up the rest of the row.
    var handles = tbody.querySelectorAll('.eng-drag-handle');
    handles.forEach(function(handle) {
      handle.addEventListener('mousedown', function() {
        var tr = handle.parentNode;
        if (tr) tr.setAttribute('draggable', 'true');
      });
    });

    function clearMarkers() {
      rows.forEach(function(r) { r.style.borderTop = ''; r.style.borderBottom = ''; });
    }

    rows.forEach(function(tr) {
      tr.addEventListener('dragstart', function(e) {
        // Only start if the drag was initiated from the handle (row has draggable set)
        if (tr.getAttribute('draggable') !== 'true') { e.preventDefault(); return; }
        dragRow = tr;
        tr.style.opacity = '0.4';
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', tr.getAttribute('data-row-id')); } catch (_) {}
      });
      tr.addEventListener('dragend', function() {
        tr.style.opacity = '';
        tr.removeAttribute('draggable');
        clearMarkers();
        dragRow = null;
      });
      tr.addEventListener('dragover', function(e) {
        if (!dragRow || dragRow === tr) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        var rect = tr.getBoundingClientRect();
        var before = (e.clientY - rect.top) < rect.height / 2;
        clearMarkers();
        tr.style[before ? 'borderTop' : 'borderBottom'] = '2px solid #D4A017';
      });
      tr.addEventListener('drop', function(e) {
        if (!dragRow || dragRow === tr) return;
        e.preventDefault();
        var rect = tr.getBoundingClientRect();
        var before = (e.clientY - rect.top) < rect.height / 2;
        tbody.insertBefore(dragRow, before ? tr : tr.nextSibling);
        clearMarkers();
        persistEngagementOrder();
      });
    });
  }

  function persistEngagementOrder() {
    var tbody = document.getElementById('engagement-tbody');
    if (!tbody) return;
    var order = [];
    tbody.querySelectorAll('tr[data-row-id]').forEach(function(tr) {
      order.push(Number(tr.getAttribute('data-row-id')));
    });
    postAPI({ action: 'engagement-reorder', order: order }).then(function(res) {
      if (!res.ok) {
        alert('Reorder failed: ' + (res.error || 'Unknown error'));
        refreshEngagementSection();
      } else {
        // Update local data to match new order
        if (reportData && reportData.engagement) {
          var byId = {};
          reportData.engagement.forEach(function(r) { byId[r.id] = r; });
          reportData.engagement = order.map(function(id) { return byId[id]; }).filter(Boolean);
        }
      }
    });
  }

  // ── 13. Meetings ─────────────────────────────────────
  function renderMeetings(meetings, topMeetings, evt) {
    var html = '';
    var ed = isAdmin();
    var inpStyle = 'font-size:12px;border:1px solid transparent;border-radius:4px;padding:2px 6px;font-family:inherit;background:transparent';
    var numInpStyle = inpStyle + ';text-align:right;width:80px';
    var focusJS = "this.style.borderColor='#D4A017';this.style.background='#fff'";
    var blurBase = "this.style.borderColor='transparent';this.style.background='transparent'";

    var sections = [
      { key: 'status', title: 'Meeting Status' },
      { key: 'mean', title: 'Mean Meetings' },
      { key: 'fundamentals', title: 'Meeting Fundamentals' }
    ];

    // Build lookup by metric name for computed fields
    var metricLookup = {};
    meetings.forEach(function(r) {
      metricLookup[r.metric.toLowerCase()] = r;
    });

    // Computed metric keys (case-insensitive match)
    // Get total_event_members from attendance data for member meetings calc
    // "Average member meetings" = "All completed meetings" / "Total Members"
    var totalMembers = { value_current: 0, value_prior: 0 };
    if (reportData && reportData.attendance) {
      reportData.attendance.forEach(function(r) {
        if (r.metric === 'total_event_members') {
          totalMembers.value_current = Number(r.value_current) || 0;
          totalMembers.value_prior = Number(r.value_prior) || 0;
        }
      });
    }

    var COMPUTED = {
      'all completed meetings': true,
      'total transactions': true,
      'max meeting capacity': true,
      'capacity utilization %': true,
      'member meetings': true,
      'average member meetings': true
    };

    function computeVal(metricName, field) {
      var key = metricName.toLowerCase();
      if (key === 'member meetings' || key === 'average member meetings') {
        var completed = computeVal('all completed meetings', field);
        var members = totalMembers[field] || 0;
        return members > 0 ? Math.round(completed / members * 10) / 10 : 0;
      }
      if (key === 'all completed meetings') {
        var formal = metricLookup['formal meetings'] ? Number(metricLookup['formal meetings'][field]) || 0 : 0;
        var informal = metricLookup['informal meetings (est.)'] ? Number(metricLookup['informal meetings (est.)'][field]) || 0 : 0;
        return formal + informal;
      }
      if (key === 'total transactions') {
        var completed = computeVal('all completed meetings', field);
        var declined = metricLookup['declined'] ? Number(metricLookup['declined'][field]) || 0 : 0;
        var cancelled = metricLookup['cancelled'] ? Number(metricLookup['cancelled'][field]) || 0 : 0;
        var unfulfilled = metricLookup['unfulfilled'] ? Number(metricLookup['unfulfilled'][field]) || 0 : 0;
        return completed + declined + cancelled + unfulfilled;
      }
      if (key === 'max meeting capacity') {
        var slots = metricLookup['total meeting slots'] ? Number(metricLookup['total meeting slots'][field]) || 0 : 0;
        var locations = metricLookup['total meeting locations'] ? Number(metricLookup['total meeting locations'][field]) || 0 : 0;
        return slots * locations;
      }
      if (key === 'capacity utilization %') {
        var completed = computeVal('all completed meetings', field);
        var capacity = computeVal('max meeting capacity', field);
        return capacity > 0 ? Math.round(completed / capacity * 1000) / 10 : 0;
      }
      return null;
    }

    sections.forEach(function(sec) {
      var items = meetings.filter(function(r) { return r.section === sec.key; });
      if (!items.length && !ed) return;

      html += '<h4 style="font-size:13px;font-weight:700;margin:16px 0 8px;color:var(--header-mid)">' + sec.title + '</h4>';
      html += '<table class="psr-table"><thead><tr>';
      html += '<th>Metric</th><th class="num">' + evt.year + '</th><th class="num">' + (evt.year - 1) + '</th>';
      html += '<th class="num">&Delta; ' + (evt.year - 1) + '</th><th class="num">Var</th>';
      if (ed) html += '<th></th>';
      html += '</tr></thead><tbody>';

      items.forEach(function(r) {
        var decimals = sec.key === 'mean' ? 1 : 0;
        var step = sec.key === 'mean' ? '0.1' : '1';
        var isComputed = COMPUTED[r.metric.toLowerCase()];
        var valCurrent, valPrior;

        if (isComputed) {
          valCurrent = computeVal(r.metric, 'value_current');
          valPrior = computeVal(r.metric, 'value_prior');
        } else {
          valCurrent = Number(r.value_current) || 0;
          valPrior = Number(r.value_prior) || 0;
        }

        var isUtilization = r.metric.toLowerCase() === 'capacity utilization %';
        var fmtCur = isUtilization ? valCurrent.toFixed(1) + '%' : fmt(valCurrent, decimals);
        var fmtPri = isUtilization ? valPrior.toFixed(1) + '%' : fmt(valPrior, decimals);

        html += '<tr data-meeting-id="' + r.id + '"' + (isComputed ? ' style="font-weight:600;background:#F8F9FB"' : '') + '>';
        if (ed) {
          // Metric name always editable
          html += '<td><input type="text" value="' + esc(r.metric) + '" style="' + inpStyle + ';width:100%' + (isComputed ? ';font-weight:600' : '') + '" '
            + 'onfocus="' + focusJS + '" '
            + 'onblur="' + blurBase + ';PSR.saveMeetingCell(' + r.id + ',\'metric\',this.value)" '
            + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}"></td>';
          if (isComputed) {
            html += '<td class="num" style="font-weight:600">' + fmtCur + '</td>';
            html += '<td class="num" style="font-weight:600">' + fmtPri + '</td>';
          } else {
            html += '<td class="num"><input type="text" value="' + fmtEngNum(valCurrent) + '" style="' + numInpStyle + '" '
              + 'onfocus="' + focusJS + '" '
              + 'onblur="' + blurBase + ';var v=parseEngNum(this.value);this.value=fmtEngNum(v);PSR.saveMeetingCell(' + r.id + ',\'value_current\',v)" '
              + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}"></td>';
            html += '<td class="num"><input type="text" value="' + fmtEngNum(valPrior) + '" style="' + numInpStyle + '" '
              + 'onfocus="' + focusJS + '" '
              + 'onblur="' + blurBase + ';var v=parseEngNum(this.value);this.value=fmtEngNum(v);PSR.saveMeetingCell(' + r.id + ',\'value_prior\',v)" '
              + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}"></td>';
          }
          // Delta & Var — suppress when current is 0 (no data yet)
          if (valCurrent !== 0 && valPrior !== 0) {
            var diff = valCurrent - valPrior;
            var dCls = diff >= 0 ? 'var-up' : 'var-down';
            var dSign = diff >= 0 ? '+' : '-';
            var dAbs = Math.abs(diff);
            html += '<td class="num"><span class="' + dCls + '">' + (diff === 0 ? (isUtilization ? '0.0%' : fmt(0, decimals)) : dSign + (isUtilization ? dAbs.toFixed(1) + '%' : fmt(dAbs, decimals))) + '</span></td>';
            var pctChg = ((valCurrent - valPrior) / Math.abs(valPrior) * 100).toFixed(1);
            var pCls = Number(pctChg) >= 0 ? 'var-up' : 'var-down';
            var pSign = Number(pctChg) >= 0 ? '+' : '';
            html += '<td class="pct"><span class="' + pCls + '">' + pSign + pctChg + '%</span></td>';
          } else {
            html += '<td class="num"></td><td class="pct"></td>';
          }
          html += '<td>' + (isComputed ? '' : '<button onclick="PSR.deleteMeetingRow(' + r.id + ')" style="background:none;border:none;color:#C0392B;cursor:pointer;font-size:14px" title="Delete row">&times;</button>') + '</td>';
        } else {
          html += '<td>' + esc(r.metric) + '</td>';
          html += '<td class="num">' + fmtCur + '</td>';
          html += '<td class="num">' + fmtPri + '</td>';
          // Delta & Var — suppress when current is 0 (no data yet)
          if (valCurrent !== 0 && valPrior !== 0) {
            var diff = valCurrent - valPrior;
            var dCls = diff >= 0 ? 'var-up' : 'var-down';
            var dSign = diff >= 0 ? '+' : '-';
            var dAbs = Math.abs(diff);
            html += '<td class="num"><span class="' + dCls + '">' + (diff === 0 ? (isUtilization ? '0.0%' : fmt(0, decimals)) : dSign + (isUtilization ? dAbs.toFixed(1) + '%' : fmt(dAbs, decimals))) + '</span></td>';
            var pctChg = ((valCurrent - valPrior) / Math.abs(valPrior) * 100).toFixed(1);
            var pCls = Number(pctChg) >= 0 ? 'var-up' : 'var-down';
            var pSign = Number(pctChg) >= 0 ? '+' : '';
            html += '<td class="pct"><span class="' + pCls + '">' + pSign + pctChg + '%</span></td>';
          } else {
            html += '<td class="num"></td><td class="pct"></td>';
          }
        }
        html += '</tr>';
      });

      html += '</tbody></table>';
      if (ed) {
        html += '<button onclick="PSR.addMeetingRow(\'' + sec.key + '\')" '
          + 'style="margin:6px 0 0;padding:4px 12px;font-size:11px;background:#f5f5f5;border:1px solid #ddd;border-radius:4px;cursor:pointer">'
          + '+ Add Row</button>';
      }
    });

    // Top meetings rankings
    if ((topMeetings && topMeetings.length) || ed) {
      var types = {};
      if (topMeetings) {
        topMeetings.forEach(function(t) {
          if (!types[t.ranking_type]) types[t.ranking_type] = [];
          types[t.ranking_type].push(t);
        });
      }
      // Ensure both ranking types exist for admin
      if (ed) {
        if (!types['member']) types['member'] = [];
        if (!types['participant']) types['participant'] = [];
      }

      html += '<div class="chart-row" style="margin-top:16px">';

      // ── Member table: Company Name, Requests Made, Confirmed Meetings, Success Ratio ──
      if (types['member']) {
        var memberItems = types['member'];
        html += '<div class="chart-box"><h4>Top Members by Meetings</h4>';
        html += '<table class="psr-table"><thead><tr>'
          + makeSortHeader('#', 0, 'num')
          + makeSortHeader('Company Name', 1, 'text')
          + makeSortHeader('Requests Made', 2, 'num')
          + makeSortHeader('Confirmed Meetings', 3, 'num')
          + makeSortHeader('Success Ratio', 4, 'num');
        if (ed) html += '<th></th>';
        html += '</tr></thead><tbody>';
        memberItems.forEach(function(t) {
          var requests = t.requests_made || 0;
          var confirmed = t.meeting_count || 0;
          var ratio = requests > 0 ? ((confirmed / requests) * 100).toFixed(0) + '%' : '—';
          html += '<tr data-top-meeting-id="' + t.id + '">';
          if (ed) {
            html += '<td class="num"><input type="number" value="' + t.rank + '" min="1" style="' + numInpStyle + ';width:40px" '
              + 'onfocus="' + focusJS + '" '
              + 'onblur="' + blurBase + ';PSR.saveTopMeetingCell(' + t.id + ',\'rank\',this.value)" '
              + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}"></td>';
            html += '<td><input type="text" value="' + esc(t.entity_name || t.company_name || '') + '" style="' + inpStyle + ';width:100%" '
              + 'onfocus="' + focusJS + '" '
              + 'onblur="' + blurBase + ';PSR.saveTopMeetingCell(' + t.id + ',\'entity_name\',this.value)" '
              + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}"></td>';
            html += '<td class="num"><input type="text" value="' + fmtEngNum(requests) + '" style="' + numInpStyle + ';width:60px" '
              + 'onfocus="' + focusJS + '" '
              + 'onblur="' + blurBase + ';var v=parseEngNum(this.value);this.value=fmtEngNum(v);PSR.saveTopMeetingCell(' + t.id + ',\'requests_made\',v)" '
              + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}"></td>';
            html += '<td class="num"><input type="text" value="' + fmtEngNum(confirmed) + '" style="' + numInpStyle + ';width:60px" '
              + 'onfocus="' + focusJS + '" '
              + 'onblur="' + blurBase + ';var v=parseEngNum(this.value);this.value=fmtEngNum(v);PSR.saveTopMeetingCell(' + t.id + ',\'meeting_count\',v)" '
              + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}"></td>';
            html += '<td class="num">' + ratio + '</td>';
            html += '<td><button onclick="PSR.deleteTopMeetingRow(' + t.id + ')" style="background:none;border:none;color:#C0392B;cursor:pointer;font-size:14px" title="Delete">&times;</button></td>';
          } else {
            html += '<td class="num">' + t.rank + '</td><td>' + esc(t.entity_name || t.company_name || '') + '</td><td class="num">' + fmt(requests) + '</td><td class="num">' + fmt(confirmed) + '</td><td class="num">' + ratio + '</td>';
          }
          html += '</tr>';
        });
        html += '</tbody></table>';
        if (ed) {
          html += '<button onclick="PSR.addTopMeetingRow(\'member\')" '
            + 'style="margin:6px 0 0;padding:4px 12px;font-size:11px;background:#f5f5f5;border:1px solid #ddd;border-radius:4px;cursor:pointer">'
            + '+ Add Entry</button>';
        }
        html += '</div>';
      }

      // ── Participant table: Name, Company, Confirmed Meetings ──
      if (types['participant']) {
        var participantItems = types['participant'];
        html += '<div class="chart-box"><h4>Top Participants by Meetings</h4>';
        html += '<table class="psr-table"><thead><tr>'
          + makeSortHeader('#', 0, 'num')
          + makeSortHeader('Name', 1, 'text')
          + makeSortHeader('Company', 2, 'text')
          + makeSortHeader('Confirmed Meetings', 3, 'num');
        if (ed) html += '<th></th>';
        html += '</tr></thead><tbody>';
        participantItems.forEach(function(t) {
          html += '<tr data-top-meeting-id="' + t.id + '">';
          if (ed) {
            html += '<td class="num"><input type="number" value="' + t.rank + '" min="1" style="' + numInpStyle + ';width:40px" '
              + 'onfocus="' + focusJS + '" '
              + 'onblur="' + blurBase + ';PSR.saveTopMeetingCell(' + t.id + ',\'rank\',this.value)" '
              + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}"></td>';
            html += '<td><input type="text" value="' + esc(t.entity_name) + '" style="' + inpStyle + ';width:100%" '
              + 'onfocus="' + focusJS + '" '
              + 'onblur="' + blurBase + ';PSR.saveTopMeetingCell(' + t.id + ',\'entity_name\',this.value)" '
              + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}"></td>';
            html += '<td><input type="text" value="' + esc(t.company_name || '') + '" style="' + inpStyle + ';width:100%" '
              + 'onfocus="' + focusJS + '" '
              + 'onblur="' + blurBase + ';PSR.saveTopMeetingCell(' + t.id + ',\'company_name\',this.value)" '
              + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}"></td>';
            html += '<td class="num"><input type="text" value="' + fmtEngNum(t.meeting_count || 0) + '" style="' + numInpStyle + ';width:60px" '
              + 'onfocus="' + focusJS + '" '
              + 'onblur="' + blurBase + ';var v=parseEngNum(this.value);this.value=fmtEngNum(v);PSR.saveTopMeetingCell(' + t.id + ',\'meeting_count\',v)" '
              + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}"></td>';
            html += '<td><button onclick="PSR.deleteTopMeetingRow(' + t.id + ')" style="background:none;border:none;color:#C0392B;cursor:pointer;font-size:14px" title="Delete">&times;</button></td>';
          } else {
            html += '<td class="num">' + t.rank + '</td><td>' + esc(t.entity_name) + '</td><td>' + esc(t.company_name || '') + '</td><td class="num">' + fmt(t.meeting_count) + '</td>';
          }
          html += '</tr>';
        });
        html += '</tbody></table>';
        if (ed) {
          html += '<button onclick="PSR.addTopMeetingRow(\'participant\')" '
            + 'style="margin:6px 0 0;padding:4px 12px;font-size:11px;background:#f5f5f5;border:1px solid #ddd;border-radius:4px;cursor:pointer">'
            + '+ Add Entry</button>';
        }
        html += '</div>';
      }

      html += '</div>';
    }

    return html;
  }

  // ── 1x1 Meetings Historical Data ────────────────────
  // [year, accept, decline, cancel, unfulfilled, total_transactions]
  var HIST_MEETINGS_BASE = [
    [2012, 1228, 556, 1268, 1279, 4331],
    [2013, 1179, 543, 890, 1055, 3667],
    [2014, 809, 1011, 843, 64, 2727],
    [2015, 794, 381, 813, 695, 2683],
    [2016, 846, 415, 619, 652, 2532],
    [2017, 1636, 910, 400, 1005, 3951],
    [2018, 1378, 684, 611, 1627, 4300],
    [2019, 1534, 849, 221, 1504, 4108],
    [2020, 1164, 978, 138, 461, 2741],
    [2021, 823, 1353, 155, 989, 3320],
    [2022, 191, 235, 251, 192, 869],
    [2023, 653, 559, 108, 682, 2002],
    [2024, 818, 851, 130, 469, 2268],
    [2025, 931, 540, 174, 692, 2337]
  ];
  var HIST_MTG_CATS = ['Accept', 'Decline', 'Cancel', 'Unfulfilled'];
  var HIST_MTG_COLORS = ['#27AE60', '#E74C3C', '#F39C12', '#95A5A6'];

  // Build meetings history including current year from live data
  function buildMeetingsHistory() {
    var rows = HIST_MEETINGS_BASE.slice();
    // Merge current year from reportData.meetings
    if (reportData && reportData.meetings && reportData.event) {
      var yr = reportData.event.year;
      var lookup = {};
      reportData.meetings.forEach(function(m) {
        lookup[m.metric.toLowerCase()] = m;
      });
      var formal = Number((lookup['formal meetings'] || {}).value_current) || 0;
      var informal = Number((lookup['informal meetings (est.)'] || {}).value_current) || 0;
      var accepted = formal + informal;
      var declined = Number((lookup['declined'] || {}).value_current) || 0;
      var cancelled = Number((lookup['cancelled'] || {}).value_current) || 0;
      var unfulfilled = Number((lookup['unfulfilled'] || {}).value_current) || 0;
      var total = accepted + declined + cancelled + unfulfilled;
      // Only add if there's any data
      if (total > 0) {
        // Remove if year already exists in base data
        rows = rows.filter(function(r) { return r[0] !== yr; });
        rows.push([yr, accepted, declined, cancelled, unfulfilled, total]);
      }
    }
    // Sort ascending for chart (chronological left to right)
    rows.sort(function(a, b) { return a[0] - b[0]; });
    return rows;
  }

  var histMtgChart = null;
  function initHistMtgChart() {
    var canvas = document.getElementById('chart-hist-meetings');
    if (!canvas) return;
    if (histMtgChart) { histMtgChart.destroy(); histMtgChart = null; }

    var histData = buildMeetingsHistory();
    var labels = histData.map(function(r) { return r[0]; });
    var datasets = HIST_MTG_CATS.map(function(cat, i) {
      var baseColor = HIST_MTG_COLORS[i];
      var stripe = makeStripePattern(baseColor, 0.45);
      return {
        label: cat,
        data: histData.map(function(r) { return r[i + 1]; }),
        backgroundColor: histData.map(function(r) {
          return VIRTUAL_YEARS[r[0]] ? stripe : baseColor;
        }),
        borderWidth: histData.map(function(r) {
          return VIRTUAL_YEARS[r[0]] ? 1 : 0;
        }),
        borderColor: histData.map(function(r) {
          return VIRTUAL_YEARS[r[0]] ? 'rgba(0,0,0,0.15)' : 'transparent';
        })
      };
    });

    histMtgChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { font: { family: 'Inter', size: 11 } } },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                return ctx.dataset.label + ': ' + ctx.parsed.y.toLocaleString();
              }
            }
          }
        },
        scales: {
          x: { stacked: true, ticks: { font: { family: 'Inter', size: 10 } } },
          y: {
            stacked: true,
            title: { display: true, text: 'Transactions', font: { family: 'Inter', size: 10 } },
            ticks: {
              font: { family: 'Inter', size: 10 },
              callback: function(val) { return val.toLocaleString(); }
            }
          }
        }
      }
    });
  }

  function renderMeetingsHistory(evt) {
    var html = '';
    var histData = buildMeetingsHistory();

    // Chart
    html += '<div style="height:360px;margin-bottom:4px"><canvas id="chart-hist-meetings"></canvas></div>';
    html += '<p style="font-size:11px;color:#888;margin:0 0 12px;font-style:italic">* Virtual-only event (striped bars)</p>';

    // Collapsible data table (year descending)
    var tableRows = histData.slice().sort(function(a, b) { return b[0] - a[0]; });

    html += '<div style="margin-top:12px">';
    html += '<div onclick="PSR.toggleMtgHistTable(this)" style="cursor:pointer;display:flex;align-items:center;gap:6px;padding:6px 0;color:#666;font-size:12px;font-weight:600;user-select:none">';
    html += '<span class="mtg-hist-arrow" style="display:inline-block;transition:transform 0.2s;transform:rotate(0deg);font-size:10px">&#9654;</span> Data Table';
    html += '</div>';
    html += '<div class="mtg-hist-table-wrap" style="display:none">';
    html += '<table class="psr-table"><thead><tr>';
    html += '<th>Year</th>';
    HIST_MTG_CATS.forEach(function(c) { html += '<th class="num">' + c + '</th>'; });
    html += '<th class="num" style="font-weight:700">Total Transactions</th>';
    html += '</tr></thead><tbody>';

    tableRows.forEach(function(r) {
      var isVirtual = VIRTUAL_YEARS[r[0]];
      var rowStyle = isVirtual ? ' style="background:#FFF8E1;font-style:italic"' : '';
      html += '<tr' + rowStyle + '>';
      html += '<td>' + r[0] + (isVirtual ? ' *' : '') + '</td>';
      for (var i = 1; i <= 4; i++) html += '<td class="num">' + fmt(r[i]) + '</td>';
      html += '<td class="num" style="font-weight:700">' + fmt(r[5]) + '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';
    html += '<p style="font-size:11px;color:#888;margin:6px 0 0;font-style:italic">* Virtual-only event</p>';
    html += '</div></div>';
    return html;
  }

  PSR.toggleMtgHistTable = function(el) {
    var wrap = el.nextElementSibling;
    var arrow = el.querySelector('.mtg-hist-arrow');
    if (wrap.style.display === 'none') {
      wrap.style.display = 'block';
      arrow.style.transform = 'rotate(90deg)';
    } else {
      wrap.style.display = 'none';
      arrow.style.transform = 'rotate(0deg)';
    }
  };

  // ── 14. Webcasts ─────────────────────────────────────
  // Format decimal minutes to human-readable duration string (e.g. 636.5 → "10h 36m 30s")
  function fmtDuration(totalMin) {
    if (totalMin == null || totalMin === '' || isNaN(Number(totalMin))) return '—';
    var m = Number(totalMin);
    if (m === 0) return '0m 00s';
    var h = Math.floor(m / 60);
    var mins = Math.floor(m % 60);
    var secs = Math.round((m * 60) % 60);
    if (secs === 60) { mins++; secs = 0; }
    if (mins === 60) { h++; mins = 0; }
    var mm = mins < 10 ? '0' + mins : '' + mins;
    var ss = secs < 10 ? '0' + secs : '' + secs;
    if (h > 0) return fmt(h) + 'h ' + mm + 'm ' + ss + 's';
    return mins + 'm ' + ss + 's';
  }

  function renderWebcasts(webcasts, evt) {
    var ed = isAdmin();
    var html = '';

    if (!webcasts.length && !ed) return '<p style="color:#999;text-align:center;padding:20px 0">No webcast data available.</p>';

    // Group by webcast_type
    var types = {};
    webcasts.forEach(function(w) {
      var t = w.webcast_type || 'video_metrics';
      if (!types[t]) types[t] = [];
      types[t].push(w);
    });

    // Ordered sub-section config
    var typeOrder = [
      { key: 'event_summary',   label: 'Event Summary',            nameCol: 'Type',    hasAvgViews: true,  hasRank: false },
      { key: 'keynote',         label: 'Keynote Speakers',         nameCol: 'Title',   hasAvgViews: false, hasRank: true },
      { key: 'company_summary', label: 'Company Summary by Status', nameCol: 'Status',  hasAvgViews: true,  hasRank: false },
      { key: 'corporate',       label: 'Companies',                nameCol: 'Company', hasAvgViews: false, hasRank: true },
      { key: 'panel',           label: 'Panels',                   nameCol: 'Title',   hasAvgViews: false, hasRank: true },
      { key: 'video_metrics',   label: 'Video Metrics',            nameCol: 'Name',    hasAvgViews: false, hasRank: true }
    ];

    var inpStyle = 'border:1px solid transparent;background:transparent;font:inherit;padding:2px 4px;width:100%';
    var numInpStyle = 'border:1px solid transparent;background:transparent;font:inherit;padding:2px 4px;text-align:right';
    var focusJS = "this.style.borderColor='#D4A017';this.style.background='#FFFDE7'";
    var blurBase = "this.style.borderColor='transparent';this.style.background='transparent'";

    var activeTypes = typeOrder.filter(function(cfg) { return types[cfg.key]; });
    // Append any unexpected types not in our ordered list
    Object.keys(types).forEach(function(k) {
      var found = false;
      for (var i = 0; i < typeOrder.length; i++) { if (typeOrder[i].key === k) { found = true; break; } }
      if (!found) activeTypes.push({ key: k, label: k.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); }), nameCol: 'Name', hasAvgViews: false, hasRank: true });
    });

    var showTypeHeading = activeTypes.length > 1;

    activeTypes.forEach(function(cfg) {
      var wtype = cfg.key;
      var rows = types[wtype];
      if (!rows) return;

      if (showTypeHeading) {
        html += '<h4 style="font-size:13px;font-weight:700;margin:18px 0 8px;color:var(--header-mid)">' + cfg.label + '</h4>';
      }

      // Build header columns
      var colIdx = 0;
      html += '<table class="psr-table"><thead><tr>';
      if (cfg.hasRank) { html += makeSortHeader('#', colIdx, 'num'); colIdx++; }
      html += makeSortHeader(cfg.nameCol, colIdx, 'text'); colIdx++;
      html += makeSortHeader('Total Views', colIdx, 'num'); colIdx++;
      if (cfg.hasAvgViews) { html += makeSortHeader('Avg Views', colIdx, 'num'); colIdx++; }
      html += makeSortHeader('Total Duration', colIdx, 'num'); colIdx++;
      html += makeSortHeader('Avg Duration', colIdx, 'num'); colIdx++;
      if (ed) html += '<th></th>';
      html += '</tr></thead><tbody>';

      rows.forEach(function(w, idx) {
        html += '<tr data-webcast-id="' + w.id + '">';
        if (ed) {
          if (cfg.hasRank) {
            html += '<td class="num"><input type="number" value="' + (w.sort_order || (idx + 1)) + '" min="1" style="' + numInpStyle + ';width:40px" '
              + 'onfocus="' + focusJS + '" '
              + 'onblur="' + blurBase + ';PSR.saveWebcastCell(' + w.id + ',\'sort_order\',this.value)" '
              + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}"></td>';
          }
          html += '<td><input type="text" value="' + esc(w.entity_name) + '" style="' + inpStyle + '" '
            + 'onfocus="' + focusJS + '" '
            + 'onblur="' + blurBase + ';PSR.saveWebcastCell(' + w.id + ',\'entity_name\',this.value)" '
            + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}"></td>';
          html += '<td class="num">' + fmt(w.total_views) + '</td>';
          if (cfg.hasAvgViews) {
            html += '<td class="num">' + (w.avg_views != null ? fmt(w.avg_views) : '—') + '</td>';
          }
          html += '<td class="num">' + fmtDuration(w.total_duration_min) + '</td>';
          html += '<td class="num">' + fmtDuration(w.avg_duration_min) + '</td>';
          html += '<td><button onclick="PSR.deleteWebcastRow(' + w.id + ')" style="background:none;border:none;color:#C0392B;cursor:pointer;font-size:14px" title="Delete">&times;</button></td>';
        } else {
          if (cfg.hasRank) {
            html += '<td class="num">' + (idx + 1) + '</td>';
          }
          html += '<td>' + esc(w.entity_name) + '</td>';
          html += '<td class="num">' + fmt(w.total_views) + '</td>';
          if (cfg.hasAvgViews) {
            html += '<td class="num">' + (w.avg_views != null ? fmt(w.avg_views) : '—') + '</td>';
          }
          html += '<td class="num">' + fmtDuration(w.total_duration_min) + '</td>';
          html += '<td class="num">' + fmtDuration(w.avg_duration_min) + '</td>';
        }
        html += '</tr>';
      });

      html += '</tbody></table>';
    });

    return html;
  }

  // ── Charts ───────────────────────────────────────────
  function initCharts(d) {
    var goldColor = '#D4A017';
    var silverColor = '#7F8C8D';
    var greenColor = '#27AE60';
    var blueColor = '#2980B9';
    var redColor = '#C0392B';
    var orangeColor = '#E67E22';

    var chartDefaults = {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { labels: { font: { family: 'Inter', size: 11 } } } },
      scales: {
        x: { ticks: { font: { family: 'Inter', size: 10 } } },
        y: { ticks: { font: { family: 'Inter', size: 10 } } }
      }
    };

    // Destroy previous market charts
    marketCharts.forEach(function(c) { c.destroy(); });
    marketCharts = [];

    // Market context charts
    if (d.market_data && d.market_data.length) {
      var pivot = {};
      var years = [];
      d.market_data.forEach(function(r) {
        if (!pivot[r.metric]) pivot[r.metric] = {};
        pivot[r.metric][r.year] = Number(r.value);
        if (years.indexOf(r.year) === -1) years.push(r.year);
      });
      years.sort();
      var yearLabels = years.map(String);

      // Helper: get value with optional inflation adjustment
      function v(metric, y) {
        var raw = pivot[metric] ? pivot[metric][y] : null;
        if (raw == null) return null;
        return adj(raw, y);
      }
      // Helper: get raw nominal value (no adjustment)
      function nomV(metric, y) {
        var raw = pivot[metric] ? pivot[metric][y] : null;
        return raw != null ? Number(raw) : null;
      }
      var isReal = inflationMode === 'real';

      var suffix = isReal ? ' (' + baseYear + ' USD)' : ' (USD)';

      // Gold price chart
      var goldDS = [
        { label: 'Gold' + suffix, data: years.map(function(y) { return v('gold_price', y); }), borderColor: goldColor, backgroundColor: goldColor + '20' }
      ];
      if (isReal) goldDS.push({ label: 'Gold (Nominal)', data: years.map(function(y) { return nomV('gold_price', y); }), borderColor: goldColor + '4D', backgroundColor: 'transparent', borderDash: [5, 3], pointRadius: 2 });
      marketCharts.push(createLineChart('chart-gold-price', yearLabels, goldDS));

      // Silver price chart
      var silverDS = [
        { label: 'Silver' + suffix, data: years.map(function(y) { return v('silver_price', y); }), borderColor: silverColor, backgroundColor: silverColor + '20' }
      ];
      if (isReal) silverDS.push({ label: 'Silver (Nominal)', data: years.map(function(y) { return nomV('silver_price', y); }), borderColor: silverColor + '4D', backgroundColor: 'transparent', borderDash: [5, 3], pointRadius: 2 });
      marketCharts.push(createLineChart('chart-silver-price', yearLabels, silverDS));

      // Market cap chart
      var mcapDS = [
        { label: 'Gold MCap ($Bn)', data: years.map(function(y) { return v('gold_mcap_bn', y); }), borderColor: goldColor, backgroundColor: goldColor + '20' },
        { label: 'Silver MCap ($Bn)', data: years.map(function(y) { return v('silver_mcap_bn', y); }), borderColor: silverColor, backgroundColor: silverColor + '20' }
      ];
      if (isReal) {
        mcapDS.push({ label: 'Gold MCap (Nominal)', data: years.map(function(y) { return nomV('gold_mcap_bn', y); }), borderColor: goldColor + '4D', backgroundColor: 'transparent', borderDash: [5, 3], pointRadius: 2 });
        mcapDS.push({ label: 'Silver MCap (Nominal)', data: years.map(function(y) { return nomV('silver_mcap_bn', y); }), borderColor: silverColor + '4D', backgroundColor: 'transparent', borderDash: [5, 3], pointRadius: 2 });
      }
      marketCharts.push(createLineChart('chart-mcap', yearLabels, mcapDS));

      // Indices chart — indexed to 100 at first available year
      var huiRaw = years.map(function(y) { return v('hui_index', y); });
      var djiRaw = years.map(function(y) { return v('dji_index', y); });

      // Find first non-zero base values
      var huiBase = null, djiBase = null;
      for (var bi = 0; bi < huiRaw.length; bi++) {
        if (huiBase === null && huiRaw[bi] && huiRaw[bi] > 0) huiBase = huiRaw[bi];
        if (djiBase === null && djiRaw[bi] && djiRaw[bi] > 0) djiBase = djiRaw[bi];
        if (huiBase !== null && djiBase !== null) break;
      }

      var huiIndexed = huiRaw.map(function(val) { return (val && huiBase) ? Math.round(val / huiBase * 100) : null; });
      var djiIndexed = djiRaw.map(function(val) { return (val && djiBase) ? Math.round(val / djiBase * 100) : null; });

      var canvasEl = document.getElementById('chart-indices');
      if (canvasEl) {
        marketCharts.push(new Chart(canvasEl.getContext('2d'), {
          type: 'line',
          data: {
            labels: yearLabels,
            datasets: [
              { label: 'HUI (indexed)', data: huiIndexed, borderColor: greenColor, backgroundColor: greenColor + '20', fill: false, tension: 0.3, pointRadius: 3 },
              { label: 'DJI (indexed)', data: djiIndexed, borderColor: blueColor, backgroundColor: blueColor + '20', fill: false, tension: 0.3, pointRadius: 3 }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { labels: { font: { family: 'Inter', size: 11 } } } },
            scales: {
              x: { ticks: { font: { family: 'Inter', size: 10 } } },
              y: { type: 'linear', title: { display: true, text: 'Index (' + years[0] + ' = 100)', font: { family: 'Inter', size: 10 } }, ticks: { font: { family: 'Inter', size: 10 } } }
            }
          }
        }));
      }
    }

    // Financials indexed chart (prior year = 100)
    if (d.financials && d.financials.length) {
      var finRev = d.financials.filter(function(r) { return r.category === 'revenue'; });
      var finExp = d.financials.filter(function(r) { return r.category === 'expense'; });
      var canvasF = document.getElementById('chart-financials');
      if (canvasF) {
        // Build labels: each revenue GL + total revenue + expenses
        var finLabels = [];
        var idxBudget = [], idxActual = [];
        function idx(val, base) {
          if (!base || base === 0) return null;
          return Math.round(Number(val) / Math.abs(Number(base)) * 1000) / 10;
        }
        finRev.forEach(function(r) {
          var prior = Number(r.prior_year_amount) || 0;
          if (!prior) return; // skip lines with no prior base
          finLabels.push(r.line_item);
          idxBudget.push(idx(r.budget_amount, prior));
          idxActual.push(idx(r.actual_amount, prior));
        });
        // Total revenue
        var totRevPrior = finRev.reduce(function(s, r) { return s + (Number(r.prior_year_amount) || 0); }, 0);
        var totRevBudget = finRev.reduce(function(s, r) { return s + (Number(r.budget_amount) || 0); }, 0);
        var totRevActual = finRev.reduce(function(s, r) { return s + (Number(r.actual_amount) || 0); }, 0);
        if (totRevPrior) {
          finLabels.push('Total Revenue');
          idxBudget.push(idx(totRevBudget, totRevPrior));
          idxActual.push(idx(totRevActual, totRevPrior));
        }
        // Total expenses
        var totExpPrior = finExp.reduce(function(s, r) { return s + Math.abs(Number(r.prior_year_amount) || 0); }, 0);
        var totExpBudget = finExp.reduce(function(s, r) { return s + Math.abs(Number(r.budget_amount) || 0); }, 0);
        var totExpActual = finExp.reduce(function(s, r) { return s + Math.abs(Number(r.actual_amount) || 0); }, 0);
        if (totExpPrior) {
          finLabels.push('Event Expenses');
          idxBudget.push(idx(totExpBudget, totExpPrior));
          idxActual.push(idx(totExpActual, totExpPrior));
        }

        var idxPrior = finLabels.map(function() { return 100; });
        var finDS = [
          { label: (d.event ? d.event.year - 1 : 'Prior') + ' Actual', data: idxPrior, backgroundColor: silverColor + '60', borderColor: silverColor, borderWidth: 1 },
          { label: 'Budget', data: idxBudget, backgroundColor: blueColor + '80', borderColor: blueColor, borderWidth: 1 },
          { label: 'Actual', data: idxActual, backgroundColor: greenColor, borderColor: '#1B7D3A', borderWidth: 1 }
        ];

        new Chart(canvasF.getContext('2d'), {
          type: 'bar',
          data: { labels: finLabels, datasets: finDS },
          options: Object.assign({}, chartDefaults, {
            plugins: {
              legend: { labels: { font: { family: 'Inter', size: 11 } } },
              annotation: {
                annotations: {
                  baseline: { type: 'line', yMin: 100, yMax: 100, borderColor: '#999', borderWidth: 1, borderDash: [4, 3], label: { display: true, content: 'Prior Year (100)', position: 'start', font: { size: 9, family: 'Inter' }, backgroundColor: 'rgba(0,0,0,0.5)' } }
                }
              },
              tooltip: {
                callbacks: {
                  label: function(ctx) { return ctx.dataset.label + ': ' + (ctx.parsed.y != null ? ctx.parsed.y.toFixed(1) : '—'); }
                }
              }
            },
            scales: {
              y: { title: { display: true, text: 'Index (Prior Year = 100)', font: { family: 'Inter', size: 10 } }, ticks: { font: { family: 'Inter', size: 10 } } }
            }
          })
        });
      }
    }

    // Historical financials area chart
    initHistFinChart(d);

    // Historical attendance stacked bar chart
    initHistAttChart();

    // Historical meetings stacked bar chart
    initHistMtgChart();

    // Attendee classification chart
    if (d.attendance && d.attendance.length) {
      var classData = d.attendance.filter(function(r) { return r.section === 'attendee_class' && Number(r.value_current) > 0; });
      var canvasC = document.getElementById('chart-attendee-class');
      if (canvasC && classData.length) {
        var classColors = [goldColor, blueColor, greenColor, orangeColor, redColor, silverColor, '#9B59B6', '#1ABC9C'];
        new Chart(canvasC.getContext('2d'), {
          type: 'doughnut',
          data: {
            labels: classData.map(function(r) { return r.metric; }),
            datasets: [{
              data: classData.map(function(r) { return Number(r.value_current); }),
              backgroundColor: classColors.slice(0, classData.length)
            }]
          },
          options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'right', labels: { font: { family: 'Inter', size: 11 } } } } }
        });
      }

      // Country chart (top 10)
      var countryData = d.attendance.filter(function(r) { return r.section === 'attendee_country'; })
        .sort(function(a, b) { return Number(b.value_current) - Number(a.value_current); })
        .slice(0, 10);
      var canvasK = document.getElementById('chart-attendee-country');
      if (canvasK && countryData.length) {
        new Chart(canvasK.getContext('2d'), {
          type: 'bar',
          data: {
            labels: countryData.map(function(r) { return r.metric; }),
            datasets: [{
              label: 'Attendees',
              data: countryData.map(function(r) { return Number(r.value_current); }),
              backgroundColor: blueColor
            }]
          },
          options: Object.assign({}, chartDefaults, { indexAxis: 'y' })
        });
      }
    }

    // Hotel chart
    if (d.hotel && d.hotel.length) {
      var canvasH = document.getElementById('chart-hotel');
      if (canvasH) {
        new Chart(canvasH.getContext('2d'), {
          type: 'bar',
          data: {
            labels: d.hotel.map(function(h) { return fmtDateShort(h.night_date); }),
            datasets: [
              { label: 'Contracted', data: d.hotel.map(function(h) { return Number(h.contracted); }), backgroundColor: blueColor + '60' },
              { label: 'Actual', data: d.hotel.map(function(h) { return Number(h.actual); }), backgroundColor: greenColor }
            ]
          },
          options: chartDefaults
        });
      }
    }

    // Member Historical Data charts
    if (d.member_history && d.member_history.length) {
      var histYears = d.member_history.map(function(r) { return String(r.year); });
      var pgmColor = '#8E44AD';
      var otherColor = '#27AE60';
      var stackedOpts = {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { position: 'top', labels: { font: { family: 'Inter', size: 11 } } },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                return ctx.dataset.label + ': ' + (ctx.parsed.y * 100).toFixed(1) + '%';
              }
            }
          }
        },
        scales: {
          x: { stacked: true, ticks: { font: { family: 'Inter', size: 10 } } },
          y: {
            stacked: true,
            min: 0, max: 1,
            ticks: {
              font: { family: 'Inter', size: 10 },
              callback: function(val) { return (val * 100) + '%'; }
            }
          }
        }
      };

      // Chart 1: Mineral composition — drop years with no mineral data
      var mineralRows = d.member_history.filter(function(r) {
        return (r.pct_gold != null) || (r.pct_silver != null) || (r.pct_pgms != null) || (r.pct_other != null);
      });
      var canvasM = document.getElementById('chart-hist-mineral');
      if (canvasM && mineralRows.length) {
        new Chart(canvasM.getContext('2d'), {
          type: 'bar',
          data: {
            labels: mineralRows.map(function(r) { return String(r.year); }),
            datasets: [
              { label: 'Gold', data: mineralRows.map(function(r) { return Number(r.pct_gold) || 0; }), backgroundColor: goldColor },
              { label: 'Silver', data: mineralRows.map(function(r) { return Number(r.pct_silver) || 0; }), backgroundColor: silverColor },
              { label: 'PGMs', data: mineralRows.map(function(r) { return Number(r.pct_pgms) || 0; }), backgroundColor: pgmColor },
              { label: 'Other', data: mineralRows.map(function(r) { return Number(r.pct_other) || 0; }), backgroundColor: otherColor }
            ]
          },
          options: stackedOpts
        });
      }

      // Chart 2: Status composition — drop years with no status data
      var producerColor = '#27AE60';
      var royaltyColor = '#2980B9';
      var devColor = '#E67E22';
      var expColor = '#9B59B6';
      var statusRows = d.member_history.filter(function(r) {
        return (r.pct_producer != null) || (r.pct_royalty != null) || (r.pct_developer != null) || (r.pct_explorer != null);
      });
      var canvasS = document.getElementById('chart-hist-status');
      if (canvasS && statusRows.length) {
        new Chart(canvasS.getContext('2d'), {
          type: 'bar',
          data: {
            labels: statusRows.map(function(r) { return String(r.year); }),
            datasets: [
              { label: 'Producer', data: statusRows.map(function(r) { return Number(r.pct_producer) || 0; }), backgroundColor: producerColor },
              { label: 'Royalty', data: statusRows.map(function(r) { return Number(r.pct_royalty) || 0; }), backgroundColor: royaltyColor },
              { label: 'Developer', data: statusRows.map(function(r) { return Number(r.pct_developer) || 0; }), backgroundColor: devColor },
              { label: 'Explorer', data: statusRows.map(function(r) { return Number(r.pct_explorer) || 0; }), backgroundColor: expColor }
            ]
          },
          options: stackedOpts
        });
      }

      // Gold valuation dual-axis chart
      var valRows = d.member_history.filter(function(r) { return r.gold_oz_per_1m_mcap != null; });
      var canvasV = document.getElementById('chart-gold-valuation');
      if (canvasV && valRows.length) {
        var valYears = valRows.map(function(r) { return String(r.year); });
        new Chart(canvasV.getContext('2d'), {
          type: 'bar',
          data: {
            labels: valYears,
            datasets: [
              {
                label: 'Gold Member MCap ($B)',
                data: valRows.map(function(r) { return Number(r.gold_member_mcap_bn) || 0; }),
                backgroundColor: '#CFB53B',
                borderColor: '#B8960C',
                borderWidth: 1,
                yAxisID: 'y',
                order: 2
              },
              {
                label: 'Gold oz / $1M MCap',
                data: valRows.map(function(r) { return Number(r.gold_oz_per_1m_mcap) || 0; }),
                type: 'line',
                borderColor: redColor,
                backgroundColor: redColor + '20',
                fill: false,
                tension: 0.3,
                pointRadius: 3,
                yAxisID: 'y1',
                order: 1
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { position: 'top', labels: { font: { family: 'Inter', size: 11 } } } },
            scales: {
              x: { ticks: { font: { family: 'Inter', size: 10 } } },
              y: {
                type: 'linear',
                position: 'left',
                title: { display: true, text: 'Market Cap ($B)', font: { family: 'Inter', size: 10 } },
                ticks: { font: { family: 'Inter', size: 10 } },
                beginAtZero: true
              },
              y1: {
                type: 'linear',
                position: 'right',
                title: { display: true, text: 'Gold oz / $1M MCap', font: { family: 'Inter', size: 10 } },
                ticks: { font: { family: 'Inter', size: 10 } },
                grid: { drawOnChartArea: false },
                beginAtZero: true
              }
            }
          }
        });
      }

      // Silver valuation dual-axis chart
      var silValRows = d.member_history.filter(function(r) { return r.silver_oz_per_1m_mcap != null || r.silver_member_mcap_bn != null; });
      var canvasSV = document.getElementById('chart-silver-valuation');
      if (canvasSV && silValRows.length) {
        var silValYears = silValRows.map(function(r) { return String(r.year); });
        new Chart(canvasSV.getContext('2d'), {
          type: 'bar',
          data: {
            labels: silValYears,
            datasets: [
              {
                label: 'Silver Member MCap ($B)',
                data: silValRows.map(function(r) { return Number(r.silver_member_mcap_bn) || 0; }),
                backgroundColor: '#A8B2B8',
                borderColor: '#7F8C8D',
                borderWidth: 1,
                yAxisID: 'y',
                order: 2
              },
              {
                label: 'Silver oz / $1M MCap',
                data: silValRows.map(function(r) { return Number(r.silver_oz_per_1m_mcap) || 0; }),
                type: 'line',
                borderColor: redColor,
                backgroundColor: redColor + '20',
                fill: false,
                tension: 0.3,
                pointRadius: 3,
                yAxisID: 'y1',
                order: 1
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { position: 'top', labels: { font: { family: 'Inter', size: 11 } } } },
            scales: {
              x: { ticks: { font: { family: 'Inter', size: 10 } } },
              y: {
                type: 'linear',
                position: 'left',
                title: { display: true, text: 'Market Cap ($B)', font: { family: 'Inter', size: 10 } },
                ticks: { font: { family: 'Inter', size: 10 } },
                beginAtZero: true
              },
              y1: {
                type: 'linear',
                position: 'right',
                title: { display: true, text: 'Silver oz / $1M MCap', font: { family: 'Inter', size: 10 } },
                ticks: { font: { family: 'Inter', size: 10 } },
                grid: { drawOnChartArea: false },
                beginAtZero: true
              }
            }
          }
        });
      }

      // Au & Ag weighted avg valuation chart
      var wgtRows = d.member_history.filter(function(r) { return r.weighted_oz_per_1m_mcap != null || r.total_au_ag_mcap_bn != null; });
      var canvasW = document.getElementById('chart-weighted-valuation');
      if (canvasW && wgtRows.length) {
        var wgtYears = wgtRows.map(function(r) { return String(r.year); });
        new Chart(canvasW.getContext('2d'), {
          type: 'bar',
          data: {
            labels: wgtYears,
            datasets: [
              {
                label: 'Total Au + Ag MCap ($B)',
                data: wgtRows.map(function(r) { return Number(r.total_au_ag_mcap_bn) || 0; }),
                backgroundColor: '#5D8AA8',
                borderColor: '#3B6E8F',
                borderWidth: 1,
                yAxisID: 'y',
                order: 2
              },
              {
                label: 'Weighted Avg oz / $1M MCap',
                data: wgtRows.map(function(r) { return Number(r.weighted_oz_per_1m_mcap) || 0; }),
                type: 'line',
                borderColor: '#2C3E50',
                backgroundColor: '#2C3E50' + '20',
                fill: false,
                tension: 0.3,
                pointRadius: 4,
                pointBackgroundColor: '#fff',
                pointBorderWidth: 2,
                yAxisID: 'y1',
                order: 1
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { position: 'top', labels: { font: { family: 'Inter', size: 11 } } } },
            scales: {
              x: { ticks: { font: { family: 'Inter', size: 10 } } },
              y: {
                type: 'linear',
                position: 'left',
                title: { display: true, text: 'Market Cap ($B)', font: { family: 'Inter', size: 10 } },
                ticks: { font: { family: 'Inter', size: 10 } },
                beginAtZero: true
              },
              y1: {
                type: 'linear',
                position: 'right',
                title: { display: true, text: 'oz / $1M MCap', font: { family: 'Inter', size: 10 } },
                ticks: { font: { family: 'Inter', size: 10 } },
                grid: { drawOnChartArea: false },
                beginAtZero: true
              }
            }
          }
        });
      }
    }
  }

  function createLineChart(id, labels, datasets) {
    var canvas = document.getElementById(id);
    if (!canvas) return null;
    datasets.forEach(function(ds) {
      ds.fill = ds.fill !== undefined ? ds.fill : false;
      ds.tension = ds.tension !== undefined ? ds.tension : 0.3;
      ds.pointRadius = ds.pointRadius !== undefined ? ds.pointRadius : 3;
    });
    return new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { labels: { font: { family: 'Inter', size: 11 } } } },
        scales: {
          x: { ticks: { font: { family: 'Inter', size: 10 } } },
          y: { ticks: { font: { family: 'Inter', size: 10 } } }
        }
      }
    });
  }

  // ── Escape HTML ──────────────────────────────────────
  function esc(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(String(s)));
    return div.innerHTML;
  }

  // ── SWOT CRUD ─────────────────────────────────────────
  function postAPI(body) {
    return fetch(API, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify(body)
    }).then(function(r) { return r.json(); });
  }

  function saveSwotItem(id, el) {
    var text = el.textContent.trim();
    if (!text) return;
    el.style.opacity = '0.5';
    postAPI({ action: 'swot-update', id: id, item_text: text }).then(function(res) {
      el.style.opacity = '1';
      if (!res.ok) alert('Save failed: ' + (res.error || 'Unknown error'));
    });
  }

  function deleteSwotItem(id, btnEl) {
    if (!confirm('Delete this item?')) return;
    var li = btnEl.closest('.swot-item');
    li.style.opacity = '0.3';
    postAPI({ action: 'swot-delete', id: id }).then(function(res) {
      if (res.ok) {
        li.remove();
      } else {
        li.style.opacity = '1';
        alert('Delete failed: ' + (res.error || 'Unknown error'));
      }
    });
  }

  function addSwotItem(category) {
    if (!currentEvent) return;
    var list = document.getElementById('swot-list-' + category);
    if (!list) return;
    var maxSort = 0;
    list.querySelectorAll('.swot-item').forEach(function(li) { maxSort++; });
    postAPI({
      action: 'swot-add',
      event_code: currentEvent.event_code,
      category: category,
      item_text: 'New item — click to edit',
      sort_order: maxSort + 1
    }).then(function(res) {
      if (res.ok && res.item) {
        var temp = document.createElement('ul');
        temp.innerHTML = renderSwotItem(res.item);
        var newLi = temp.firstChild;
        list.appendChild(newLi);
        var textEl = newLi.querySelector('.swot-item-text');
        textEl.focus();
        // Select all text for easy replacement
        var range = document.createRange();
        range.selectNodeContents(textEl);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        alert('Add failed: ' + (res.error || 'Unknown error'));
      }
    });
  }

  // ── Market Data CRUD ──────────────────────────────────
  function focusMarketCell(input) {
    // Show raw value for editing
    var raw = input.getAttribute('data-raw') || input.value;
    input.value = raw;
    input.select();
  }

  function blurMarketCell(input) {
    // Strip commas to get numeric value, save, then re-format
    var val = input.value.replace(/,/g, '').trim();
    if (val === '') return;
    var num = Number(val);
    if (isNaN(num)) { input.value = input.getAttribute('data-raw') || val; return; }
    var d = Number(input.getAttribute('data-decimals')) || 0;
    input.setAttribute('data-raw', num);
    input.value = fmtInput(num, d);
    // Save to DB
    var id = Number(input.getAttribute('data-id'));
    input.style.opacity = '0.5';
    postAPI({ action: 'market-update', id: id, value: num }).then(function(res) {
      input.style.opacity = '1';
      if (!res.ok) alert('Save failed: ' + (res.error || 'Unknown error'));
    });
  }

  function saveMarketCell(input) {
    blurMarketCell(input);
  }

  function addMarketYear() {
    var input = document.getElementById('market-new-year');
    if (!input) return;
    var year = parseInt(input.value, 10);
    if (!year || year < 2000 || year > 2099) { alert('Enter a valid year (2000-2099)'); return; }
    if (!currentEvent) return;

    // Check if year already exists
    if (marketIdMap['gold_price|' + year]) {
      alert('Year ' + year + ' already exists');
      return;
    }

    input.disabled = true;
    postAPI({
      action: 'market-add-year',
      event_type: currentEvent.event_type,
      year: year
    }).then(function(res) {
      input.disabled = false;
      if (res.ok) {
        // Reload the full report to re-render with new year
        selectEvent(currentEvent);
      } else {
        alert('Add failed: ' + (res.error || 'Unknown error'));
      }
    });
  }

  function deleteMarketYear(year) {
    if (!currentEvent) return;
    if (!confirm('Delete all market data for ' + year + '?')) return;
    postAPI({
      action: 'market-delete-year',
      event_type: currentEvent.event_type,
      year: year
    }).then(function(res) {
      if (res.ok) {
        selectEvent(currentEvent);
      } else {
        alert('Delete failed: ' + (res.error || 'Unknown error'));
      }
    });
  }

  // ── Venue History CRUD ─────────────────────────────────
  function saveVenueField(el) {
    var id = Number(el.getAttribute('data-id'));
    var field = el.getAttribute('data-field');
    var value = el.textContent.trim();
    var body = { action: 'venue-update', id: id };
    body[field] = value;
    el.style.opacity = '0.5';
    postAPI(body).then(function(res) {
      el.style.opacity = '1';
      if (!res.ok) alert('Save failed: ' + (res.error || 'Unknown error'));
    });
  }

  // ── Refresh MCaps from analytics ────────────────────────
  function refreshMcaps() {
    if (!currentEvent) return;
    var btn = document.getElementById('btn-refresh-mcaps');
    if (btn) { btn.disabled = true; btn.textContent = '↻ Refreshing…'; }

    postAPI({
      action: 'refresh-mcaps',
      event_code: currentEvent.event_code,
      event_type: currentEvent.event_type,
      year: currentEvent.year
    }).then(function(res) {
      if (!res.ok) {
        alert('Refresh failed: ' + (res.error || 'Unknown error'));
        if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh MCaps'; }
        return;
      }
      // Update local reportData so re-render picks up new values
      if (reportData && reportData.market_data) {
        reportData.market_data.forEach(function(r) {
          if (r.event_type === currentEvent.event_type && r.year === currentEvent.year) {
            if (r.metric === 'gold_mcap_bn') r.value = res.gold_mcap_bn;
            if (r.metric === 'silver_mcap_bn') r.value = res.silver_mcap_bn;
          }
        });
      }
      refreshMarketSection();
      // Brief success flash
      var btn2 = document.getElementById('btn-refresh-mcaps');
      if (btn2) {
        btn2.textContent = '✓ Updated (' + res.participants + ' participants)';
        btn2.style.background = '#1E8449';
        setTimeout(function() {
          btn2.textContent = '↻ Refresh MCaps';
          btn2.style.background = '';
          btn2.disabled = false;
        }, 3000);
      }
    }).catch(function(err) {
      alert('Refresh error: ' + err.message);
      if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh MCaps'; }
    });
  }

  // ── Inflation toggle ──────────────────────────────────
  var marketSectionId = null; // set during renderReport
  var histFinSectionId = null; // set during renderReport
  var histFinChart = null; // track hist chart instance for cleanup

  function setInflation(mode) {
    inflationMode = mode;
    refreshMarketSection();
    refreshHistFinSection();
  }

  function setBaseYear(year) {
    baseYear = year;
    if (inflationMode === 'real') {
      refreshMarketSection();
      refreshHistFinSection();
    }
  }

  function refreshMarketSection() {
    if (!reportData || !marketSectionId) return;
    var section = document.getElementById(marketSectionId);
    if (!section) return;
    var body = section.querySelector('.psr-section-body');
    if (!body) return;
    body.innerHTML = renderMarketContext(reportData.market_data, reportData.event);
    setTimeout(function() { initCharts(reportData); }, 50);
  }

  function initHistFinChart(d) {
    var canvasHF = document.getElementById('chart-hist-financials');
    if (!canvasHF) return;

    if (histFinChart) { histFinChart.destroy(); histFinChart = null; }

    var rows = buildHistRows(d.financials, d.event, d.historical_actuals);
    var isReal = inflationMode === 'real';

    var labels = rows.map(function(r) { return String(r[0]); });
    var revData = rows.map(function(r) { return isReal ? adj(r[1], r[0]) : r[1]; });
    var expData = rows.map(function(r) { return isReal ? adj(r[2], r[0]) : r[2]; });
    var netData = rows.map(function(i, idx) { return revData[idx] + expData[idx]; });

    // Virtual year segment styling
    var revBg = rows.map(function(r) { return VIRTUAL_YEARS[r[0]] ? 'rgba(39,174,96,0.2)' : '#27AE6080'; });
    var expBg = rows.map(function(r) { return VIRTUAL_YEARS[r[0]] ? 'rgba(192,57,43,0.2)' : '#C0392B80'; });
    var revBorder = rows.map(function(r) { return VIRTUAL_YEARS[r[0]] ? '#27AE6080' : '#27AE60'; });
    var expBorder = rows.map(function(r) { return VIRTUAL_YEARS[r[0]] ? '#C0392B80' : '#C0392B'; });
    var revDash = rows.map(function(r) { return VIRTUAL_YEARS[r[0]] ? [4, 4] : []; });
    var netPointBg = rows.map(function(r) { return VIRTUAL_YEARS[r[0]] ? '#999' : '#000'; });
    var netPointBorder = rows.map(function(r) { return VIRTUAL_YEARS[r[0]] ? '#ccc' : '#fff'; });

    histFinChart = new Chart(canvasHF.getContext('2d'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Direct Revenue',
            data: revData,
            borderColor: revBorder,
            backgroundColor: revBg,
            fill: true,
            tension: 0,
            pointRadius: 0,
            segment: { borderDash: function(ctx) { return VIRTUAL_YEARS[rows[ctx.p0DataIndex] && rows[ctx.p0DataIndex][0]] ? [4, 4] : []; } },
            order: 2
          },
          {
            label: 'Direct Expenses',
            data: expData,
            borderColor: expBorder,
            backgroundColor: expBg,
            fill: true,
            tension: 0,
            pointRadius: 0,
            segment: { borderDash: function(ctx) { return VIRTUAL_YEARS[rows[ctx.p0DataIndex] && rows[ctx.p0DataIndex][0]] ? [4, 4] : []; } },
            order: 3
          },
          {
            label: 'Net Operating Income',
            data: netData,
            borderColor: '#FFFFFF',
            backgroundColor: 'transparent',
            fill: false,
            tension: 0,
            borderWidth: 2.5,
            pointRadius: 4,
            pointBackgroundColor: netPointBg,
            pointBorderColor: netPointBorder,
            pointBorderWidth: 1.5,
            segment: { borderDash: function(ctx) { return VIRTUAL_YEARS[rows[ctx.p0DataIndex] && rows[ctx.p0DataIndex][0]] ? [4, 4] : []; } },
            order: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { font: { family: 'Inter', size: 11 }, usePointStyle: true } },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                var v = ctx.parsed.y;
                var sign = v < 0 ? '-' : '';
                return ctx.dataset.label + ': ' + sign + '$' + Math.abs(v).toLocaleString('en-US');
              },
              footer: function(items) {
                var yr = labels[items[0].dataIndex];
                return VIRTUAL_YEARS[Number(yr)] ? '(Virtual Only)' : '';
              }
            }
          }
        },
        scales: {
          x: {
            ticks: {
              font: { family: 'Inter', size: 10 },
              maxRotation: 45,
              minRotation: 0,
              callback: function(val, idx) {
                var yr = Number(labels[idx]);
                return VIRTUAL_YEARS[yr] ? labels[idx] + ' *' : labels[idx];
              }
            }
          },
          y: {
            ticks: {
              font: { family: 'Inter', size: 10 },
              callback: function(v) {
                var sign = v < 0 ? '-' : '';
                return sign + '$' + Math.abs(v).toLocaleString('en-US');
              }
            }
          }
        }
      }
    });
  }

  function refreshHistFinSection() {
    if (!reportData || !histFinSectionId) return;
    var section = document.getElementById(histFinSectionId);
    if (!section) return;
    var body = section.querySelector('.psr-section-body');
    if (!body) return;
    body.innerHTML = renderHistoricalFinancials(reportData.financials, reportData.event, reportData.historical_actuals);
    setTimeout(function() { initHistFinChart(reportData); }, 50);
  }

  // ── Hotel Pickup CRUD ──────────────────────────────────
  function saveHotelCell(id, field, value) {
    postAPI({ action: 'hotel-update', id: id, field: field, value: value }).then(function(res) {
      if (!res.ok) alert('Save failed: ' + (res.error || 'Unknown error'));
      else refreshHotelSection();
    });
  }

  function saveHotelName(input, oldName) {
    var newName = input.value.trim();
    if (!newName || newName === oldName || !currentEvent) return;
    postAPI({ action: 'hotel-rename', event_code: currentEvent.event_code, old_name: oldName, new_name: newName }).then(function(res) {
      if (!res.ok) { alert('Rename failed: ' + (res.error || 'Unknown error')); input.value = oldName; }
      else refreshHotelSection();
    });
  }

  function deleteHotelRow(id) {
    if (!confirm('Delete this night row?')) return;
    postAPI({ action: 'hotel-delete', id: id }).then(function(res) {
      if (!res.ok) alert('Delete failed: ' + (res.error || 'Unknown error'));
      else refreshHotelSection();
    });
  }

  function addHotelNight() {
    if (!currentEvent) return;
    var sel = document.getElementById('hotel-add-select');
    if (!sel) return;
    var hotelName = sel.value;
    postAPI({ action: 'hotel-add-night', event_code: currentEvent.event_code, hotel_name: hotelName }).then(function(res) {
      if (!res.ok) alert('Add failed: ' + (res.error || 'Unknown error'));
      else refreshHotelSection();
    });
  }

  function addNewHotel() {
    if (!currentEvent) return;
    var input = document.getElementById('hotel-new-name');
    if (!input || !input.value.trim()) { alert('Enter a hotel name'); return; }
    postAPI({ action: 'hotel-add-new', event_code: currentEvent.event_code, hotel_name: input.value.trim() }).then(function(res) {
      if (!res.ok) alert('Add failed: ' + (res.error || 'Unknown error'));
      else refreshHotelSection();
    });
  }

  function refreshHotelSection() {
    if (!reportData || !hotelSectionId || !currentEvent) return;
    // Re-fetch hotel data from API
    fetch(API + '?action=hotel&event_code=' + currentEvent.event_code, { headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (!res.ok) return;
        reportData.hotel = res.hotel;
        var section = document.getElementById(hotelSectionId);
        if (!section) return;
        var body = section.querySelector('.psr-section-body');
        if (!body) return;
        body.innerHTML = renderHotel(reportData.hotel, reportData.event);
        setTimeout(function() { initCharts(reportData); }, 50);
      });
  }

  // ── Engagement CRUD ──────────────────────────────────
  function saveEngagementCell(id, field, value) {
    postAPI({ action: 'engagement-update', id: id, field: field, value: value }).then(function(res) {
      if (!res.ok) alert('Save failed: ' + (res.error || 'Unknown error'));
      else refreshEngagementSection();
    });
  }

  function deleteEngagementRow(id) {
    if (!confirm('Delete this engagement row?')) return;
    postAPI({ action: 'engagement-delete', id: id }).then(function(res) {
      if (!res.ok) alert('Delete failed: ' + (res.error || 'Unknown error'));
      else refreshEngagementSection();
    });
  }

  function addEngagementRow() {
    if (!currentEvent) return;
    var metricInput = document.getElementById('engagement-new-metric');
    var currentInput = document.getElementById('engagement-new-current');
    var priorInput = document.getElementById('engagement-new-prior');
    var metric = metricInput ? metricInput.value.trim() : '';
    if (!metric) { alert('Enter a metric name'); return; }
    postAPI({
      action: 'engagement-add',
      event_code: currentEvent.event_code,
      metric: metric,
      value_current: currentInput ? currentInput.value : 0,
      value_prior: priorInput ? priorInput.value : 0
    }).then(function(res) {
      if (!res.ok) alert('Add failed: ' + (res.error || 'Unknown error'));
      else refreshEngagementSection();
    });
  }

  function refreshEngagementSection() {
    if (!reportData || !engagementSectionId || !currentEvent) return;
    fetch(API + '?action=engagement&event_code=' + currentEvent.event_code, { headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (!res.ok) return;
        reportData.engagement = res.engagement;
        var section = document.getElementById(engagementSectionId);
        if (!section) return;
        var body = section.querySelector('.psr-section-body');
        if (!body) return;
        body.innerHTML = renderEngagement(reportData.engagement, reportData.event);
      });
  }

  // ── Meetings CRUD ─────────────────────────────────────
  function saveMeetingCell(id, field, value) {
    postAPI({ action: 'meeting-update', id: id, field: field, value: value }).then(function(res) {
      if (!res.ok) alert('Save failed: ' + (res.error || 'Unknown error'));
    });
  }

  function deleteMeetingRow(id) {
    if (!confirm('Delete this meeting row?')) return;
    postAPI({ action: 'meeting-delete', id: id }).then(function(res) {
      if (!res.ok) alert('Delete failed: ' + (res.error || 'Unknown error'));
      else refreshMeetingsSection();
    });
  }

  function addMeetingRow(section) {
    postAPI({ action: 'meeting-add', event_code: currentEvent.event_code, section: section }).then(function(res) {
      if (!res.ok) alert('Add failed: ' + (res.error || 'Unknown error'));
      else refreshMeetingsSection();
    });
  }

  function saveTopMeetingCell(id, field, value) {
    postAPI({ action: 'top-meeting-update', id: id, field: field, value: value }).then(function(res) {
      if (!res.ok) alert('Save failed: ' + (res.error || 'Unknown error'));
    });
  }

  function deleteTopMeetingRow(id) {
    if (!confirm('Delete this ranking entry?')) return;
    postAPI({ action: 'top-meeting-delete', id: id }).then(function(res) {
      if (!res.ok) alert('Delete failed: ' + (res.error || 'Unknown error'));
      else refreshMeetingsSection();
    });
  }

  function addTopMeetingRow(rankingType) {
    postAPI({ action: 'top-meeting-add', event_code: currentEvent.event_code, ranking_type: rankingType }).then(function(res) {
      if (!res.ok) alert('Add failed: ' + (res.error || 'Unknown error'));
      else refreshMeetingsSection();
    });
  }

  function refreshMeetingsSection() {
    if (!reportData || !meetingsSectionId || !currentEvent) return;
    fetch(API + '?action=meetings&event_code=' + currentEvent.event_code, { headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (!res.ok) return;
        reportData.meetings = res.meetings;
        reportData.top_meetings = res.top_meetings;
        var section = document.getElementById(meetingsSectionId);
        if (!section) return;
        var body = section.querySelector('.psr-section-body');
        if (!body) return;
        body.innerHTML = renderMeetings(reportData.meetings, reportData.top_meetings, reportData.event);
      });
  }

  // ── Webcast CRUD ──
  function saveWebcastCell(id, field, value) {
    postAPI({ action: 'webcast-update', id: id, field: field, value: value }).then(function(res) {
      if (!res.ok) alert('Save failed: ' + (res.error || 'Unknown error'));
    });
  }

  function deleteWebcastRow(id) {
    if (!confirm('Delete this webcast entry?')) return;
    postAPI({ action: 'webcast-delete', id: id }).then(function(res) {
      if (!res.ok) alert('Delete failed: ' + (res.error || 'Unknown error'));
      else refreshWebcastSection();
    });
  }

  function refreshWebcastSection() {
    if (!reportData || !webcastSectionId || !currentEvent) return;
    fetch(API + '?action=webcasts&event_code=' + currentEvent.event_code, { headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (!res.ok) return;
        reportData.webcasts = res.webcasts;
        var section = document.getElementById(webcastSectionId);
        if (!section) return;
        var body = section.querySelector('.psr-section-body');
        if (!body) return;
        body.innerHTML = renderWebcasts(reportData.webcasts, reportData.event);
      });
  }

  // ── Sortable table helpers ──
  function makeSortHeader(label, colIdx, type) {
    return '<th class="sortable' + (type === 'num' ? ' num' : '') + '" data-sort-col="' + colIdx + '" data-sort-type="' + type + '" onclick="PSR.sortTable(this)">' + label + '</th>';
  }

  function sortTable(th) {
    var table = th.closest('table');
    if (!table) return;
    var tbody = table.querySelector('tbody');
    if (!tbody) return;
    var colIdx = parseInt(th.getAttribute('data-sort-col'), 10);
    var type = th.getAttribute('data-sort-type') || 'text';
    var asc = true;
    if (th.classList.contains('sort-asc')) { asc = false; }
    var ths = th.parentElement.querySelectorAll('th.sortable');
    for (var i = 0; i < ths.length; i++) {
      ths[i].classList.remove('sort-asc', 'sort-desc');
    }
    th.classList.add(asc ? 'sort-asc' : 'sort-desc');
    var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
    rows.sort(function(a, b) {
      var cellA = a.children[colIdx];
      var cellB = b.children[colIdx];
      if (!cellA || !cellB) return 0;
      var inpA = cellA.querySelector('input');
      var inpB = cellB.querySelector('input');
      var vA = inpA ? inpA.value : cellA.textContent;
      var vB = inpB ? inpB.value : cellB.textContent;
      vA = (vA || '').trim();
      vB = (vB || '').trim();
      if (type === 'num') {
        var nA = parseFloat(vA.replace(/[,%$]/g, '')) || 0;
        var nB = parseFloat(vB.replace(/[,%$]/g, '')) || 0;
        return asc ? nA - nB : nB - nA;
      }
      vA = vA.toLowerCase();
      vB = vB.toLowerCase();
      if (vA < vB) return asc ? -1 : 1;
      if (vA > vB) return asc ? 1 : -1;
      return 0;
    });
    for (var j = 0; j < rows.length; j++) {
      tbody.appendChild(rows[j]);
    }
  }

  // Expose editing functions globally
  window.PSR = {
    saveSwotItem: saveSwotItem,
    deleteSwotItem: deleteSwotItem,
    addSwotItem: addSwotItem,
    saveMarketCell: saveMarketCell,
    focusMarketCell: focusMarketCell,
    blurMarketCell: blurMarketCell,
    addMarketYear: addMarketYear,
    deleteMarketYear: deleteMarketYear,
    saveVenueField: saveVenueField,
    setInflation: setInflation,
    setBaseYear: setBaseYear,
    refreshMcaps: refreshMcaps,
    showTrackingDetail: PSR.showTrackingDetail,
    saveHotelCell: saveHotelCell,
    saveHotelName: saveHotelName,
    deleteHotelRow: deleteHotelRow,
    addHotelNight: addHotelNight,
    addNewHotel: addNewHotel,
    saveEngagementCell: saveEngagementCell,
    deleteEngagementRow: deleteEngagementRow,
    addEngagementRow: addEngagementRow,
    saveMeetingCell: saveMeetingCell,
    deleteMeetingRow: deleteMeetingRow,
    addMeetingRow: addMeetingRow,
    saveTopMeetingCell: saveTopMeetingCell,
    deleteTopMeetingRow: deleteTopMeetingRow,
    addTopMeetingRow: addTopMeetingRow,
    saveWebcastCell: saveWebcastCell,
    deleteWebcastRow: deleteWebcastRow,
    toggleHistTable: toggleHistTable,
    refreshRegRecon: refreshRegRecon,
    toggleRegHistTable: PSR.toggleRegHistTable,
    toggleMtgHistTable: PSR.toggleMtgHistTable,
    sortTable: sortTable,
    setCoverPage: setCoverPage
  };

  // ── Cover page (persisted to Supabase) ──────────────
  var _coverPageBytes = null;

  function loadCoverPage(eventCode) {
    var statusEl = document.getElementById('cover-page-status');
    fetch(API + '?action=cover&event_code=' + encodeURIComponent(eventCode), { headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.ok && d.cover_pdf) {
          var bin = atob(d.cover_pdf);
          var bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          _coverPageBytes = bytes;
          if (statusEl) { statusEl.style.display = 'inline'; statusEl.textContent = '\u2713 Cover page loaded'; }
        } else {
          _coverPageBytes = null;
          if (statusEl) { statusEl.style.display = 'none'; }
        }
      }).catch(function() {
        _coverPageBytes = null;
      });
  }

  function setCoverPage(fileInput) {
    var file = fileInput.files[0];
    if (!file) return;
    if (!currentEvent) return;
    var statusEl = document.getElementById('cover-page-status');
    if (statusEl) { statusEl.style.display = 'inline'; statusEl.textContent = 'Uploading...'; }
    var reader = new FileReader();
    reader.onload = function(e) {
      _coverPageBytes = new Uint8Array(e.target.result);
      // Convert to base64 and persist
      var binary = '';
      var bytes = _coverPageBytes;
      for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      var b64 = btoa(binary);
      var token = getToken();
      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ action: 'cover-save', event_code: currentEvent.event_code, cover_pdf: b64 })
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.ok) {
          if (statusEl) { statusEl.textContent = '\u2713 ' + file.name + ' (saved)'; }
        } else {
          if (statusEl) { statusEl.textContent = '\u2713 ' + file.name + ' (save failed)'; }
        }
      }).catch(function() {
        if (statusEl) { statusEl.textContent = '\u2713 ' + file.name + ' (save failed)'; }
      });
    };
    reader.readAsArrayBuffer(file);
  }

  // ── PDF Download (window.print approach) ──────────────
  function snapChart(id) {
    var cvs = document.getElementById(id);
    if (!cvs || !cvs.width || !cvs.height) return null;
    try { return { src: cvs.toDataURL('image/png'), ratio: cvs.height / cvs.width }; } catch(e) { return null; }
  }

  // Snapshot all canvases matching a prefix (for dynamic IDs like composition doughnuts)
  function snapAllCanvases() {
    var snaps = {};
    var canvases = document.querySelectorAll('canvas');
    canvases.forEach(function(cvs) {
      if (cvs.id && cvs.width && cvs.height) {
        try { snaps[cvs.id] = { src: cvs.toDataURL('image/png'), ratio: cvs.height / cvs.width }; } catch(e) {}
      }
    });
    return snaps;
  }

  window.downloadReport = function() {
    if (!reportData || !reportData.event) { alert('No report loaded.'); return; }
    var evt = reportData.event;
    var data = reportData;
    var content = document.getElementById('report-content');
    if (!content) return;

    var btn = document.querySelector('.btn-download');
    var origText = btn ? btn.textContent : '';
    if (btn) { btn.textContent = 'Preparing report...'; btn.disabled = true; }

    // Expand all collapsed sections so charts render
    var collapsed = content.querySelectorAll('.psr-section.collapsed');
    collapsed.forEach(function(s) { s.classList.remove('collapsed'); });

    // Initialize all charts (they are lazy-loaded on section expand)
    try { initCharts(data); } catch(e) { console.warn('Chart init:', e); }

    setTimeout(function() {
      // Force all Chart.js instances to resize
      if (window.Chart && Chart.instances) {
        Object.keys(Chart.instances).forEach(function(k) {
          try { Chart.instances[k].resize(); } catch(e) {}
        });
      }
      setTimeout(function() {
        try {
          buildPrintDocument(evt, data);
        } catch(e) {
          console.error('PDF error:', e);
          alert('PDF generation failed: ' + e.message);
        }
        // Re-collapse sections
        collapsed.forEach(function(s) { s.classList.add('collapsed'); });
        if (btn) { btn.textContent = origText; btn.disabled = false; }
      }, 800);
    }, 800);
  };

  function buildPrintDocument(evt, data) {
    var colors = getEventColors(evt.event_type);

    // ── Snapshot all charts ──────────────────────────
    var allSnaps = snapAllCanvases();
    var charts = {
      histAttendance: allSnaps['chart-hist-attendance'] || null,
      histMeetings:   allSnaps['chart-hist-meetings'] || null,
      histFinancials: allSnaps['chart-hist-financials'] || null,
      attendeeClass:  allSnaps['chart-attendee-class'] || null,
      attendeeCountry:allSnaps['chart-attendee-country'] || null,
      goldPrice:      allSnaps['chart-gold-price'] || null,
      silverPrice:    allSnaps['chart-silver-price'] || null,
      histMineral:    allSnaps['chart-hist-mineral'] || null,
      histStatus:     allSnaps['chart-hist-status'] || null,
      goldValuation:  allSnaps['chart-gold-valuation'] || null,
      hotel:          allSnaps['chart-hotel'] || null
    };

    // Find composition doughnuts (dynamic IDs like md-XXXX-cm-cnt, md-XXXX-cs-cnt)
    var compCharts = [];
    Object.keys(allSnaps).forEach(function(id) {
      if (id.indexOf('md-') === 0 && (id.indexOf('-cm-cnt') > 0 || id.indexOf('-cs-cnt') > 0)) {
        var label = id.indexOf('-cm-cnt') > 0 ? 'Mineral Composition' : 'Status Composition';
        compCharts.push({ label: label, snap: allSnaps[id] });
      }
    });

    // ── Key Metrics ─────────────────────────────────
    var regMap = {};
    (data.attendance || []).forEach(function(r) { if (r.section === 'registration' || r.section === 'members') regMap[r.metric] = r; });
    var accepted = regMap['accepted'] ? Number(regMap['accepted'].value_current) || 0 : 0;
    var acceptedPrior = regMap['accepted'] ? Number(regMap['accepted'].value_prior) || 0 : 0;
    var attended = (Number((regMap['checked_in']||{}).value_current)||0) + (Number((regMap['walk_up']||{}).value_current)||0);
    var attendedPrior = (Number((regMap['checked_in']||{}).value_prior)||0) + (Number((regMap['walk_up']||{}).value_prior)||0);
    var members = regMap['total_event_members'] ? Number(regMap['total_event_members'].value_current) || 0 : 0;
    var membersPrior = regMap['total_event_members'] ? Number(regMap['total_event_members'].value_prior) || 0 : 0;
    var mtgMap = {};
    (data.meetings || []).forEach(function(r) { mtgMap[r.metric.toLowerCase()] = r; });
    var totalMtg = (Number((mtgMap['formal meetings']||{}).value_current)||0) + (Number((mtgMap['informal meetings (est.)']||{}).value_current)||0);
    var totalMtgPrior = (Number((mtgMap['formal meetings']||{}).value_prior)||0) + (Number((mtgMap['informal meetings (est.)']||{}).value_prior)||0);

    var metrics = [
      { label: 'Members', val: members, prior: membersPrior, color: '#8B6914' },
      { label: 'Accepted', val: accepted, prior: acceptedPrior, color: '#27AE60' },
      { label: 'Attended', val: attended, prior: attendedPrior, color: '#2980B9' },
      { label: 'Meetings', val: totalMtg, prior: totalMtgPrior, color: '#8E44AD' }
    ];

    // ── SWOT Data ───────────────────────────────────
    var swotGrouped = { strength: [], weakness: [], opportunity: [], threat: [] };
    (data.swot || []).forEach(function(s) {
      var cat = s.category.toLowerCase();
      if (swotGrouped[cat] && s.item_text && s.item_text.indexOf('New item') !== 0) {
        swotGrouped[cat].push(s.item_text);
      }
    });

    var swotCards = [
      { key: 'strength', label: 'Strengths', bg: '#eafaf1', border: '#27AE60', hdr: '#1E8449', icon: '\u2726' },
      { key: 'weakness', label: 'Weaknesses', bg: '#fdedec', border: '#E74C3C', hdr: '#C0392B', icon: '\u25BC' },
      { key: 'opportunity', label: 'Opportunities', bg: '#ebf5fb', border: '#3498DB', hdr: '#1A5276', icon: '\u2605' },
      { key: 'threat', label: 'Threats', bg: '#fef9e7', border: '#F39C12', hdr: '#7D6608', icon: '\u26A0' }
    ];

    // ── Venue info ──────────────────────────────────
    var venue = evt.venue || '';
    var city = evt.city || '';
    var country = evt.country || '';
    var dateRange = fmtDate(evt.start_date) + ' \u2014 ' + fmtDate(evt.end_date);

    // ── Cover page image (base64) ───────────────────
    var coverImgHtml = '';
    if (_coverPageBytes) {
      var binary = '';
      var bytes = _coverPageBytes;
      for (var ci = 0; ci < bytes.length; ci++) binary += String.fromCharCode(bytes[ci]);
      var coverB64 = btoa(binary);
      // Check if it's a PDF — if so we can't embed as image, skip
      var isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
      if (!isPdf) {
        coverImgHtml = '<div class="cover-page">' +
          '<img src="data:image/png;base64,' + coverB64 + '" style="max-width:100%;max-height:100%;object-fit:contain;">' +
          '</div><div class="page-break"></div>';
      }
    }

    // ── Build HTML document ─────────────────────────
    var html = '<!DOCTYPE html><html><head>';
    html += '<meta charset="utf-8">';
    html += '<title>PSR \u2014 ' + esc(evt.event_name) + '</title>';
    html += '<link href="https://fonts.googleapis.com/css2?family=Bree+Serif&family=Lato:wght@400;700;900&display=swap" rel="stylesheet">';
    html += '<style>';

    // Page setup
    html += '@page { size: letter portrait; margin: 0.65in 0.7in; }';
    html += '@media print { .no-print { display: none !important; } }';
    html += '* { box-sizing: border-box; margin: 0; padding: 0; }';
    html += 'body { font-family: "Lato", "Inter", sans-serif; font-size: 10pt; color: #2C3E50; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }';

    // Page break
    html += '.page-break { page-break-before: always; }';

    // Cover page
    html += '.cover-page { display: flex; align-items: center; justify-content: center; height: 100vh; page-break-after: always; }';

    // Report header
    html += '.report-header { background: ' + colors.gradient + '; color: #fff; padding: 28px 32px; border-radius: 8px; margin-bottom: 24px; position: relative; overflow: hidden; }';
    html += '.report-header h1 { font-family: "Bree Serif", serif; font-size: 22pt; font-weight: 400; margin: 0 0 2px 0; }';
    html += '.report-header .subtitle { font-size: 11pt; opacity: 0.9; margin-bottom: 6px; }';
    html += '.report-header .meta { font-size: 9pt; opacity: 0.8; }';
    html += '.report-header .meta span { margin-right: 18px; }';

    // Section headings
    html += 'h2 { font-family: "Bree Serif", serif; font-size: 14pt; font-weight: 400; color: ' + colors.primary + '; border-bottom: 2px solid ' + colors.primary + '; padding-bottom: 4px; margin: 22px 0 12px 0; }';
    html += 'h3 { font-family: "Bree Serif", serif; font-size: 11pt; font-weight: 400; color: #2C3E50; margin: 14px 0 8px 0; }';

    // KPI cards
    html += '.kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }';
    html += '.kpi-card { background: #F8F9FB; border-radius: 6px; padding: 12px 14px; border-left: 4px solid #ccc; }';
    html += '.kpi-label { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; color: #7F8C8D; letter-spacing: 0.5px; margin-bottom: 3px; }';
    html += '.kpi-value { font-size: 18pt; font-weight: 900; color: #2C3E50; line-height: 1.1; }';
    html += '.kpi-yoy { font-size: 8pt; margin-top: 2px; }';
    html += '.kpi-yoy.up { color: #1E8449; }';
    html += '.kpi-yoy.down { color: #C0392B; }';

    // Chart images
    html += '.chart-section { margin-bottom: 18px; }';
    html += '.chart-section img { width: 100%; height: auto; border-radius: 4px; }';
    html += '.chart-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }';
    html += '.chart-pair img { width: 100%; height: auto; border-radius: 4px; }';
    html += '.chart-pair h3 { margin: 0 0 4px 0; font-size: 9.5pt; }';

    // SWOT
    html += '.swot-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px; }';
    html += '.swot-card { border-radius: 6px; padding: 12px 14px; border-left: 4px solid #ccc; }';
    html += '.swot-card h4 { font-family: "Bree Serif", serif; font-size: 10.5pt; font-weight: 400; margin: 0 0 8px 0; }';
    html += '.swot-card ul { list-style: none; padding: 0; margin: 0; }';
    html += '.swot-card li { font-size: 9pt; line-height: 1.4; padding: 2px 0; padding-left: 12px; position: relative; }';
    html += '.swot-card li::before { content: "\u2022"; position: absolute; left: 0; color: inherit; font-weight: 700; }';

    // Footer
    html += '.report-footer { background: #F5F6FA; border-radius: 6px; padding: 14px 20px; text-align: center; margin-top: 28px; }';
    html += '.report-footer p { font-size: 8.5pt; color: #7F8C8D; margin: 0; }';
    html += '.report-footer a { color: ' + colors.primary + '; font-weight: 700; text-decoration: none; }';

    // Print button
    html += '.print-btn { position: fixed; bottom: 20px; right: 20px; background: ' + colors.primary + '; color: #fff; border: none; padding: 12px 28px; border-radius: 6px; font-family: "Lato", sans-serif; font-size: 11pt; font-weight: 700; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.2); z-index: 999; }';
    html += '.print-btn:hover { opacity: 0.9; }';

    // Composition doughnut row
    html += '.comp-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }';
    html += '.comp-row img { width: 100%; max-width: 240px; height: auto; margin: 0 auto; display: block; }';
    html += '.comp-row .comp-cell { text-align: center; }';

    // Tracking / Engagement tables
    html += '.data-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 9pt; }';
    html += '.data-table th { text-align: left; font-weight: 700; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.3px; color: #7F8C8D; padding: 5px 8px; border-bottom: 2px solid #E0E0E0; }';
    html += '.data-table th.num { text-align: right; }';
    html += '.data-table td { padding: 4px 8px; border-bottom: 1px solid #F0F0F0; font-size: 8.5pt; }';
    html += '.data-table td.num { text-align: right; font-variant-numeric: tabular-nums; }';
    html += '.data-table tfoot td { font-weight: 700; border-top: 2px solid #E0E0E0; background: #F8F9FB; }';
    html += '.data-table tr.highlight td { background: #FFFDE7; }';

    // Summary table
    html += '.summary-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 9pt; }';
    html += '.summary-table th { text-align: left; font-weight: 700; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.3px; color: #7F8C8D; padding: 6px 10px; border-bottom: 2px solid #E0E0E0; }';
    html += '.summary-table th.num { text-align: right; }';
    html += '.summary-table td { padding: 5px 10px; border-bottom: 1px solid #F0F0F0; }';
    html += '.summary-table td.num { text-align: right; font-variant-numeric: tabular-nums; }';
    html += '.summary-table tr.subtotal td { font-weight: 700; border-top: 2px solid #E0E0E0; background: #F8F9FB; }';
    html += '.summary-table tr.section-hdr td { font-weight: 700; font-size: 8.5pt; color: ' + colors.primary + '; padding-top: 10px; border-bottom: none; }';
    html += '.var-up { color: #1E8449; }';
    html += '.var-down { color: #C0392B; }';

    html += '</style></head><body>';

    // Print button (hidden when printing)
    html += '<button class="print-btn no-print" onclick="window.print()">\uD83D\uDDB6 Print / Save as PDF</button>';

    // Cover page (if uploaded image)
    html += coverImgHtml;

    // ── Report Header ───────────────────────────────
    html += '<div class="report-header">';
    html += '<h1>' + esc(evt.event_name) + '</h1>';
    html += '<div class="subtitle">Post Show Report</div>';
    html += '<div class="meta">';
    html += '<span>' + esc(venue) + ', ' + esc(city) + ', ' + esc(country) + '</span>';
    html += '<span>' + dateRange + '</span>';
    html += '</div></div>';

    // ── Key Metrics ─────────────────────────────────
    html += '<div class="kpi-grid">';
    metrics.forEach(function(m) {
      var pct = m.prior ? Math.round((m.val - m.prior) / m.prior * 100) : null;
      var sign = pct !== null && pct >= 0 ? '+' : '';
      var cls = pct !== null ? (pct >= 0 ? 'up' : 'down') : '';
      html += '<div class="kpi-card" style="border-left-color:' + m.color + ';">';
      html += '<div class="kpi-label">' + m.label + '</div>';
      html += '<div class="kpi-value">' + Number(m.val).toLocaleString() + '</div>';
      if (pct !== null) html += '<div class="kpi-yoy ' + cls + '">' + sign + pct + '% YoY</div>';
      html += '</div>';
    });
    html += '</div>';

    // ── Summary Table ───────────────────────────────
    var priorYear = evt.year - 1;

    function yoyCell(cur, prior) {
      if (prior == null || prior === 0) return '<td class="num"></td><td class="num"></td>';
      var diff = cur - prior;
      var pctV = ((cur - prior) / Math.abs(prior) * 100).toFixed(1);
      var cls = Number(pctV) >= 0 ? 'var-up' : 'var-down';
      var sign = Number(pctV) >= 0 ? '+' : '';
      var dSign = diff >= 0 ? '+' : '';
      return '<td class="num"><span class="' + cls + '">' + dSign + Number(diff).toLocaleString() + '</span></td>' +
             '<td class="num"><span class="' + cls + '">' + sign + pctV + '%</span></td>';
    }

    function negYoyCell(cur, prior) {
      // For negative metrics (no-show, declined): decrease is good
      if (prior == null || prior === 0) return '<td class="num"></td><td class="num"></td>';
      var diff = cur - prior;
      var absCur = Math.abs(cur), absPrior = Math.abs(prior);
      var pctV = ((absCur - absPrior) / absPrior * 100).toFixed(1);
      var cls = Number(pctV) <= 0 ? 'var-up' : 'var-down';
      var sign = Number(pctV) >= 0 ? '+' : '';
      var dSign = diff >= 0 ? '+' : '';
      return '<td class="num"><span class="' + cls + '">' + dSign + Number(Math.abs(diff)).toLocaleString() + '</span></td>' +
             '<td class="num"><span class="' + cls + '">' + sign + pctV + '%</span></td>';
    }

    html += '<h2>Event Summary</h2>';
    html += '<table class="summary-table">';
    html += '<thead><tr><th>Metric</th><th class="num">' + evt.year + '</th><th class="num">' + priorYear + '</th><th class="num">\u0394</th><th class="num">YoY %</th></tr></thead>';
    html += '<tbody>';

    // ── Member Participation section ──
    html += '<tr class="section-hdr"><td colspan="5">Member Participation</td></tr>';
    var totalMembers = regMap['total_event_members'] || {};
    var presentingM = regMap['presenting_members'] || {};
    var presSlots = regMap['presentation_slots'] || {};
    var sponsors = regMap['event_sponsors'] || {};
    var newMem = regMap['new_membership_from_event'] || {};
    var cancWith = regMap['cancellations_withdrawals'] || {};

    var memberRows = [
      { label: 'Total Event Members', cur: Number(totalMembers.value_current)||0, prior: Number(totalMembers.value_prior)||0 },
      { label: 'Presenting Members', cur: Number(presentingM.value_current)||0, prior: Number(presentingM.value_prior)||0 },
      { label: 'Presentation Slots', cur: Number(presSlots.value_current)||0, prior: Number(presSlots.value_prior)||0 },
      { label: 'Event Sponsors', cur: Number(sponsors.value_current)||0, prior: Number(sponsors.value_prior)||0 },
      { label: 'Cancellations / Withdrawals', cur: Number(cancWith.value_current)||0, prior: Number(cancWith.value_prior)||0, neg: true },
      { label: 'New Membership from Event', cur: Number(newMem.value_current)||0, prior: Number(newMem.value_prior)||0 }
    ];
    memberRows.forEach(function(r) {
      if (!r.cur && !r.prior) return;
      html += '<tr><td>' + r.label + '</td>';
      html += '<td class="num">' + Number(r.cur).toLocaleString() + '</td>';
      html += '<td class="num">' + Number(r.prior).toLocaleString() + '</td>';
      html += r.neg ? negYoyCell(r.cur, r.prior) : yoyCell(r.cur, r.prior);
      html += '</tr>';
    });

    // ── Registration Funnel section ──
    html += '<tr class="section-hdr"><td colspan="5">Registration &amp; Attendance</td></tr>';
    var invited = regMap['invited'] || {};
    var noResp = regMap['no_response'] || {};
    var declined = regMap['declined'] || {};
    var optedOut = regMap['opted_out'] || {};
    var accCancelled = regMap['accepted_cancelled'] || {};
    var accRow = regMap['accepted'] || {};
    var checkedInR = regMap['checked_in'] || {};
    var walkUpR = regMap['walk_up'] || {};
    var noShowR = regMap['no_show'] || {};

    var invCur = Number(invited.value_current)||0, invPrior = Number(invited.value_prior)||0;
    var accCur = Number(accRow.value_current)||0, accPrior = Number(accRow.value_prior)||0;
    var ciCur = Number(checkedInR.value_current)||0, ciPrior = Number(checkedInR.value_prior)||0;
    var wuCur = Number(walkUpR.value_current)||0, wuPrior = Number(walkUpR.value_prior)||0;
    var nsCur = Number(noShowR.value_current)||0, nsPrior = Number(noShowR.value_prior)||0;
    var attendedCur = ciCur + wuCur;
    var attendedPr = ciPrior + wuPrior;

    var regRows = [
      { label: 'Invited', cur: invCur, prior: invPrior },
      { label: 'No Response', cur: Number(noResp.value_current)||0, prior: Number(noResp.value_prior)||0, neg: true },
      { label: 'Declined', cur: Number(declined.value_current)||0, prior: Number(declined.value_prior)||0, neg: true },
      { label: 'Opted Out', cur: Number(optedOut.value_current)||0, prior: Number(optedOut.value_prior)||0, neg: true },
      { label: 'Accepted \u2014 Cancelled', cur: Number(accCancelled.value_current)||0, prior: Number(accCancelled.value_prior)||0, neg: true },
      { label: 'Accepted', cur: accCur, prior: accPrior, subtotal: true },
      { label: 'Checked In', cur: ciCur, prior: ciPrior },
      { label: 'Walk-Up', cur: wuCur, prior: wuPrior },
      { label: 'No Show', cur: nsCur, prior: nsPrior, neg: true },
      { label: 'Attended In Person', cur: attendedCur, prior: attendedPr, subtotal: true }
    ];
    regRows.forEach(function(r) {
      if (!r.cur && !r.prior && !r.subtotal) return;
      var rowCls = r.subtotal ? ' class="subtotal"' : '';
      html += '<tr' + rowCls + '><td>' + r.label + '</td>';
      var display = r.neg ? (r.cur < 0 ? '(' + Number(Math.abs(r.cur)).toLocaleString() + ')' : Number(r.cur).toLocaleString()) : Number(r.cur).toLocaleString();
      var displayP = r.neg ? (r.prior < 0 ? '(' + Number(Math.abs(r.prior)).toLocaleString() + ')' : Number(r.prior).toLocaleString()) : Number(r.prior).toLocaleString();
      html += '<td class="num">' + display + '</td>';
      html += '<td class="num">' + displayP + '</td>';
      html += r.neg ? negYoyCell(r.cur, r.prior) : yoyCell(r.cur, r.prior);
      html += '</tr>';
    });
    // Acceptance rate
    if (invCur > 0) {
      var accRateCur = (accCur / invCur * 100).toFixed(1);
      var accRatePrior = invPrior > 0 ? (accPrior / invPrior * 100).toFixed(1) : null;
      html += '<tr><td>Acceptance Rate</td>';
      html += '<td class="num">' + accRateCur + '%</td>';
      html += '<td class="num">' + (accRatePrior !== null ? accRatePrior + '%' : '\u2014') + '</td>';
      if (accRatePrior !== null) {
        var arDiff = (Number(accRateCur) - Number(accRatePrior)).toFixed(1);
        var arCls = Number(arDiff) >= 0 ? 'var-up' : 'var-down';
        var arSign = Number(arDiff) >= 0 ? '+' : '';
        html += '<td class="num"><span class="' + arCls + '">' + arSign + arDiff + 'pp</span></td><td class="num"></td>';
      } else {
        html += '<td class="num"></td><td class="num"></td>';
      }
      html += '</tr>';
    }
    // Attendance rate (of accepted)
    if (accCur > 0) {
      var attRateCur = (attendedCur / accCur * 100).toFixed(1);
      var attRatePrior = accPrior > 0 ? (attendedPr / accPrior * 100).toFixed(1) : null;
      html += '<tr><td>Attendance Rate (of Accepted)</td>';
      html += '<td class="num">' + attRateCur + '%</td>';
      html += '<td class="num">' + (attRatePrior !== null ? attRatePrior + '%' : '\u2014') + '</td>';
      if (attRatePrior !== null) {
        var atDiff = (Number(attRateCur) - Number(attRatePrior)).toFixed(1);
        var atCls = Number(atDiff) >= 0 ? 'var-up' : 'var-down';
        var atSign = Number(atDiff) >= 0 ? '+' : '';
        html += '<td class="num"><span class="' + atCls + '">' + atSign + atDiff + 'pp</span></td><td class="num"></td>';
      } else {
        html += '<td class="num"></td><td class="num"></td>';
      }
      html += '</tr>';
    }

    // ── Meetings section ──
    html += '<tr class="section-hdr"><td colspan="5">1\u00D71 Meetings</td></tr>';
    var mtgMetrics = data.meetings || [];
    var mtgLookup = {};
    mtgMetrics.forEach(function(r) { mtgLookup[r.metric.toLowerCase()] = r; });
    var formalM = mtgLookup['formal meetings'] || {};
    var informalM = mtgLookup['informal meetings (est.)'] || {};
    var mtgDeclined = mtgLookup['declined'] || {};
    var mtgCancelled = mtgLookup['cancelled'] || {};
    var mtgUnfulfilled = mtgLookup['unfulfilled'] || {};
    var fCur = Number(formalM.value_current)||0, fPrior = Number(formalM.value_prior)||0;
    var iCur = Number(informalM.value_current)||0, iPrior = Number(informalM.value_prior)||0;
    var completedCur = fCur + iCur, completedPrior = fPrior + iPrior;
    var dCur = Number(mtgDeclined.value_current)||0, dPrior = Number(mtgDeclined.value_prior)||0;
    var cCur = Number(mtgCancelled.value_current)||0, cPrior = Number(mtgCancelled.value_prior)||0;
    var uCur = Number(mtgUnfulfilled.value_current)||0, uPrior = Number(mtgUnfulfilled.value_prior)||0;
    var totalTxCur = completedCur + dCur + cCur + uCur;
    var totalTxPrior = completedPrior + dPrior + cPrior + uPrior;

    var mtgRows = [
      { label: 'Formal Meetings', cur: fCur, prior: fPrior },
      { label: 'Informal Meetings (Est.)', cur: iCur, prior: iPrior },
      { label: 'All Completed Meetings', cur: completedCur, prior: completedPrior, subtotal: true },
      { label: 'Declined', cur: dCur, prior: dPrior, neg: true },
      { label: 'Cancelled', cur: cCur, prior: cPrior, neg: true },
      { label: 'Unfulfilled', cur: uCur, prior: uPrior, neg: true },
      { label: 'Total Transactions', cur: totalTxCur, prior: totalTxPrior, subtotal: true }
    ];
    mtgRows.forEach(function(r) {
      if (!r.cur && !r.prior && !r.subtotal) return;
      var rowCls = r.subtotal ? ' class="subtotal"' : '';
      html += '<tr' + rowCls + '><td>' + r.label + '</td>';
      html += '<td class="num">' + Number(r.cur).toLocaleString() + '</td>';
      html += '<td class="num">' + Number(r.prior).toLocaleString() + '</td>';
      html += r.neg ? negYoyCell(r.cur, r.prior) : yoyCell(r.cur, r.prior);
      html += '</tr>';
    });
    // Meeting capacity utilization
    var mtgCapacity = mtgLookup['max meeting capacity'];
    if (mtgCapacity) {
      var capCur = Number(mtgCapacity.value_current)||0;
      var capPrior = Number(mtgCapacity.value_prior)||0;
      if (capCur > 0) {
        var utilCur = (completedCur / capCur * 100).toFixed(1);
        var utilPrior = capPrior > 0 ? (completedPrior / capPrior * 100).toFixed(1) : null;
        html += '<tr><td>Capacity Utilization</td>';
        html += '<td class="num">' + utilCur + '%</td>';
        html += '<td class="num">' + (utilPrior !== null ? utilPrior + '%' : '\u2014') + '</td>';
        if (utilPrior !== null) {
          var uDiff = (Number(utilCur) - Number(utilPrior)).toFixed(1);
          var uCls = Number(uDiff) >= 0 ? 'var-up' : 'var-down';
          var uSign = Number(uDiff) >= 0 ? '+' : '';
          html += '<td class="num"><span class="' + uCls + '">' + uSign + uDiff + 'pp</span></td><td class="num"></td>';
        } else {
          html += '<td class="num"></td><td class="num"></td>';
        }
        html += '</tr>';
      }
    }
    // Average member meetings = all completed meetings / total event members
    var pmCur = Number((regMap['total_event_members']||{}).value_current)||0;
    var pmPrior = Number((regMap['total_event_members']||{}).value_prior)||0;
    if (pmCur > 0) {
      var mmCur = (completedCur / pmCur).toFixed(1);
      var mmPrior = pmPrior > 0 ? (completedPrior / pmPrior).toFixed(1) : null;
      html += '<tr><td>Average Member Meetings</td>';
      html += '<td class="num">' + mmCur + '</td>';
      html += '<td class="num">' + (mmPrior !== null ? mmPrior : '\u2014') + '</td>';
      if (mmPrior !== null) {
        var mmDiff = (Number(mmCur) - Number(mmPrior)).toFixed(1);
        var mmCls = Number(mmDiff) >= 0 ? 'var-up' : 'var-down';
        var mmSign = Number(mmDiff) >= 0 ? '+' : '';
        html += '<td class="num"><span class="' + mmCls + '">' + mmSign + mmDiff + '</span></td><td class="num"></td>';
      } else {
        html += '<td class="num"></td><td class="num"></td>';
      }
      html += '</tr>';
    }

    // ── Engagement section ──
    if (data.engagement && data.engagement.length) {
      html += '<tr class="section-hdr"><td colspan="5">Engagement</td></tr>';
      data.engagement.forEach(function(r) {
        var eCur = Number(r.value_current)||0;
        var ePrior = Number(r.value_prior)||0;
        if (!eCur && !ePrior) return;
        html += '<tr><td>' + esc(r.metric) + '</td>';
        html += '<td class="num">' + Number(eCur).toLocaleString() + '</td>';
        html += '<td class="num">' + Number(ePrior).toLocaleString() + '</td>';
        html += yoyCell(eCur, ePrior);
        html += '</tr>';
      });
    }

    // ── Sponsorship total ──
    if (data.sponsors && data.sponsors.length) {
      html += '<tr class="section-hdr"><td colspan="5">Sponsorship</td></tr>';
      var sponsorTotal = 0;
      data.sponsors.forEach(function(s) { sponsorTotal += Number(s.amount_usd) || 0; });
      html += '<tr><td>Total Sponsorship Revenue</td>';
      html += '<td class="num">$' + Number(sponsorTotal).toLocaleString() + '</td>';
      html += '<td class="num"></td><td class="num"></td><td class="num"></td></tr>';
      html += '<tr><td>Number of Sponsors</td>';
      html += '<td class="num">' + data.sponsors.length + '</td>';
      html += '<td class="num"></td><td class="num"></td><td class="num"></td></tr>';
    }

    html += '</tbody></table>';

    // ── Charts: Historical ──────────────────────────
    if (charts.histAttendance) {
      html += '<h2>Historical Attendance</h2>';
      html += '<div class="chart-section"><img src="' + charts.histAttendance.src + '"></div>';
    }
    if (charts.histMeetings) {
      html += '<h2>Historical 1\u00D71 Meetings</h2>';
      html += '<div class="chart-section"><img src="' + charts.histMeetings.src + '"></div>';
    }
    if (charts.histFinancials) {
      html += '<div class="page-break"></div>';
      html += '<h2>Historical Revenue &amp; Expenses</h2>';
      html += '<div class="chart-section"><img src="' + charts.histFinancials.src + '"></div>';
    }

    // ── Charts: Attendee breakdown (pair) ───────────
    if (charts.attendeeClass || charts.attendeeCountry) {
      html += '<div class="chart-pair">';
      if (charts.attendeeClass) {
        html += '<div><h3>Attendees by Classification</h3><img src="' + charts.attendeeClass.src + '"></div>';
      }
      if (charts.attendeeCountry) {
        html += '<div><h3>Top Countries</h3><img src="' + charts.attendeeCountry.src + '"></div>';
      }
      html += '</div>';
    }

    // ── Charts: Market (pair) ───────────────────────
    if (charts.goldPrice || charts.silverPrice) {
      html += '<div class="chart-pair">';
      if (charts.goldPrice) {
        html += '<div><h3>Gold Price</h3><img src="' + charts.goldPrice.src + '"></div>';
      }
      if (charts.silverPrice) {
        html += '<div><h3>Silver Price</h3><img src="' + charts.silverPrice.src + '"></div>';
      }
      html += '</div>';
    }

    // ── Charts: Composition doughnuts ────────────────
    if (compCharts.length) {
      html += '<div class="page-break"></div>';
      html += '<h2>Member Composition \u2014 ' + evt.year + '</h2>';
      html += '<div class="comp-row">';
      compCharts.forEach(function(c) {
        html += '<div class="comp-cell"><h3>' + c.label + '</h3><img src="' + c.snap.src + '"></div>';
      });
      html += '</div>';
    }

    // ── Charts: Member History ───────────────────────
    if (charts.histMineral || charts.histStatus) {
      if (!compCharts.length) html += '<div class="page-break"></div>';
      if (charts.histMineral) {
        html += '<h2>Historical Mineral Composition</h2>';
        html += '<div class="chart-section"><img src="' + charts.histMineral.src + '"></div>';
      }
      if (charts.histStatus) {
        html += '<h2>Historical Status Composition</h2>';
        html += '<div class="chart-section"><img src="' + charts.histStatus.src + '"></div>';
      }
    }

    // ── Charts: Valuations ──────────────────────────
    if (charts.goldValuation) {
      html += '<h2>Gold Valuation</h2>';
      html += '<div class="chart-section"><img src="' + charts.goldValuation.src + '"></div>';
    }

    // ── Hotel Pickup ────────────────────────────────
    if (charts.hotel) {
      html += '<div class="page-break"></div>';
      html += '<h2>Hotel Room Pickup</h2>';
      html += '<div class="chart-section"><img src="' + charts.hotel.src + '"></div>';
    }

    // ── Member Tracking ──────────────────────────────
    if (data.members && data.members.length) {
      var statusOrder = ['Producer', 'Developer (construction/feasibility)', 'Developer (PEA/scoping)',
        'Explorer (advanced)', 'Explorer (early-stage)', 'Royalty / Streaming', 'Bullion Dealer'];
      var trackCols = ['new', 'repeating', 'returning', 'not_returning'];
      var trackLabels = { 'new': 'New', 'repeating': 'Repeating', 'returning': 'Returning', 'not_returning': 'Not Returning' };

      // Build counts grid
      var tGrid = {};
      statusOrder.forEach(function(s) { tGrid[s] = { new: 0, repeating: 0, returning: 0, not_returning: 0, total: 0 }; });
      var tTotals = { new: 0, repeating: 0, returning: 0, not_returning: 0, total: 0 };

      data.members.forEach(function(m) {
        var status = m.company_status || '';
        var track = m.tracking_status || '';
        if (!tGrid[status]) tGrid[status] = { new: 0, repeating: 0, returning: 0, not_returning: 0, total: 0 };
        if (tGrid[status][track] !== undefined) tGrid[status][track]++;
        if (track !== 'not_returning') tGrid[status].total++;
        if (tTotals[track] !== undefined) tTotals[track]++;
        if (track !== 'not_returning') tTotals.total++;
      });

      html += '<div class="page-break"></div>';
      html += '<h2>Member Tracking</h2>';
      html += '<table class="data-table"><thead><tr>';
      html += '<th>Company Status</th><th class="num">Total</th>';
      trackCols.forEach(function(t) { html += '<th class="num">' + trackLabels[t] + '</th>'; });
      html += '</tr></thead><tbody>';

      statusOrder.forEach(function(s) {
        var row = tGrid[s];
        if (!row || (!row.total && !row.not_returning)) return;
        html += '<tr><td>' + esc(s) + '</td>';
        html += '<td class="num" style="font-weight:600">' + row.total + '</td>';
        trackCols.forEach(function(t) {
          html += '<td class="num">' + (row[t] || 0) + '</td>';
        });
        html += '</tr>';
      });

      html += '</tbody><tfoot><tr>';
      html += '<td>Total</td>';
      html += '<td class="num">' + tTotals.total + '</td>';
      trackCols.forEach(function(t) {
        html += '<td class="num">' + tTotals[t] + '</td>';
      });
      html += '</tr></tfoot></table>';

      // Retention metrics
      var retentionRate = tTotals.total > 0 ? ((tTotals.repeating / (tTotals.total + tTotals.not_returning)) * 100).toFixed(1) : null;
      var newRate = tTotals.total > 0 ? ((tTotals['new'] / tTotals.total) * 100).toFixed(1) : null;
      var returnRate = tTotals.total > 0 ? ((tTotals.returning / tTotals.total) * 100).toFixed(1) : null;
      var churnRate = (tTotals.total + tTotals.not_returning) > 0 ? ((tTotals.not_returning / (tTotals.total + tTotals.not_returning)) * 100).toFixed(1) : null;

      html += '<div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-top:12px;">';
      if (retentionRate !== null) {
        html += '<div class="kpi-card" style="border-left-color:#27AE60;">';
        html += '<div class="kpi-label">Repeat Rate</div>';
        html += '<div class="kpi-value" style="font-size:16pt;">' + retentionRate + '%</div>';
        html += '<div style="font-size:7.5pt;color:#7F8C8D;">' + tTotals.repeating + ' of ' + (tTotals.total + tTotals.not_returning) + ' returning members</div>';
        html += '</div>';
      }
      if (newRate !== null) {
        html += '<div class="kpi-card" style="border-left-color:#2980B9;">';
        html += '<div class="kpi-label">New Members</div>';
        html += '<div class="kpi-value" style="font-size:16pt;">' + newRate + '%</div>';
        html += '<div style="font-size:7.5pt;color:#7F8C8D;">' + tTotals['new'] + ' first-time participants</div>';
        html += '</div>';
      }
      if (returnRate !== null) {
        html += '<div class="kpi-card" style="border-left-color:#8E44AD;">';
        html += '<div class="kpi-label">Win-Back Rate</div>';
        html += '<div class="kpi-value" style="font-size:16pt;">' + returnRate + '%</div>';
        html += '<div style="font-size:7.5pt;color:#7F8C8D;">' + tTotals.returning + ' returning after absence</div>';
        html += '</div>';
      }
      if (churnRate !== null) {
        html += '<div class="kpi-card" style="border-left-color:#C0392B;">';
        html += '<div class="kpi-label">Non-Return Rate</div>';
        html += '<div class="kpi-value" style="font-size:16pt;">' + churnRate + '%</div>';
        html += '<div style="font-size:7.5pt;color:#7F8C8D;">' + tTotals.not_returning + ' did not return</div>';
        html += '</div>';
      }
      html += '</div>';
    }

    // ── Engagement Metrics ──────────────────────────
    if (data.engagement && data.engagement.length) {
      html += '<div class="page-break"></div>';
      html += '<h2>Engagement Metrics</h2>';
      html += '<table class="data-table"><thead><tr>';
      html += '<th>Metric</th><th class="num">' + evt.year + '</th><th class="num">' + priorYear + '</th><th class="num">\u0394</th><th class="num">YoY %</th>';
      html += '</tr></thead><tbody>';

      data.engagement.forEach(function(r) {
        var eCur = Number(r.value_current)||0;
        var ePrior = Number(r.value_prior)||0;
        html += '<tr><td>' + esc(r.metric) + '</td>';
        html += '<td class="num">' + Number(eCur).toLocaleString() + '</td>';
        html += '<td class="num">' + Number(ePrior).toLocaleString() + '</td>';
        html += yoyCell(eCur, ePrior);
        html += '</tr>';
      });

      html += '</tbody></table>';
    }

    // ── SWOT Analysis ───────────────────────────────
    var hasSwot = swotCards.some(function(sc) { return (swotGrouped[sc.key] || []).length > 0; });
    if (hasSwot) {
      html += '<div class="page-break"></div>';
      html += '<h2>SWOT Analysis</h2>';
      html += '<div class="swot-grid">';
      swotCards.forEach(function(sc) {
        var items = swotGrouped[sc.key] || [];
        if (!items.length) return;
        html += '<div class="swot-card" style="background:' + sc.bg + ';border-left-color:' + sc.border + ';">';
        html += '<h4 style="color:' + sc.hdr + ';">' + sc.icon + ' ' + sc.label + '</h4>';
        html += '<ul>';
        items.forEach(function(t) {
          html += '<li style="color:' + sc.hdr + ';">' + esc(t) + '</li>';
        });
        html += '</ul></div>';
      });
      html += '</div>';
    }

    // ── Footer ──────────────────────────────────────
    var dashUrl = 'https://analytics.miningforum.com/psr/' + evt.event_code;
    html += '<div class="report-footer">';
    html += '<p>Full interactive report with detailed data tables available at:</p>';
    html += '<p><a href="' + dashUrl + '">' + dashUrl + '</a></p>';
    html += '</div>';

    html += '</body></html>';

    // ── Open in new window and trigger print ────────
    var win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
    } else {
      alert('Pop-up blocked. Please allow pop-ups for this site and try again.');
    }
  }

  // ── Boot ─────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
