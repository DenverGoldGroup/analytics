// Shared deal rendering functions — used by admin-deals.html and dealbook-deal.html
// Expects a DEAL object with: bidder, target, combined, terms, proForma, milestones, assets, growthPipeline, votingSupport, links
// All functions are attached to window.DealRenderer namespace

(function() {
  'use strict';

  // =========================================================
  // FORMATTERS
  // =========================================================
  // Currency symbol map: ISO code -> display prefix
  var CCY_SYMBOLS = { USD: 'US$', AUD: 'A$', CAD: 'C$', GBP: '£', EUR: '€', ZAR: 'R' };
  function ccySym(code) { return (code && CCY_SYMBOLS[code]) || '$'; }

  function fmtCurrency(n, decimals, ccy) {
    if (n == null || isNaN(n)) return '—';
    var d = decimals != null ? decimals : 0;
    var sym = ccySym(ccy);
    return sym + Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtM(n, ccy) {
    if (n == null || isNaN(n)) return '—';
    var sym = ccySym(ccy);
    if (Math.abs(n) >= 1000) return sym + (n / 1000).toFixed(1) + 'B';
    return sym + Number(n).toFixed(0) + 'M';
  }
  function fmtOz(n) {
    if (n == null || isNaN(n)) return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M oz';
    if (n >= 1000) return Math.round(n / 1000) + 'K oz';
    return Number(n).toLocaleString() + ' oz';
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    var parts = iso.split('-');
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[parseInt(parts[1], 10) - 1] + ' ' + parseInt(parts[2], 10) + ', ' + parts[0];
  }
  function fmtPct(n, d) { return n != null && !isNaN(n) ? n.toFixed(d != null ? d : 1) + '%' : '—'; }
  function fmtX(n) { return n != null && !isNaN(n) ? n.toFixed(1) + 'x' : '—'; }
  function fmtPerShare(n) {
    if (n == null || isNaN(n)) return '—';
    if (n >= 1) return n.toFixed(2);
    if (n >= 0.01) return n.toFixed(3);
    return n.toFixed(4);
  }
  // Exchange ratio as announced: up to 4 decimals below 1 (0.0966, 0.6947), 2 above; no trailing zeros
  function fmtXR(n) {
    if (n == null || isNaN(n)) return '—';
    var t = Number(n).toFixed(n < 1 ? 4 : 2);
    return t.indexOf('.') >= 0 ? t.replace(/0+$/, '').replace(/\.$/, '') : t;
  }
  function fmtNum(n) { return n != null && !isNaN(n) ? Number(n).toLocaleString('en-US') : '—'; }
  function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // Extract short exchange name: "Toronto Stock Exchange (TSX)" -> "TSX"
  function shortExchange(ex) {
    if (!ex) return '';
    var m = ex.match(/\(([^)]+)\)/);
    if (m) return m[1];
    return ex.length > 8 ? ex.replace(/\s+Exchange.*$/i, '') : ex;
  }

  // Database reserves/resources scale normalization
  function dbReservesToOz(val) {
    if (!val) return null;
    return val < 200 ? val * 1e6 : val * 1e3;
  }
  function dbProdToOz(val) {
    if (!val) return null;
    return val < 5000 ? val * 1e3 : val;
  }
  // Deal-level combined figures are entered in ounces, but some deals were saved in the
  // companies-table scale (Moz for reserves, koz for production). Normalise to ounces.
  function ozFromAny(val) {
    if (!val) return val;
    if (val < 200) return val * 1e6;      // Moz
    if (val < 200000) return val * 1e3;   // koz
    return val;
  }
  function normCombined(c) {
    var o = {};
    for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) o[k] = c[k];
    o.production = c.production ? dbProdToOz(c.production) : c.production;
    o.productionLow = c.productionLow ? dbProdToOz(c.productionLow) : c.productionLow;
    o.productionHigh = c.productionHigh ? dbProdToOz(c.productionHigh) : c.productionHigh;
    o.productionGrowth = c.productionGrowth ? dbProdToOz(c.productionGrowth) : c.productionGrowth;
    o.ppReserves = ozFromAny(c.ppReserves);
    o.miResources = ozFromAny(c.miResources);
    o.inferredResources = ozFromAny(c.inferredResources);
    return o;
  }
  // A party's M&I resources exclusive of reserves. The companies table holds some issuers'
  // M&I inclusive of reserves; the deal marks those with resourcesBasis: 'inclusive'.
  function resourcesExOz(co) {
    var r = dbReservesToOz(co.resources);
    if (!r) return null;
    if (co.resourcesBasis === 'inclusive') {
      var res = dbReservesToOz(co.reserves) || 0;
      return r - res > 0 ? r - res : null;
    }
    return r;
  }

  // =========================================================
  // RENDER: Deal Banner
  // =========================================================
  function renderPartyLogo(deal, role) {
    var logos = deal.logos || {};
    var src = role === 'bidder' ? logos.bidder : logos.target;
    if (!src) return '';
    return '<div style="margin-bottom:8px"><img src="' + src + '" alt="Logo" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:2px solid rgba(212,160,23,0.4)"></div>';
  }

  function renderBanner(deal) {
    prepare(deal);
    var b = deal.bidder;
    var t = deal.target;
    var statusClass = deal.status === 'closed' ? 'deal-status-closed' : 'deal-status-pending';
    var statusText = deal.status === 'closed' ? 'Closed' : deal.status === 'terminated' ? 'Terminated' : 'Pending';
    var bExch = shortExchange(b.exchange);
    var tExch = shortExchange(t.exchange);

    return '<div class="deal-party">' +
        '<div class="deal-party-label">Acquirer</div>' +
        renderPartyLogo(deal, 'bidder') +
        '<div class="deal-party-name">' + escHtml(b.shortName) + '</div>' +
        '<div class="deal-party-ticker">' + escHtml((b.ticker || '').replace(/:$/, '')) + (bExch ? ' · ' + escHtml(bExch) : '') + '</div>' +
        '<div class="deal-party-mcap">' + (b.marketCapDisplay ? '$' + b.marketCapDisplay : fmtM(b.marketCapUsd, 'USD')) + ' MC</div>' +
      '</div>' +
      '<div class="deal-center">' +
        '<div class="deal-xr-badge">' + fmtXR(deal.terms.exchangeRatio) + '</div>' +
        '<div class="deal-xr-label">Exchange Ratio</div>' +
        '<div class="deal-type-badge">' + escHtml(deal.terms.structure) + '</div>' +
        '<div class="deal-status-badge ' + statusClass + '">' + statusText + '</div>' +
        '<div class="deal-dates">' +
          'Announced ' + fmtDate(deal.announcementDate) + '<span>·</span>Market data as at ' + fmtDate(deal.marketDataDate) +
        '</div>' +
      '</div>' +
      '<div class="deal-party">' +
        '<div class="deal-party-label">Target</div>' +
        renderPartyLogo(deal, 'target') +
        '<div class="deal-party-name">' + escHtml(t.shortName) + '</div>' +
        '<div class="deal-party-ticker">' + escHtml((t.ticker || '').replace(/:$/, '')) + (tExch ? ' · ' + escHtml(tExch) : '') + '</div>' +
        '<div class="deal-party-mcap">' + (t.marketCapDisplay ? '$' + t.marketCapDisplay : fmtM(t.marketCapUsd, 'USD')) + ' MC</div>' +
      '</div>';
  }

  // =========================================================
  // RENDER: Source Links
  // =========================================================
  function renderLinks(deal) {
    var L = deal.links;
    if (!L) return '';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M4.5 2A2.5 2.5 0 002 4.5v11A2.5 2.5 0 004.5 18h11a2.5 2.5 0 002.5-2.5v-4a.75.75 0 00-1.5 0v4a1 1 0 01-1 1h-11a1 1 0 01-1-1v-11a1 1 0 011-1h4a.75.75 0 000-1.5h-4zM11 3.75a.75.75 0 01.75-.75h4.5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0V5.56l-5.22 5.22a.75.75 0 11-1.06-1.06L14.44 4.5H11.75a.75.75 0 01-.75-.75z"/></svg>';
    var html = '';
    var ll = L.labels || {};
    // The "joint release" slot often holds the target's own HTML release rather than a PDF
    var prPdfLabel = ll.pressReleasePdf || (/\.pdf(\?|#|$)/i.test(L.pressReleasePdf || '') ? 'Joint News Release (PDF)'
      : ((deal.target && deal.target.shortName ? deal.target.shortName + ' ' : '') + 'News Release'));
    if (L.pressRelease) html += '<a href="' + L.pressRelease + '" target="_blank" rel="noopener" class="deal-link">' + svg + escHtml(ll.pressRelease || 'Press Release') + '</a>';
    if (L.presentationPdf) html += '<a href="' + L.presentationPdf + '" target="_blank" rel="noopener" class="deal-link">' + svg + escHtml(ll.presentationPdf || 'Merger Presentation') + '</a>';
    if (L.pressReleasePdf) html += '<a href="' + L.pressReleasePdf + '" target="_blank" rel="noopener" class="deal-link">' + svg + escHtml(prPdfLabel) + '</a>';
    if (L.webcast) html += '<a href="' + L.webcast + '" target="_blank" rel="noopener" class="deal-link">' + svg + escHtml(ll.webcast || 'Conference Webcast') + '</a>';
    return html;
  }

  // A figure of 0 in deal data means "not entered", not a real zero
  function given(n) { return n != null && !isNaN(n) && Number(n) !== 0; }

  // Combined production: a guidance range when both ends are entered, else the single figure
  function combinedProdText(c, short) {
    if (given(c.productionLow) && given(c.productionHigh) && c.productionLow !== c.productionHigh) {
      return short ? Math.round(c.productionLow / 1000) + '–' + fmtOz(c.productionHigh)
        : fmtNum(c.productionLow) + '–' + fmtNum(c.productionHigh) + ' oz';
    }
    if (!given(c.production)) return '—';
    return short ? fmtOz(c.production) : fmtNum(c.production) + ' oz';
  }

  // Per-share terms from live prices. Returns null unless both share prices are known.
  // Uses the exchange ratio directly, which is exact; the market-cap/ownership method
  // is distorted by rounded ownership splits and pre-existing stakes.
  function perShareTerms(deal) {
    var b = deal.bidder, t = deal.target, tm = deal.terms || {};
    if (!given(b.stockPriceUsd) || !given(t.stockPriceUsd) || !tm.exchangeRatio) return null;
    var cash = Number(tm.cashPerShare) || 0;
    var cashCcy = deal.dealCurrency || b.currency || 'USD';
    if (cash && cashCcy !== 'USD') return null; // cash leg in another currency: can't add to USD prices
    var implied = tm.exchangeRatio * b.stockPriceUsd + cash;
    return { impliedPerShare: implied, spread: implied / t.stockPriceUsd - 1 };
  }

  // Market figures to show. The live overlay comes from the companies table; when that table was
  // loaded before the deal's market-data date, its prices predate the announcement, so the page
  // uses the announcement's own figures (announcementMC, refPriceUsd) instead. Idempotent.
  function prepare(deal) {
    if (!deal || deal._prepared) return deal;
    deal._prepared = true;
    var b = deal.bidder || {}, t = deal.target || {};
    var asOf = b.marketDataAsOf || t.marketDataAsOf;
    deal._liveAsOf = asOf || null;
    deal._staleLive = !!(asOf && deal.marketDataDate && String(asOf).slice(0, 10) < deal.marketDataDate);
    [b, t].forEach(function(p) {
      p._mcFrom = 'live';
      var useRef = deal._staleLive || !given(p.marketCapUsd);
      if (useRef && given(p.announcementMC)) {
        p.liveMarketCapUsd = p.marketCapUsd;
        p.marketCapUsd = p.announcementMC;
        delete p.marketCapDisplay;
        p._mcFrom = 'announcement';
      }
      if ((useRef || !given(p.stockPriceUsd)) && given(p.refPriceUsd)) {
        p.liveStockPriceUsd = p.stockPriceUsd;
        p.stockPriceUsd = p.refPriceUsd;
        p._priceFrom = 'announcement';
      }
    });
    if (deal.combined && given(b.marketCapUsd) && given(t.marketCapUsd)) deal.combined.marketCapUsd = b.marketCapUsd + t.marketCapUsd;
    return deal;
  }

  // =========================================================
  // RENDER: Quick Stats
  // =========================================================
  function renderQuickStats(deal) {
    prepare(deal);
    var c = normCombined(deal.combined || {});
    var dc = deal.dealCurrency || (deal.bidder && deal.bidder.currency) || 'USD';
    var stats = [
      { num: fmtM(c.marketCapUsd, 'USD'), label: 'Combined Market Cap (USD)' },
      { num: combinedProdText(c, true), label: c.productionLabel || 'Annual Production' },
      { num: given(c.ppReserves) ? fmtOz(c.ppReserves) : '—', label: 'P&P Reserves' },
      { num: given(c.ebitda2026e) ? fmtM(c.ebitda2026e, dc) : '—', label: 'EBITDA 2026E (' + dc + ')' },
      { num: given(c.fcf2026e) ? fmtM(c.fcf2026e, dc) : '—', label: 'Free Cash Flow 2026E (' + dc + ')' },
      { num: given(c.productionGrowth) ? (c.productionGrowthPrefix || '') + fmtOz(c.productionGrowth) : '—', label: c.productionGrowthLabel || 'Growth Target' }
    ];
    // Headline deal value from the announcement, when entered, replaces the EBITDA tile if EBITDA is blank
    var tm = deal.terms || {};
    if (given(tm.transactionValueM) && !given(c.ebitda2026e)) {
      stats[3] = { num: '~' + fmtM(tm.transactionValueM, tm.transactionValueCcy || 'USD'), label: 'Transaction Value (' + (tm.transactionValueCcy || 'USD') + ')' };
    }
    if (given(tm.impliedValuePerShare) && !given(c.fcf2026e)) {
      stats[4] = { num: fmtCurrency(tm.impliedValuePerShare, 2, tm.transactionValueCcy || 'USD'), label: 'Implied Value / ' + (deal.target.ticker || 'Target').replace(/:$/, '') + ' Share' };
    }
    var html = '';
    stats.forEach(function(s) {
      html += '<div class="qs-card"><div class="qs-num">' + s.num + '</div><div class="qs-lbl">' + s.label + '</div></div>';
    });
    return html;
  }

  // =========================================================
  // RENDER: Deal Spread
  // =========================================================
  function renderDealSpread(deal, liveGoldData) {
    prepare(deal);
    // liveGoldData can be a number (legacy) or { price, updated_at }
    var liveGoldPrice = null;
    var goldUpdatedAt = null;
    if (liveGoldData && typeof liveGoldData === 'object') {
      liveGoldPrice = liveGoldData.price;
      goldUpdatedAt = liveGoldData.updated_at;
    } else if (typeof liveGoldData === 'number') {
      liveGoldPrice = liveGoldData;
    }
    var b = deal.bidder;
    var t = deal.target;
    if (!b.marketCapUsd || !t.marketCapUsd) return '';

    var shareRatio = deal.proForma.ownershipBidder / deal.proForma.ownershipTarget;
    // Per-share spread = exchangeRatio × acquirerPrice / targetPrice - 1, from live prices when
    // both are known; otherwise approximated from market caps and the pro forma ownership split
    var ps = perShareTerms(deal);
    var dealSpread = ps ? ps.spread : (b.marketCapUsd / t.marketCapUsd) / shareRatio - 1;
    var dealSpreadPct = dealSpread * 100;
    var isPositive = dealSpreadPct >= 0;
    var spreadColor = isPositive ? 'sens-positive' : 'sens-negative';
    // Bar fills from center: right for premium, left for discount
    // Scale: 25% spread = full half, so each 1% = 2% of half-width
    var barPct = Math.min(50, Math.abs(dealSpreadPct) * 2);
    var barBg = isPositive ? '#27AE60' : '#E74C3C';

    var liveCombinedMC = b.marketCapUsd + t.marketCapUsd;
    // Implied value to target holders: per-share value × target shares when the share count is
    // known, else the target's pro forma ownership share of the combined market cap
    var olaImpliedValue = ps && given(t.sharesOutstanding)
      ? ps.impliedPerShare * t.sharesOutstanding
      : liveCombinedMC * deal.proForma.ownershipTarget / 100;

    var liveAsOf = deal._liveAsOf;
    var staleLive = deal._staleLive;

    var bAnnMC = b.announcementMC;
    var tAnnMC = t.announcementMC;
    // Only compare combined MC with announcement when both sides have an announcement figure
    var annCombinedMC = given(bAnnMC) && given(tAnnMC) ? bAnnMC + tAnnMC : null;

    // Premium to undisturbed: deal's implied value vs pre-announcement target MC
    // Per share against the undisturbed price when the deal records one: market caps can be on
    // different share-count bases (basic vs fully diluted) and would skew the comparison
    var premiumToUndisturbed = ps && given(t.undisturbedPriceUsd) ? (ps.impliedPerShare / t.undisturbedPriceUsd - 1) * 100
      : tAnnMC ? ((olaImpliedValue / tAnnMC) - 1) * 100 : null;
    var premiumIsPositive = premiumToUndisturbed !== null && premiumToUndisturbed >= 0;
    var premiumSpreadColor = premiumIsPositive ? 'sens-positive' : 'sens-negative';
    // Scale: 100% premium = full half, each 1% = 0.5% of half-width
    var premiumBarPct = premiumToUndisturbed !== null ? Math.min(50, Math.abs(premiumToUndisturbed) * 0.5) : 0;
    var premiumBarBg = premiumIsPositive ? '#27AE60' : '#E74C3C';

    function mcChangeHtml(liveMC, annMC) {
      if (!annMC || !liveMC || staleLive) return '';
      var delta = liveMC - annMC;
      var pct = (delta / annMC) * 100;
      var color = delta >= 0 ? '#27AE60' : '#E74C3C';
      var sign = delta >= 0 ? '+' : '';
      return '<div style="font-size:11px;color:' + color + ';margin-top:2px;font-weight:600">' +
        sign + fmtM(delta, 'USD') + ' (' + sign + pct.toFixed(1) + '%)' +
      '</div>';
    }

    // Gold price change since announcement
    var goldNow = liveGoldPrice || deal.dealTimeGoldPrice;
    var goldAnn = deal.dealTimeGoldPrice;
    var goldDelta = goldNow - goldAnn;
    var goldDeltaPct = goldAnn ? (goldDelta / goldAnn) * 100 : 0;
    var goldColor = goldDelta >= 0 ? '#27AE60' : '#E74C3C';
    var goldSign = goldDelta >= 0 ? '+' : '';
    var goldChangeHtml = goldAnn ? '<div style="font-size:11px;color:' + goldColor + ';margin-top:2px;font-weight:600">' +
      goldSign + fmtCurrency(Math.round(goldDelta), 0, 'USD') + ' (' + goldSign + goldDeltaPct.toFixed(1) + '%)' +
      '</div>' : '';

    // Gold price timestamp
    var goldTimeHtml = '';
    if (goldUpdatedAt) {
      var gd = new Date(goldUpdatedAt);
      var gh = gd.getHours(); var gm = gd.getMinutes();
      var gAmPm = gh >= 12 ? 'PM' : 'AM';
      var gh12 = gh % 12 || 12;
      goldTimeHtml = '<div style="font-size:9px;color:#999;margin-top:3px">' +
        (gd.getMonth() + 1) + '/' + gd.getDate() + '/' + gd.getFullYear() +
        ' ' + gh12 + ':' + (gm < 10 ? '0' : '') + gm + ' ' + gAmPm + ' UTC</div>';
    }

    // Company data date: when the companies table was last loaded (sent by the API),
    // falling back to end of day yesterday for callers that don't supply it
    var asOf = liveAsOf;
    var eodLabel;
    if (asOf) {
      var ad = new Date(asOf);
      eodLabel = 'As at ' + (ad.getUTCMonth() + 1) + '/' + ad.getUTCDate() + '/' + ad.getUTCFullYear();
    } else {
      var yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      eodLabel = 'EOD ' + (yesterday.getMonth() + 1) + '/' + yesterday.getDate() + '/' + yesterday.getFullYear();
    }
    var eodHtml = '<div style="font-size:9px;color:#999;margin-top:3px">' + eodLabel + '</div>';
    // Each tile says where its figure came from: the announcement, or the companies table and its date
    var annHtml = '<div style="font-size:9px;color:#999;margin-top:3px">Press release' + (deal.marketDataDate ? ', ' + fmtDate(deal.marketDataDate) : '') + '</div>';
    function srcHtml(p) { return p._mcFrom === 'announcement' ? annHtml : eodHtml; }
    var combSrc = b._mcFrom === t._mcFrom ? srcHtml(b)
      : '<div style="font-size:9px;color:#999;margin-top:3px">Mixed sources (see tiles)</div>';

    return '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px;margin-bottom:16px">' +
        '<div style="text-align:center;padding:12px;background:#FAFBFC;border-radius:8px">' +
          '<div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px">Acquirer MC (USD)</div>' +
          '<div style="font-size:20px;font-weight:700;color:var(--header-mid);margin-top:4px">' + fmtM(b.marketCapUsd, 'USD') + '</div>' +
          mcChangeHtml(b.marketCapUsd, bAnnMC) +
          srcHtml(b) +
        '</div>' +
        '<div style="text-align:center;padding:12px;background:#FAFBFC;border-radius:8px">' +
          '<div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px">Target MC (USD)</div>' +
          '<div style="font-size:20px;font-weight:700;color:var(--header-mid);margin-top:4px">' + fmtM(t.marketCapUsd, 'USD') + '</div>' +
          mcChangeHtml(t.marketCapUsd, tAnnMC) +
          srcHtml(t) +
        '</div>' +
        '<div style="text-align:center;padding:12px;background:#FAFBFC;border-radius:8px">' +
          '<div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px">Combined MC (USD)</div>' +
          '<div style="font-size:20px;font-weight:700;color:var(--header-mid);margin-top:4px">' + fmtM(liveCombinedMC, 'USD') + '</div>' +
          mcChangeHtml(liveCombinedMC, annCombinedMC) +
          combSrc +
        '</div>' +
        '<div style="text-align:center;padding:12px;background:#FFF8E1;border-radius:8px;border:1.5px solid var(--color-gold)">' +
          '<div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px">Gold Price USD (Live)</div>' +
          '<div style="font-size:20px;font-weight:700;color:var(--color-gold);margin-top:4px">' + fmtCurrency(Math.round(goldNow), 0, 'USD') + '</div>' +
          goldChangeHtml +
          goldTimeHtml +
        '</div>' +
      '</div>' +
      '<div class="spread-bar">' +
        '<div class="spread-label">Arb Spread (Per-Share Basis)</div>' +
        '<div class="spread-track">' +
          '<div class="spread-center"></div>' +
          (isPositive
            ? '<div class="spread-fill" style="left:50%;width:' + barPct + '%;background:' + barBg + '"></div>'
            : '<div class="spread-fill" style="right:50%;width:' + barPct + '%;background:' + barBg + '"></div>') +
        '</div>' +
        '<div class="spread-value ' + spreadColor + '">' + (dealSpreadPct >= 0 ? '+' : '') + dealSpreadPct.toFixed(1) + '%</div>' +
      '</div>' +
      (premiumToUndisturbed !== null ?
      '<div class="spread-bar" style="margin-top:8px">' +
        '<div class="spread-label">Premium to Undisturbed</div>' +
        '<div class="spread-track">' +
          '<div class="spread-center"></div>' +
          (premiumIsPositive
            ? '<div class="spread-fill" style="left:50%;width:' + premiumBarPct + '%;background:' + premiumBarBg + '"></div>'
            : '<div class="spread-fill" style="right:50%;width:' + premiumBarPct + '%;background:' + premiumBarBg + '"></div>') +
        '</div>' +
        '<div class="spread-value ' + premiumSpreadColor + '">' + (premiumToUndisturbed >= 0 ? '+' : '') + premiumToUndisturbed.toFixed(1) + '%</div>' +
      '</div>' : '') +
      '<div style="font-size:11px;color:var(--text-secondary);margin-top:10px">' +
        '<strong>Arb Spread:</strong> How far the target\'s stock trades from the deal\'s implied value at the acquirer\'s current share price. ' +
        'Positive means the target trades <em>below</em> the offer — the gap reflects deal-completion risk (regulatory, shareholder vote, financing). ' +
        'Negative means the target trades <em>above</em> the offer — the market may expect a sweetened or competing bid. ' +
        'Near zero means the market expects the deal to close at current terms.' +
        (premiumToUndisturbed !== null ? ' <strong>Premium to Undisturbed:</strong> The deal\'s current implied value vs. ' + escHtml(t.shortName) + '\'s pre-announcement ' +
          (ps && given(t.undisturbedPriceUsd) ? 'share price (' + fmtCurrency(t.undisturbedPriceUsd, 2, 'USD') + ')' : 'market cap (' + fmtM(tAnnMC, 'USD') + ')') +
          ', showing the total value uplift the deal delivers to target shareholders.' : '') +
        ' Implied value to ' + escHtml(t.shortName) + ' shareholders: ' + fmtM(olaImpliedValue, 'USD') +
        (given(t.sharesOutstanding) && ps ? ' on ' + (Math.round(t.sharesOutstanding * 10) / 10).toFixed(1) + 'M shares' : '') +
        (ps ? ' (' + fmtCurrency(ps.impliedPerShare, 2, 'USD') + ' per share at ' + escHtml(b.shortName) + ' ' + fmtCurrency(b.stockPriceUsd, 2, 'USD') +
          ' vs ' + escHtml(t.shortName) + ' ' + fmtCurrency(t.stockPriceUsd, 2, 'USD') + ')' : '') + '.' +
      '</div>';
  }

  // =========================================================
  // RENDER: Term Sheet
  // =========================================================
  function renderTermSheet(deal) {
    prepare(deal);
    var tm = deal.terms;
    var pf = deal.proForma;
    var b = deal.bidder;
    var t = deal.target;
    var vs = deal.votingSupport;
    // Deal currency for terms like break fees, cash per share
    var dc = deal.dealCurrency || b.currency || 'USD';

    var bT = escHtml((b.ticker || '').replace(/:$/, ''));
    var tT = escHtml((t.ticker || '').replace(/:$/, ''));
    var ND = '<span style="color:var(--text-secondary);font-weight:500">Not disclosed</span>';
    function row(key, val, cls) {
      return '<div class="term-row"><span class="term-key">' + key + '</span><span class="term-val' + (cls ? ' ' + cls : '') + '">' + val + '</span></div>';
    }
    function txt(s) { return s && !/^tbd$/i.test(String(s).trim()) ? escHtml(s) : ND; }
    function fee(n, payer) {
      if (!given(n)) return ND;
      return fmtCurrency(n, n % 1 ? 1 : 0, dc) + 'M' + (payer ? ' <span style="color:var(--text-secondary);font-weight:500">payable by ' + escHtml(payer) + '</span>' : '');
    }
    var xrText = fmtXR(tm.exchangeRatio);

    var structure = '<h4>Transaction Structure</h4>' +
      row('Exchange Ratio', xrText + ' ' + bT + ' per ' + tT + ' share', 'gold') +
      row('Cash Component', given(tm.cashPerShare) && tm.cashPerShare >= 0.001 ? fmtCurrency(tm.cashPerShare, 4, dc) + ' per ' + tT + ' share' : 'None') +
      (given(tm.impliedValuePerShare) ? row('Implied Value', fmtCurrency(tm.impliedValuePerShare, 2, tm.transactionValueCcy || dc) + ' per ' + tT + ' share' + (tm.impliedValueBasis ? ' <span style="color:var(--text-secondary);font-weight:500">' + escHtml(tm.impliedValueBasis) + '</span>' : '')) : '') +
      (given(tm.transactionValueM) ? row('Transaction Value', '~' + fmtM(tm.transactionValueM, tm.transactionValueCcy || dc) + (tm.transactionValueBasis ? ' <span style="color:var(--text-secondary);font-weight:500">' + escHtml(tm.transactionValueBasis) + '</span>' : '')) : '') +
      (given(tm.premiumSpotPct) ? row('Premium to Last Close', fmtPct(tm.premiumSpotPct, 0)) : '') +
      (given(tm.premiumVwapPct) ? row('Premium to ' + escHtml(tm.premiumVwapLabel || 'VWAP'), fmtPct(tm.premiumVwapPct, 0)) : '') +
      (tm.premiumAsOf ? row('Premium Measured', 'As at ' + fmtDate(tm.premiumAsOf)) : '') +
      row('Structure', escHtml(tm.structure)) +
      (given(tm.existingStakePct) ? row('Existing ' + bT + ' Stake', fmtPct(tm.existingStakePct, 2) + ' of ' + tT + (tm.existingStakeNote ? ' <span style="color:var(--text-secondary);font-weight:500">' + escHtml(tm.existingStakeNote) + '</span>' : '')) : '') +
      row('Bidder Break Fee', fee(tm.bidderBreakFee, tm.bidderBreakFeePayer)) +
      row('Target Break Fee', fee(tm.targetBreakFee, tm.targetBreakFeePayer)) +
      row(bT + ' Approval', txt(tm.bidderApproval)) +
      row(tT + ' Approval', txt(tm.targetApproval));

    var boardKnown = given(pf.boardSize);
    var governance = '<h4>Pro Forma Governance</h4>' +
      row(bT + ' Ownership', '~' + pf.ownershipBidder + '%', 'gold') +
      row(tT + ' Ownership', '~' + pf.ownershipTarget + '%' + (pf.ownershipNote ? ' <span style="color:var(--text-secondary);font-weight:500">' + escHtml(pf.ownershipNote) + '</span>' : '')) +
      row('Board Size', boardKnown ? pf.boardSize + ' directors' : ND) +
      row('Board Composition', boardKnown && (given(pf.boardBidder) || given(pf.boardTarget))
        ? (pf.boardBidder || 0) + ' ' + bT + ' + ' + (pf.boardTarget || 0) + ' ' + tT + ' + Chair' : ND) +
      row('CEO', txt(pf.ceo)) +
      row('President', txt(pf.president)) +
      row('Chair', txt(pf.chair));

    var html = '<div class="term-grid">' +
        '<div class="term-group">' + structure + '</div>' +
        '<div class="term-group">' + governance + '</div>' +
      '</div>';

    // Conditions to closing and advisers, as listed in the announcement
    var conds = deal.conditions || [];
    var adv = deal.advisers;
    if (conds.length || (adv && (adv.bidder || adv.target))) {
      var subHead = '<h4 style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin:20px 0 12px;padding-top:16px;border-top:2px solid #E8EAF0">';
      html += subHead + 'Conditions &amp; Advisers</h4><div class="term-grid">';
      if (conds.length) {
        html += '<div class="term-group"><h4>Conditions to Closing</h4><ul style="margin:0;padding-left:18px;font-size:12.5px;line-height:1.6">';
        conds.forEach(function(cd) { html += '<li>' + escHtml(cd) + '</li>'; });
        html += '</ul></div>';
      }
      if (adv && (adv.bidder || adv.target)) {
        html += '<div class="term-group"><h4>Advisers</h4>';
        var advRows = function(who, a) {
          if (!a) return '';
          var out = '';
          if (a.financial) out += row(escHtml(who) + ' Financial', escHtml(a.financial));
          if (a.legal) out += row(escHtml(who) + ' Legal', escHtml(a.legal));
          if (a.fairness) out += row(escHtml(who) + ' Fairness Opinion', escHtml(a.fairness));
          return out;
        };
        html += advRows(b.shortName, adv.bidder) + advRows(t.shortName, adv.target) + '</div>';
      }
      html += '</div>';
    }

    // SpinCo / CVR section
    var sc = deal.spinCo;
    if (sc && sc.name) {
      html += '<h4 style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin:20px 0 12px;padding-top:16px;border-top:2px solid #E8EAF0">SpinCo / Contingent Value Right</h4>' +
        '<div class="term-grid">' +
          '<div class="term-group">' +
            '<h4>' + escHtml(sc.name) + '</h4>' +
            (sc.description ? '<div class="term-row"><span class="term-key">Description</span><span class="term-val">' + escHtml(sc.description) + '</span></div>' : '') +
            (sc.properties ? '<div class="term-row"><span class="term-key">Properties</span><span class="term-val">' + escHtml(sc.properties) + '</span></div>' : '') +
            (sc.cashFunding ? '<div class="term-row"><span class="term-key">Cash Funding</span><span class="term-val">' + fmtCurrency(sc.cashFunding, 0, sc.cashCurrency || 'CAD') + 'M</span></div>' : '') +
          '</div>' +
          '<div class="term-group">' +
            '<h4>CVR Details</h4>' +
            (sc.cvrMaxPayout ? '<div class="term-row"><span class="term-key">Max Payout</span><span class="term-val">' + fmtCurrency(sc.cvrMaxPayout, 0, sc.cvrCurrency || 'USD') + 'M</span></div>' : '') +
            (sc.cvrTrigger ? '<div class="term-row"><span class="term-key">Trigger</span><span class="term-val">' + escHtml(sc.cvrTrigger) + '</span></div>' : '') +
          '</div>' +
        '</div>';
    }

    if (vs) {
      html += '<h4 style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin:20px 0 12px;padding-top:16px;border-top:2px solid #E8EAF0">Voting Support Committed</h4>' +
        '<div class="voting-grid">' +
          '<div class="voting-card">' +
            '<div class="voting-pct">' + (given(vs.bidder.pct) ? '~' + vs.bidder.pct + '%' : '—') + '</div>' +
            '<div class="voting-label">' + escHtml(b.shortName) + ' Shareholders</div>' +
            '<div class="voting-desc">' + escHtml(vs.bidder.desc) + '</div>' +
          '</div>' +
          '<div class="voting-card">' +
            '<div class="voting-pct">' + (given(vs.target.pct) ? '~' + vs.target.pct + '%' : '—') + '</div>' +
            '<div class="voting-label">' + escHtml(t.shortName) + ' Shareholders</div>' +
            '<div class="voting-desc">' + escHtml(vs.target.desc) + '</div>' +
          '</div>' +
        '</div>';
    }

    return html;
  }

  // =========================================================
  // RENDER: Pro Forma Comparison
  // =========================================================
  function renderProForma(deal) {
    prepare(deal);
    var b = deal.bidder;
    var t = deal.target;
    var c = deal.combined;
    var pf = deal.proForma;
    // AISC is always shown in USD (converted at deal time for non-USD deals) for gold price comparison
    // Market caps are always USD (live data from companies table)

    function prodRange(co) {
      if (!co.productionLow && !co.productionHigh) return '—';
      var lo = dbProdToOz(co.productionLow);
      var hi = dbProdToOz(co.productionHigh);
      if (lo && hi) return fmtNum(lo) + '–' + fmtNum(hi);
      return fmtNum(lo || hi);
    }

    c = normCombined(c);
    var bidderMC = b.marketCapUsd || (c.marketCapUsd * pf.ownershipBidder / 100);
    var targetMC = t.marketCapUsd || (c.marketCapUsd * pf.ownershipTarget / 100);
    var bidderResOz = dbReservesToOz(b.reserves);
    var targetResOz = dbReservesToOz(t.reserves);
    var bidderRscOz = resourcesExOz(b);
    var targetRscOz = resourcesExOz(t);
    var bidderInfOz = dbReservesToOz(b.inferred);
    var targetInfOz = dbReservesToOz(t.inferred);
    var bidderProd = dbProdToOz(b.productionHigh || b.productionLow);
    var targetProd = dbProdToOz(t.productionHigh || t.productionLow);
    // Combined M&I (ex. reserves) and inferred from the two parties when not entered for the
    // deal — only when both parties have a figure, so a one-sided total isn't shown as combined
    var combRsc = given(c.miResources) ? c.miResources : (bidderRscOz && targetRscOz ? bidderRscOz + targetRscOz : null);
    var combInf = given(c.inferredResources) ? c.inferredResources : (bidderInfOz && targetInfOz ? bidderInfOz + targetInfOz : null);

    // Shares outstanding (stored in millions) — convert to actual count
    var bShares = b.sharesOutstanding ? b.sharesOutstanding * 1e6 : null;
    var tShares = t.sharesOutstanding ? t.sharesOutstanding * 1e6 : null;
    var exchangeRatio = deal.terms && deal.terms.exchangeRatio ? deal.terms.exchangeRatio : null;
    var combinedShares = bShares && tShares && exchangeRatio ? bShares + tShares * exchangeRatio : null;

    // Deal currency for EBITDA/FCF/liquidity — these are in whatever currency the deal reports
    var dc = deal.dealCurrency || b.currency || 'USD';
    function liq(co) {
      if (!given(co.liquidityM)) return '—';
      return fmtM(co.liquidityM, co.liquidityCcy || dc) + (co.liquidityNote ? '<div style="font-size:10px;color:var(--text-secondary)">' + escHtml(co.liquidityNote) + '</div>' : '');
    }
    function aisc(co) { return given(co.aiscLow) && given(co.aiscHigh) ? fmtCurrency(co.aiscLow, 0, 'USD') + '–' + fmtCurrency(co.aiscHigh, 0, 'USD') + '/oz' : '—'; }
    function life(res, prod) { return res && prod ? (res / prod).toFixed(1) + ' years' : '—'; }
    function perOz(mc, oz) { return mc && oz ? fmtCurrency(mc * 1e6 / oz, 0, 'USD') : '—'; }
    var combProd = c.production;

    var rows = [
      { section: 'Market & Valuation' },
      { metric: 'Market Cap (USD)', bidder: fmtM(bidderMC, 'USD'), target: fmtM(targetMC, 'USD'), combined: fmtM(c.marketCapUsd, 'USD') },
      { metric: 'EBITDA 2026E (' + dc + ')', bidder: given(b.ebitda2026e) ? fmtM(b.ebitda2026e, dc) : '—', target: given(t.ebitda2026e) ? fmtM(t.ebitda2026e, dc) : '—', combined: given(c.ebitda2026e) ? fmtM(c.ebitda2026e, dc) : '—' },
      { metric: 'Free Cash Flow 2026E (' + dc + ')', bidder: given(b.fcf2026e) ? fmtM(b.fcf2026e, dc) : '—', target: given(t.fcf2026e) ? fmtM(t.fcf2026e, dc) : '—', combined: given(c.fcf2026e) ? fmtM(c.fcf2026e, dc) : '—' },
      { metric: 'Liquidity', bidder: liq(b), target: liq(t), combined: given(c.liquidity) ? fmtM(c.liquidity, dc) : '—' },
      { metric: 'EV/EBITDA 2026E', bidder: bidderMC && given(b.ebitda2026e) ? fmtX(bidderMC / b.ebitda2026e) : '—', target: targetMC && given(t.ebitda2026e) ? fmtX(targetMC / t.ebitda2026e) : '—', combined: given(c.ebitda2026e) ? fmtX(c.marketCapUsd / c.ebitda2026e) : '—' },
      { metric: 'FCF Yield 2026E', bidder: bidderMC && given(b.fcf2026e) ? fmtPct(b.fcf2026e / bidderMC * 100) : '—', target: targetMC && given(t.fcf2026e) ? fmtPct(t.fcf2026e / targetMC * 100) : '—', combined: c.marketCapUsd && given(c.fcf2026e) ? fmtPct(c.fcf2026e / c.marketCapUsd * 100) : '—' },
      { section: 'Production & Reserves' },
      { metric: 'Annual Production', bidder: prodRange(b), target: prodRange(t), combined: combinedProdText(c, false) },
      { metric: 'AISC Guidance 2026 (USD)', bidder: aisc(b), target: aisc(t), combined: aisc(c) },
      { metric: 'P&P Reserves', bidder: bidderResOz ? fmtOz(bidderResOz) : '—', target: targetResOz ? fmtOz(targetResOz) : '—', combined: given(c.ppReserves) ? fmtOz(c.ppReserves) : '—' },
      { metric: 'M&I Resources (ex. reserves)', bidder: bidderRscOz ? fmtOz(bidderRscOz) : '—', target: targetRscOz ? fmtOz(targetRscOz) : '—', combined: combRsc ? fmtOz(combRsc) : '—' },
      { metric: 'Inferred Resources', bidder: bidderInfOz ? fmtOz(bidderInfOz) : '—', target: targetInfOz ? fmtOz(targetInfOz) : '—', combined: combInf ? fmtOz(combInf) : '—' },
      { metric: 'Reserve Life', bidder: life(bidderResOz, bidderProd), target: life(targetResOz, targetProd), combined: given(c.ppReserves) && given(combProd) ? life(c.ppReserves, combProd) : '—' },
      { metric: 'Growth Production Target', bidder: '—', target: '—', combined: given(c.productionGrowth) ? (c.productionGrowthPrefix != null ? c.productionGrowthPrefix : '>') + fmtOz(c.productionGrowth) : '—' },
      { section: 'Key Ratios' },
      { metric: 'MC / Annual Production (USD/oz)', bidder: perOz(bidderMC, bidderProd), target: perOz(targetMC, targetProd), combined: given(combProd) ? perOz(c.marketCapUsd, combProd) : '—' },
      { metric: 'MC / P&P Reserve (USD/oz)', bidder: perOz(bidderMC, bidderResOz), target: perOz(targetMC, targetResOz), combined: given(c.ppReserves) ? perOz(c.marketCapUsd, c.ppReserves) : '—' },
      { metric: 'P&P Reserve oz / 100K Shares', bidder: bidderResOz && bShares ? fmtNum(Math.round(bidderResOz / bShares * 1e5)) : '—', target: targetResOz && tShares ? fmtNum(Math.round(targetResOz / tShares * 1e5)) : '—', combined: given(c.ppReserves) && combinedShares ? fmtNum(Math.round(c.ppReserves / combinedShares * 1e5)) : '—' },
      { metric: 'Production oz / 100K Shares', bidder: bidderProd && bShares ? fmtNum(Math.round(bidderProd / bShares * 1e5)) : '—', target: targetProd && tShares ? fmtNum(Math.round(targetProd / tShares * 1e5)) : '—', combined: given(combProd) && combinedShares ? fmtNum(Math.round(combProd / combinedShares * 1e5)) : '—' }
    ];

    var html = '<table class="pf-table"><thead><tr><th>Metric</th><th>' + escHtml(b.shortName) + '</th><th>' + escHtml(t.shortName) + '</th><th>Combined</th></tr></thead><tbody>';
    rows.forEach(function(r) {
      if (r.section) {
        html += '<tr class="pf-section-row"><td colspan="4">' + escHtml(r.section) + '</td></tr>';
      } else {
        html += '<tr><td class="pf-metric">' + escHtml(r.metric) + '</td><td>' + r.bidder + '</td><td>' + r.target + '</td><td class="pf-combined">' + r.combined + '</td></tr>';
      }
    });
    html += '</tbody></table>';
    // Source and basis notes for the figures above
    if (deal.dataNotes && deal.dataNotes.length) {
      html += '<ol style="margin:12px 0 0;padding-left:18px;font-size:11px;line-height:1.55;color:var(--text-secondary)">';
      deal.dataNotes.forEach(function(n) { html += '<li>' + escHtml(n) + '</li>'; });
      html += '</ol>';
    }
    return html;
  }

  // =========================================================
  // RENDER: Sensitivity Analysis (controls + table + chart)
  // =========================================================
  function renderSensitivityControls(deal) {
    var goldBase = deal.defaultGoldPrice;
    return '<div class="sens-slider-group">' +
        '<div class="sens-label">Gold Price (USD/oz)</div>' +
        '<div class="sens-value" id="sens-gold-val">' + fmtCurrency(goldBase, 0, 'USD') + '</div>' +
        '<input type="range" class="sens-range" id="sens-gold" min="3000" max="6500" step="250" value="' + goldBase + '">' +
        '<div class="sens-bounds"><span>US$3,000</span><span>US$6,500</span></div>' +
      '</div>' +
      '<div class="sens-slider-group">' +
        '<div class="sens-label">All-In Sustaining Cost (USD/oz)</div>' +
        '<div class="sens-value" id="sens-aisc-val">' + fmtCurrency(deal.defaultAisc, 0, 'USD') + '</div>' +
        '<input type="range" class="sens-range" id="sens-aisc" min="1000" max="2500" step="50" value="' + deal.defaultAisc + '">' +
        '<div class="sens-bounds"><span>US$1,000</span><span>US$2,500</span></div>' +
      '</div>' +
      '<div class="sens-slider-group">' +
        '<div class="sens-label">Reserve Estimate Adjustment</div>' +
        '<div class="sens-value" id="sens-res-val">Base Case (0%)</div>' +
        '<input type="range" class="sens-range" id="sens-res" min="-30" max="30" step="3" value="0">' +
        '<div class="sens-bounds"><span>-30%</span><span>+30%</span></div>' +
      '</div>';
  }

  function computeSensitivity(deal, liveGoldPrice) {
    prepare(deal);
    var goldPrice = parseInt(document.getElementById('sens-gold').value);
    var aisc = parseInt(document.getElementById('sens-aisc').value);
    var resAdj = parseInt(document.getElementById('sens-res').value);

    document.getElementById('sens-gold-val').textContent = fmtCurrency(goldPrice, 0, 'USD');
    document.getElementById('sens-aisc-val').textContent = fmtCurrency(aisc, 0, 'USD');
    document.getElementById('sens-res-val').textContent = resAdj === 0 ? 'Base Case (0%)' : (resAdj > 0 ? '+' : '') + resAdj + '%';

    var c = normCombined(deal.combined || {});
    var production = c.production || c.productionHigh;
    // Without an EBITDA/FCF base the price sensitivity has nothing to flex; show margins only
    var hasBase = given(c.ebitda2026e) || given(c.fcf2026e);
    var baseGold = deal.defaultGoldPrice;
    var reserves = c.ppReserves * (1 + resAdj / 100);
    var marketCap = c.marketCapUsd;

    var revenue = production * goldPrice / 1e6;
    var totalCost = production * aisc / 1e6;
    var ebitda = given(c.ebitda2026e) ? c.ebitda2026e + (goldPrice - baseGold) * production / 1e6 : null;
    var fcf = given(c.fcf2026e) ? c.fcf2026e + (goldPrice - baseGold) * production / 1e6 : null;

    var mcPerReserveOz = marketCap * 1e6 / reserves;
    var reserveLife = reserves / production;
    var evEbitda = ebitda != null && ebitda > 0 ? marketCap / ebitda : null;
    var fcfYield = fcf != null && marketCap > 0 ? fcf / marketCap * 100 : null;
    var margin = goldPrice > 0 ? (goldPrice - aisc) / goldPrice * 100 : 0;

    // Deal currency for financial metrics display
    var dc = deal.dealCurrency || (deal.bidder && deal.bidder.currency) || 'USD';

    var goldSteps = [3500, 3750, 4000, 4250, 4500, 4750, 5000, 5250, 5500];

    // Insert announcement gold price as a distinct row if not already in steps
    var baseGoldRounded = Math.round(baseGold);
    var baseGoldInSteps = false;
    for (var bi = 0; bi < goldSteps.length; bi++) {
      if (goldSteps[bi] === baseGoldRounded) { baseGoldInSteps = true; break; }
    }
    if (!baseGoldInSteps) {
      goldSteps.push(baseGoldRounded);
      goldSteps.sort(function(a, b) { return a - b; });
    }

    // Insert live gold price as a distinct row if available
    var liveGoldRounded = liveGoldPrice ? Math.round(liveGoldPrice) : null;
    var liveGoldInSteps = false;
    if (liveGoldRounded) {
      for (var si = 0; si < goldSteps.length; si++) {
        if (goldSteps[si] === liveGoldRounded) { liveGoldInSteps = true; break; }
      }
      if (!liveGoldInSteps) {
        goldSteps.push(liveGoldRounded);
        goldSteps.sort(function(a, b) { return a - b; });
      }
    }

    var tableRows = '';
    var chartLabels = [];
    var chartEbitda = [];
    var chartFcf = [];

    goldSteps.forEach(function(gp) {
      var eb = given(c.ebitda2026e) ? c.ebitda2026e + (gp - baseGold) * production / 1e6 : null;
      var fc = given(c.fcf2026e) ? c.fcf2026e + (gp - baseGold) * production / 1e6 : null;
      var mg = gp > 0 ? (gp - aisc) / gp * 100 : 0;
      var ev = eb != null && eb > 0 ? marketCap / eb : null;
      var fy = fc != null && marketCap > 0 ? fc / marketCap * 100 : null;
      var isBase = gp === baseGoldRounded;
      var isLive = liveGoldRounded && gp === liveGoldRounded;

      var rowClass = '';
      if (isLive && !isBase) rowClass = ' class="sens-live"';
      else if (isBase) rowClass = ' class="sens-base"';

      var label = '';
      if (isLive && isBase) label = ' ◀ Live / Announcement Price';
      else if (isLive) label = ' ◀ Live';
      else if (isBase) label = ' ◀ Announcement Price';

      var ebBlank = eb == null || Math.round(eb) === 0;

      tableRows += '<tr' + rowClass + '>' +
        '<td>' + fmtCurrency(gp, 0, 'USD') + label + '</td>' +
        '<td>' + (ebBlank ? '—' : fmtM(eb, dc)) + '</td>' +
        '<td>' + (fc == null ? '—' : fmtM(fc, dc)) + '</td>' +
        '<td>' + fmtPct(mg) + '</td>' +
        '<td>' + fmtX(ev) + '</td>' +
        '<td class="' + (fy >= 0 ? 'sens-positive' : 'sens-negative') + '">' + fmtPct(fy) + '</td>' +
        '<td>' + fmtCurrency(Math.round(gp * production / reserves), 0, 'USD') + '</td>' +
      '</tr>';

      chartLabels.push('US$' + (gp / 1000).toFixed(1) + 'K');
      chartEbitda.push(eb);
      chartFcf.push(fc);
    });

    var summaryHtml =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:20px">' +
        '<div style="padding:12px;background:#FAFBFC;border-radius:8px;text-align:center;border-left:3px solid var(--color-gold)">' +
          '<div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase">EBITDA (' + dc + ')</div>' +
          '<div style="font-size:18px;font-weight:700;color:var(--header-mid)">' + (ebitda == null || Math.round(ebitda) === 0 ? '—' : fmtM(ebitda, dc)) + '</div>' +
        '</div>' +
        '<div style="padding:12px;background:#FAFBFC;border-radius:8px;text-align:center;border-left:3px solid #27AE60">' +
          '<div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase">Free Cash Flow (' + dc + ')</div>' +
          '<div style="font-size:18px;font-weight:700;color:var(--header-mid)">' + (fcf == null ? '—' : fmtM(fcf, dc)) + '</div>' +
        '</div>' +
        '<div style="padding:12px;background:#FAFBFC;border-radius:8px;text-align:center;border-left:3px solid #2980B9">' +
          '<div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase">Operating Margin</div>' +
          '<div style="font-size:18px;font-weight:700;color:var(--header-mid)">' + fmtPct(margin) + '</div>' +
        '</div>' +
        '<div style="padding:12px;background:#FAFBFC;border-radius:8px;text-align:center;border-left:3px solid #8E44AD">' +
          '<div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase">EV/EBITDA</div>' +
          '<div style="font-size:18px;font-weight:700;color:var(--header-mid)">' + fmtX(evEbitda) + '</div>' +
        '</div>' +
        '<div style="padding:12px;background:#FAFBFC;border-radius:8px;text-align:center;border-left:3px solid #E67E22">' +
          '<div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase">MC/Reserve oz (USD)</div>' +
          '<div style="font-size:18px;font-weight:700;color:var(--header-mid)">' + fmtCurrency(Math.round(mcPerReserveOz), 0, 'USD') + '</div>' +
        '</div>' +
        '<div style="padding:12px;background:#FAFBFC;border-radius:8px;text-align:center;border-left:3px solid #1ABC9C">' +
          '<div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase">Reserve Life</div>' +
          '<div style="font-size:18px;font-weight:700;color:var(--header-mid)">' + reserveLife.toFixed(1) + ' yrs</div>' +
        '</div>' +
      '</div>';

    var tableHtml =
      '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Gold Price Sensitivity (at AISC ' + fmtCurrency(aisc, 0, 'USD') + '/oz, Reserves ' + fmtOz(reserves) + ')</div>' +
      '<div style="overflow-x:auto">' +
      '<table class="sens-table"><thead><tr>' +
        '<th>Gold Price</th><th>EBITDA (' + dc + ')</th><th>FCF (' + dc + ')</th><th>Margin</th><th>EV/EBITDA</th><th>FCF Yield</th><th>Revenue/Reserve oz</th>' +
      '</tr></thead><tbody>' + tableRows + '</tbody></table></div>';

    if (!hasBase) {
      summaryHtml = '<div style="font-size:12px;color:var(--text-secondary);background:#FAFBFC;border-radius:8px;padding:10px 12px;margin-bottom:12px">' +
        'No EBITDA or free cash flow estimate is entered for this deal, so those columns are blank. Margin, MC per reserve ounce and reserve life still respond to the sliders.</div>' + summaryHtml;
    }

    return {
      html: summaryHtml + tableHtml,
      chartLabels: chartLabels,
      chartEbitda: chartEbitda,
      chartFcf: chartFcf
    };
  }

  function createSensChart(canvasId, labels, ebitdaData, fcfData, dealCurrency) {
    var ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    // Nothing to chart when the deal has no EBITDA/FCF base
    var anyVal = ebitdaData.concat(fcfData).some(function(v) { return v != null && !isNaN(v); });
    if (ctx.parentNode) ctx.parentNode.style.display = anyVal ? '' : 'none';
    if (!anyVal) return null;
    var dc = dealCurrency || 'USD';
    var sym = ccySym(dc);
    return new Chart(ctx.getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'EBITDA (' + sym + 'M)',
            data: ebitdaData,
            backgroundColor: 'rgba(212,160,23,0.7)',
            borderColor: 'rgba(212,160,23,1)',
            borderWidth: 1,
            borderRadius: 4
          },
          {
            label: 'Free Cash Flow (' + sym + 'M)',
            data: fcfData,
            backgroundColor: 'rgba(39,174,96,0.7)',
            borderColor: 'rgba(39,174,96,1)',
            borderWidth: 1,
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { font: { family: 'Inter', size: 11 }, boxWidth: 12, padding: 16 } },
          tooltip: {
            callbacks: {
              label: function(context) { return context.dataset.label + ': ' + fmtM(context.raw, dc); }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { font: { family: 'Inter', size: 10 }, callback: function(v) { return fmtM(v, dc); } },
            grid: { color: '#F0F2F5' }
          },
          x: {
            title: { display: true, text: 'Gold Price USD/oz', font: { family: 'Inter', size: 11, weight: '600' }, color: '#7F8C8D' },
            ticks: { font: { family: 'Inter', size: 10 } },
            grid: { display: false }
          }
        }
      }
    });
  }

  // =========================================================
  // RENDER: Assets
  // =========================================================
  function renderAssets(deal) {
    var totalProd = 0;
    (deal.assets || []).forEach(function(a) { totalProd += a.production || 0; });

    var html = '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Current Operations</div>' +
      '<div class="assets-grid">';
    (deal.assets || []).forEach(function(a) {
      html += '<div class="asset-card">' +
        '<div class="asset-name">' + escHtml(a.name) + '</div>' +
        '<div class="asset-region">' + escHtml(a.region) + (a.owner ? ' · ' + escHtml(a.owner) : '') + '</div>' +
        '<div class="asset-prod">' + (a.productionText ? escHtml(a.productionText) : fmtOz(a.production)) + '</div>' +
        '<div class="asset-prod-label">' + escHtml(a.productionLabel || 'Annual Production') + '</div>' +
      '</div>';
    });
    html += '</div>';

    if (deal.growthPipeline && deal.growthPipeline.length > 0) {
      var growthProd = 0;
      deal.growthPipeline.forEach(function(a) { growthProd += a.production || 0; });
      html += '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin:20px 0 12px;padding-top:16px;border-top:2px solid #E8EAF0">Growth Pipeline' + (growthProd ? ' (>' + fmtOz(growthProd) + ' additional)' : '') + '</div>' +
        '<div class="assets-grid">';
      deal.growthPipeline.forEach(function(a) {
        html += '<div class="asset-card" style="border-style:dashed;border-color:#D0D4DE">' +
          '<div class="asset-name">' + escHtml(a.name) + '</div>' +
          '<div class="asset-region">' + escHtml(a.region) + '</div>' +
          '<div class="asset-prod">' + (a.productionText ? escHtml(a.productionText) : a.production ? '~' + fmtOz(a.production) : 'TBD') + '</div>' +
          '<div class="asset-prod-label">' + escHtml(a.productionLabel || 'Target Production') + '</div>' +
        '</div>';
      });
      html += '</div>';
    }

    return { html: html, totalProd: totalProd };
  }

  // =========================================================
  // RENDER: Deal Progress Timeline
  // =========================================================
  function renderProgress(deal) {
    var today = new Date().toISOString().slice(0, 10);
    // Milestones without a date can't be placed on the timeline
    var ms = (deal.milestones || []).filter(function(m) { return m.date; });
    if (!ms || ms.length === 0) return { html: '<p style="color:var(--text-secondary)">No milestones defined.</p>', badge: '' };

    var startDate = new Date(ms[0].date).getTime();
    var endDate = new Date(ms[ms.length - 1].date).getTime();
    var todayTs = new Date(today).getTime();
    var totalDays = Math.max(1, Math.round((endDate - startDate) / 86400000));
    var elapsed = Math.max(0, Math.round((todayTs - startDate) / 86400000));
    var pctComplete = Math.min(100, Math.round(elapsed / totalDays * 100));

    var badge = elapsed + ' of ~' + totalDays + ' days (' + pctComplete + '%)';

    var html = '<div class="timeline-track">';
    ms.forEach(function(m, i) {
      var mDate = new Date(m.date + 'T00:00:00');
      var isComplete = m.status === 'complete' || (m.date <= today && !m.dateText);
      var isActive = !isComplete && (i === 0 || ms[i - 1].date <= today);
      var dotClass = isComplete ? 'complete' : isActive ? 'active' : '';
      // dateText holds an announced month ("Nov 2026") where no exact day was given
      var when = m.dateText ? 'Expected ' + m.dateText : mDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

      html += '<div class="timeline-node">' +
        '<div class="timeline-dot ' + dotClass + '"></div>' +
        '<div class="timeline-label">' + escHtml(m.label) + '</div>' +
        '<div class="timeline-date">' + escHtml(when) + '</div>' +
        '<div class="timeline-detail">' + escHtml(m.detail) + '</div>' +
      '</div>';

      if (i < ms.length - 1) {
        var nextDate = new Date(ms[i + 1].date).getTime();
        var segStart = new Date(m.date).getTime();
        var segWidth = todayTs >= nextDate ? 100 : todayTs > segStart ? Math.round((todayTs - segStart) / (nextDate - segStart) * 100) : 0;
        html += '<div class="timeline-line"><div class="timeline-line-fill" style="width:' + segWidth + '%"></div></div>';
      }
    });
    html += '</div>';

    var last = ms[ms.length - 1];
    var daysToClose = Math.max(0, Math.round((endDate - todayTs) / 86400000));
    html += '<div style="text-align:center;margin-top:8px">' +
      (last.dateText
        ? '<span style="font-size:24px;font-weight:800;color:var(--color-gold)">' + escHtml(last.dateText) + '</span>' +
          '<span style="font-size:12px;color:var(--text-secondary);margin-left:6px">expected close (~' + daysToClose + ' days)</span>'
        : '<span style="font-size:24px;font-weight:800;color:var(--color-gold)">' + daysToClose + '</span>' +
          '<span style="font-size:12px;color:var(--text-secondary);margin-left:6px">days to expected close</span>') +
    '</div>';

    return { html: html, badge: badge };
  }

  // =========================================================
  // RENDER: Disclaimer
  // =========================================================
  function renderDisclaimer() {
    return '<div class="disclaimer">' +
      '<p class="disclaimer-estimates"><strong>Data Note:</strong> Where precise company-reported figures were unavailable, production guidance, reserves, and resources reflect best available estimates derived from public filings, investor presentations, and third-party research. All values should be independently verified before use in any investment analysis.</p>' +
      '<p><strong>Notice</strong> &mdash; The Denver Gold Group does not make any express or implied condition, representation, warranty or other term as to the accuracy, validity, reliability, timeliness or completeness of any information or materials in general or in connection with any particular use or purpose presented at the Mining Forum. The Denver Gold Group does not represent or endorse the accuracy or reliability of any third party advice, opinion, statement, information or materials received during the Mining Forum.</p>' +
      '<p><strong>INVESTMENT ADVICE &mdash; NO OFFER OR RECOMMENDATION</strong> &mdash; The Denver Gold Group, Inc, the Mining Forums, and the information and materials presented at the Mining Forum and in all Denver Gold Group publications, including Internet assets are not, and should not be construed as, an offer to buy or sell, or as a solicitation of an offer to buy or sell, any regulated gold related products or any other regulated products, securities or investments. The Denver Gold Group, Inc and the Mining Forums do not, and should not be construed as acting to, sponsor, advocate, endorse or promote any regulated gold related products or any other regulated products, securities or investments. Before making any investment decision, prospective investors should seek advice from their financial, legal, tax and accounting advisers, take into account their individual financial needs and circumstances and carefully consider the risks associated with such investment decision.</p>' +
      '<p class="disclaimer-copyright">&copy; 2026 by The Denver Gold Group, Inc. All rights reserved. Distribution and republication is encouraged provided that no part of this publication is modified in any form or by any means without the prior written permission of the copyright holder.</p>' +
    '</div>';
  }

  // =========================================================
  // PUBLIC API
  // =========================================================
  window.DealRenderer = {
    // Formatters
    ccySym: ccySym,
    fmtCurrency: fmtCurrency,
    fmtM: fmtM,
    fmtOz: fmtOz,
    fmtDate: fmtDate,
    fmtPct: fmtPct,
    fmtX: fmtX,
    fmtNum: fmtNum,
    escHtml: escHtml,
    shortExchange: shortExchange,
    dbReservesToOz: dbReservesToOz,
    dbProdToOz: dbProdToOz,

    // Renderers (return HTML strings)
    renderBanner: renderBanner,
    renderLinks: renderLinks,
    renderQuickStats: renderQuickStats,
    renderDealSpread: renderDealSpread,
    renderTermSheet: renderTermSheet,
    renderProForma: renderProForma,
    renderSensitivityControls: renderSensitivityControls,
    computeSensitivity: computeSensitivity,
    createSensChart: createSensChart,
    renderAssets: renderAssets,
    renderProgress: renderProgress,
    renderDisclaimer: renderDisclaimer
  };
})();
