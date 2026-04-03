// Main application controller with interactive filters
(function() {
  'use strict';

  // State
  var currentSection = 'dgg';
  var currentView = 'overview';
  var dataCache = {};
  var attendeesCache = {};
  var activeFilters = {
    mineral: null,
    status: null,
    country: null
  };

  // Section config
  var SECTIONS = {
    dgg: {
      title: 'Denver Gold Group Membership',
      subtitle: '{count} companies &mdash; Unduplicated membership across all DGG forums and events',
      tagline: '<a href="https://www.denvergold.org" target="_blank" rel="noopener" style="color:#D4A017;text-decoration:none">2026</a> &middot; <a href="https://www.denvergold.org" target="_blank" rel="noopener" style="color:#95A5A6;text-decoration:none">denvergold.org</a>',
      logo: '/logos/dgg-logo.png',
      keyColor: '#8B6914',
      accentClass: 'active-dgg',
      headerTheme: 'dgg-theme'
    },
    mfe: {
      title: 'Mining Forum Europe 2026',
      subtitle: '{count} accepted companies &mdash; Zurich, Switzerland',
      tagline: '13&ndash;15 April 2026 &middot; <a href="https://europe.miningforum.com" target="_blank" rel="noopener" style="color:#4CAF50;text-decoration:none">europe.miningforum.com</a>',
      logo: '/logos/mfe26-logo.png',
      keyColor: '#1B5E20',
      accentClass: 'active-mfe',
      headerTheme: 'mfe-theme'
    },
    mfa: {
      title: 'Mining Forum Americas 2026',
      subtitle: '{count} accepted companies &mdash; Colorado Springs, USA',
      tagline: '27&ndash;30 September 2026 &middot; <a href="https://americas.miningforum.com" target="_blank" rel="noopener" style="color:#7986CB;text-decoration:none">americas.miningforum.com</a>',
      logo: '/logos/mfa26-logo.png',
      keyColor: '#1A237E',
      accentClass: 'active-mfa',
      headerTheme: 'mfa-theme'
    }
  };

  // Initialize
  async function init() {
    try {
      // Start fetching spot prices early (non-blocking)
      fetchSpotPrices();
      setupNavigation();
      parseHash();
      await loadSection(currentSection);
    } catch (err) {
      console.error('Init error:', err);
      document.getElementById('content').innerHTML =
        '<div style="padding:40px;text-align:center;color:#E74C3C">' +
        '<h3>Error Loading Data</h3>' +
        '<p style="font-size:12px;color:#7F8C8D;margin-top:8px">' + escHtml(err.message || String(err)) + '</p>' +
        '</div>';
    }
  }

  function parseHash() {
    var hash = window.location.hash.replace('#', '');
    if (hash) {
      var parts = hash.split('/');
      if (SECTIONS[parts[0]]) currentSection = parts[0];
      if (parts[1]) currentView = parts[1];
    }
  }

  function setupNavigation() {
    // Section tabs
    document.querySelectorAll('.section-tabs a').forEach(function(tab) {
      tab.addEventListener('click', async function(e) {
        e.preventDefault();
        var section = tab.dataset.section;
        currentSection = section;
        currentView = 'overview';
        clearFilters();
        window.location.hash = section;
        await loadSection(section);
      });
    });

    // Sub-nav
    document.querySelectorAll('.nav-bar a').forEach(function(link) {
      link.addEventListener('click', async function(e) {
        e.preventDefault();
        var view = link.dataset.view;
        currentView = view;
        clearFilters();
        window.location.hash = currentSection + '/' + view;
        updateSubNav();
        await renderView();
      });
    });

    // Hash change
    window.addEventListener('hashchange', async function() {
      parseHash();
      clearFilters();
      await loadSection(currentSection);
    });
  }

  function updateSectionTabs() {
    document.querySelectorAll('.section-tabs a').forEach(function(tab) {
      tab.className = '';
      if (tab.dataset.section === currentSection) {
        tab.className = SECTIONS[currentSection].accentClass;
      }
    });
  }

  function updateSubNav() {
    document.querySelectorAll('.nav-bar a').forEach(function(link) {
      link.classList.toggle('active', link.dataset.view === currentView);
      // Hide Attendees tab for DGG section
      if (link.dataset.view === 'attendees') {
        link.style.display = currentSection === 'dgg' ? 'none' : '';
      }
    });
  }

  function updateHeader() {
    var cfg = SECTIONS[currentSection];
    var header = document.getElementById('page-header');

    // Remove old themes, add new
    header.classList.remove('dgg-theme', 'mfe-theme', 'mfa-theme');
    header.classList.add(cfg.headerTheme);

    document.getElementById('header-logo').src = cfg.logo;
    document.getElementById('header-title').innerHTML = cfg.title;
    document.getElementById('header-subtitle').innerHTML = cfg.subtitle;
    var taglineEl = document.querySelector('.page-header .tagline');
    if (taglineEl && cfg.tagline) {
      taglineEl.innerHTML = cfg.tagline;
    }
  }

  async function loadSection(section) {
    updateSectionTabs();
    updateSubNav();
    updateHeader();

    // Show loading
    document.getElementById('content').innerHTML =
      '<div class="loading"><div class="loading-spinner"></div>Loading data&hellip;</div>';

    // Fetch data if not cached
    if (!dataCache[section]) {
      if (section === 'dgg') {
        dataCache[section] = await fetchDGGCompanies();
      } else {
        var code = section === 'mfe' ? 'MFE26' : 'MFA26';
        dataCache[section] = await fetchEventParticipations(code);
        attendeesCache[section] = await fetchAttendees(code);
      }
    }

    await renderView();
  }

  async function renderView() {
    var data = dataCache[currentSection] || [];
    var container = document.getElementById('content');
    var cfg = SECTIONS[currentSection];

    // Map to common shape
    var companies = data.map(function(d) {
      return {
        id: d.company_id || d.id,
        company_name: d.company_name,
        company_status: d.company_status,
        primary_mineral: d.primary_mineral,
        primary_country: d.primary_country,
        primary_region: d.primary_region,
        primary_subregion: d.primary_subregion,
        primary_stock_exchange: d.primary_stock_exchange,
        stock_symbol: d.stock_symbol,
        ticker: d.ticker,
        market_cap_usd: d.market_cap_usd,
        market_cap_display: d.market_cap_display,
        production_low: d.production_low,
        production_high: d.production_high,
        reserves: d.reserves,
        resources: d.resources,
        one_year_return: d.one_year_return,
        profile_url: d.profile_url,
        // Event-specific fields
        presentation_type: d.presentation_type,
        presentation_date: d.presentation_date,
        presentation_time: d.presentation_time,
        presentation_location: d.presentation_location
      };
    });

    // Update header subtitle with actual count
    var subtitleEl = document.getElementById('header-subtitle');
    if (subtitleEl && cfg.subtitle) {
      subtitleEl.innerHTML = cfg.subtitle.replace('{count}', companies.length);
    }

    try {
      console.log('Rendering view:', currentView, '| Companies:', companies.length);
      if (currentView === 'overview') {
        container.innerHTML = renderOverview(companies, cfg);
        initOverviewCharts(companies, cfg);
      } else if (currentView === 'attendees') {
        var attendees = attendeesCache[currentSection] || [];
        container.innerHTML = renderAttendees(attendees, cfg);
        initAttendeesCharts(cfg);
      } else if (currentView === 'solitaire-mineral') {
        container.innerHTML = renderSolitaireByMineral(companies, cfg);
      } else if (currentView === 'solitaire-status') {
        container.innerHTML = renderSolitaireByStatus(companies, cfg);
      } else if (currentView === 'solitaire-country') {
        container.innerHTML = renderSolitaireByCountry(companies, cfg);
      } else if (currentView === 'all-companies') {
        var sectionAttendees = attendeesCache[currentSection] || [];
        container.innerHTML = renderAllCompanies(companies, cfg, sectionAttendees);
        attachAllCompaniesSort();
      } else if (currentView === 'flat-rank') {
        container.innerHTML = renderFlatRank(companies, cfg);
      }
    } catch (renderErr) {
      console.error('Render error [' + currentView + ']:', renderErr);
      container.innerHTML =
        '<div style="padding:40px;text-align:center;color:#E74C3C">' +
        '<h3>Render Error</h3>' +
        '<p style="font-size:12px;color:#7F8C8D;margin-top:8px">' + escHtml(renderErr.message || String(renderErr)) + '</p>' +
        '<p style="font-size:11px;margin-top:12px">View: ' + escHtml(currentView) + ' | Data: ' + companies.length + ' companies</p>' +
        '</div>';
    }

    // Re-attach filter listeners after render
    attachFilterListeners();

    // Backfill spot prices on pills if they loaded after render
    if (!_spotPrices && _spotPricesPromise) {
      _spotPricesPromise.then(function() {
        if (!_spotPrices) return;
        document.querySelectorAll('[data-spot-group]').forEach(function(el) {
          var g = el.getAttribute('data-spot-group');
          var spot = getSpotPrice(g);
          if (spot && spot.price && !el.textContent.trim()) {
            var changeClass = spot.change >= 0 ? 'spot-up' : 'spot-down';
            var arrow = spot.change >= 0 ? '&#9650;' : '&#9660;';
            el.innerHTML = formatSpotPrice(spot.price) +
              (spot.change_percent != null ? ' <span class="' + changeClass + '">' + arrow + ' ' + Math.abs(spot.change_percent).toFixed(2) + '%</span>' : '');
          }
        });
      });
    }
  }

  // =========================================================
  // INTERACTIVE FILTER SYSTEM
  // =========================================================

  function attachFilterListeners() {
    // Mineral pills
    document.querySelectorAll('[data-mineral-filter]').forEach(function(pill) {
      pill.addEventListener('click', function() {
        var mineral = pill.getAttribute('data-mineral-filter');
        if (activeFilters.mineral === mineral) {
          activeFilters.mineral = null;
        } else {
          activeFilters.mineral = mineral;
        }
        applyFilters();
      });
    });

    // Status chips
    document.querySelectorAll('[data-status-filter]').forEach(function(chip) {
      chip.addEventListener('click', function() {
        var status = chip.getAttribute('data-status-filter');
        if (activeFilters.status === status) {
          activeFilters.status = null;
        } else {
          activeFilters.status = status;
        }
        applyFilters();
      });
    });

    // Country pills
    document.querySelectorAll('[data-country-filter]').forEach(function(pill) {
      pill.addEventListener('click', function() {
        var country = pill.getAttribute('data-country-filter');
        if (activeFilters.country === country) {
          activeFilters.country = null;
        } else {
          activeFilters.country = country;
        }
        applyFilters();
      });
    });

    // Exchange pills
    document.querySelectorAll('[data-exchange-filter]').forEach(function(pill) {
      pill.addEventListener('click', function() {
        var exchange = pill.getAttribute('data-exchange-filter');
        if (activeFilters.exchange === exchange) {
          activeFilters.exchange = null;
        } else {
          activeFilters.exchange = exchange;
        }
        applyFilters();
      });
    });
  }

  function applyFilters() {
    // Update pill/chip visual states
    document.querySelectorAll('[data-mineral-filter]').forEach(function(pill) {
      var mineral = pill.getAttribute('data-mineral-filter');
      if (!activeFilters.mineral) {
        pill.classList.remove('active', 'dimmed');
      } else if (activeFilters.mineral === mineral) {
        pill.classList.add('active');
        pill.classList.remove('dimmed');
      } else {
        pill.classList.remove('active');
        pill.classList.add('dimmed');
      }
    });

    document.querySelectorAll('[data-status-filter]').forEach(function(chip) {
      var status = chip.getAttribute('data-status-filter');
      if (!activeFilters.status) {
        chip.classList.remove('active', 'dimmed');
      } else if (activeFilters.status === status) {
        chip.classList.add('active');
        chip.classList.remove('dimmed');
      } else {
        chip.classList.remove('active');
        chip.classList.add('dimmed');
      }
    });

    document.querySelectorAll('[data-country-filter]').forEach(function(pill) {
      var country = pill.getAttribute('data-country-filter');
      if (!activeFilters.country) {
        pill.classList.remove('active');
      } else if (activeFilters.country === country) {
        pill.classList.add('active');
      } else {
        pill.classList.remove('active');
      }
    });

    document.querySelectorAll('[data-exchange-filter]').forEach(function(pill) {
      var exchange = pill.getAttribute('data-exchange-filter');
      if (!activeFilters.exchange) {
        pill.classList.remove('active');
      } else if (activeFilters.exchange === exchange) {
        pill.classList.add('active');
      } else {
        pill.classList.remove('active');
      }
    });

    // Show/hide reset buttons
    var mineralReset = document.getElementById('mineral-reset');
    if (mineralReset) mineralReset.classList.toggle('visible', !!activeFilters.mineral);
    var statusReset = document.getElementById('status-reset');
    if (statusReset) statusReset.classList.toggle('visible', !!activeFilters.status);
    var countryReset = document.getElementById('country-reset');
    if (countryReset) countryReset.classList.toggle('visible', !!activeFilters.country);
    var exchangeReset = document.getElementById('exchange-reset');
    if (exchangeReset) exchangeReset.classList.toggle('visible', !!activeFilters.exchange);

    // Filter company cards
    document.querySelectorAll('.company-card, .flat-rank-item, .co-row').forEach(function(card) {
      var show = true;
      if (activeFilters.mineral && card.getAttribute('data-mineral') !== activeFilters.mineral) show = false;
      if (activeFilters.status && card.getAttribute('data-status') !== activeFilters.status) show = false;
      if (activeFilters.country && card.getAttribute('data-country') !== activeFilters.country) show = false;
      if (activeFilters.exchange && card.getAttribute('data-exchange') !== activeFilters.exchange) show = false;
      card.style.display = show ? '' : 'none';
    });

    // Filter table rows
    document.querySelectorAll('.data-table tbody tr[data-mineral]').forEach(function(row) {
      var show = true;
      if (activeFilters.mineral && row.getAttribute('data-mineral') !== activeFilters.mineral) show = false;
      if (activeFilters.status && row.getAttribute('data-status') !== activeFilters.status) show = false;
      if (activeFilters.country && row.getAttribute('data-country') !== activeFilters.country) show = false;
      if (activeFilters.exchange && row.getAttribute('data-exchange') !== activeFilters.exchange) show = false;
      row.style.display = show ? '' : 'none';
    });

    // Filter solitaire groups
    document.querySelectorAll('[data-mineral-group]').forEach(function(group) {
      if (activeFilters.mineral) {
        group.style.display = group.getAttribute('data-mineral-group') === activeFilters.mineral ? '' : 'none';
      } else {
        group.style.display = '';
      }
    });

    document.querySelectorAll('[data-status-group]').forEach(function(group) {
      if (activeFilters.status) {
        group.style.display = group.getAttribute('data-status-group') === activeFilters.status ? '' : 'none';
      } else {
        group.style.display = '';
      }
    });

    document.querySelectorAll('[data-country-group]').forEach(function(group) {
      if (activeFilters.country) {
        group.style.display = group.getAttribute('data-country-group') === activeFilters.country ? '' : 'none';
      } else {
        group.style.display = '';
      }
    });
  }

  function clearFilters() {
    activeFilters.mineral = null;
    activeFilters.status = null;
    activeFilters.country = null;
  }

  // Expose filter reset functions globally
  window.resetMineralFilter = function() {
    activeFilters.mineral = null;
    applyFilters();
  };

  window.resetStatusFilter = function() {
    activeFilters.status = null;
    applyFilters();
  };

  window.resetCountryFilter = function() {
    activeFilters.country = null;
    applyFilters();
  };

  window.resetExchangeFilter = function() {
    activeFilters.exchange = null;
    applyFilters();
  };

  // Expose re-render for sort handlers
  window._reRenderCurrentView = function() {
    renderView();
  };

  // Boot
  document.addEventListener('DOMContentLoaded', init);

})();
