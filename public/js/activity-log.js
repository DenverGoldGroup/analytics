// Activity Log — 30-day user action report
// Available to admins and vendors (viewers)

(function() {
  var API = '/api/psr';
  var PAGE_SIZE = 50;
  var allLogs = [];
  var filteredLogs = [];
  var currentPage = 0;

  // ── Auth ─────────────────────────────────────────────
  function getToken() {
    return sessionStorage.getItem('admin_token') || sessionStorage.getItem('psr_token') || '';
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

  // ── Init ─────────────────────────────────────────────
  function init() {
    var role = detectRole();
    if (!role) {
      showAuthGate();
      return;
    }
    buildNav(role);
    loadLogs();
  }

  function showAuthGate() {
    var el = document.getElementById('al-content');
    el.innerHTML =
      '<div class="al-auth-gate">' +
      '<h3>Authentication Required</h3>' +
      '<p>Please sign in to view the activity log.</p>' +
      '<div style="margin-top:20px">' +
      '<a href="/admin" style="display:inline-block;padding:10px 24px;background:var(--color-gold);color:#fff;font-weight:600;border-radius:8px;text-decoration:none;font-size:13px;margin-right:8px">Admin Login</a>' +
      '<a href="/psr-login" style="display:inline-block;padding:10px 24px;border:2px solid #E0E0E0;border-radius:8px;text-decoration:none;font-size:13px;color:var(--text-primary);font-weight:600">PSR Login</a>' +
      '</div></div>';
  }

  function buildNav(role) {
    var nav = document.getElementById('al-nav-links');
    var html = '';
    if (role === 'admin') {
      html += '<a href="/admin" class="btn">Admin</a>';
    }
    html += '<a href="/" class="btn">View Site</a>';
    html += '<button class="btn" onclick="sessionStorage.removeItem(\'admin_token\');sessionStorage.removeItem(\'psr_token\');window.location.href=\'/admin\'">Log Out</button>';
    nav.innerHTML = html;
  }

  // ── Load data ────────────────────────────────────────
  function loadLogs() {
    var el = document.getElementById('al-content');
    el.innerHTML = '<div class="al-loading"><div class="loading-spinner"></div>Loading activity log...</div>';

    fetch(API + '?action=activity-log', {
      headers: { 'Authorization': 'Bearer ' + getToken() }
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.ok) {
        el.innerHTML = '<div class="al-empty"><h3>Error</h3><p>' + (data.error || 'Failed to load logs') + '</p></div>';
        return;
      }
      allLogs = data.logs || [];
      filteredLogs = allLogs.slice();
      render();
    })
    .catch(function(err) {
      el.innerHTML = '<div class="al-empty"><h3>Connection Error</h3><p>' + err.message + '</p></div>';
    });
  }

  // ── Render ───────────────────────────────────────────
  function render() {
    var el = document.getElementById('al-content');
    if (!allLogs.length) {
      el.innerHTML = '<div class="al-empty"><h3>No Activity Yet</h3><p>User actions will appear here once the system starts logging.</p></div>';
      return;
    }

    var html = '';

    // Summary stats
    html += renderSummary();

    // Filters
    html += renderFilters();

    // Table
    html += renderTable();

    el.innerHTML = html;
    bindFilterEvents();
  }

  // ── Summary cards ────────────────────────────────────
  function renderSummary() {
    var totalActions = filteredLogs.length;
    var uniqueUsers = new Set(filteredLogs.map(function(l) { return l.user_email; })).size;
    var logins = filteredLogs.filter(function(l) { return l.action === 'login'; }).length;
    var views = filteredLogs.filter(function(l) { return l.action === 'view-report'; }).length;
    var edits = filteredLogs.filter(function(l) {
      return l.action !== 'login' && l.action !== 'view-report' &&
             l.action.indexOf('user-') !== 0;
    }).length;

    // Date range
    var newest = filteredLogs.length ? filteredLogs[0].created_at : null;
    var oldest = filteredLogs.length ? filteredLogs[filteredLogs.length - 1].created_at : null;
    var rangeStr = '';
    if (oldest && newest) {
      rangeStr = fmtDateShort(oldest) + ' — ' + fmtDateShort(newest);
    }

    return '<div class="al-summary">' +
      statCard(totalActions, 'Total Actions', '#2C3E50') +
      statCard(uniqueUsers, 'Unique Users', '#8B6914') +
      statCard(logins, 'Logins', '#1A5276') +
      statCard(views, 'Report Views', '#5D6D7E') +
      statCard(edits, 'Edits', '#7D6608') +
      (rangeStr ? '<div class="al-stat"><div class="num" style="font-size:13px;color:var(--text-secondary)">' + rangeStr + '</div><div class="lbl">Date Range</div></div>' : '') +
      '</div>';
  }

  function statCard(val, label, color) {
    return '<div class="al-stat"><div class="num" style="color:' + color + '">' + val + '</div><div class="lbl">' + label + '</div></div>';
  }

  // ── Filters ──────────────────────────────────────────
  function renderFilters() {
    // Unique users
    var users = [];
    var seen = {};
    allLogs.forEach(function(l) {
      if (!seen[l.user_email]) { users.push(l.user_email); seen[l.user_email] = true; }
    });
    users.sort();

    // Unique actions
    var actions = [];
    var aSeen = {};
    allLogs.forEach(function(l) {
      if (!aSeen[l.action]) { actions.push(l.action); aSeen[l.action] = true; }
    });
    actions.sort();

    // Unique events
    var events = [];
    var eSeen = {};
    allLogs.forEach(function(l) {
      if (l.event_code && !eSeen[l.event_code]) { events.push(l.event_code); eSeen[l.event_code] = true; }
    });
    events.sort();

    var html = '<div class="al-filters">';

    // User filter
    html += '<div class="al-filter-field"><label>User</label><select id="f-user"><option value="">All Users</option>';
    users.forEach(function(u) { html += '<option value="' + u + '">' + u + '</option>'; });
    html += '</select></div>';

    // Action filter
    html += '<div class="al-filter-field"><label>Action</label><select id="f-action"><option value="">All Actions</option>';
    actions.forEach(function(a) { html += '<option value="' + a + '">' + formatAction(a) + '</option>'; });
    html += '</select></div>';

    // Event filter
    html += '<div class="al-filter-field"><label>Event</label><select id="f-event"><option value="">All Events</option>';
    events.forEach(function(e) { html += '<option value="' + e + '">' + e + '</option>'; });
    html += '</select></div>';

    // Role filter
    html += '<div class="al-filter-field"><label>Role</label><select id="f-role"><option value="">All Roles</option><option value="admin">Admin</option><option value="viewer">Viewer</option></select></div>';

    // Search
    html += '<div class="al-filter-field"><label>Search</label><input type="text" id="f-search" placeholder="Search details..." style="width:160px"></div>';

    html += '<button class="al-filter-btn" onclick="window._alApplyFilters()">Filter</button>';
    html += '<button class="al-filter-reset" onclick="window._alResetFilters()">Reset</button>';

    html += '</div>';
    return html;
  }

  function bindFilterEvents() {
    // Enter key on search triggers filter
    var searchEl = document.getElementById('f-search');
    if (searchEl) {
      searchEl.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') window._alApplyFilters();
      });
    }
  }

  window._alApplyFilters = function() {
    var user = document.getElementById('f-user').value;
    var action = document.getElementById('f-action').value;
    var event = document.getElementById('f-event').value;
    var role = document.getElementById('f-role').value;
    var search = (document.getElementById('f-search').value || '').toLowerCase();

    filteredLogs = allLogs.filter(function(l) {
      if (user && l.user_email !== user) return false;
      if (action && l.action !== action) return false;
      if (event && l.event_code !== event) return false;
      if (role && l.user_role !== role) return false;
      if (search && (l.detail || '').toLowerCase().indexOf(search) === -1 &&
          (l.action || '').toLowerCase().indexOf(search) === -1 &&
          (l.user_email || '').toLowerCase().indexOf(search) === -1) return false;
      return true;
    });

    currentPage = 0;
    render();
  };

  window._alResetFilters = function() {
    filteredLogs = allLogs.slice();
    currentPage = 0;
    render();
  };

  // ── Table ────────────────────────────────────────────
  function renderTable() {
    var total = filteredLogs.length;
    var totalPages = Math.ceil(total / PAGE_SIZE);
    if (currentPage >= totalPages) currentPage = Math.max(0, totalPages - 1);
    var start = currentPage * PAGE_SIZE;
    var page = filteredLogs.slice(start, start + PAGE_SIZE);

    if (!page.length) {
      return '<div class="al-empty"><h3>No Matching Entries</h3><p>Try adjusting your filters.</p></div>';
    }

    var html = '<div class="al-table-wrap">';
    html += '<table class="al-table"><thead><tr>';
    html += '<th>Timestamp</th><th>User</th><th>Role</th><th>Event</th><th>Action</th><th>Detail</th>';
    html += '</tr></thead><tbody>';

    page.forEach(function(l) {
      html += '<tr>';
      html += '<td class="ts">' + fmtTimestamp(l.created_at) + '</td>';
      html += '<td class="user">' + escHtml(l.user_email) + '</td>';
      html += '<td><span class="role-badge ' + l.user_role + '">' + l.user_role + '</span></td>';
      html += '<td>' + (l.event_code || '<span style="color:#ccc">—</span>') + '</td>';
      html += '<td>' + actionBadge(l.action) + '</td>';
      html += '<td class="detail" title="' + escAttr(l.detail || '') + '">' + escHtml(l.detail || '—') + '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';

    // Pagination
    if (totalPages > 1) {
      html += '<div class="al-pagination">';
      html += '<span>Showing ' + (start + 1) + '–' + Math.min(start + PAGE_SIZE, total) + ' of ' + total + '</span>';
      html += '<div class="al-page-btns">';
      html += '<button class="al-page-btn" onclick="window._alPage(0)" ' + (currentPage === 0 ? 'disabled' : '') + '>«</button>';
      html += '<button class="al-page-btn" onclick="window._alPage(' + (currentPage - 1) + ')" ' + (currentPage === 0 ? 'disabled' : '') + '>‹</button>';

      // Show max 5 page buttons around current
      var pStart = Math.max(0, currentPage - 2);
      var pEnd = Math.min(totalPages, pStart + 5);
      if (pEnd - pStart < 5) pStart = Math.max(0, pEnd - 5);
      for (var p = pStart; p < pEnd; p++) {
        html += '<button class="al-page-btn' + (p === currentPage ? ' active' : '') + '" onclick="window._alPage(' + p + ')">' + (p + 1) + '</button>';
      }

      html += '<button class="al-page-btn" onclick="window._alPage(' + (currentPage + 1) + ')" ' + (currentPage >= totalPages - 1 ? 'disabled' : '') + '>›</button>';
      html += '<button class="al-page-btn" onclick="window._alPage(' + (totalPages - 1) + ')" ' + (currentPage >= totalPages - 1 ? 'disabled' : '') + '>»</button>';
      html += '</div></div>';
    }

    html += '</div>';
    return html;
  }

  window._alPage = function(p) {
    currentPage = p;
    // Re-render just the table portion
    render();
    window.scrollTo(0, 0);
  };

  // ── Formatting helpers ───────────────────────────────
  function fmtTimestamp(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    var mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    var day = d.getDate();
    var h = d.getHours();
    var m = String(d.getMinutes()).padStart(2, '0');
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return mon + ' ' + day + ', ' + h + ':' + m + ' ' + ampm;
  }

  function fmtDateShort(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    return mon + ' ' + d.getDate();
  }

  function formatAction(a) {
    return a.replace(/-/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
  }

  function actionBadge(action) {
    var cls = 'view';
    if (action === 'login') cls = 'login';
    else if (action === 'view-report') cls = 'view';
    else if (action.indexOf('user-') === 0) cls = 'user';
    else if (action.indexOf('delete') >= 0 || action.indexOf('remove') >= 0) cls = 'delete';
    else if (action.indexOf('upload') >= 0 || action === 'cover-save') cls = 'upload';
    else cls = 'edit';
    return '<span class="action-badge ' + cls + '">' + formatAction(action) + '</span>';
  }

  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function escAttr(s) {
    return s.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Boot ─────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
