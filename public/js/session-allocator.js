// Session Allocator — client-side logic for admin-sessions.html
// Manages config, program building, schedule rendering, drag-drop, priority editing, and export

var _currentEvent = 'MFE26';
var _currentView = 'day';
var _schedule = null;
var _config = null;
var _dragSlotId = null;
var _dragSourceSessionId = null;
var _progFilter = null; // null = no filter, 'yes' = programmed only, 'no' = unprogrammed only

// ---- Auth ----
function getToken() {
  return sessionStorage.getItem('admin_token') || '';
}

function apiHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + getToken()
  };
}

// Checks API response for 401 and redirects to login
function checkAuth(resp) {
  if (resp.status === 401) {
    sessionStorage.removeItem('admin_token');
    window.location.href = '/admin';
    throw new Error('Session expired — redirecting to login');
  }
  return resp;
}

// ---- Mineral/Status colors (match main dashboard) ----
var MINERAL_COLORS = {
  'Gold': '#D4A017', 'Silver': '#7F8C8D', 'PGMs': '#8E44AD', 'PGM': '#8E44AD',
  'Copper': '#CA6F1E', 'Other': '#27AE60'
};
var STATUS_COLORS = {
  'Producer': '#27AE60', 'Royalty': '#2980B9', 'Developer': '#E67E22',
  'Explorer': '#9B59B6', 'Bullion': '#95A5A6'
};
var TIER_COLORS = {
  'AboveMean': '#D4A017', 'AboveMedian': '#2980B9', 'BelowMedian': '#7F8C8D'
};
var TIER_LABELS = {
  'AboveMean': 'Above Mean', 'AboveMedian': 'Above Median', 'BelowMedian': 'Below Median'
};

function mineralColor(m) { return MINERAL_COLORS[m] || MINERAL_COLORS['Other']; }
function statusColor(s) { return STATUS_COLORS[s] || '#95A5A6'; }
function tierColor(t) { return TIER_COLORS[t] || '#7F8C8D'; }

function escHtml(s) {
  var d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function formatMcap(v) {
  if (!v) return '$0';
  if (v >= 1) return '$' + v.toFixed(1) + 'B';
  return '$' + (v * 1000).toFixed(0) + 'M';
}

// ---- Tab switching ----
function switchEvent(code) {
  _currentEvent = code;
  document.querySelectorAll('.event-tab').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-event') === code);
  });
  loadConfig();
  loadSchedule();
  loadCompaniesCount();
}

// ---- Config management ----
function loadConfig() {
  fetch('/api/sessions?action=config&event_code=' + _currentEvent, { headers: apiHeaders() })
    .then(checkAuth)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.ok && d.config) {
        _config = d.config;
        fillConfigForm(d.config);
        updateSlotCalc();
      } else {
        _config = null;
        clearConfigForm();
      }
    })
    .catch(function(err) { console.error('Load config error:', err); });
}

function fillConfigForm(c) {
  document.getElementById('cfg-start-date').value = c.event_start_date || '';
  document.getElementById('cfg-end-date').value = c.event_end_date || '';
  document.getElementById('cfg-day-start').value = c.day_start_time || '08:00';
  document.getElementById('cfg-day-end').value = c.day_end_time || '17:30';
  document.getElementById('cfg-duration').value = c.presentation_duration_min || 25;
  document.getElementById('cfg-morning-tracks').value = c.morning_tracks || 3;
  document.getElementById('cfg-afternoon-tracks').value = c.afternoon_tracks || 3;
  document.getElementById('cfg-lunch-start').value = c.lunch_start_time || '12:00';
  document.getElementById('cfg-lunch-end').value = c.lunch_end_time || '13:30';
}

function clearConfigForm() {
  var ids = ['cfg-start-date', 'cfg-end-date', 'cfg-day-start', 'cfg-day-end', 'cfg-duration', 'cfg-morning-tracks', 'cfg-afternoon-tracks', 'cfg-lunch-start', 'cfg-lunch-end'];
  ids.forEach(function(id) { document.getElementById(id).value = ''; });
  document.getElementById('slot-calc-result').textContent = '';
}

function updateSlotCalc() {
  var startDate = document.getElementById('cfg-start-date').value;
  var endDate = document.getElementById('cfg-end-date').value;
  if (!startDate || !endDate) {
    document.getElementById('slot-calc-result').textContent = '';
    return;
  }
  var cfg = getConfigFromForm();
  // Include day_overrides from loaded config
  if (_config && _config.day_overrides) cfg.day_overrides = _config.day_overrides;
  var info = calcTotalSlotsClient(cfg);

  var lines = '<strong>' + info.totalSlots + '</strong> total presentation slots (' + info.days + ' days)';
  if (info.dayDetails && info.dayDetails.length > 0) {
    lines += '<br>';
    info.dayDetails.forEach(function(dd) {
      lines += '<span style="margin-right:12px">Day ' + dd.day + ': ' + dd.morning + 'm &times; ' + dd.mt + 'T + ' + dd.afternoon + 'a &times; ' + dd.at + 'T = ' + dd.total + '</span>';
    });
  }
  document.getElementById('slot-calc-result').innerHTML = lines;
}

function calcTotalSlotsClient(cfg) {
  function tm(t) { var p = (t || '08:00').split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1] || '0', 10); }
  var dur = cfg.presentation_duration_min || 25;
  var start = new Date(cfg.event_start_date);
  var end = new Date(cfg.event_end_date);
  var days = Math.max(1, Math.round((end - start) / 86400000) + 1);
  var mt = cfg.morning_tracks || 3;
  var at = cfg.afternoon_tracks || 3;
  var dayOverrides = cfg.day_overrides || {};

  var totalSlots = 0;
  var dayDetails = [];

  for (var d = 0; d < days; d++) {
    var dayLabel = 'Day ' + (d + 1);
    var ov = dayOverrides[dayLabel] || {};
    var ds = ov.day_start_time || cfg.day_start_time || '08:00';
    var de = ov.day_end_time || cfg.day_end_time || '17:30';
    var ls = ov.lunch_start_time || cfg.lunch_start_time || '12:00';
    var le = ov.lunch_end_time || cfg.lunch_end_time || '13:30';

    var morningMin = tm(ls) - tm(ds);
    var afternoonMin = Math.max(0, tm(de) - tm(le));
    var morningSPT = Math.max(0, Math.floor(morningMin / dur));
    var afternoonSPT = afternoonMin > 0 ? Math.floor(afternoonMin / dur) : 0;
    var dayTotal = (morningSPT * mt) + (afternoonSPT * at);
    totalSlots += dayTotal;

    dayDetails.push({ day: d + 1, morning: morningSPT, afternoon: afternoonSPT, mt: mt, at: at, total: dayTotal });
  }

  return {
    days: days, totalSlots: totalSlots, dayDetails: dayDetails,
    morningTracks: mt, afternoonTracks: at
  };
}

function getConfigFromForm() {
  return {
    event_start_date: document.getElementById('cfg-start-date').value,
    event_end_date: document.getElementById('cfg-end-date').value,
    day_start_time: document.getElementById('cfg-day-start').value || '08:00',
    day_end_time: document.getElementById('cfg-day-end').value || '17:30',
    presentation_duration_min: parseInt(document.getElementById('cfg-duration').value) || 25,
    morning_tracks: parseInt(document.getElementById('cfg-morning-tracks').value) || 3,
    afternoon_tracks: parseInt(document.getElementById('cfg-afternoon-tracks').value) || 3,
    lunch_start_time: document.getElementById('cfg-lunch-start').value || '12:00',
    lunch_end_time: document.getElementById('cfg-lunch-end').value || '13:30'
  };
}

function saveConfig() {
  var cfg = getConfigFromForm();
  cfg.action = 'save-config';
  cfg.event_code = _currentEvent;
  var btn = document.getElementById('save-config-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  fetch('/api/sessions', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(cfg) })
    .then(checkAuth)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      btn.disabled = false;
      btn.textContent = 'Save Config';
      if (d.ok) {
        _config = d.config;
        showMessage('Config saved. ' + d.slotInfo.totalSlots + ' total slots available.', 'success');
        updateSlotCalc();
      } else {
        showMessage('Error: ' + (d.error || 'Unknown'), 'error');
      }
    })
    .catch(function(err) {
      btn.disabled = false;
      btn.textContent = 'Save Config';
      showMessage('Error: ' + err.message, 'error');
    });
}

// ---- Build Program: create empty session containers ----
function buildProgram() {
  if (!confirm('This will create (or recreate) the session program for ' + _currentEvent + ' based on the saved config. Any existing sessions and assignments will be deleted. Continue?')) return;

  var btn = document.getElementById('build-program-btn');
  btn.disabled = true;
  btn.textContent = 'Building...';
  showMessage('Building program...', 'info');

  fetch('/api/sessions', {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({ action: 'build-program', event_code: _currentEvent })
  })
  .then(checkAuth)
  .then(function(r) { return r.json(); })
  .then(function(d) {
    btn.disabled = false;
    btn.textContent = 'Build Program';
    if (d.ok) {
      showMessage(d.message, 'success');
      loadSchedule();
    } else {
      showMessage('Error: ' + (d.error || 'Unknown'), 'error');
    }
  })
  .catch(function(err) {
    btn.disabled = false;
    btn.textContent = 'Build Program';
    showMessage('Error: ' + err.message, 'error');
  });
}

// ---- Schedule loading & rendering ----
function loadSchedule() {
  var grid = document.getElementById('schedule-grid');
  grid.innerHTML = '<div style="text-align:center;padding:40px;color:#7F8C8D">Loading schedule...</div>';

  fetch('/api/sessions?action=schedule&event_code=' + _currentEvent, { headers: apiHeaders() })
    .then(checkAuth)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.ok) {
        _schedule = d;
        renderSchedule(d);
        updateStats(d.stats);
      } else {
        grid.innerHTML = '<div style="text-align:center;padding:40px;color:#7F8C8D">Error loading schedule.</div>';
      }
    })
    .catch(function(err) {
      grid.innerHTML = '<div style="text-align:center;padding:40px;color:#E74C3C">Error: ' + err.message + '</div>';
    });
}

function updateStats(stats) {
  document.getElementById('stat-sessions').textContent = stats.totalSessions || 0;
  var placedStr = (stats.totalPlaced || 0) + ' / ' + (stats.totalCompanies || stats.totalPlaced || 0);
  document.getElementById('stat-placed').textContent = placedStr;
  var filledEl = document.getElementById('stat-filled');
  if (filledEl) filledEl.textContent = (stats.totalFilled || 0) + ' / ' + (stats.totalSessions || 0);
  updateProgCounts(stats);

  // Count sessions missing priorities
  var unassigned = 0;
  if (_schedule && _schedule.sessions) {
    _schedule.sessions.forEach(function(s) {
      if (s.priority == null || s.priority === '' || s.priority === 0) unassigned++;
    });
  }
  var priEl = document.getElementById('stat-priorities');
  if (priEl) {
    if (unassigned > 0) {
      priEl.textContent = unassigned + ' unset';
      priEl.style.color = '#E74C3C';
    } else if (stats.totalSessions > 0) {
      priEl.textContent = 'All set';
      priEl.style.color = '#1E8449';
    } else {
      priEl.textContent = '\u2014';
      priEl.style.color = '';
    }
  }
}

function switchView(view) {
  _currentView = view;
  document.querySelectorAll('.view-btn').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-view') === view);
  });
  if (_schedule) {
    renderSchedule(_schedule);
  }
}

function renderSchedule(data) {
  var grid = document.getElementById('schedule-grid');
  if (!data.sessions || data.sessions.length === 0) {
    grid.innerHTML = '<div style="text-align:center;padding:60px;color:#7F8C8D">' +
      '<h3>No program built</h3>' +
      '<p style="margin-top:8px;font-size:13px">1. Configure the event above and save. 2. Click <strong>Build Program</strong> to create session containers. 3. Optionally edit priorities. 4. Click <strong>Generate Schedule</strong> to fill companies.</p></div>';
    return;
  }

  if (_currentView === 'track') {
    renderTrackView(data, grid);
    return;
  }

  if (_currentView === 'thematics') {
    renderThematicsView(data, grid);
    return;
  }

  // Group sessions by day
  var dayGroups = {};
  var dayOrder = [];
  data.sessions.forEach(function(s) {
    var day = s.day || 'Unassigned';
    if (!dayGroups[day]) { dayGroups[day] = []; dayOrder.push(day); }
    dayGroups[day].push(s);
  });

  var html = '';
  dayOrder.forEach(function(day) {
    html += '<div class="day-group">';
    html += '<div class="day-header">' + escHtml(day) + '</div>';
    html += '<div class="sessions-row">';
    dayGroups[day].forEach(function(s) {
      html += renderSessionCard(s);
    });
    html += '</div></div>';
  });

  // Unallocated companies (day view)
  html += '<div class="unallocated-section" id="unallocated-section" style="display:none;margin-top:20px">';
  html += '<div class="holding-header" style="background:#FFF5F5;border-bottom-color:#F5B7B1"><span style="color:#C0392B">⚠</span> Unallocated Companies <span class="holding-count" id="unallocated-count" style="background:#E74C3C;color:#fff">0</span></div>';
  html += '<div class="holding-items" id="unallocated-items"></div>';
  html += '</div>';

  grid.innerHTML = html;
  initDragDrop();
  initPriorityEditing();
  renderUnallocated(data.unallocated);
  applyProgFilter();
}

// ---- Track View ----
function getDayTimes(cfg, dayLabel) {
  var ov = (cfg.day_overrides || {})[dayLabel] || {};
  return {
    day_start_time: ov.day_start_time || cfg.day_start_time || '08:00',
    day_end_time: ov.day_end_time || cfg.day_end_time || '17:30',
    lunch_start_time: ov.lunch_start_time || cfg.lunch_start_time || '12:00',
    lunch_end_time: ov.lunch_end_time || cfg.lunch_end_time || '13:30'
  };
}

function renderTrackView(data, grid) {
  var cfg = _config || {};
  var duration = parseInt(cfg.presentation_duration_min) || 25;

  var stageSet = {};
  data.sessions.forEach(function(s) { stageSet[s.stage || 'Stage 1'] = true; });
  var stages = Object.keys(stageSet).sort();
  if (stages.length === 0) stages = ['Stage 1', 'Stage 2', 'Stage 3'];

  var stageColors = { 'Stage 1': 'stage-1', 'Stage 2': 'stage-2', 'Stage 3': 'stage-3' };

  var stageData = {};
  stages.forEach(function(st) { stageData[st] = {}; });
  data.sessions.forEach(function(s) {
    var stage = s.stage || 'Stage 1';
    var day = s.day || 'Day 1';
    if (!stageData[stage]) stageData[stage] = {};
    if (!stageData[stage][day]) stageData[stage][day] = [];
    stageData[stage][day].push(s);
  });

  var allDays = [];
  var daySet = {};
  data.sessions.forEach(function(s) {
    var d = s.day || 'Day 1';
    if (!daySet[d]) { daySet[d] = true; allDays.push(d); }
  });
  // Sort days numerically (Day 1, Day 2, Day 3...)
  allDays.sort(function(a, b) {
    var na = parseInt(a.replace(/\D/g, '')) || 0;
    var nb = parseInt(b.replace(/\D/g, '')) || 0;
    return na - nb;
  });

  var html = '<div class="track-view">';

  stages.forEach(function(stage, stageIdx) {
    var colorClass = stageColors[stage] || 'stage-1';
    html += '<div class="track-column">';
    html += '<div class="track-header ' + colorClass + '">' + escHtml(stage) + '</div>';

    allDays.forEach(function(day) {
      var dt = getDayTimes(cfg, day);

      // Day divider: show editable times only in the first stage column
      if (stageIdx === 0) {
        html += '<div class="track-day-divider">' + escHtml(day);
        html += '<span class="track-day-times-edit">';
        html += '<input type="time" class="day-time-input" data-day="' + escHtml(day) + '" data-field="day_start_time" value="' + dt.day_start_time + '" title="Day start">';
        html += '<span class="day-time-sep">\u2013</span>';
        html += '<input type="time" class="day-time-input" data-day="' + escHtml(day) + '" data-field="day_end_time" value="' + dt.day_end_time + '" title="Day end">';
        html += '</span>';
        html += '</div>';
      } else {
        html += '<div class="track-day-divider">' + escHtml(day);
        html += '<span class="track-day-times">' + dt.day_start_time + ' \u2013 ' + dt.day_end_time + '</span>';
        html += '</div>';
      }

      var sessions = (stageData[stage] && stageData[stage][day]) || [];
      // Sort by time: morning before afternoon, then by start_time chronologically
      sessions.sort(function(a, b) {
        var blockOrder = { 'morning': 0, 'afternoon': 1 };
        var aBlock = blockOrder[a.time_block] !== undefined ? blockOrder[a.time_block] : 0;
        var bBlock = blockOrder[b.time_block] !== undefined ? blockOrder[b.time_block] : 0;
        if (aBlock !== bBlock) return aBlock - bBlock;
        return timeToMin(a.start_time || '08:00') - timeToMin(b.start_time || '08:00');
      });

      if (sessions.length === 0) {
        html += '<div class="track-session"><div style="padding:12px;text-align:center;color:#C0C4CC;font-size:11px">No sessions</div></div>';
      }

      // Separate morning / afternoon sessions
      var morningSessions = sessions.filter(function(s) { return s.time_block === 'morning' || !s.time_block; });
      var afternoonSessions = sessions.filter(function(s) { return s.time_block === 'afternoon'; });

      var hasMixed = morningSessions.length > 0 && afternoonSessions.length > 0;
      var blocks = hasMixed
        ? [{ label: 'Morning', sessions: morningSessions, startMin: timeToMin(dt.day_start_time) },
           { label: 'Lunch', sessions: [], startMin: timeToMin(dt.lunch_start_time) },
           { label: 'Afternoon', sessions: afternoonSessions, startMin: timeToMin(dt.lunch_end_time) }]
        : [{ label: null, sessions: sessions, startMin: timeToMin(dt.day_start_time) }];

      blocks.forEach(function(block) {
        if (block.label === 'Lunch') {
          html += '<div class="track-lunch">Lunch ' + dt.lunch_start_time + ' \u2014 ' + dt.lunch_end_time + '</div>';
          return;
        }

        var currentTime = block.startMin;

        block.sessions.forEach(function(s) {
          var slotCount = s.max_slots || 6;
          var sessionSlots = s.slots || [];

          // Use stored start_time if available
          if (s.start_time) {
            currentTime = timeToMin(s.start_time);
          }

          var sessionLabel = s.session_theme || 'Session ' + s.session_number;
          var startStr = minToTime(currentTime);
          var endMin = currentTime + (slotCount * duration);
          var endStr = minToTime(endMin);

          html += '<div class="track-session">';
          html += '<div class="track-session-header">';
          var tPriVal = (s.priority !== null && s.priority !== undefined) ? s.priority : '';
          var tPriClass = tPriVal === '' ? 'tsh-priority-input priority-input priority-unset' : 'tsh-priority-input priority-input';
          html += '<input type="number" class="' + tPriClass + '" data-session-id="' + s.id + '" value="' + tPriVal + '" min="1" placeholder="\u2014" title="Priority (fill order) \u2014 set before generating">';
          html += '<span class="tsh-label">S' + s.session_number + '</span>';
          html += '<span class="tsh-theme">' + escHtml(sessionLabel) + '</span>';
          html += '<span class="tsh-time-range">' + startStr + '\u2013' + endStr + '</span>';
          html += '<span class="tsh-slots">' + sessionSlots.length + '/' + slotCount + '</span>';
          html += '</div>';

          for (var i = 1; i <= slotCount; i++) {
            var slot = null;
            for (var j = 0; j < sessionSlots.length; j++) {
              if (sessionSlots[j].slot_in_session === i) { slot = sessionSlots[j]; break; }
            }

            var timeStr = minToTime(currentTime);

            if (slot) {
              var tooltip = escHtml(slot.company_name);
              if (slot.geography) tooltip += ' — ' + escHtml(slot.geography);
              if (slot.primary_mineral) tooltip += ' (' + escHtml(slot.primary_mineral) + ')';
              var isUnpaid = (slot.payment_status || '').toLowerCase() === 'unpaid';
              var unpaidClass = isUnpaid ? ' ts-unpaid' : '';
              html += '<div class="track-slot' + unpaidClass + '" draggable="true" data-slot-id="' + slot.id + '" data-session-id="' + s.id + '" data-programmed="' + (slot.programmed ? 'true' : 'false') + '" title="' + tooltip + '">';
              html += '<span class="ts-time">' + timeStr + '</span>';
              html += '<span class="ts-mineral" style="background:' + mineralColor(slot.primary_mineral) + '" title="' + escHtml(slot.primary_mineral) + '"></span>';
              html += '<span class="ts-name">' + escHtml(slot.company_name) + '</span>';
              if (isUnpaid) html += '<span class="ts-unpaid-badge">UNPAID</span>';
              html += '<span class="ts-status" style="color:' + statusColor(slot.company_status) + '">' + escHtml(slot.company_status || '') + '</span>';
              html += '<span class="ts-mcap">' + formatMcap(slot.market_cap_usd) + '</span>';
              html += '<button class="ts-remove-btn" data-slot-id="' + slot.id + '" title="Remove to holding bucket">&times;</button>';
              html += '</div>';
            } else {
              html += '<div class="track-slot track-slot-empty" data-session-id="' + s.id + '" data-slot="' + i + '" style="opacity:0.35">';
              html += '<span class="ts-time">' + timeStr + '</span>';
              html += '<span class="ts-name" style="color:#C0C4CC">\u2014</span>';
              html += '</div>';
            }

            currentTime += duration;
          }

          html += '</div>';
        });
      });
    });

    html += '</div>';
  });

  html += '</div>';

  // Holding bucket
  html += '<div class="holding-bucket" id="holding-bucket">';
  html += '<div class="holding-header">Holding Bucket <span class="holding-count" id="holding-count">0</span></div>';
  html += '<div class="holding-items" id="holding-items"><span style="color:#C0C4CC;font-size:11px">Empty</span></div>';
  html += '</div>';

  // Unallocated companies
  html += '<div class="unallocated-section" id="unallocated-section" style="display:none">';
  html += '<div class="holding-header" style="background:#FFF5F5;border-bottom-color:#F5B7B1"><span style="color:#C0392B">⚠</span> Unallocated Companies <span class="holding-count" id="unallocated-count" style="background:#E74C3C;color:#fff">0</span></div>';
  html += '<div class="holding-items" id="unallocated-items"></div>';
  html += '</div>';

  grid.innerHTML = html;
  initTrackPriorityEditing();
  initTrackDragDrop();
  initRemoveButtons();
  loadHoldingBucket();
  renderUnallocated(data.unallocated);
  applyProgFilter();
}

function timeToMin(t) {
  var p = (t || '08:00').split(':');
  return parseInt(p[0], 10) * 60 + parseInt(p[1] || '0', 10);
}

function minToTime(m) {
  var h = Math.floor(m / 60);
  var min = m % 60;
  return (h < 10 ? '0' : '') + h + ':' + (min < 10 ? '0' : '') + min;
}

function initTrackPriorityEditing() {
  document.querySelectorAll('.tsh-priority-input').forEach(function(el) {
    el.addEventListener('change', function() {
      savePriority(el);
    });
    el.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    });
  });

  // Day time inputs
  document.querySelectorAll('.day-time-input').forEach(function(el) {
    el.addEventListener('change', function() {
      saveDayTime(el);
    });
  });
}

// ---- Track View Drag and Drop ----
function initTrackDragDrop() {
  // Draggable filled slots
  document.querySelectorAll('.track-slot[draggable="true"]').forEach(function(el) {
    el.addEventListener('dragstart', onTrackDragStart);
    el.addEventListener('dragend', onTrackDragEnd);
  });
  // Drop targets: all track-slot elements (filled = swap, empty = move)
  document.querySelectorAll('.track-slot').forEach(function(el) {
    el.addEventListener('dragover', onTrackDragOver);
    el.addEventListener('dragleave', onTrackDragLeave);
    el.addEventListener('drop', onTrackDrop);
  });
  // Also allow dropping on track-session containers (append to end)
  document.querySelectorAll('.track-session').forEach(function(el) {
    el.addEventListener('dragover', onTrackDragOver);
    el.addEventListener('dragleave', onTrackDragLeave);
    el.addEventListener('drop', onTrackSessionDrop);
  });
}

function onTrackDragStart(e) {
  _dragSlotId = e.currentTarget.getAttribute('data-slot-id');
  _dragSourceSessionId = e.currentTarget.getAttribute('data-session-id');
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', _dragSlotId);
}

function onTrackDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.track-slot.drag-over, .track-session.drag-over').forEach(function(el) {
    el.classList.remove('drag-over');
  });
}

function onTrackDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function onTrackDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function onTrackDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('drag-over');

  var rawData = e.dataTransfer.getData('text/plain');
  var targetEl = e.currentTarget;
  var targetSessionId = targetEl.getAttribute('data-session-id');
  var targetSlotNum = targetEl.getAttribute('data-slot');
  var targetSlotId = targetEl.getAttribute('data-slot-id');

  if (!rawData || !targetSessionId) return;

  // Handle drop from holding bucket
  if (rawData.indexOf('holding:') === 0) {
    var companyName = rawData.substring(8);
    if (targetSlotNum) {
      placeFromHolding(companyName, parseInt(targetSessionId), parseInt(targetSlotNum));
    } else {
      showMessage('Drop on an empty slot to place from holding.', 'error');
    }
    return;
  }

  var slotId = rawData;
  if (slotId === targetSlotId) return; // dropped on itself

  // If dropping on an empty slot, move to that position
  if (targetSlotNum) {
    persistMove(parseInt(slotId), parseInt(targetSessionId), parseInt(targetSlotNum));
    return;
  }

  // If dropping on a filled slot, swap them
  if (targetSlotId) {
    persistSwapSlots(parseInt(slotId), parseInt(targetSlotId));
    return;
  }
}

function placeFromHolding(companyName, targetSessionId, targetSlot) {
  showMessage('Placing from holding...', 'info');

  fetch('/api/sessions', {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({
      action: 'place-from-holding',
      event_code: _currentEvent,
      company_name: companyName,
      target_session_id: targetSessionId,
      target_slot: targetSlot
    })
  })
  .then(checkAuth)
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.ok) {
      showMessage(d.message, 'success');
      renderHoldingBucket(d.holding);
      loadSchedule();
    } else {
      showMessage('Error: ' + (d.error || 'Unknown'), 'error');
    }
  })
  .catch(function(err) {
    showMessage('Error: ' + err.message, 'error');
  });
}

function onTrackSessionDrop(e) {
  // Only handle if not already handled by a child track-slot
  if (e.defaultPrevented) return;
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');

  var rawData = e.dataTransfer.getData('text/plain');
  if (!rawData) return;

  // Find the session ID from the header
  var header = e.currentTarget.querySelector('.track-session-header .tsh-priority-input');
  if (!header) return;
  var targetSessionId = parseInt(header.getAttribute('data-session-id'));
  if (!targetSessionId) return;

  // Find next available empty slot in this session
  var emptySlots = e.currentTarget.querySelectorAll('.track-slot-empty[data-session-id="' + targetSessionId + '"]');
  if (emptySlots.length === 0) {
    showMessage('No empty slots in this session.', 'error');
    return;
  }
  var targetSlot = parseInt(emptySlots[0].getAttribute('data-slot'));

  // Handle drop from holding bucket
  if (rawData.indexOf('holding:') === 0) {
    var companyName = rawData.substring(8);
    placeFromHolding(companyName, targetSessionId, targetSlot);
    return;
  }

  persistMove(parseInt(rawData), targetSessionId, targetSlot);
}

function persistSwapSlots(slotIdA, slotIdB) {
  showMessage('Swapping...', 'info');

  fetch('/api/sessions', {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({
      action: 'swap-slots',
      slot_id_a: slotIdA,
      slot_id_b: slotIdB
    })
  })
  .then(checkAuth)
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.ok) {
      showMessage('Swapped successfully', 'success');
      loadSchedule();
    } else {
      showMessage('Swap failed: ' + (d.error || 'Unknown'), 'error');
    }
  })
  .catch(function(err) {
    showMessage('Swap error: ' + err.message, 'error');
  });
}

// ---- Remove to Holding Bucket ----
function initRemoveButtons() {
  document.querySelectorAll('.ts-remove-btn').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      var slotId = parseInt(el.getAttribute('data-slot-id'));
      if (!slotId) return;
      removeToHolding(slotId);
    });
  });
}

function removeToHolding(slotId) {
  showMessage('Moving to holding...', 'info');

  fetch('/api/sessions', {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({ action: 'remove-to-holding', slot_id: slotId })
  })
  .then(checkAuth)
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.ok) {
      showMessage(d.message, 'success');
      renderHoldingBucket(d.holding);
      loadSchedule();
    } else {
      showMessage('Error: ' + (d.error || 'Unknown'), 'error');
    }
  })
  .catch(function(err) {
    showMessage('Error: ' + err.message, 'error');
  });
}

function loadHoldingBucket() {
  fetch('/api/sessions?action=holding&event_code=' + _currentEvent, { headers: apiHeaders() })
    .then(checkAuth)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.ok) renderHoldingBucket(d.holding);
    })
    .catch(function() {});
}

function renderHoldingBucket(bucket) {
  var countEl = document.getElementById('holding-count');
  var itemsEl = document.getElementById('holding-items');
  if (!countEl || !itemsEl) return;

  countEl.textContent = (bucket || []).length;

  if (!bucket || bucket.length === 0) {
    itemsEl.innerHTML = '<span style="color:#C0C4CC;font-size:11px">Empty</span>';
    return;
  }

  var html = '';
  bucket.forEach(function(c) {
    var isUnpaid = (c.payment_status || '').toLowerCase() === 'unpaid';
    var unpaidClass = isUnpaid ? ' holding-item-unpaid' : '';
    html += '<div class="holding-item' + unpaidClass + '" draggable="true" data-company-name="' + escHtml(c.company_name) + '" data-programmed="' + (c.programmed ? 'true' : 'false') + '">';
    html += '<span class="ts-mineral" style="background:' + mineralColor(c.primary_mineral) + '"></span>';
    html += '<span class="holding-name">' + escHtml(c.company_name) + '</span>';
    if (isUnpaid) html += '<span class="ts-unpaid-badge">UNPAID</span>';
    html += '<span class="ts-status" style="color:' + statusColor(c.company_status) + '">' + escHtml(c.company_status || '') + '</span>';
    html += '<span class="ts-mcap">' + formatMcap(c.market_cap_usd) + '</span>';
    html += '</div>';
  });

  itemsEl.innerHTML = html;
  applyProgFilter();

  // Make holding items draggable
  itemsEl.querySelectorAll('.holding-item[draggable]').forEach(function(el) {
    el.addEventListener('dragstart', function(e) {
      var name = el.getAttribute('data-company-name');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'holding:' + name);
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', function(e) {
      el.classList.remove('dragging');
    });
  });
}

// ---- Thematics View ----
function renderThematicsView(data, grid) {
  grid.innerHTML = '<div style="text-align:center;padding:40px;color:#7F8C8D">Loading companies...</div>';

  // Fetch all presenting companies to build pure thematic clusters
  fetch('/api/sessions?action=companies&event_code=' + _currentEvent, { headers: apiHeaders() })
    .then(checkAuth)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (!d.ok || !d.companies || d.companies.length === 0) {
        grid.innerHTML = '<div style="text-align:center;padding:60px;color:#7F8C8D"><h3>No companies uploaded</h3></div>';
        return;
      }
      renderThematicClusters(d.companies, data, grid);
    })
    .catch(function(err) {
      grid.innerHTML = '<div style="text-align:center;padding:40px;color:#E74C3C">Error: ' + err.message + '</div>';
    });
}

function renderThematicClusters(companies, scheduleData, grid) {
  // Build a lookup: company_name -> session info
  var sessionLookup = {};
  if (scheduleData && scheduleData.sessions) {
    scheduleData.sessions.forEach(function(s) {
      (s.slots || []).forEach(function(sl) {
        sessionLookup[sl.company_name] = {
          sessionNumber: s.session_number,
          sessionTheme: s.session_theme || 'Session ' + s.session_number
        };
      });
    });
  }

  // Normalize status to broader categories for clustering
  function normalizeStatus(s) {
    if (!s) return 'Other';
    var sl = s.toLowerCase();
    if (sl.indexOf('producer') >= 0) return 'Producer';
    if (sl.indexOf('royalty') >= 0 || sl.indexOf('streaming') >= 0) return 'Royalty / Streaming';
    if (sl.indexOf('developer') >= 0 || sl.indexOf('construction') >= 0 || sl.indexOf('feasibility') >= 0) return 'Developer';
    if (sl.indexOf('explorer') >= 0) return 'Explorer';
    if (sl.indexOf('bullion') >= 0) return 'Bullion';
    return s;
  }

  // Determine best geo label: use country, fall back to subregion
  function geoLabel(c) {
    return c.primary_country || c.primary_subregion || c.primary_region || 'Global';
  }

  var MIN_CLUSTER = 5; // Clusters with fewer than this get promoted to broader geo

  // Pass 1: Cluster by (mineral, country, normalized status)
  var pass1 = {};
  companies.forEach(function(c) {
    var mineral = c.primary_mineral || 'Other';
    var geo = geoLabel(c);
    var status = normalizeStatus(c.company_status);
    var key = status + '|' + mineral + '|' + geo;
    if (!pass1[key]) pass1[key] = { status: status, mineral: mineral, geo: geo, companies: [] };
    pass1[key].companies.push(c);
  });

  // Pass 2: Small clusters (< MIN_CLUSTER) promote to subregion
  var pass2 = {};
  Object.keys(pass1).forEach(function(k) {
    var cl = pass1[k];
    if (cl.companies.length >= MIN_CLUSTER) {
      if (!pass2[k]) pass2[k] = { status: cl.status, mineral: cl.mineral, geo: cl.geo, companies: [] };
      pass2[k].companies = pass2[k].companies.concat(cl.companies);
    } else {
      cl.companies.forEach(function(c) {
        var subregion = c.primary_subregion || c.primary_region || 'Global';
        var subKey = cl.status + '|' + cl.mineral + '|' + subregion;
        if (!pass2[subKey]) pass2[subKey] = { status: cl.status, mineral: cl.mineral, geo: subregion, companies: [] };
        pass2[subKey].companies.push(c);
      });
    }
  });

  // Pass 3: Still-small clusters promote to region
  var final = {};
  Object.keys(pass2).forEach(function(k) {
    var cl = pass2[k];
    if (cl.companies.length >= MIN_CLUSTER) {
      if (!final[k]) final[k] = { status: cl.status, mineral: cl.mineral, geo: cl.geo, companies: [] };
      final[k].companies = final[k].companies.concat(cl.companies);
    } else {
      cl.companies.forEach(function(c) {
        var region = c.primary_region || 'Global';
        var regKey = cl.status + '|' + cl.mineral + '|' + region;
        if (!final[regKey]) final[regKey] = { status: cl.status, mineral: cl.mineral, geo: region, companies: [] };
        final[regKey].companies.push(c);
      });
    }
  });

  // Sort companies within each cluster by mcap desc
  var clusterList = Object.keys(final).map(function(k) { return final[k]; });
  clusterList.forEach(function(cl) {
    cl.companies.sort(function(a, b) { return (b.market_cap_usd || 0) - (a.market_cap_usd || 0); });
    cl.topMcap = cl.companies[0].market_cap_usd || 0;
    cl.totalMcap = cl.companies.reduce(function(s, c) { return s + (c.market_cap_usd || 0); }, 0);
  });

  // Group clusters by status, then sort within each by total mcap
  var statusOrder = ['Producer', 'Royalty / Streaming', 'Developer', 'Explorer', 'Bullion', 'Other'];
  var byStatus = {};
  clusterList.forEach(function(cl) {
    if (!byStatus[cl.status]) byStatus[cl.status] = [];
    byStatus[cl.status].push(cl);
  });
  Object.keys(byStatus).forEach(function(st) {
    byStatus[st].sort(function(a, b) { return b.totalMcap - a.totalMcap; });
  });

  // Count stats
  var totalClusters = clusterList.length;
  var multiClusters = clusterList.filter(function(cl) { return cl.companies.length > 1; }).length;
  var singletons = totalClusters - multiClusters;

  var html = '';
  html += '<div style="margin-bottom:16px;font-size:12px;color:var(--text-secondary)">';
  html += '<strong>' + totalClusters + '</strong> thematic clusters (' + multiClusters + ' multi-company, ' + singletons + ' singletons) from <strong>' + companies.length + '</strong> companies';
  html += '</div>';

  statusOrder.forEach(function(status) {
    var groupClusters = byStatus[status];
    if (!groupClusters || groupClusters.length === 0) return;

    var groupCount = groupClusters.reduce(function(s, cl) { return s + cl.companies.length; }, 0);
    html += '<div class="thematics-status-group">';
    html += '<div class="thematics-status-header">' + escHtml(status) + 's <span style="font-size:12px;font-weight:400;color:#999">(' + groupCount + ' companies, ' + groupClusters.length + ' clusters)</span></div>';
    html += '<div class="thematics-grid">';

    groupClusters.forEach(function(cl) {
      var isSingleton = cl.companies.length === 1;
      var cardClass = isSingleton ? 'thematic-card thematic-singleton' : 'thematic-card';
      var title = cl.status + 's — ' + cl.geo + ' — ' + cl.mineral;

      html += '<div class="' + cardClass + '">';
      html += '<div class="thematic-card-header">';
      html += '<span class="tc-mineral" style="background:' + mineralColor(cl.mineral) + '"></span>';
      html += '<span class="tc-title">' + escHtml(title) + '</span>';
      html += '<span class="tc-count">' + cl.companies.length + '</span>';
      html += '</div>';

      cl.companies.forEach(function(c, idx) {
        var sess = sessionLookup[c.company_name];
        var allocClass = sess ? 'thematic-company tc-allocated' : 'thematic-company tc-unallocated';
        html += '<div class="' + allocClass + '" data-programmed="' + (c.programmed ? 'true' : 'false') + '">';
        html += '<span class="tc-rank">' + (idx + 1) + '</span>';
        html += '<span class="tc-status-dot" style="background:' + statusColor(c.company_status) + '" title="' + escHtml(c.company_status) + '"></span>';
        html += '<span class="tc-name" title="' + escHtml(c.company_name) + '">' + escHtml(c.company_name) + '</span>';
        if (sess) {
          html += '<span class="tc-session-badge">S' + sess.sessionNumber + '</span>';
        } else {
          html += '<span class="ts-unpaid-badge" style="background:#F39C12">UNPLACED</span>';
        }
        html += '<span class="tc-mcap">' + formatMcap(c.market_cap_usd) + '</span>';
        html += '</div>';
      });

      html += '</div>';
    });

    html += '</div></div>';
  });

  grid.innerHTML = html;
  applyProgFilter();
}

// ---- Unallocated Companies ----
function renderUnallocated(unallocated) {
  var el = document.getElementById('unallocated-section');
  if (!el) return;
  if (!unallocated || unallocated.length === 0) {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  var countEl = document.getElementById('unallocated-count');
  if (countEl) countEl.textContent = unallocated.length;

  // Group by day-appropriate buckets: mineral + status
  var groups = {};
  unallocated.forEach(function(c) {
    var key = (c.primary_mineral || 'Other') + ' — ' + (c.company_status || 'Unknown');
    if (!groups[key]) groups[key] = [];
    groups[key].push(c);
  });

  var html = '';
  Object.keys(groups).sort().forEach(function(key) {
    html += '<div class="unalloc-group">';
    html += '<div class="unalloc-group-label">' + escHtml(key) + ' (' + groups[key].length + ')</div>';
    groups[key].sort(function(a, b) { return (b.market_cap_usd || 0) - (a.market_cap_usd || 0); });
    groups[key].forEach(function(c) {
      var isUnpaid = (c.payment_status || '').toLowerCase() === 'unpaid';
      var unpaidClass = isUnpaid ? ' holding-item-unpaid' : '';
      html += '<div class="holding-item' + unpaidClass + '" draggable="true" data-company-name="' + escHtml(c.company_name) + '" data-programmed="' + (c.programmed ? 'true' : 'false') + '">';
      html += '<span class="ts-mineral" style="background:' + mineralColor(c.primary_mineral) + '"></span>';
      html += '<span class="holding-name">' + escHtml(c.company_name) + '</span>';
      if (isUnpaid) html += '<span class="ts-unpaid-badge">UNPAID</span>';
      html += '<span class="ts-status" style="color:' + statusColor(c.company_status) + '">' + escHtml(c.company_status || '') + '</span>';
      html += '<span class="ts-mcap">' + formatMcap(c.market_cap_usd) + '</span>';
      html += '</div>';
    });
    html += '</div>';
  });

  var itemsEl = document.getElementById('unallocated-items');
  if (itemsEl) {
    itemsEl.innerHTML = html;
    applyProgFilter();
    // Make unallocated items draggable (same as holding bucket)
    itemsEl.querySelectorAll('.holding-item[draggable]').forEach(function(el) {
      el.addEventListener('dragstart', function(e) {
        var name = el.getAttribute('data-company-name');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'holding:' + name);
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', function(e) {
        el.classList.remove('dragging');
      });
    });
  }
}

function saveDayTime(el) {
  var dayLabel = el.getAttribute('data-day');
  var field = el.getAttribute('data-field');
  var value = el.value;

  if (!dayLabel || !field || !value) return;

  // Gather all time fields for this day from the DOM
  var inputs = document.querySelectorAll('.day-time-input[data-day="' + dayLabel + '"]');
  var times = {};
  inputs.forEach(function(inp) {
    times[inp.getAttribute('data-field')] = inp.value;
  });

  // Also carry over lunch times from config if not in the DOM
  var cfg = _config || {};
  var existingOv = (cfg.day_overrides || {})[dayLabel] || {};
  if (!times.lunch_start_time) times.lunch_start_time = existingOv.lunch_start_time || cfg.lunch_start_time || '12:00';
  if (!times.lunch_end_time) times.lunch_end_time = existingOv.lunch_end_time || cfg.lunch_end_time || '13:30';

  showMessage('Saving ' + dayLabel + ' times...', 'info');

  fetch('/api/sessions', {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({
      action: 'save-day-times',
      event_code: _currentEvent,
      day: dayLabel,
      times: times
    })
  })
  .then(checkAuth)
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.ok) {
      // Update local config cache
      if (!_config.day_overrides) _config.day_overrides = {};
      _config.day_overrides[dayLabel] = times;
      showMessage(dayLabel + ' times saved. Rebuilding program...', 'info');
      // Auto-rebuild program to recalculate sessions for the changed day
      return fetch('/api/sessions', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ action: 'build-program', event_code: _currentEvent })
      });
    } else {
      showMessage('Error: ' + (d.error || 'Unknown'), 'error');
      return null;
    }
  })
  .then(function(r) {
    if (!r) return;
    return r.json();
  })
  .then(function(d) {
    if (!d) return;
    if (d.ok) {
      showMessage(d.message, 'success');
      updateSlotCalc();
      loadSchedule();
    } else {
      showMessage('Rebuild error: ' + (d.error || 'Unknown'), 'error');
    }
  })
  .catch(function(err) {
    showMessage('Error: ' + err.message, 'error');
  });
}

function renderSessionCard(s) {
  var hasCompanies = s.slots && s.slots.length > 0;
  var filledClass = hasCompanies ? '' : ' session-empty';

  var html = '<div class="session-card' + filledClass + '" data-session-id="' + s.id + '">';
  html += '<div class="session-header">';
  var priVal = (s.priority !== null && s.priority !== undefined) ? s.priority : '';
  var priClass = priVal === '' ? 'priority-input priority-unset' : 'priority-input';
  html += '<input type="number" class="' + priClass + '" data-session-id="' + s.id + '" value="' + priVal + '" min="1" placeholder="\u2014" title="Priority (fill order) \u2014 set before generating">';
  html += '<span class="session-title" contenteditable="true" data-session-id="' + s.id + '" data-field="theme" title="Click to edit theme">' +
    escHtml(s.session_theme || 'Session ' + s.session_number) + '</span>';
  html += '<span class="session-meta">';
  html += '<span class="session-stage">' + escHtml(s.stage) + '</span>';
  html += '<span class="session-block">' + escHtml(s.time_block || '') + '</span>';
  html += '<span class="session-slot-count">' + (s.slots ? s.slots.length : 0) + '/' + (s.max_slots || 6) + '</span>';
  html += '</span>';
  html += '</div>';

  var maxSlots = s.max_slots || 6;
  for (var i = 1; i <= maxSlots; i++) {
    var slot = null;
    if (s.slots) {
      for (var j = 0; j < s.slots.length; j++) {
        if (s.slots[j].slot_in_session === i) { slot = s.slots[j]; break; }
      }
    }
    html += renderSlotZone(s.id, i, slot);
  }

  html += '</div>';
  return html;
}

function renderSlotZone(sessionId, slotNum, slot) {
  var html = '<div class="slot-drop-zone" data-session-id="' + sessionId + '" data-slot="' + slotNum + '">';
  if (slot) {
    var slotTooltip = escHtml(slot.company_name);
    if (slot.geography) slotTooltip += ' — ' + escHtml(slot.geography);
    if (slot.primary_mineral) slotTooltip += ' (' + escHtml(slot.primary_mineral) + ')';
    html += '<div class="slot-card" draggable="true" data-slot-id="' + slot.id + '" data-session-id="' + sessionId + '" data-programmed="' + (slot.programmed ? 'true' : 'false') + '" title="' + slotTooltip + '">';
    html += '<span class="slot-num">' + slotNum + '</span>';
    html += '<span class="slot-mineral" style="background:' + mineralColor(slot.primary_mineral) + '" title="' + escHtml(slot.primary_mineral) + '"></span>';
    html += '<span class="slot-name">' + escHtml(slot.company_name) + '</span>';
    html += '<span class="slot-status" style="color:' + statusColor(slot.company_status) + '">' + escHtml(slot.company_status) + '</span>';
    html += '<span class="slot-mcap">' + formatMcap(slot.market_cap_usd) + '</span>';
    html += '<span class="slot-tier" style="background:' + tierColor(slot.mcap_tier) + '">' + escHtml(TIER_LABELS[slot.mcap_tier] || '') + '</span>';
    html += '</div>';
  } else {
    html += '<div class="empty-slot">' + slotNum + '. <span style="color:#D0D4DE">Empty</span></div>';
  }
  html += '</div>';
  return html;
}

// ---- Priority Editing ----
function initPriorityEditing() {
  // Priority input: save on blur or Enter
  document.querySelectorAll('.priority-input').forEach(function(el) {
    el.addEventListener('change', function() {
      savePriority(el);
    });
    el.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    });
  });

  // Theme editing: save on blur
  document.querySelectorAll('.session-title[contenteditable]').forEach(function(el) {
    el.addEventListener('blur', function() {
      saveTheme(el);
    });
    el.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    });
  });
}

function savePriority(el) {
  var sessionId = parseInt(el.getAttribute('data-session-id'));
  var newPriority = parseInt(el.value);

  if (!newPriority || newPriority < 1) {
    showMessage('Priority must be a positive integer.', 'error');
    return;
  }

  fetch('/api/sessions', {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({
      action: 'update-priority',
      session_id: sessionId,
      priority: newPriority
    })
  })
  .then(checkAuth)
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.ok) {
      // Mark the input as saved
      el.classList.add('priority-saved');
      el.classList.remove('priority-unset');
      setTimeout(function() { el.classList.remove('priority-saved'); }, 1500);
      // Update local schedule cache so stats are accurate
      if (_schedule && _schedule.sessions) {
        _schedule.sessions.forEach(function(s) {
          if (s.id === sessionId) s.priority = newPriority;
        });
        updateStats(_schedule.stats || {});
      }
      if (d.warning) {
        showMessage(d.warning, 'error');
      } else {
        showMessage(d.message, 'success');
      }
    } else {
      showMessage('Error: ' + (d.error || 'Unknown'), 'error');
    }
  })
  .catch(function(err) {
    showMessage('Error: ' + err.message, 'error');
  });
}

function saveTheme(el) {
  var sessionId = parseInt(el.getAttribute('data-session-id'));
  var newTheme = el.textContent.trim();

  fetch('/api/sessions', {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({
      action: 'update-theme',
      session_id: sessionId,
      session_theme: newTheme
    })
  })
  .then(checkAuth)
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (!d.ok) {
      showMessage('Theme update failed: ' + (d.error || 'Unknown'), 'error');
    }
  })
  .catch(function(err) {
    showMessage('Theme error: ' + err.message, 'error');
  });
}

// ---- Drag and Drop ----
function initDragDrop() {
  document.querySelectorAll('.slot-card').forEach(function(el) {
    el.addEventListener('dragstart', onDragStart);
    el.addEventListener('dragend', onDragEnd);
  });
  document.querySelectorAll('.slot-drop-zone').forEach(function(el) {
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop', onDrop);
  });
}

function onDragStart(e) {
  _dragSlotId = e.target.getAttribute('data-slot-id');
  _dragSourceSessionId = e.target.getAttribute('data-session-id');
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', _dragSlotId);
}

function onDragEnd(e) {
  e.target.classList.remove('dragging');
  document.querySelectorAll('.slot-drop-zone.drag-over').forEach(function(el) {
    el.classList.remove('drag-over');
  });
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function onDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function onDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');

  var slotId = e.dataTransfer.getData('text/plain');
  var targetSessionId = e.currentTarget.getAttribute('data-session-id');
  var targetSlot = e.currentTarget.getAttribute('data-slot');

  if (!slotId || !targetSessionId || !targetSlot) return;

  persistMove(parseInt(slotId), parseInt(targetSessionId), parseInt(targetSlot));
}

function persistMove(slotId, targetSessionId, targetSlot) {
  showMessage('Moving...', 'info');

  fetch('/api/sessions', {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({
      action: 'move-slot',
      slot_id: slotId,
      target_session_id: targetSessionId,
      target_slot: targetSlot
    })
  })
  .then(checkAuth)
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.ok) {
      showMessage('Moved successfully', 'success');
      loadSchedule();
    } else {
      showMessage('Move failed: ' + (d.error || 'Unknown'), 'error');
    }
  })
  .catch(function(err) {
    showMessage('Move error: ' + err.message, 'error');
  });
}

// ---- Generate (fill companies into program) ----
function generateSchedule() {
  if (!confirm('This will fill (or re-fill) companies into the session program for ' + _currentEvent + ', replacing any manual slot assignments. Session structure and priorities are preserved. Continue?')) return;

  var btn = document.getElementById('generate-btn');
  btn.disabled = true;
  btn.textContent = 'Generating...';
  showMessage('Generating schedule...', 'info');

  fetch('/api/sessions', {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({ action: 'generate', event_code: _currentEvent })
  })
  .then(checkAuth)
  .then(function(r) { return r.json(); })
  .then(function(d) {
    btn.disabled = false;
    btn.textContent = 'Generate Schedule';
    if (d.ok) {
      showMessage(d.message, 'success');
      loadSchedule();
    } else {
      showMessage('Error: ' + (d.error || 'Unknown'), 'error');
    }
  })
  .catch(function(err) {
    btn.disabled = false;
    btn.textContent = 'Generate Schedule';
    showMessage('Error: ' + err.message, 'error');
  });
}

// ---- Clear ----
function clearSchedule() {
  if (!confirm('Delete ALL sessions for ' + _currentEvent + '? This cannot be undone.')) return;

  fetch('/api/sessions', {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({ action: 'clear', event_code: _currentEvent })
  })
  .then(checkAuth)
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.ok) {
      showMessage(d.message, 'success');
      loadSchedule();
    } else {
      showMessage('Error: ' + (d.error || 'Unknown'), 'error');
    }
  });
}

// ---- Export ----
function exportSchedule(format) {
  showMessage('Exporting ' + format.toUpperCase() + '...', 'info');

  fetch('/api/sessions', {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({ action: 'export', event_code: _currentEvent, format: format })
  })
  .then(checkAuth)
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (!d.ok) { showMessage('Export error: ' + (d.error || 'Unknown'), 'error'); return; }

    var content, filename, mime;
    if (format === 'json') {
      content = JSON.stringify(d.data, null, 2);
      filename = _currentEvent.toLowerCase() + '_session_allocation.json';
      mime = 'application/json';
    } else {
      content = d.csv;
      filename = _currentEvent.toLowerCase() + '_session_allocation.csv';
      mime = 'text/csv';
    }

    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showMessage('Exported ' + filename, 'success');
  })
  .catch(function(err) { showMessage('Export error: ' + err.message, 'error'); });
}

// ---- Presenting Companies Upload ----
function loadCompaniesCount() {
  fetch('/api/sessions?action=companies&event_code=' + _currentEvent, { headers: apiHeaders() })
    .then(checkAuth)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var el = document.getElementById('companies-count');
      if (d.ok && d.count > 0) {
        el.textContent = d.count + ' companies loaded';
        el.style.color = '#1E8449';
      } else {
        el.textContent = 'No companies uploaded';
        el.style.color = 'var(--text-secondary)';
      }
    })
    .catch(function() {});
}

function uploadPresentingCompanies() {
  var input = document.getElementById('companies-import-file');
  if (!input.files.length) return;

  var file = input.files[0];
  var isJSON = file.name.endsWith('.json');
  var btn = document.getElementById('companies-import-btn');
  btn.disabled = true;
  btn.textContent = 'Uploading...';
  showMessage('Reading file...', 'info');

  file.text().then(function(text) {
    var companies;
    if (isJSON) {
      companies = JSON.parse(text);
      if (!Array.isArray(companies)) throw new Error('JSON must be an array');
    } else {
      var lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(function(l) { return l.trim(); });
      if (lines.length < 2) throw new Error('CSV must have a header and data');
      var headers = parseCSVLine(lines[0]);
      companies = [];
      for (var i = 1; i < lines.length; i++) {
        var vals = parseCSVLine(lines[i]);
        var row = {};
        headers.forEach(function(h, idx) { row[h.trim()] = (vals[idx] || '').trim(); });
        companies.push(row);
      }
    }

    showMessage('Uploading ' + companies.length + ' companies...', 'info');

    return fetch('/api/sessions', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ action: 'import-companies', event_code: _currentEvent, companies: companies })
    });
  })
  .then(checkAuth)
  .then(function(r) { return r.json(); })
  .then(function(d) {
    btn.disabled = false;
    btn.textContent = 'Upload Companies';
    input.value = '';
    if (d.ok) {
      showMessage(d.message, 'success');
      loadCompaniesCount();
    } else {
      showMessage('Error: ' + (d.error || 'Unknown'), 'error');
    }
  })
  .catch(function(err) {
    btn.disabled = false;
    btn.textContent = 'Upload Companies';
    input.value = '';
    showMessage('Error: ' + err.message, 'error');
  });
}

// ---- Import Schedule ----
function handleImportFile(input) {
  if (!input.files.length) return;
  var file = input.files[0];
  var isJSON = file.name.endsWith('.json');

  if (!confirm('This will replace the entire schedule for ' + _currentEvent + ' with the imported file. Continue?')) {
    input.value = '';
    return;
  }

  showMessage('Reading file...', 'info');

  file.text().then(function(text) {
    var rows;
    if (isJSON) {
      rows = JSON.parse(text);
      if (!Array.isArray(rows)) {
        showMessage('JSON file must be an array of objects.', 'error');
        input.value = '';
        return;
      }
    } else {
      var lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(function(l) { return l.trim(); });
      if (lines.length < 2) { showMessage('CSV must have a header row and data.', 'error'); input.value = ''; return; }
      var headers = parseCSVLine(lines[0]);
      rows = [];
      for (var i = 1; i < lines.length; i++) {
        var vals = parseCSVLine(lines[i]);
        var row = {};
        headers.forEach(function(h, idx) { row[h.trim()] = (vals[idx] || '').trim(); });
        rows.push(row);
      }
    }

    showMessage('Uploading ' + rows.length + ' rows...', 'info');

    return fetch('/api/sessions', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ action: 'import', event_code: _currentEvent, rows: rows })
    });
  })
  .then(checkAuth)
  .then(function(r) { return r.json(); })
  .then(function(d) {
    input.value = '';
    if (d.ok) {
      showMessage(d.message, 'success');
      loadSchedule();
    } else {
      showMessage('Import error: ' + (d.error || 'Unknown'), 'error');
    }
  })
  .catch(function(err) {
    input.value = '';
    showMessage('Import error: ' + err.message, 'error');
  });
}

function parseCSVLine(line) {
  var fields = [];
  var current = '';
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = false; }
      } else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { fields.push(current); current = ''; }
      else { current += ch; }
    }
  }
  fields.push(current);
  return fields;
}

// ---- Messages ----
function showMessage(msg, type) {
  var el = document.getElementById('message-bar');
  el.textContent = msg;
  el.className = 'message-bar ' + (type || 'info');
  el.style.display = 'block';
  if (type === 'success' || type === 'info') {
    setTimeout(function() { el.style.display = 'none'; }, 4000);
  }
}

// ---- Programmed Filter ----
function toggleProgFilter(val) {
  if (_progFilter === val) {
    _progFilter = null; // toggle off
  } else {
    _progFilter = val;
  }
  updateProgFilterUI();
  applyProgFilter();
}

function clearProgFilter() {
  _progFilter = null;
  updateProgFilterUI();
  applyProgFilter();
}

function updateProgFilterUI() {
  var chips = document.querySelectorAll('.prog-chip');
  chips.forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-prog') === _progFilter);
  });
  var resetBtn = document.getElementById('prog-filter-reset');
  if (resetBtn) resetBtn.style.display = _progFilter ? 'inline-block' : 'none';
}

function updateProgCounts(stats) {
  var yesEl = document.getElementById('prog-yes-count');
  var noEl = document.getElementById('prog-no-count');
  if (yesEl) yesEl.textContent = stats.programmedCount || 0;
  if (noEl) noEl.textContent = stats.unprogrammedCount || 0;
}

function applyProgFilter() {
  var grid = document.getElementById('schedule-grid');
  if (!grid) return;

  if (!_progFilter) {
    grid.classList.remove('prog-filter-active');
    grid.querySelectorAll('.prog-hidden').forEach(function(el) {
      el.classList.remove('prog-hidden');
    });
    return;
  }

  grid.classList.add('prog-filter-active');
  var match = _progFilter === 'yes';

  // Tag slot-cards (day view)
  grid.querySelectorAll('.slot-card[data-programmed]').forEach(function(el) {
    var isProg = el.getAttribute('data-programmed') === 'true';
    el.classList.toggle('prog-hidden', isProg !== match);
  });

  // Tag track-slots (track view)
  grid.querySelectorAll('.track-slot[data-programmed]').forEach(function(el) {
    var isProg = el.getAttribute('data-programmed') === 'true';
    el.classList.toggle('prog-hidden', isProg !== match);
  });

  // Tag holding-items
  grid.querySelectorAll('.holding-item[data-programmed]').forEach(function(el) {
    var isProg = el.getAttribute('data-programmed') === 'true';
    el.classList.toggle('prog-hidden', isProg !== match);
  });

  // Tag thematic companies
  grid.querySelectorAll('.thematic-company[data-programmed]').forEach(function(el) {
    var isProg = el.getAttribute('data-programmed') === 'true';
    el.classList.toggle('prog-hidden', isProg !== match);
  });
}

// ---- Init ----
function initSessionAllocator() {
  if (!getToken()) {
    window.location.href = '/admin';
    return;
  }

  // Tab handlers
  document.querySelectorAll('.event-tab').forEach(function(el) {
    el.addEventListener('click', function() {
      switchEvent(el.getAttribute('data-event'));
    });
  });

  // Config form change handlers for live slot calc
  var cfgInputs = ['cfg-start-date', 'cfg-end-date', 'cfg-day-start', 'cfg-day-end', 'cfg-duration', 'cfg-morning-tracks', 'cfg-afternoon-tracks', 'cfg-lunch-start', 'cfg-lunch-end'];
  cfgInputs.forEach(function(id) {
    document.getElementById(id).addEventListener('change', updateSlotCalc);
    document.getElementById(id).addEventListener('input', updateSlotCalc);
  });

  // Enable upload button when file selected
  document.getElementById('companies-import-file').addEventListener('change', function() {
    document.getElementById('companies-import-btn').disabled = !this.files.length;
  });

  // Load initial data
  switchEvent('MFE26');
}

document.addEventListener('DOMContentLoaded', initSessionAllocator);
