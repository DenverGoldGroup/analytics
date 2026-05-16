// Admin Companies — Company Program Status page
// Shows All Companies table per event with Programmed Yes/No filter

var _acEvent = 'MFE26';
var _acData = {};        // event_code -> array of company objects
var _acSort = { col: 'market_cap_usd', dir: 'desc' };
var _acProgFilter = null; // null | 'yes' | 'no'
var _acPayFilter = null;  // null | 'paid' | 'unpaid'
var _acOctileMap = {};    // company_name -> octile number (1-8)
var _acFilters = { mineral: null, status: null, country: null, exchange: null, octile: null };

// ---- Helpers (not in supabase-client.js) ----
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---- Auth ----
function acGetToken() {
  return sessionStorage.getItem('admin_token') || '';
}

// ---- Init ----
function initAdminCompanies() {
  if (!acGetToken()) {
    window.location.href = '/admin';
    return;
  }

  // Tab handlers
  document.querySelectorAll('.event-tab').forEach(function(el) {
    el.addEventListener('click', function() {
      acSwitchEvent(el.getAttribute('data-event'));
    });
  });

  // Upload file change handler
  document.getElementById('ac-upload-file').addEventListener('change', function() {
    document.getElementById('ac-upload-btn').disabled = !this.files.length;
    document.getElementById('ac-upload-status').textContent = '';
  });

  // Start with MFE26
  acSwitchEvent('MFE26');
}

function acSwitchEvent(code) {
  _acEvent = code;
  _acProgFilter = null;
  _acPayFilter = null;
  _acFilters = { mineral: null, status: null, country: null, exchange: null, octile: null };
  _acSort = { col: 'market_cap_usd', dir: 'desc' };
  document.querySelectorAll('.event-tab').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-event') === code);
  });
  acLoadData();
}

// ---- Data loading ----
function acLoadData() {
  var container = document.getElementById('ac-content');
  container.innerHTML = '<div class="ac-loading"><div class="loading-spinner"></div><br>Loading companies&hellip;</div>';

  if (_acData[_acEvent]) {
    acRender(_acData[_acEvent]);
    return;
  }

  fetchEventParticipations(_acEvent).then(function(rows) {
    var companies = (rows || []).map(function(d) {
      return {
        company_name: d.company_name,
        company_status: d.company_status,
        primary_mineral: d.primary_mineral,
        primary_country: d.primary_country,
        primary_stock_exchange: d.primary_stock_exchange,
        ticker: d.ticker,
        stock_symbol: d.stock_symbol,
        market_cap_usd: d.market_cap_usd,
        production_low: d.production_low,
        production_high: d.production_high,
        reserves: d.reserves,
        resources: d.resources,
        profile_url: d.profile_url,
        presentation_date: d.presentation_date,
        programmed: d.presentation_date != null && d.presentation_date !== '',
        payment_status: d.payment_status || '',
        paid: (d.payment_status || '').toLowerCase() === 'paid'
      };
    });
    _acData[_acEvent] = companies;
    acRender(companies);
  });
}

// ---- Render ----
function acRender(companies) {
  var container = document.getElementById('ac-content');

  // Counts
  var progYes = companies.filter(function(c) { return c.programmed; }).length;
  var progNo = companies.filter(function(c) { return !c.programmed; }).length;

  var html = '';

  // Stats row
  html += acStatsRow(companies);

  // Mineral legend
  html += acMineralLegend(companies);

  // Status filter
  html += acStatusFilter(companies);

  // Country filter
  html += acCountryFilter(companies);

  // Exchange filter
  html += acExchangeFilter(companies);

  // Octile filter
  html += acOctileFilter(companies);

  // Programmed filter bar
  html += '<div class="prog-filter-bar" id="ac-prog-filter">';
  html += '<span class="prog-label">Programmed</span>';
  html += '<span class="prog-chip prog-yes' + (_acProgFilter === 'yes' ? ' active' : '') + '" data-prog="yes" onclick="acToggleProg(\'yes\')">Yes <span class="chip-count">' + progYes + '</span></span>';
  html += '<span class="prog-chip prog-no' + (_acProgFilter === 'no' ? ' active' : '') + '" data-prog="no" onclick="acToggleProg(\'no\')">No <span class="chip-count">' + progNo + '</span></span>';
  html += '<button class="prog-filter-reset' + (_acProgFilter ? ' visible' : '') + '" id="ac-prog-reset" onclick="acClearProg()">Clear</button>';
  html += '</div>';

  // Payment filter bar
  var payPaid = companies.filter(function(c) { return c.paid; }).length;
  var payUnpaid = companies.filter(function(c) { return !c.paid && c.payment_status !== ''; }).length;
  var payNone = companies.length - payPaid - payUnpaid;
  html += '<div class="prog-filter-bar" id="ac-pay-filter">';
  html += '<span class="prog-label">Payment</span>';
  html += '<span class="pay-chip pay-paid' + (_acPayFilter === 'paid' ? ' active' : '') + '" onclick="acTogglePay(\'paid\')">Paid <span class="chip-count">' + payPaid + '</span></span>';
  html += '<span class="pay-chip pay-unpaid' + (_acPayFilter === 'unpaid' ? ' active' : '') + '" onclick="acTogglePay(\'unpaid\')">Unpaid <span class="chip-count">' + payUnpaid + '</span></span>';
  if (payNone > 0) {
    html += '<span class="pay-chip pay-none' + (_acPayFilter === 'none' ? ' active' : '') + '" onclick="acTogglePay(\'none\')">No Data <span class="chip-count">' + payNone + '</span></span>';
  }
  html += '<button class="prog-filter-reset' + (_acPayFilter ? ' visible' : '') + '" id="ac-pay-reset" onclick="acClearPay()">Clear</button>';
  html += '</div>';

  // Table
  html += acBuildTable(companies);

  container.innerHTML = html;

  // Attach sort listeners
  acAttachSort();

  // Attach filter listeners
  acAttachFilterListeners();

  // Apply current filters
  acApplyAllFilters();
}

// ---- Stats row ----
function acStatsRow(companies) {
  var totalMcap = sumMcap(companies);
  var producers = companies.filter(function(c) { return c.company_status === 'Producer'; });
  var countries = {};
  var minerals = {};
  companies.forEach(function(c) {
    if (c.primary_country) countries[c.primary_country] = true;
    if (c.primary_mineral) minerals[c.primary_mineral] = true;
  });

  var html = '<div class="stats-row">';
  html += '<div class="stat-item"><span class="stat-label">Companies</span><span class="stat-value" style="color:var(--header-mid)">' + companies.length + '</span></div>';
  html += '<div class="stat-divider"></div>';
  html += '<div class="stat-item"><span class="stat-label">Market Cap</span><span class="stat-value" style="color:var(--header-mid)">' + formatMcap(totalMcap) + '</span></div>';
  html += '<div class="stat-divider"></div>';
  html += '<div class="stat-item"><span class="stat-label">Producers</span><span class="stat-value" style="color:#27AE60">' + producers.length + '</span></div>';
  html += '<div class="stat-divider"></div>';
  html += '<div class="stat-item"><span class="stat-label">Countries</span><span class="stat-value" style="color:#2980B9">' + Object.keys(countries).length + '</span></div>';
  html += '<div class="stat-divider"></div>';
  html += '<div class="stat-item"><span class="stat-label">Minerals</span><span class="stat-value" style="color:#8E44AD">' + Object.keys(minerals).length + '</span></div>';
  html += '</div>';
  return html;
}

// ---- Filter bars ----
function acMineralLegend(companies) {
  var groups = {};
  companies.forEach(function(c) {
    var mg = getMineralGroup(c.primary_mineral);
    if (!groups[mg.group]) groups[mg.group] = { color: mg.color, count: 0, mcap: 0 };
    groups[mg.group].count++;
    groups[mg.group].mcap += (c.market_cap_usd || 0);
  });

  var html = '<div class="legend-bar" id="ac-mineral-legend">';
  html += '<span class="legend-label">Minerals</span>';
  ['Gold', 'Silver', 'PGMs', 'Copper', 'Other'].forEach(function(g) {
    if (groups[g]) {
      html += '<span class="legend-pill" style="background:' + groups[g].color + '" data-mineral-filter="' + g + '">';
      html += g + ' <span class="pill-count">' + groups[g].count + ' &bull; ' + formatMcap(groups[g].mcap) + '</span>';
      html += '</span>';
    }
  });
  html += '<button class="filter-reset" id="ac-mineral-reset" onclick="acResetMineral()">Clear</button>';
  html += '</div>';
  return html;
}

function acStatusFilter(companies) {
  var byStatus = groupBy(companies, 'company_status');
  var html = '<div class="status-filter-bar" id="ac-status-filter">';
  html += '<span class="filter-label">Status</span>';
  STATUS_ORDER.forEach(function(s) {
    if (byStatus[s]) {
      var statusMcap = sumMcap(byStatus[s]);
      html += '<span class="status-chip" style="background:' + getStatusColor(s) + '" data-status-filter="' + escHtml(s) + '">';
      html += escHtml(acShortStatus(s)) + ' <span class="chip-count">' + byStatus[s].length + ' &bull; ' + formatMcap(statusMcap) + '</span>';
      html += '</span>';
    }
  });
  html += '<button class="filter-reset" id="ac-status-reset" onclick="acResetStatus()">Clear</button>';
  html += '</div>';
  return html;
}

function acCountryFilter(companies) {
  var byCountry = groupBy(companies, 'primary_country');
  var sorted = Object.entries(byCountry).sort(function(a, b) { return sumMcap(b[1]) - sumMcap(a[1]); });

  var html = '<div class="country-filter-bar" id="ac-country-filter">';
  html += '<span class="filter-label">Countries</span>';
  sorted.forEach(function(entry) {
    var country = entry[0];
    var count = entry[1].length;
    var mcap = sumMcap(entry[1]);
    var flag = getFlag(country);
    html += '<span class="country-pill" data-country-filter="' + escHtml(country) + '">';
    html += '<span class="country-flag">' + flag + '</span> ' + escHtml(country) + ' <span class="pill-count">' + count + ' &bull; ' + formatMcap(mcap) + '</span>';
    html += '</span>';
  });
  html += '<button class="filter-reset" id="ac-country-reset" onclick="acResetCountry()">Clear</button>';
  html += '</div>';
  return html;
}

function acExchangeFilter(companies) {
  var byExchange = {};
  companies.forEach(function(c) {
    var ex = acShortExchange(c.primary_stock_exchange);
    if (!ex) return;
    if (!byExchange[ex]) byExchange[ex] = { count: 0, mcap: 0 };
    byExchange[ex].count++;
    byExchange[ex].mcap += (c.market_cap_usd || 0);
  });
  var sorted = Object.entries(byExchange).sort(function(a, b) { return b[1].mcap - a[1].mcap; });

  var html = '<div class="exchange-filter-bar" id="ac-exchange-filter">';
  html += '<span class="filter-label">Exchange</span>';
  sorted.forEach(function(entry) {
    html += '<span class="exchange-pill" data-exchange-filter="' + escHtml(entry[0]) + '">';
    html += escHtml(entry[0]) + ' <span class="pill-count">' + entry[1].count + ' &bull; ' + formatMcap(entry[1].mcap) + '</span>';
    html += '</span>';
  });
  html += '<button class="filter-reset" id="ac-exchange-reset" onclick="acResetExchange()">Clear</button>';
  html += '</div>';
  return html;
}

// ---- Octile helpers ----
var OCTILE_COLORS = [
  '#1B2631', '#1A5276', '#117A65', '#1E8449',
  '#B7950B', '#CA6F1E', '#A93226', '#6C3483'
];

function acComputeOctiles(companies) {
  var withCap = companies.filter(function(c) { return c.market_cap_usd > 0; });
  var noCap = companies.filter(function(c) { return !c.market_cap_usd || c.market_cap_usd <= 0; });
  withCap.sort(function(a, b) { return (b.market_cap_usd || 0) - (a.market_cap_usd || 0); });

  var n = withCap.length;
  var size = Math.ceil(n / 8);
  var map = {};    // company_name -> octile (1-8)
  var octiles = []; // [{label, count, mcap, low, high}, ...]

  for (var o = 0; o < 8; o++) {
    var start = o * size;
    var end = Math.min(start + size, n);
    var slice = withCap.slice(start, end);
    if (slice.length === 0) continue;
    var totalMcap = 0;
    var hi = slice[0].market_cap_usd || 0;
    var lo = slice[slice.length - 1].market_cap_usd || 0;
    for (var si = 0; si < slice.length; si++) {
      map[slice[si].company_name] = o + 1;
      totalMcap += (slice[si].market_cap_usd || 0);
    }
    octiles.push({ num: o + 1, count: slice.length, mcap: totalMcap, high: hi, low: lo });
  }

  // Companies with no market cap go into the last octile
  for (var ni = 0; ni < noCap.length; ni++) {
    map[noCap[ni].company_name] = octiles.length;
    octiles[octiles.length - 1].count++;
  }

  return { map: map, octiles: octiles };
}

function acOctileFilter(companies) {
  var oc = acComputeOctiles(companies);
  _acOctileMap = oc.map;

  var html = '<div class="octile-filter-bar" id="ac-octile-filter">';
  html += '<span class="filter-label">Octiles</span>';
  oc.octiles.forEach(function(o) {
    var rangeLabel = formatMcap(o.low) + ' – ' + formatMcap(o.high);
    html += '<span class="octile-pill" style="background:' + OCTILE_COLORS[o.num - 1] + '" data-octile-filter="' + o.num + '">';
    html += 'O' + o.num + ' <span class="pill-count">' + o.count + ' &bull; ' + rangeLabel + '</span>';
    html += '</span>';
  });
  html += '<button class="filter-reset" id="ac-octile-reset" onclick="acResetOctile()">Clear</button>';
  html += '</div>';
  return html;
}

// ---- Table ----
function acBuildTable(companies) {
  var sorted = acSortCompanies(companies);

  var html = '<div class="section-title">All Companies</div>';
  html += '<div class="data-table-wrap"><table class="data-table" id="ac-table">';
  html += '<thead><tr>';

  var cols = [
    { key: 'rank', label: '#', sortable: false },
    { key: 'flag', label: '', sortable: false },
    { key: 'company_name', label: 'Company', sortable: true },
    { key: 'company_status', label: 'Status', sortable: true },
    { key: 'primary_mineral', label: 'Mineral', sortable: true },
    { key: 'primary_country', label: 'Country', sortable: true },
    { key: 'primary_stock_exchange', label: 'Exchange', sortable: true },
    { key: 'ticker', label: 'Ticker', sortable: true },
    { key: 'market_cap_usd', label: 'Market Cap', align: 'right', sortable: true },
    { key: 'production_mid', label: 'Prod (koz)', align: 'right', sortable: true },
    { key: 'reserves', label: 'Reserves', align: 'right', sortable: true },
    { key: 'resources', label: 'Resources', align: 'right', sortable: true },
    { key: 'programmed', label: 'Programmed', sortable: true },
    { key: 'paid', label: 'Paid', sortable: true }
  ];

  cols.forEach(function(col) {
    var cls = col.align === 'right' ? ' class="r"' : '';
    if (col.sortable) {
      var arrow = '';
      if (_acSort.col === col.key) {
        arrow = _acSort.dir === 'asc' ? ' ▲' : ' ▼';
      }
      html += '<th' + cls + ' data-sort-col="' + col.key + '" style="cursor:pointer">' + col.label + arrow + '</th>';
    } else {
      html += '<th' + cls + '>' + col.label + '</th>';
    }
  });
  html += '</tr></thead><tbody>';

  sorted.forEach(function(c, i) {
    var mg = getMineralGroup(c.primary_mineral);
    var flag = getFlag(c.primary_country);
    var safeUrl = (c.profile_url && /^https?:\/\//i.test(c.profile_url)) ? escHtml(c.profile_url) : '';
    var nameHtml = safeUrl
      ? '<a href="' + safeUrl + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">' + escHtml(c.company_name) + '</a>'
      : escHtml(c.company_name);
    var prodMid = ((c.production_low || 0) + (c.production_high || 0)) / 2;

    var octNum = _acOctileMap[c.company_name] || '';
    html += '<tr data-mineral="' + escHtml(mg.group) + '"' +
      ' data-status="' + escHtml(c.company_status || '') + '"' +
      ' data-country="' + escHtml(c.primary_country || '') + '"' +
      ' data-exchange="' + escHtml(acShortExchange(c.primary_stock_exchange)) + '"' +
      ' data-octile="' + octNum + '"' +
      ' data-programmed="' + (c.programmed ? 'yes' : 'no') + '"' +
      ' data-paid="' + (c.paid ? 'paid' : (c.payment_status ? 'unpaid' : 'none')) + '">';
    html += '<td>' + (i + 1) + '</td>';
    html += '<td>' + flag + '</td>';
    html += '<td class="company-name">' + nameHtml + '</td>';
    html += '<td><span class="mini-badge" style="background:' + getStatusColor(c.company_status) + '">' + escHtml(acShortStatus(c.company_status)) + '</span></td>';
    html += '<td><span class="mini-badge" style="background:' + mg.color + '">' + escHtml(mg.group) + '</span></td>';
    html += '<td>' + escHtml(c.primary_country || '') + '</td>';
    html += '<td>' + escHtml(acShortExchange(c.primary_stock_exchange) || '') + '</td>';
    html += '<td>' + escHtml(c.ticker || '') + '</td>';
    html += '<td class="numeric" style="font-weight:600">' + formatMcap(c.market_cap_usd) + '</td>';
    html += '<td class="numeric">' + (prodMid > 0 ? formatNum(Math.round(prodMid)) : '&mdash;') + '</td>';
    html += '<td class="numeric">' + (c.reserves ? c.reserves : '&mdash;') + '</td>';
    html += '<td class="numeric">' + (c.resources ? c.resources : '&mdash;') + '</td>';
    html += '<td><span class="prog-badge ' + (c.programmed ? 'prog-y' : 'prog-n') + '">' + (c.programmed ? 'Yes' : 'No') + '</span></td>';
    var payClass = c.paid ? 'pay-y' : (c.payment_status ? 'pay-n' : 'pay-empty');
    var payLabel = c.paid ? 'Paid' : (c.payment_status ? 'Unpaid' : '—');
    html += '<td><span class="prog-badge ' + payClass + '">' + payLabel + '</span></td>';
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

// ---- Sorting ----
function acSortCompanies(companies) {
  var col = _acSort.col;
  var dir = _acSort.dir;
  var mult = dir === 'asc' ? 1 : -1;

  return companies.slice().sort(function(a, b) {
    var va, vb;

    if (col === 'production_mid') {
      va = ((a.production_low || 0) + (a.production_high || 0)) / 2;
      vb = ((b.production_low || 0) + (b.production_high || 0)) / 2;
    } else if (col === 'programmed') {
      va = a.programmed ? 1 : 0;
      vb = b.programmed ? 1 : 0;
    } else if (col === 'paid') {
      va = a.paid ? 1 : 0;
      vb = b.paid ? 1 : 0;
    } else {
      va = a[col];
      vb = b[col];
    }

    if (va == null || va === '') va = dir === 'asc' ? Infinity : -Infinity;
    if (vb == null || vb === '') vb = dir === 'asc' ? Infinity : -Infinity;

    if (typeof va === 'string' && typeof vb === 'string') {
      return mult * va.localeCompare(vb, undefined, { sensitivity: 'base' });
    }
    if (typeof va === 'number' && typeof vb === 'number') {
      return mult * (va - vb);
    }
    return mult * String(va).localeCompare(String(vb));
  });
}

function acAttachSort() {
  document.querySelectorAll('#ac-table th[data-sort-col]').forEach(function(th) {
    th.addEventListener('click', function() {
      var col = th.getAttribute('data-sort-col');
      if (_acSort.col === col) {
        _acSort.dir = _acSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        _acSort.col = col;
        var numCols = ['market_cap_usd', 'production_mid', 'reserves', 'resources', 'programmed', 'paid'];
        _acSort.dir = numCols.indexOf(col) >= 0 ? 'desc' : 'asc';
      }
      acRender(_acData[_acEvent]);
    });
  });
}

// ---- Programmed filter ----
function acToggleProg(val) {
  _acProgFilter = _acProgFilter === val ? null : val;
  acUpdateProgUI();
  acApplyProgFilter();
}

function acClearProg() {
  _acProgFilter = null;
  acUpdateProgUI();
  acApplyProgFilter();
}

function acUpdateProgUI() {
  var yesChip = document.querySelector('.prog-chip.prog-yes');
  var noChip = document.querySelector('.prog-chip.prog-no');
  var resetBtn = document.getElementById('ac-prog-reset');
  if (yesChip) yesChip.classList.toggle('active', _acProgFilter === 'yes');
  if (noChip) noChip.classList.toggle('active', _acProgFilter === 'no');
  if (resetBtn) resetBtn.classList.toggle('visible', !!_acProgFilter);
}

function acApplyProgFilter() {
  document.querySelectorAll('#ac-table tbody tr[data-programmed]').forEach(function(row) {
    if (!_acProgFilter) {
      row.classList.remove('prog-dimmed');
    } else {
      var match = row.getAttribute('data-programmed') === _acProgFilter;
      row.classList.toggle('prog-dimmed', !match);
    }
  });
}

// ---- Payment filter ----
function acTogglePay(val) {
  _acPayFilter = _acPayFilter === val ? null : val;
  acUpdatePayUI();
  acApplyPayFilter();
}

function acClearPay() {
  _acPayFilter = null;
  acUpdatePayUI();
  acApplyPayFilter();
}

function acUpdatePayUI() {
  document.querySelectorAll('.pay-chip').forEach(function(chip) {
    var vals = { 'pay-paid': 'paid', 'pay-unpaid': 'unpaid', 'pay-none': 'none' };
    var v = null;
    Object.keys(vals).forEach(function(cls) { if (chip.classList.contains(cls)) v = vals[cls]; });
    chip.classList.toggle('active', _acPayFilter === v);
  });
  var resetBtn = document.getElementById('ac-pay-reset');
  if (resetBtn) resetBtn.classList.toggle('visible', !!_acPayFilter);
}

function acApplyPayFilter() {
  document.querySelectorAll('#ac-table tbody tr[data-paid]').forEach(function(row) {
    if (!_acPayFilter) {
      row.classList.remove('pay-dimmed');
    } else {
      var match = row.getAttribute('data-paid') === _acPayFilter;
      row.classList.toggle('pay-dimmed', !match);
    }
  });
}

// ---- Mineral/Status/Country/Exchange filters ----
function acAttachFilterListeners() {
  document.querySelectorAll('[data-mineral-filter]').forEach(function(pill) {
    pill.addEventListener('click', function() {
      var mineral = pill.getAttribute('data-mineral-filter');
      _acFilters.mineral = _acFilters.mineral === mineral ? null : mineral;
      acApplyAllFilters();
    });
  });

  document.querySelectorAll('[data-status-filter]').forEach(function(chip) {
    chip.addEventListener('click', function() {
      var status = chip.getAttribute('data-status-filter');
      _acFilters.status = _acFilters.status === status ? null : status;
      acApplyAllFilters();
    });
  });

  document.querySelectorAll('[data-country-filter]').forEach(function(pill) {
    pill.addEventListener('click', function() {
      var country = pill.getAttribute('data-country-filter');
      _acFilters.country = _acFilters.country === country ? null : country;
      acApplyAllFilters();
    });
  });

  document.querySelectorAll('[data-exchange-filter]').forEach(function(pill) {
    pill.addEventListener('click', function() {
      var exchange = pill.getAttribute('data-exchange-filter');
      _acFilters.exchange = _acFilters.exchange === exchange ? null : exchange;
      acApplyAllFilters();
    });
  });

  document.querySelectorAll('[data-octile-filter]').forEach(function(pill) {
    pill.addEventListener('click', function() {
      var octile = pill.getAttribute('data-octile-filter');
      _acFilters.octile = _acFilters.octile === octile ? null : octile;
      acApplyAllFilters();
    });
  });
}

function acApplyAllFilters() {
  // Update pill/chip visuals
  document.querySelectorAll('[data-mineral-filter]').forEach(function(pill) {
    var m = pill.getAttribute('data-mineral-filter');
    if (!_acFilters.mineral) { pill.classList.remove('active', 'dimmed'); }
    else if (_acFilters.mineral === m) { pill.classList.add('active'); pill.classList.remove('dimmed'); }
    else { pill.classList.remove('active'); pill.classList.add('dimmed'); }
  });

  document.querySelectorAll('[data-status-filter]').forEach(function(chip) {
    var s = chip.getAttribute('data-status-filter');
    if (!_acFilters.status) { chip.classList.remove('active', 'dimmed'); }
    else if (_acFilters.status === s) { chip.classList.add('active'); chip.classList.remove('dimmed'); }
    else { chip.classList.remove('active'); chip.classList.add('dimmed'); }
  });

  document.querySelectorAll('[data-country-filter]').forEach(function(pill) {
    var c = pill.getAttribute('data-country-filter');
    if (!_acFilters.country) { pill.classList.remove('active'); }
    else if (_acFilters.country === c) { pill.classList.add('active'); }
    else { pill.classList.remove('active'); }
  });

  document.querySelectorAll('[data-exchange-filter]').forEach(function(pill) {
    var e = pill.getAttribute('data-exchange-filter');
    if (!_acFilters.exchange) { pill.classList.remove('active'); }
    else if (_acFilters.exchange === e) { pill.classList.add('active'); }
    else { pill.classList.remove('active'); }
  });

  document.querySelectorAll('[data-octile-filter]').forEach(function(pill) {
    var o = pill.getAttribute('data-octile-filter');
    if (!_acFilters.octile) { pill.classList.remove('active', 'dimmed'); }
    else if (_acFilters.octile === o) { pill.classList.add('active'); pill.classList.remove('dimmed'); }
    else { pill.classList.remove('active'); pill.classList.add('dimmed'); }
  });

  // Show/hide reset buttons
  var mineralReset = document.getElementById('ac-mineral-reset');
  if (mineralReset) mineralReset.classList.toggle('visible', !!_acFilters.mineral);
  var statusReset = document.getElementById('ac-status-reset');
  if (statusReset) statusReset.classList.toggle('visible', !!_acFilters.status);
  var countryReset = document.getElementById('ac-country-reset');
  if (countryReset) countryReset.classList.toggle('visible', !!_acFilters.country);
  var exchangeReset = document.getElementById('ac-exchange-reset');
  if (exchangeReset) exchangeReset.classList.toggle('visible', !!_acFilters.exchange);
  var octileReset = document.getElementById('ac-octile-reset');
  if (octileReset) octileReset.classList.toggle('visible', !!_acFilters.octile);

  // Filter table rows (mineral/status/country/exchange via display, prog via dimming)
  document.querySelectorAll('#ac-table tbody tr[data-mineral]').forEach(function(row) {
    var show = true;
    if (_acFilters.mineral && row.getAttribute('data-mineral') !== _acFilters.mineral) show = false;
    if (_acFilters.status && row.getAttribute('data-status') !== _acFilters.status) show = false;
    if (_acFilters.country && row.getAttribute('data-country') !== _acFilters.country) show = false;
    if (_acFilters.exchange && row.getAttribute('data-exchange') !== _acFilters.exchange) show = false;
    if (_acFilters.octile && row.getAttribute('data-octile') !== _acFilters.octile) show = false;
    row.style.display = show ? '' : 'none';
  });

  // Also apply prog and pay filters (dimming pattern)
  acApplyProgFilter();
  acApplyPayFilter();
}

function acResetMineral() { _acFilters.mineral = null; acApplyAllFilters(); }
function acResetStatus() { _acFilters.status = null; acApplyAllFilters(); }
function acResetCountry() { _acFilters.country = null; acApplyAllFilters(); }
function acResetExchange() { _acFilters.exchange = null; acApplyAllFilters(); }
function acResetOctile() { _acFilters.octile = null; acApplyAllFilters(); }

// ---- Helpers (mirror public site) ----
function acShortStatus(s) {
  var map = {
    'Producer': 'Producer',
    'Royalty/Streaming': 'Royalty',
    'Royalty / Streaming': 'Royalty',
    'Developer (construction/feasibility)': 'Dev (C/F)',
    'Developer (PEA/scoping)': 'Dev (PEA)',
    'Explorer (advanced)': 'Exp (Adv)',
    'Explorer (early-stage)': 'Exp (Early)',
    'Bullion Dealer': 'Bullion'
  };
  return map[s] || s;
}

function acShortExchange(ex) {
  if (!ex) return '';
  var map = {
    'Toronto Stock Exchange (TSX)': 'TSX',
    'Toronto Venture Exchange (TSXv)': 'TSXv',
    'Australian Stock Exchange (ASX)': 'ASX',
    'New York Stock Exchange (NYSE)': 'NYSE',
    'London Stock Exchange (LSE)': 'LSE',
    'Johannesburg Stock Exchange (JSX)': 'JSX',
    'Shanghai Stock Exchange': 'Shanghai',
    'Canadian Securities Exchange': 'CSE',
    'NYSE Mkt (Amex)': 'AMEX',
    'NYSE Arca': 'NYSE Arca',
    'NYSE-Arca': 'NYSE Arca'
  };
  return map[ex] || ex;
}

// ---- Upload ----
function acUploadProgram() {
  var fileInput = document.getElementById('ac-upload-file');
  var btn = document.getElementById('ac-upload-btn');
  var statusEl = document.getElementById('ac-upload-status');
  var msgEl = document.getElementById('ac-message');

  if (!fileInput.files || !fileInput.files.length) return;

  var file = fileInput.files[0];
  statusEl.textContent = 'Reading file…';
  btn.disabled = true;

  var reader = new FileReader();
  reader.onerror = function() {
    statusEl.textContent = '';
    msgEl.className = 'ac-message error';
    msgEl.textContent = 'Failed to read file.';
    btn.disabled = false;
  };
  reader.onload = function(e) {
    var jsonData;
    try {
      jsonData = JSON.parse(e.target.result);
    } catch (err) {
      statusEl.textContent = '';
      msgEl.className = 'ac-message error';
      msgEl.textContent = 'Invalid JSON: ' + err.message;
      btn.disabled = false;
      return;
    }

    if (!Array.isArray(jsonData) || jsonData.length === 0) {
      statusEl.textContent = '';
      msgEl.className = 'ac-message error';
      msgEl.textContent = 'JSON must be a non-empty array of objects.';
      btn.disabled = false;
      return;
    }

    statusEl.textContent = 'Uploading ' + jsonData.length + ' records…';

    var token = acGetToken();
    fetch('/api/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ action: 'update-program', event_code: _acEvent, companies: jsonData })
    })
    .then(function(resp) { return resp.json(); })
    .then(function(result) {
      statusEl.textContent = '';
      fileInput.value = '';
      btn.disabled = true;

      if (result.ok) {
        var msg = result.message || ('Updated ' + (result.updated || 0) + ' companies.');
        if (result.skipped > 0) {
          msg += ' Skipped: ' + result.skipped + '.';
        }
        msgEl.className = 'ac-message success';
        msgEl.textContent = msg;

        if (result.errors && result.errors.length > 0) {
          msgEl.className = 'ac-message info';
          msgEl.innerHTML = escHtml(msg) + '<br><br><strong>Warnings:</strong><br>' +
            result.errors.map(function(e) { return '• ' + escHtml(e); }).join('<br>');
        }

        // Clear cached data and reload
        delete _acData[_acEvent];
        acLoadData();
      } else {
        msgEl.className = 'ac-message error';
        msgEl.textContent = result.error || 'Upload failed.';
      }
    })
    .catch(function(err) {
      statusEl.textContent = '';
      btn.disabled = false;
      msgEl.className = 'ac-message error';
      msgEl.textContent = 'Network error: ' + err.message;
    });
  };
  reader.readAsText(file);
}

// ---- Boot ----
document.addEventListener('DOMContentLoaded', initAdminCompanies);
