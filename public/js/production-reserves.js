// All Companies — sortable table view

var _allCoSort = { col: 'market_cap_usd', dir: 'desc' };

// Normalize company name for fuzzy matching
function normCompany(name) {
  return (name || '').toLowerCase().trim()
    .replace(/\b(corp\.?|inc\.?|ltd\.?|limited|plc|s\.a\.?|pty|n\.v\.?)\b/g, '')
    .replace(/\band\b/g, ' ')
    .replace(/[.,&+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderAllCompanies(companies, cfg, attendees) {
  // Build C-Suite and Senior Mgmt lookups: normalized company name -> count
  var csuiteLookup = {};
  var srMgmtLookup = {};
  if (attendees && attendees.length) {
    attendees.forEach(function(a) {
      var key = normCompany(a.company);
      if (!key) return;
      if (isCsuite(a.job_title)) {
        csuiteLookup[key] = (csuiteLookup[key] || 0) + 1;
      } else if (isSeniorMgmt(a.job_title)) {
        srMgmtLookup[key] = (srMgmtLookup[key] || 0) + 1;
      }
    });
  }
  var hasCsuite = Object.keys(csuiteLookup).length > 0;
  var hasSrMgmt = Object.keys(srMgmtLookup).length > 0;
  var csuiteLookupKeys = Object.keys(csuiteLookup);
  var srMgmtLookupKeys = Object.keys(srMgmtLookup);

  var html = statsRow(companies, cfg.keyColor);
  html += mineralLegendInteractive(companies);
  html += statusFilterInteractive(companies);
  html += countryFilterInteractive(companies);
  html += exchangeFilterInteractive(companies);

  html += '<div class="section-title">All Companies</div>';
  html += '<div class="data-table-wrap"><table class="data-table" id="all-companies-table">';
  html += '<thead><tr>';

  var cols = [
    { key: 'rank',               label: '#',           align: 'left',  sortable: false },
    { key: 'flag',               label: '',            align: 'left',  sortable: false },
    { key: 'company_name',       label: 'Company',     align: 'left',  sortable: true },
    hasCsuite ? { key: 'csuite', label: 'C-Suite Reps', align: 'center', sortable: true } : null,
    hasSrMgmt ? { key: 'srmgmt', label: 'Senior Mgmt', align: 'center', sortable: true } : null,
    { key: 'company_status',     label: 'Status',      align: 'left',  sortable: true },
    { key: 'primary_mineral',    label: 'Mineral',     align: 'left',  sortable: true },
    { key: 'primary_country',    label: 'Country',     align: 'left',  sortable: true },
    { key: 'primary_stock_exchange', label: 'Exchange', align: 'left', sortable: true },
    { key: 'ticker',             label: 'Ticker',      align: 'left',  sortable: true },
    { key: 'market_cap_usd',     label: 'Market Cap',  align: 'right', sortable: true },
    { key: 'production_mid',     label: 'Prod (koz)',   align: 'right', sortable: true },
    { key: 'reserves',           label: 'Reserves',    align: 'right', sortable: true },
    { key: 'resources',          label: 'Resources',   align: 'right', sortable: true }
  ].filter(Boolean);

  cols.forEach(function(col) {
    var cls = col.align === 'right' ? ' class="r"' : '';
    if (col.sortable) {
      var arrow = '';
      if (_allCoSort.col === col.key) {
        arrow = _allCoSort.dir === 'asc' ? ' ▲' : ' ▼';
      }
      html += '<th' + cls + ' data-sort-col="' + col.key + '" style="cursor:pointer">' + col.label + arrow + '</th>';
    } else {
      html += '<th' + cls + '>' + col.label + '</th>';
    }
  });
  html += '</tr></thead><tbody>';

  var sorted = sortAllCompanies(companies);

  sorted.forEach(function(c, i) {
    var mg = getMineralGroup(c.primary_mineral);
    var flag = getFlag(c.primary_country);
    var safeUrl = safeHref(c.profile_url);
    var profileLink = safeUrl
      ? '<a href="' + safeUrl + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">' + escHtml(c.company_name) + '</a>'
      : escHtml(c.company_name);
    var prodMid = ((c.production_low || 0) + (c.production_high || 0)) / 2;

    html += '<tr data-mineral="' + escHtml(mg.group) + '"' +
      ' data-status="' + escHtml(c.company_status || '') + '"' +
      ' data-country="' + escHtml(c.primary_country || '') + '"' +
      ' data-exchange="' + escHtml(shortExchange(c.primary_stock_exchange)) + '">';
    html += '<td>' + (i + 1) + '</td>';
    html += '<td>' + flag + '</td>';
    html += '<td class="company-name">' + profileLink + '</td>';
    if (hasCsuite) {
      var normName = normCompany(c.company_name);
      var csuiteCount = csuiteLookup[normName] || 0;
      // Fuzzy fallback 1: check if either name starts with the other
      if (csuiteCount === 0) {
        for (var k = 0; k < csuiteLookupKeys.length; k++) {
          var lk = csuiteLookupKeys[k];
          if (normName.indexOf(lk) === 0 || lk.indexOf(normName) === 0) {
            csuiteCount = csuiteLookup[lk];
            break;
          }
        }
      }
      // Fuzzy fallback 2: match on first word if unique
      if (csuiteCount === 0) {
        var fw = normName.split(' ')[0];
        var fwMatches = csuiteLookupKeys.filter(function(lk) { return lk.split(' ')[0] === fw; });
        if (fwMatches.length === 1) {
          csuiteCount = csuiteLookup[fwMatches[0]];
        }
      }
      var dots = '';
      for (var d = 0; d < csuiteCount; d++) {
        dots += '<span class="csuite-dot" title="C-Suite attendee"></span>';
      }
      html += '<td style="text-align:center;white-space:nowrap">' + (csuiteCount > 0 ? dots : '&mdash;') + '</td>';
    }
    if (hasSrMgmt) {
      var normName2 = hasCsuite ? normName : normCompany(c.company_name);
      var smCount = srMgmtLookup[normName2] || 0;
      if (smCount === 0) {
        for (var k2 = 0; k2 < srMgmtLookupKeys.length; k2++) {
          var lk2 = srMgmtLookupKeys[k2];
          if (normName2.indexOf(lk2) === 0 || lk2.indexOf(normName2) === 0) {
            smCount = srMgmtLookup[lk2];
            break;
          }
        }
      }
      if (smCount === 0) {
        var fw2 = normName2.split(' ')[0];
        var fwm2 = srMgmtLookupKeys.filter(function(lk) { return lk.split(' ')[0] === fw2; });
        if (fwm2.length === 1) smCount = srMgmtLookup[fwm2[0]];
      }
      var smDots = '';
      for (var d2 = 0; d2 < smCount; d2++) {
        smDots += '<span class="csuite-dot" title="Senior Mgmt" style="background:#2980B9"></span>';
      }
      html += '<td style="text-align:center;white-space:nowrap">' + (smCount > 0 ? smDots : '&mdash;') + '</td>';
    }
    html += '<td><span class="mini-badge" style="background:' + getStatusColor(c.company_status) + '">' + escHtml(shortStatus(c.company_status)) + '</span></td>';
    html += '<td><span class="mini-badge" style="background:' + mg.color + '">' + escHtml(mg.group) + '</span></td>';
    html += '<td>' + escHtml(c.primary_country || '') + '</td>';
    html += '<td>' + escHtml(shortExchange(c.primary_stock_exchange) || '') + '</td>';
    html += '<td>' + escHtml(c.ticker || '') + '</td>';
    html += '<td class="numeric" style="font-weight:600">' + formatMcap(c.market_cap_usd) + '</td>';
    html += '<td class="numeric">' + (prodMid > 0 ? formatNum(Math.round(prodMid)) : '&mdash;') + '</td>';
    html += '<td class="numeric">' + (c.reserves ? c.reserves : '&mdash;') + '</td>';
    html += '<td class="numeric">' + (c.resources ? c.resources : '&mdash;') + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  html += renderDisclaimer();
  return html;
}

function sortAllCompanies(companies) {
  var col = _allCoSort.col;
  var dir = _allCoSort.dir;
  var mult = dir === 'asc' ? 1 : -1;

  return companies.slice().sort(function(a, b) {
    var va, vb;

    if (col === 'production_mid') {
      va = ((a.production_low || 0) + (a.production_high || 0)) / 2;
      vb = ((b.production_low || 0) + (b.production_high || 0)) / 2;
    } else {
      va = a[col];
      vb = b[col];
    }

    // Handle nulls — push to bottom regardless of direction
    if (va == null || va === '') va = dir === 'asc' ? Infinity : -Infinity;
    if (vb == null || vb === '') vb = dir === 'asc' ? Infinity : -Infinity;

    // String vs number
    if (typeof va === 'string' && typeof vb === 'string') {
      return mult * va.localeCompare(vb, undefined, { sensitivity: 'base' });
    }
    if (typeof va === 'number' && typeof vb === 'number') {
      return mult * (va - vb);
    }
    // Mixed — convert to string
    return mult * String(va).localeCompare(String(vb));
  });
}

// Attach sort click handlers — called after render from app.js
function attachAllCompaniesSort() {
  document.querySelectorAll('#all-companies-table th[data-sort-col]').forEach(function(th) {
    th.addEventListener('click', function() {
      var col = th.getAttribute('data-sort-col');
      if (_allCoSort.col === col) {
        _allCoSort.dir = _allCoSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        _allCoSort.col = col;
        // Default direction: desc for numeric columns, asc for text
        var numCols = ['market_cap_usd', 'production_mid', 'reserves', 'resources'];
        _allCoSort.dir = numCols.indexOf(col) >= 0 ? 'desc' : 'asc';
      }
      // Re-render the view
      if (typeof _reRenderCurrentView === 'function') {
        _reRenderCurrentView();
      }
    });
  });
}
