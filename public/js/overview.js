// Overview dashboard rendering + Chart.js initialization

function renderOverview(companies, cfg) {
  var totalCompanies = companies.length;
  var totalMcap = sumMcap(companies);
  var producers = companies.filter(function(c) { return c.company_status === 'Producer'; });
  var countries = [];
  var countrySet = {};
  companies.forEach(function(c) { if (c.primary_country && !countrySet[c.primary_country]) { countrySet[c.primary_country] = true; countries.push(c.primary_country); } });
  var minerals = [];
  var mineralSet = {};
  companies.forEach(function(c) { if (c.primary_mineral && !mineralSet[c.primary_mineral]) { mineralSet[c.primary_mineral] = true; minerals.push(c.primary_mineral); } });

  var html = '';

  // Summary boxes
  html += '<div class="summary-grid">';
  html += summaryBox('Companies', totalCompanies, cfg.keyColor);
  html += summaryBox('Total Market Cap', formatMcap(totalMcap), cfg.keyColor);
  html += summaryBox('Producers', producers.length, '#27AE60');
  html += summaryBox('Countries', countries.length, '#2980B9');
  html += summaryBox('Minerals', minerals.length, '#8E44AD');
  html += summaryBox('Avg MCap', formatMcap(totalCompanies > 0 ? totalMcap / totalCompanies : 0), '#E67E22');
  html += '</div>';

  // Mineral legend pills
  html += mineralLegendInteractive(companies);

  // Status breakdown bar
  html += statusFilterInteractive(companies);

  // Chart grid
  html += '<div class="section-title">Market Cap Distribution</div>';
  html += '<div class="chart-grid">';
  html += '<div class="chart-card"><h3>Companies by Status</h3><canvas id="chart-status"></canvas></div>';
  html += '<div class="chart-card"><h3>Market Cap by Mineral Group</h3><canvas id="chart-mineral-mcap"></canvas></div>';
  html += '<div class="chart-card"><h3>Companies by Region</h3><canvas id="chart-region"></canvas></div>';
  html += '</div>';

  // Top companies bar chart — full width, responsive height
  var topCount = Math.min(companies.filter(function(c) { return c.market_cap_usd > 0; }).length, 25);
  var barHeight = Math.max(300, topCount * 28 + 60);
  html += '<div class="section-title">Top Companies by Market Cap</div>';
  html += '<div class="chart-card" style="margin-bottom:24px"><h3>Top ' + topCount + ' Companies by Market Cap</h3>';
  html += '<div style="height:' + barHeight + 'px;width:100%"><canvas id="chart-top-mcap"></canvas></div></div>';

  // Top 15 table
  html += '<div class="section-title">Top Companies by Market Cap</div>';
  html += renderTopCompaniesTable(companies, cfg);

  // Disclaimer
  html += renderDisclaimer();

  return html;
}

function summaryBox(label, value, color) {
  return '<div class="summary-box" style="border-top-color:' + color + '"><div class="value" style="color:' + color + '">' + value +
    '</div><div class="label">' + label + '</div></div>';
}

function renderTopCompaniesTable(companies, cfg) {
  var top = companies
    .filter(function(c) { return c.market_cap_usd && c.market_cap_usd > 0; })
    .sort(function(a, b) { return b.market_cap_usd - a.market_cap_usd; })
    .slice(0, 15);

  if (top.length === 0) return '';

  var html = '<div class="chart-card" style="margin-bottom:24px">';
  html += '<h3>Top 15 Companies by Market Cap</h3>';
  html += '<div class="data-table-wrap"><table class="data-table">';
  html += '<thead><tr>';
  html += '<th>#</th><th>Company</th><th>Status</th><th>Mineral</th><th>Country</th><th>Ticker</th><th style="text-align:right">Market Cap</th>';
  html += '</tr></thead><tbody>';

  top.forEach(function(c, i) {
    var mg = getMineralGroup(c.primary_mineral);
    var flag = getFlag(c.primary_country);
    var safeUrl = safeHref(c.profile_url);
    var profileLink = safeUrl
      ? '<a href="' + safeUrl + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">' + escHtml(c.company_name) + '</a>'
      : escHtml(c.company_name);

    html += '<tr>';
    html += '<td>' + (i + 1) + '</td>';
    html += '<td class="company-name">' + profileLink + '</td>';
    html += '<td><span class="mini-badge" style="background:' + getStatusColor(c.company_status) + '">' + escHtml(shortStatus(c.company_status)) + '</span></td>';
    html += '<td><span class="mini-badge" style="background:' + mg.color + '">' + escHtml(mg.group) + '</span></td>';
    html += '<td>' + flag + ' ' + escHtml(c.primary_country || '') + '</td>';
    html += '<td>' + escHtml(c.ticker || '') + '</td>';
    html += '<td class="numeric" style="font-weight:600">' + formatMcap(c.market_cap_usd) + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table></div></div>';
  return html;
}

// Track chart instances to destroy on re-render (prevents memory leaks)
var _chartInstances = {};
function _createChart(id, config) {
  if (_chartInstances[id]) {
    _chartInstances[id].destroy();
  }
  var canvas = document.getElementById(id);
  if (!canvas) return null;
  _chartInstances[id] = new Chart(canvas, config);
  return _chartInstances[id];
}

function initOverviewCharts(companies, cfg) {
  // Status pie chart
  var byStatus = groupBy(companies, 'company_status');
  var statusLabels = [];
  var statusData = [];
  var statusColors = [];
  STATUS_ORDER.forEach(function(s) {
    if (byStatus[s]) {
      statusLabels.push(s);
      statusData.push(byStatus[s].length);
      statusColors.push(getStatusColor(s));
    }
  });

  var statusTotal = statusData.reduce(function(s, v) { return s + v; }, 0);
  _createChart('chart-status', {
      type: 'doughnut',
      data: {
        labels: statusLabels,
        datasets: [{ data: statusData, backgroundColor: statusColors, borderWidth: 2, borderColor: '#fff' }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              font: { size: 11, family: 'Inter' }, padding: 12,
              generateLabels: function(chart) {
                var data = chart.data;
                return data.labels.map(function(label, i) {
                  var value = data.datasets[0].data[i];
                  var pct = statusTotal > 0 ? (value / statusTotal * 100).toFixed(1) : 0;
                  return {
                    text: label + ': ' + value + ' (' + pct + '%)',
                    fillStyle: data.datasets[0].backgroundColor[i],
                    strokeStyle: '#fff',
                    lineWidth: 2,
                    hidden: false,
                    index: i
                  };
                });
              }
            }
          },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                var pct = statusTotal > 0 ? (ctx.parsed / statusTotal * 100).toFixed(1) : 0;
                return ctx.label + ': ' + ctx.parsed + ' (' + pct + '%)';
              }
            }
          }
        }
      }
    });

  // Mineral group mcap pie chart
  var mineralGroups = {};
  companies.forEach(function(c) {
    var mg = getMineralGroup(c.primary_mineral);
    if (!mineralGroups[mg.group]) mineralGroups[mg.group] = { mcap: 0, color: mg.color, count: 0 };
    mineralGroups[mg.group].mcap += (c.market_cap_usd || 0);
    mineralGroups[mg.group].count++;
  });

  var mgLabels = [];
  var mgData = [];
  var mgColors = [];
  ['Gold', 'Silver', 'PGMs', 'Copper', 'Other'].forEach(function(g) {
    if (mineralGroups[g]) {
      mgLabels.push(g + ' (' + mineralGroups[g].count + ')');
      mgData.push(mineralGroups[g].mcap);
      mgColors.push(mineralGroups[g].color);
    }
  });

  var mgTotal = mgData.reduce(function(s, v) { return s + v; }, 0);
  _createChart('chart-mineral-mcap', {
      type: 'doughnut',
      data: {
        labels: mgLabels,
        datasets: [{ data: mgData, backgroundColor: mgColors, borderWidth: 2, borderColor: '#fff' }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              font: { size: 11, family: 'Inter' }, padding: 12,
              generateLabels: function(chart) {
                var data = chart.data;
                return data.labels.map(function(label, i) {
                  var value = data.datasets[0].data[i];
                  var pct = mgTotal > 0 ? (value / mgTotal * 100).toFixed(1) : 0;
                  return {
                    text: label + ': ' + formatMcap(value) + ' (' + pct + '%)',
                    fillStyle: data.datasets[0].backgroundColor[i],
                    strokeStyle: '#fff',
                    lineWidth: 2,
                    hidden: false,
                    index: i
                  };
                });
              }
            }
          },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                var pct = mgTotal > 0 ? (ctx.parsed / mgTotal * 100).toFixed(1) : 0;
                return ctx.label + ': ' + formatMcap(ctx.parsed) + ' (' + pct + '%)';
              }
            }
          }
        }
      }
    });

  // Region pie chart
  var byRegion = groupBy(companies, 'primary_region');
  var regionLabels = Object.keys(byRegion).sort(function(a, b) { return byRegion[b].length - byRegion[a].length; });
  var regionData = regionLabels.map(function(r) { return byRegion[r].length; });
  var regionColors = ['#3498DB', '#E74C3C', '#2ECC71', '#F39C12', '#9B59B6', '#1ABC9C', '#E67E22', '#95A5A6'];

  var regionTotal = regionData.reduce(function(s, v) { return s + v; }, 0);
  _createChart('chart-region', {
      type: 'doughnut',
      data: {
        labels: regionLabels,
        datasets: [{ data: regionData, backgroundColor: regionColors.slice(0, regionLabels.length), borderWidth: 2, borderColor: '#fff' }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              font: { size: 11, family: 'Inter' }, padding: 12,
              generateLabels: function(chart) {
                var data = chart.data;
                return data.labels.map(function(label, i) {
                  var value = data.datasets[0].data[i];
                  var pct = regionTotal > 0 ? (value / regionTotal * 100).toFixed(1) : 0;
                  return {
                    text: label + ': ' + value + ' (' + pct + '%)',
                    fillStyle: data.datasets[0].backgroundColor[i],
                    strokeStyle: '#fff',
                    lineWidth: 2,
                    hidden: false,
                    index: i
                  };
                });
              }
            }
          },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                var pct = regionTotal > 0 ? (ctx.parsed / regionTotal * 100).toFixed(1) : 0;
                return ctx.label + ': ' + ctx.parsed + ' (' + pct + '%)';
              }
            }
          }
        }
      }
    });

  // Top companies horizontal bar chart
  var top = companies
    .filter(function(c) { return c.market_cap_usd && c.market_cap_usd > 0; })
    .sort(function(a, b) { return b.market_cap_usd - a.market_cap_usd; })
    .slice(0, 25);

  var topLabels = top.map(function(c) { return c.company_name; });
  var topData = top.map(function(c) { return c.market_cap_usd / 1e6; });
  var topColors = top.map(function(c) { return getMineralGroup(c.primary_mineral).color; });

  _createChart('chart-top-mcap', {
      type: 'bar',
      data: {
        labels: topLabels,
        datasets: [{
          label: 'Market Cap ($M)',
          data: topData,
          backgroundColor: topColors,
          borderWidth: 0,
          borderRadius: 3
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(ctx) { return formatMcap(ctx.parsed.x * 1e6); }
            }
          }
        },
        scales: {
          x: {
            ticks: {
              callback: function(v) { return '$' + (v >= 1e6 ? (v/1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'T' : v >= 1000 ? (v/1000).toFixed(1) + 'B' : Math.round(v) + 'M'); },
              font: { size: 10, family: 'Inter' }
            },
            grid: { color: '#F0F2F5' }
          },
          y: {
            ticks: {
              font: { size: 10, family: 'Inter' },
              autoSkip: false
            },
            grid: { display: false }
          }
        }
      }
    });
}

function renderDisclaimer() {
  return '<div class="disclaimer">' +
    '<p class="disclaimer-estimates"><strong>Data Note:</strong> Where precise company-reported figures were unavailable, production guidance, reserves, and resources reflect best available estimates derived from public filings, investor presentations, and third-party research. All values should be independently verified before use in any investment analysis.</p>' +
    '<p><strong>Notice</strong> &mdash; The Denver Gold Group does not make any express or implied condition, representation, warranty or other term as to the accuracy, validity, reliability, timeliness or completeness of any information or materials in general or in connection with any particular use or purpose presented at the Mining Forum. The Denver Gold Group does not represent or endorse the accuracy or reliability of any third party advice, opinion, statement, information or materials received during the Mining Forum.</p>' +
    '<p><strong>INVESTMENT ADVICE &mdash; NO OFFER OR RECOMMENDATION</strong> &mdash; The Denver Gold Group, Inc, the Mining Forums, and the information and materials presented at the Mining Forum and in all Denver Gold Group publications, including Internet assets are not, and should not be construed as, an offer to buy or sell, or as a solicitation of an offer to buy or sell, any regulated gold related products or any other regulated products, securities or investments. The Denver Gold Group, Inc and the Mining Forums do not, and should not be construed as acting to, sponsor, advocate, endorse or promote any regulated gold related products or any other regulated products, securities or investments. Before making any investment decision, prospective investors should seek advice from their financial, legal, tax and accounting advisers, take into account their individual financial needs and circumstances and carefully consider the risks associated with such investment decision.</p>' +
    '<p class="disclaimer-copyright">&copy; 2026 by The Denver Gold Group, Inc. All rights reserved. Distribution and republication is encouraged provided that no part of this publication is modified in any form or by any means without the prior written permission of the copyright holder.</p>' +
    '</div>';
}
