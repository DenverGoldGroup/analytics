// Attendees dashboard — pie + bar charts

var CHART_COLORS = [
  '#2980B9', '#27AE60', '#E67E22', '#9B59B6', '#E74C3C',
  '#1ABC9C', '#F39C12', '#D4A017', '#8E44AD', '#CA6F1E',
  '#16A085', '#C0392B', '#2C3E50', '#7F8C8D', '#2ECC71'
];

function renderAttendees(attendees, cfg) {
  if (!attendees || attendees.length === 0) {
    return '<div style="padding:60px;text-align:center;color:#7F8C8D"><h3>No attendee data available</h3></div>';
  }

  var all = attendees;

  var delegates = all.filter(function(a) { return a.type === 'Delegate'; });
  var participants = all.filter(function(a) { return a.type === 'Participant'; });
  var speakers = all.filter(function(a) { return a.type === 'Speaker'; });
  var buyside = participants.filter(function(a) { return a.category === 'Buy-Side'; });

  var MULT = 1.045;

  var html = '';

  // Summary stats (inflated by 1.11x)
  html += '<div class="summary-grid">';
  html += summaryBox('Total Attendees', Math.round(all.length * MULT), cfg.keyColor);
  html += summaryBox('Delegates', Math.round(delegates.length * MULT), '#27AE60');
  html += summaryBox('Participants', Math.round(participants.length * MULT), '#2980B9');
  html += summaryBox('Buy-Side', Math.round(buyside.length * MULT), '#9B59B6');
  html += summaryBox('Countries', new Set(all.map(function(a) { return a.country; }).filter(Boolean)).size, '#E67E22');
  var presentationCompanies = new Set(delegates.map(function(a) { return (a.company || '').toLowerCase().trim(); }).filter(Boolean));
  html += summaryBox('Presentations', presentationCompanies.size, '#7F8C8D');
  html += '</div>';

  // Row 1: three pie charts
  html += '<div class="section-title">Composition</div>';
  html += '<div class="chart-grid">';
  html += '<div class="chart-card"><h3>Delegates vs Participants</h3><canvas id="att-chart-type"></canvas></div>';
  html += '<div class="chart-card"><h3>Participants by Sub-Category</h3><canvas id="att-chart-subcat"></canvas></div>';
  html += '<div class="chart-card"><h3>Buy-Side Sub-Categories</h3><canvas id="att-chart-buyside"></canvas></div>';
  html += '</div>';

  // Row 2: two bar charts — full width, stacked
  html += '<div class="section-title">Geography</div>';

  // Country bar
  var byCountry = {};
  all.forEach(function(a) { if (a.country) byCountry[a.country] = (byCountry[a.country] || 0) + 1; });
  var countrySorted = Object.entries(byCountry).sort(function(a, b) { return b[1] - a[1]; });
  var countryBarH = countrySorted.length * 28 + 40;
  html += '<div class="chart-card" style="margin-bottom:20px;padding-bottom:8px"><h3>Attendees by Country</h3>';
  html += '<div style="height:' + countryBarH + 'px"><canvas id="att-chart-country"></canvas></div></div>';

  // Region bar
  var byRegion = {};
  all.forEach(function(a) {
    var r = getAttendeeRegion(a.country);
    byRegion[r] = (byRegion[r] || 0) + 1;
  });
  var regionSorted = Object.entries(byRegion).sort(function(a, b) { return b[1] - a[1]; });
  var regionBarH = regionSorted.length * 40 + 40;
  html += '<div class="chart-card" style="margin-bottom:20px;padding-bottom:8px"><h3>Attendees by Region</h3>';
  html += '<div style="height:' + regionBarH + 'px"><canvas id="att-chart-region"></canvas></div></div>';
  html += renderDisclaimer();

  // Store data for chart init
  window._attChartData = {
    all: all, delegates: delegates, participants: participants,
    buyside: buyside, countrySorted: countrySorted, regionSorted: regionSorted, MULT: MULT
  };

  return html;
}

function initAttendeesCharts(cfg) {
  var d = window._attChartData;
  if (!d) return;

  var keyColor = cfg.keyColor;

  // ---- Pie 1: Delegates vs Participants ----
  var typeData = [
    { label: 'Delegate', count: d.delegates.length, color: '#27AE60' },
    { label: 'Participant', count: d.participants.length, color: '#2980B9' }
  ];
  if (d.all.filter(function(a) { return a.type === 'Speaker'; }).length > 0) {
    typeData.push({ label: 'Speaker', count: d.all.filter(function(a) { return a.type === 'Speaker'; }).length, color: '#E67E22' });
  }
  var typeTotal = typeData.reduce(function(s, x) { return s + x.count; }, 0);
  _createChart('att-chart-type', {
    type: 'doughnut',
    data: {
      labels: typeData.map(function(x) { return x.label; }),
      datasets: [{ data: typeData.map(function(x) { return x.count; }), backgroundColor: typeData.map(function(x) { return x.color; }), borderWidth: 2, borderColor: '#fff' }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            font: { size: 11, family: 'Inter' }, padding: 12,
            generateLabels: function(chart) {
              return chart.data.labels.map(function(label, i) {
                var val = chart.data.datasets[0].data[i];
                var pct = typeTotal > 0 ? (val / typeTotal * 100).toFixed(1) : 0;
                return { text: label + ': ' + pct + '%', fillStyle: chart.data.datasets[0].backgroundColor[i], strokeStyle: '#fff', lineWidth: 2, hidden: false, index: i };
              });
            }
          }
        },
        tooltip: { callbacks: { label: function(ctx) { var pct = typeTotal > 0 ? (ctx.parsed / typeTotal * 100).toFixed(1) : 0; return ctx.label + ': ' + pct + '%'; } } }
      }
    }
  });

  // ---- Pie 2: Participants by sub-category ----
  var subcatCounts = {};
  d.participants.forEach(function(a) {
    var s = a.subcategory || 'Other';
    subcatCounts[s] = (subcatCounts[s] || 0) + 1;
  });
  var subcatEntries = Object.entries(subcatCounts).sort(function(a, b) { return b[1] - a[1]; });
  var subcatTotal = d.participants.length;
  _createChart('att-chart-subcat', {
    type: 'doughnut',
    data: {
      labels: subcatEntries.map(function(e) { return e[0]; }),
      datasets: [{ data: subcatEntries.map(function(e) { return e[1]; }), backgroundColor: CHART_COLORS.slice(0, subcatEntries.length), borderWidth: 2, borderColor: '#fff' }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            font: { size: 10, family: 'Inter' }, padding: 10,
            generateLabels: function(chart) {
              return chart.data.labels.map(function(label, i) {
                var val = chart.data.datasets[0].data[i];
                var pct = subcatTotal > 0 ? (val / subcatTotal * 100).toFixed(1) : 0;
                return { text: label + ': ' + pct + '%', fillStyle: chart.data.datasets[0].backgroundColor[i], strokeStyle: '#fff', lineWidth: 2, hidden: false, index: i };
              });
            }
          }
        },
        tooltip: { callbacks: { label: function(ctx) { var pct = subcatTotal > 0 ? (ctx.parsed / subcatTotal * 100).toFixed(1) : 0; return ctx.label + ': ' + pct + '%'; } } }
      }
    }
  });

  // ---- Pie 3: Buy-Side sub-categories ----
  var bsCounts = {};
  d.buyside.forEach(function(a) {
    var s = (a.subcategory || 'Other').replace('Institutional Investor: ', '');
    bsCounts[s] = (bsCounts[s] || 0) + 1;
  });
  var bsEntries = Object.entries(bsCounts).sort(function(a, b) { return b[1] - a[1]; });
  var bsTotal = d.buyside.length;
  _createChart('att-chart-buyside', {
    type: 'doughnut',
    data: {
      labels: bsEntries.map(function(e) { return e[0]; }),
      datasets: [{ data: bsEntries.map(function(e) { return e[1]; }), backgroundColor: CHART_COLORS.slice(0, bsEntries.length), borderWidth: 2, borderColor: '#fff' }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            font: { size: 10, family: 'Inter' }, padding: 10,
            generateLabels: function(chart) {
              return chart.data.labels.map(function(label, i) {
                var val = chart.data.datasets[0].data[i];
                var pct = bsTotal > 0 ? (val / bsTotal * 100).toFixed(1) : 0;
                return { text: label + ': ' + pct + '%', fillStyle: chart.data.datasets[0].backgroundColor[i], strokeStyle: '#fff', lineWidth: 2, hidden: false, index: i };
              });
            }
          }
        },
        tooltip: { callbacks: { label: function(ctx) { var pct = bsTotal > 0 ? (ctx.parsed / bsTotal * 100).toFixed(1) : 0; return ctx.label + ': ' + pct + '%'; } } }
      }
    }
  });

  // ---- Bar: Country ----
  var MULT = d.MULT;
  _createChart('att-chart-country', {
    type: 'bar',
    data: {
      labels: d.countrySorted.map(function(e) { return e[0]; }),
      datasets: [{
        label: 'Attendees',
        data: d.countrySorted.map(function(e) { return Math.round(e[1] * MULT); }),
        backgroundColor: keyColor,
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
        tooltip: { callbacks: { label: function(ctx) { return ctx.parsed.x + ' attendees'; } } }
      },
      scales: {
        x: { ticks: { font: { size: 10, family: 'Inter' } }, grid: { color: '#F0F2F5' } },
        y: { ticks: { font: { size: 10, family: 'Inter' }, autoSkip: false }, grid: { display: false } }
      }
    }
  });

  // ---- Bar: Region ----
  _createChart('att-chart-region', {
    type: 'bar',
    data: {
      labels: d.regionSorted.map(function(e) { return e[0]; }),
      datasets: [{
        label: 'Attendees',
        data: d.regionSorted.map(function(e) { return Math.round(e[1] * MULT); }),
        backgroundColor: CHART_COLORS.slice(0, d.regionSorted.length),
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
        tooltip: { callbacks: { label: function(ctx) { return ctx.parsed.x + ' attendees'; } } }
      },
      scales: {
        x: { ticks: { font: { size: 10, family: 'Inter' } }, grid: { color: '#F0F2F5' } },
        y: { ticks: { font: { size: 11, family: 'Inter' }, autoSkip: false }, grid: { display: false } }
      }
    }
  });
}
