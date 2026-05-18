// Solitaire card layout rendering with interactive filters

// ---- Company Card ----
function companyCard(c, rank) {
  var mg = getMineralGroup(c.primary_mineral);
  var flag = getFlag(c.primary_country);
  var mcap = formatMcap(c.market_cap_usd);
  var safeUrl = safeHref(c.profile_url);
  var profileLink = safeUrl
    ? '<a href="' + safeUrl + '" target="_blank" rel="noopener">' + escHtml(c.company_name) + '</a>'
    : escHtml(c.company_name);

  // Tooltip data
  var tooltip = escHtml(c.company_name) + ' | ' + escHtml(c.company_status || '') +
    ' | ' + escHtml(c.primary_mineral || '') + ' | ' + escHtml(c.primary_country || '') +
    ' | MCap: ' + mcap;
  if (c.ticker) tooltip += ' | ' + escHtml(c.ticker);

  return '<div class="company-card" style="border-left-color:' + mg.color + '"' +
    ' data-mineral="' + escHtml(mg.group) + '"' +
    ' data-status="' + escHtml(c.company_status || '') + '"' +
    ' data-country="' + escHtml(c.primary_country || '') + '"' +
    ' data-exchange="' + escHtml(shortExchange(c.primary_stock_exchange)) + '"' +
    ' data-tooltip="' + tooltip + '">' +
    '<span class="rank">' + rank + '</span>' +
    '<span class="flag">' + flag + '</span>' +
    '<span class="name">' + profileLink + '</span>' +
    '<span class="mcap">' + mcap + '</span>' +
    '</div>';
}

// Escape HTML
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Sanitize URL for href — only allow http/https to prevent javascript: XSS
function safeHref(url) {
  if (!url || typeof url !== 'string') return '';
  var trimmed = url.trim().toLowerCase();
  if (trimmed.indexOf('https://') === 0 || trimmed.indexOf('http://') === 0) return escHtml(url.trim());
  return '';
}

// ---- Build Column ----
function buildColumn(title, companies, bgColor) {
  var totalMcap = sumMcap(companies);
  var html = '<div class="col">';
  html += '<div class="col-header" style="background:' + bgColor + '">';
  html += '<span>' + escHtml(title) + '</span>';
  html += '<span class="count">' + companies.length + ' &bull; ' + formatMcap(totalMcap) + '</span>';
  html += '</div>';
  html += '<div class="card-stack">';
  companies.forEach(function(c, i) { html += companyCard(c, i + 1); });
  html += '</div></div>';
  return html;
}

// ---- Interactive Mineral Legend ----
function mineralLegendInteractive(companies) {
  var groups = {};
  companies.forEach(function(c) {
    var mg = getMineralGroup(c.primary_mineral);
    if (!groups[mg.group]) groups[mg.group] = { color: mg.color, count: 0, mcap: 0 };
    groups[mg.group].count++;
    groups[mg.group].mcap += (c.market_cap_usd || 0);
  });

  var html = '<div class="legend-bar" id="mineral-legend">';
  html += '<span class="legend-label">Minerals</span>';
  ['Gold', 'Silver', 'PGMs', 'Copper', 'Other'].forEach(function(g) {
    if (groups[g]) {
      var spot = getSpotPrice(g);
      var spotHtml = '';
      if (spot && spot.price) {
        var changeClass = spot.change >= 0 ? 'spot-up' : 'spot-down';
        var arrow = spot.change >= 0 ? '&#9650;' : '&#9660;';
        spotHtml = ' <span class="pill-spot" data-spot-group="' + g + '">' +
          formatSpotPrice(spot.price) +
          (spot.change_percent != null ? ' <span class="' + changeClass + '">' + arrow + ' ' + Math.abs(spot.change_percent).toFixed(2) + '%</span>' : '') +
          '</span>';
      } else {
        spotHtml = ' <span class="pill-spot" data-spot-group="' + g + '"></span>';
      }
      html += '<span class="legend-pill" style="background:' + groups[g].color + '" data-mineral-filter="' + g + '">';
      html += g + spotHtml + ' <span class="pill-count">' + groups[g].count + ' &bull; ' + formatMcap(groups[g].mcap) + '</span>';
      html += '</span>';
    }
  });
  html += '<button class="filter-reset" id="mineral-reset" onclick="resetMineralFilter()">Clear</button>';
  html += '</div>';
  return html;
}

// ---- Interactive Status Filter ----
function statusFilterInteractive(companies) {
  var byStatus = groupBy(companies, 'company_status');
  var html = '<div class="status-filter-bar" id="status-filter">';
  html += '<span class="filter-label">Status</span>';
  STATUS_ORDER.forEach(function(s) {
    if (byStatus[s]) {
      var statusMcap = sumMcap(byStatus[s]);
      html += '<span class="status-chip" style="background:' + getStatusColor(s) + '" data-status-filter="' + escHtml(s) + '">';
      html += escHtml(shortStatus(s)) + ' <span class="chip-count">' + byStatus[s].length + ' &bull; ' + formatMcap(statusMcap) + '</span>';
      html += '</span>';
    }
  });
  html += '<button class="filter-reset" id="status-reset" onclick="resetStatusFilter()">Clear</button>';
  html += '</div>';
  return html;
}

// ---- Interactive Country Filter ----
function countryFilterInteractive(companies) {
  var byCountry = groupBy(companies, 'primary_country');
  var sorted = Object.entries(byCountry).sort(function(a,b) { return sumMcap(b[1]) - sumMcap(a[1]); });

  var html = '<div class="country-filter-bar" id="country-filter">';
  html += '<span class="filter-label">Countries</span>';
  sorted.forEach(function(entry) {
    var country = entry[0];
    var countryCompanies = entry[1];
    var count = countryCompanies.length;
    var mcap = sumMcap(countryCompanies);
    var flag = getFlag(country);
    html += '<span class="country-pill" data-country-filter="' + escHtml(country) + '">';
    html += '<span class="country-flag">' + flag + '</span> ' + escHtml(country) + ' <span class="pill-count">' + count + ' &bull; ' + formatMcap(mcap) + '</span>';
    html += '</span>';
  });
  html += '<button class="filter-reset" id="country-reset" onclick="resetCountryFilter()">Clear</button>';
  html += '</div>';
  return html;
}

// ---- Stats Summary Row ----
function statsRow(companies, keyColor) {
  var totalMcap = sumMcap(companies);
  var producers = companies.filter(function(c) { return c.company_status === 'Producer'; });
  var countries = new Set(companies.map(function(c) { return c.primary_country; }).filter(Boolean));
  var minerals = new Set(companies.map(function(c) { return c.primary_mineral; }).filter(Boolean));

  var html = '<div class="stats-row">';
  html += statItem('Companies', companies.length, keyColor);
  html += '<div class="stat-divider"></div>';
  html += statItem('Market Cap', formatMcap(totalMcap), keyColor);
  html += '<div class="stat-divider"></div>';
  html += statItem('Producers', producers.length, '#27AE60');
  html += '<div class="stat-divider"></div>';
  html += statItem('Countries', countries.size, '#2980B9');
  html += '<div class="stat-divider"></div>';
  html += statItem('Minerals', minerals.size, '#8E44AD');
  html += '</div>';
  return html;
}

function statItem(label, value, color) {
  return '<div class="stat-item"><span class="stat-label">' + label +
    '</span><span class="stat-value" style="color:' + color + '">' + value + '</span></div>';
}

// Short status label
function shortStatus(s) {
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

// Short exchange label
function shortExchange(ex) {
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

// ---- Interactive Exchange Filter ----
function exchangeFilterInteractive(companies) {
  var byExchange = {};
  companies.forEach(function(c) {
    var ex = shortExchange(c.primary_stock_exchange);
    if (!ex) return;
    if (!byExchange[ex]) byExchange[ex] = { count: 0, mcap: 0 };
    byExchange[ex].count++;
    byExchange[ex].mcap += (c.market_cap_usd || 0);
  });
  var sorted = Object.entries(byExchange).sort(function(a, b) { return b[1].mcap - a[1].mcap; });

  var html = '<div class="exchange-filter-bar" id="exchange-filter">';
  html += '<span class="filter-label">Exchange</span>';
  sorted.forEach(function(entry) {
    html += '<span class="exchange-pill" data-exchange-filter="' + escHtml(entry[0]) + '">';
    html += escHtml(entry[0]) + ' <span class="pill-count">' + entry[1].count + ' &bull; ' + formatMcap(entry[1].mcap) + '</span>';
    html += '</span>';
  });
  html += '<button class="filter-reset" id="exchange-reset" onclick="resetExchangeFilter()">Clear</button>';
  html += '</div>';
  return html;
}

// ---- Non-interactive legends (for static display) ----
function mineralLegend(companies) {
  return mineralLegendInteractive(companies);
}

function statusLegend(companies) {
  return statusFilterInteractive(companies);
}

// ---- Solitaire by Mineral (mineral → status columns) ----
function renderSolitaireByMineral(companies, cfg) {
  var html = statsRow(companies, cfg.keyColor);
  html += mineralLegendInteractive(companies);
  html += statusFilterInteractive(companies);
  html += countryFilterInteractive(companies);
  html += exchangeFilterInteractive(companies);

  var byMineral = {};
  companies.forEach(function(c) {
    var mg = getMineralGroup(c.primary_mineral);
    if (!byMineral[mg.group]) byMineral[mg.group] = { color: mg.color, companies: [] };
    byMineral[mg.group].companies.push(c);
  });

  var sortedMinerals = Object.entries(byMineral)
    .sort(function(a, b) { return sumMcap(b[1].companies) - sumMcap(a[1].companies); });

  html += '<div class="solitaire-container">';

  sortedMinerals.forEach(function(entry) {
    var mineral = entry[0];
    var data = entry[1];
    var totalMcap = sumMcap(data.companies);
    html += '<div class="solitaire-group" data-mineral-group="' + mineral + '">';
    html += '<h3><span class="badge" style="background:' + data.color + '">' + mineral + '</span>';
    html += ' <span class="group-stats">' + data.companies.length + ' companies &bull; ' + formatMcap(totalMcap) + '</span></h3>';

    var byStatus = groupBy(data.companies, 'company_status');
    html += '<div class="lane">';

    STATUS_ORDER.forEach(function(s) {
      if (byStatus[s] && byStatus[s].length > 0) {
        var sorted = byStatus[s].sort(function(a, b) { return (b.market_cap_usd || 0) - (a.market_cap_usd || 0); });
        html += buildColumn(shortStatus(s), sorted, getStatusColor(s));
      }
    });

    html += '</div></div>';
  });

  html += '</div>';
  html += renderDisclaimer();
  return html;
}

// ---- Solitaire by Status (status → mineral columns) ----
function renderSolitaireByStatus(companies, cfg) {
  var html = statsRow(companies, cfg.keyColor);
  html += mineralLegendInteractive(companies);
  html += statusFilterInteractive(companies);
  html += countryFilterInteractive(companies);
  html += exchangeFilterInteractive(companies);

  var byStatus = groupBy(companies, 'company_status');

  html += '<div class="solitaire-container">';

  STATUS_ORDER.forEach(function(status) {
    if (!byStatus[status] || byStatus[status].length === 0) return;

    var statusCompanies = byStatus[status];
    var totalMcap = sumMcap(statusCompanies);
    html += '<div class="solitaire-group" data-status-group="' + escHtml(status) + '">';
    html += '<h3><span class="badge" style="background:' + getStatusColor(status) + '">' + escHtml(status) + '</span>';
    html += ' <span class="group-stats">' + statusCompanies.length + ' companies &bull; ' + formatMcap(totalMcap) + '</span></h3>';

    var byMineral = {};
    statusCompanies.forEach(function(c) {
      var mg = getMineralGroup(c.primary_mineral);
      if (!byMineral[mg.group]) byMineral[mg.group] = { color: mg.color, companies: [] };
      byMineral[mg.group].companies.push(c);
    });

    html += '<div class="lane">';
    var sortedMinerals = Object.entries(byMineral)
      .sort(function(a, b) { return sumMcap(b[1].companies) - sumMcap(a[1].companies); });

    sortedMinerals.forEach(function(entry) {
      var mineral = entry[0];
      var data = entry[1];
      var sorted = data.companies.sort(function(a, b) { return (b.market_cap_usd || 0) - (a.market_cap_usd || 0); });
      html += buildColumn(mineral, sorted, data.color);
    });

    html += '</div></div>';
  });

  html += '</div>';
  html += renderDisclaimer();
  return html;
}

// ---- Solitaire by Country (country → mineral columns) ----
function renderSolitaireByCountry(companies, cfg) {
  var html = statsRow(companies, cfg.keyColor);
  html += mineralLegendInteractive(companies);
  html += statusFilterInteractive(companies);
  html += countryFilterInteractive(companies);
  html += exchangeFilterInteractive(companies);

  var byCountry = groupBy(companies, 'primary_country');
  var sortedCountries = Object.entries(byCountry)
    .sort(function(a, b) { return sumMcap(b[1]) - sumMcap(a[1]); });

  html += '<div class="solitaire-container">';

  sortedCountries.forEach(function(entry) {
    var country = entry[0];
    var countryCompanies = entry[1];
    var totalMcap = sumMcap(countryCompanies);
    var flag = getFlag(country);
    html += '<div class="solitaire-group" data-country-group="' + escHtml(country) + '">';
    html += '<h3>' + flag + ' ' + escHtml(country);
    html += ' <span class="group-stats">' + countryCompanies.length + ' companies &bull; ' + formatMcap(totalMcap) + '</span></h3>';

    var byMineral = {};
    countryCompanies.forEach(function(c) {
      var mg = getMineralGroup(c.primary_mineral);
      if (!byMineral[mg.group]) byMineral[mg.group] = { color: mg.color, companies: [] };
      byMineral[mg.group].companies.push(c);
    });

    html += '<div class="lane">';
    var sortedMinerals = Object.entries(byMineral)
      .sort(function(a, b) { return sumMcap(b[1].companies) - sumMcap(a[1].companies); });

    sortedMinerals.forEach(function(entry2) {
      var mineral = entry2[0];
      var data = entry2[1];
      var sorted = data.companies.sort(function(a, b) { return (b.market_cap_usd || 0) - (a.market_cap_usd || 0); });
      html += buildColumn(mineral, sorted, data.color);
    });

    html += '</div></div>';
  });

  html += '</div>';
  html += renderDisclaimer();
  return html;
}

// ---- Flat Rank View — Columnar Layout (sample-matched) ----
function renderFlatRank(companies, cfg) {
  // Simple legend bar (sample style)
  var groups = {};
  companies.forEach(function(c) {
    var mg = getMineralGroup(c.primary_mineral);
    if (!groups[mg.group]) groups[mg.group] = { color: mg.color, count: 0, mcap: 0 };
    groups[mg.group].count++;
    groups[mg.group].mcap += (c.market_cap_usd || 0);
  });

  var html = '<div class="legend-bar-simple">';
  ['Gold', 'Silver', 'PGMs', 'Copper', 'Other'].forEach(function(g) {
    if (groups[g]) {
      html += '<div class="legend-item" data-mineral-filter="' + g + '" style="cursor:pointer">';
      html += '<span class="legend-dot" style="background:' + groups[g].color + '"></span>';
      html += g + '<span class="legend-mcap">' + formatMcap(groups[g].mcap) + '</span>';
      html += '</div>';
    }
  });
  html += '</div>';

  // Stats area with summary chips
  var totalMcap = sumMcap(companies);
  var countries = {};
  companies.forEach(function(c) {
    if (c.primary_country) {
      if (!countries[c.primary_country]) countries[c.primary_country] = 0;
      countries[c.primary_country] += (c.market_cap_usd || 0);
    }
  });
  var sortedCountries = Object.entries(countries)
    .sort(function(a, b) { return b[1] - a[1]; });
  var minerals = new Set(companies.map(function(c) { return c.primary_mineral; }).filter(Boolean));
  var countrySet = new Set(companies.map(function(c) { return c.primary_country; }).filter(Boolean));

  html += '<div class="stats-area">';
  html += '<div class="stats-headline">' + companies.length + ' companies &middot; ' +
    countrySet.size + ' countries &middot; ' + minerals.size + ' minerals &middot; Combined Market Cap: ' +
    formatMcap(totalMcap) + '</div>';

  // Mineral chips
  html += '<div class="summary-row"><div class="summary-row-label">Market Cap by Mineral</div>';
  ['Gold', 'Silver', 'PGMs', 'Copper', 'Other'].forEach(function(g) {
    if (groups[g]) {
      html += '<span class="summary-chip" style="border-color:' + groups[g].color + '">' +
        g + '<span class="chip-val">' + formatMcap(groups[g].mcap) + '</span></span>';
    }
  });
  html += '</div>';

  // Country chips (top 12 + others)
  html += '<div class="summary-row"><div class="summary-row-label">Market Cap by Country</div>';
  var shownCountries = sortedCountries.slice(0, 12);
  var otherCountries = sortedCountries.slice(12);
  var otherMcap = otherCountries.reduce(function(s, e) { return s + e[1]; }, 0);
  shownCountries.forEach(function(entry) {
    var flag = getFlag(entry[0]);
    html += '<span class="summary-chip">' + flag + ' ' + escHtml(entry[0]) +
      '<span class="chip-val">' + formatMcap(entry[1]) + '</span></span>';
  });
  if (otherCountries.length > 0) {
    html += '<span class="summary-chip">+' + otherCountries.length + ' others' +
      '<span class="chip-val">' + formatMcap(otherMcap) + '</span></span>';
  }
  html += '</div></div>';

  // Columnar layout by status
  var byStatus = groupBy(companies, 'company_status');

  html += '<div class="columns-wrap">';

  STATUS_ORDER.forEach(function(status) {
    if (!byStatus[status] || byStatus[status].length === 0) return;

    var statusCompanies = byStatus[status]
      .sort(function(a, b) { return (b.market_cap_usd || 0) - (a.market_cap_usd || 0); });
    var statusMcap = sumMcap(statusCompanies);

    html += '<div class="status-col">';
    html += '<div class="status-col-header">';
    html += '<div class="status-col-title">' + escHtml(shortStatus(status)) + '</div>';
    html += '<div class="status-col-sub"><span>' + statusCompanies.length + ' companies</span>';
    html += '<span>' + formatMcap(statusMcap) + '</span></div>';
    html += '</div>';
    html += '<div class="status-col-body">';

    statusCompanies.forEach(function(c, i) {
      var mg = getMineralGroup(c.primary_mineral);
      var flag = getFlag(c.primary_country);
      var mcap = formatMcap(c.market_cap_usd);
      var tooltip = escHtml(c.ticker || c.stock_symbol || '');
      var profileLink = c.profile_url
        ? '<a href="' + c.profile_url + '" target="_blank" rel="noopener">' + escHtml(c.company_name) + '</a>'
        : escHtml(c.company_name);

      html += '<div class="co-row"' +
        ' data-mineral="' + escHtml(mg.group) + '"' +
        ' data-status="' + escHtml(c.company_status || '') + '"' +
        ' data-country="' + escHtml(c.primary_country || '') + '"' +
        ' data-exchange="' + escHtml(shortExchange(c.primary_stock_exchange)) + '">';
      html += '<span class="co-rank">' + (i + 1) + '.</span>';
      html += '<span class="co-mineral-dot" style="background:' + mg.color + '" title="' + escHtml(c.primary_mineral || mg.group) + '"></span>';
      html += '<span class="co-name"' + (tooltip ? ' data-tooltip="' + tooltip + '"' : '') + '>' + profileLink + '</span>';
      html += '<span class="co-country">' + flag + ' ' + escHtml(c.primary_country || '') + '</span>';
      html += '<span class="co-mcap">' + mcap + '</span>';
      html += '</div>';
    });

    html += '</div></div>';
  });

  html += '</div>';
  html += renderDisclaimer();
  return html;
}
