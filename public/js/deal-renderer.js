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
        '<div class="deal-party-ticker">' + escHtml(b.ticker) + (bExch ? ' · ' + escHtml(bExch) : '') + '</div>' +
        '<div class="deal-party-mcap">' + (b.marketCapDisplay ? '$' + b.marketCapDisplay : fmtM(b.marketCapUsd, 'USD')) + ' MC</div>' +
      '</div>' +
      '<div class="deal-center">' +
        '<div class="deal-xr-badge">' + deal.terms.exchangeRatio.toFixed(2) + '</div>' +
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
        '<div class="deal-party-ticker">' + escHtml(t.ticker) + (tExch ? ' · ' + escHtml(tExch) : '') + '</div>' +
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
    if (L.pressRelease) html += '<a href="' + L.pressRelease + '" target="_blank" rel="noopener" class="deal-link">' + svg + 'Press Release</a>';
    if (L.presentationPdf) html += '<a href="' + L.presentationPdf + '" target="_blank" rel="noopener" class="deal-link">' + svg + 'Merger Presentation</a>';
    if (L.pressReleasePdf) html += '<a href="' + L.pressReleasePdf + '" target="_blank" rel="noopener" class="deal-link">' + svg + 'Joint News Release (PDF)</a>';
    if (L.webcast) html += '<a href="' + L.webcast + '" target="_blank" rel="noopener" class="deal-link">' + svg + 'Conference Webcast</a>';
    return html;
  }

  // =========================================================
  // RENDER: Quick Stats
  // =========================================================
  function renderQuickStats(deal) {
    var c = deal.combined;
    var dc = deal.dealCurrency || (deal.bidder && deal.bidder.currency) || 'USD';
    var stats = [
      { num: fmtM(c.marketCapUsd, 'USD'), label: 'Combined Market Cap (USD)' },
      { num: fmtOz(c.production), label: 'Annual Production' },
      { num: fmtOz(c.ppReserves), label: 'P&P Reserves' },
      { num: fmtM(c.ebitda2026e, dc), label: 'EBITDA 2026E (' + dc + ')' },
      { num: fmtM(c.fcf2026e, dc), label: 'Free Cash Flow 2026E (' + dc + ')' },
      { num: fmtOz(c.productionGrowth), label: 'Growth Target' }
    ];
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
    // Per-share spread: exchange ratio cancels out when using MC + ownership %
    // Equivalent to: exchangeRatio × acquirerPrice / targetPrice - 1
    var dealSpread = (b.marketCapUsd / t.marketCapUsd) / shareRatio - 1;
    var dealSpreadPct = dealSpread * 100;
    var isPositive = dealSpreadPct >= 0;
    var spreadColor = isPositive ? 'sens-positive' : 'sens-negative';
    // Bar fills from center: right for premium, left for discount
    // Scale: 25% spread = full half, so each 1% = 2% of half-width
    var barPct = Math.min(50, Math.abs(dealSpreadPct) * 2);
    var barBg = isPositive ? '#27AE60' : '#E74C3C';

    var liveCombinedMC = b.marketCapUsd + t.marketCapUsd;
    var olaImpliedValue = liveCombinedMC * deal.proForma.ownershipTarget / 100;
    var olaPremium = (olaImpliedValue / t.marketCapUsd - 1) * 100;

    var bAnnMC = b.announcementMC;
    var tAnnMC = t.announcementMC;
    var annCombinedMC = (bAnnMC || 0) + (tAnnMC || 0);

    // Premium to undisturbed: deal's implied value vs pre-announcement target MC
    var premiumToUndisturbed = tAnnMC ? ((olaImpliedValue / tAnnMC) - 1) * 100 : null;
    var premiumIsPositive = premiumToUndisturbed !== null && premiumToUndisturbed >= 0;
    var premiumSpreadColor = premiumIsPositive ? 'sens-positive' : 'sens-negative';
    // Scale: 100% premium = full half, each 1% = 0.5% of half-width
    var premiumBarPct = premiumToUndisturbed !== null ? Math.min(50, Math.abs(premiumToUndisturbed) * 0.5) : 0;
    var premiumBarBg = premiumIsPositive ? '#27AE60' : '#E74C3C';

    function mcChangeHtml(liveMC, annMC) {
      if (!annMC || !liveMC) return '';
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

    // Company data date: end of day yesterday
    var yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    var eodLabel = 'EOD ' + (yesterday.getMonth() + 1) + '/' + yesterday.getDate() + '/' + yesterday.getFullYear();
    var eodHtml = '<div style="font-size:9px;color:#999;margin-top:3px">' + eodLabel + '</div>';

    return '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px;margin-bottom:16px">' +
        '<div style="text-align:center;padding:12px;background:#FAFBFC;border-radius:8px">' +
          '<div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px">Acquirer MC (USD)</div>' +
          '<div style="font-size:20px;font-weight:700;color:var(--header-mid);margin-top:4px">' + fmtM(b.marketCapUsd, 'USD') + '</div>' +
          mcChangeHtml(b.marketCapUsd, bAnnMC) +
          eodHtml +
        '</div>' +
        '<div style="text-align:center;padding:12px;background:#FAFBFC;border-radius:8px">' +
          '<div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px">Target MC (USD)</div>' +
          '<div style="font-size:20px;font-weight:700;color:var(--header-mid);margin-top:4px">' + fmtM(t.marketCapUsd, 'USD') + '</div>' +
          mcChangeHtml(t.marketCapUsd, tAnnMC) +
          eodHtml +
        '</div>' +
        '<div style="text-align:center;padding:12px;background:#FAFBFC;border-radius:8px">' +
          '<div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px">Combined MC (USD)</div>' +
          '<div style="font-size:20px;font-weight:700;color:var(--header-mid);margin-top:4px">' + fmtM(liveCombinedMC, 'USD') + '</div>' +
          mcChangeHtml(liveCombinedMC, annCombinedMC) +
          eodHtml +
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
        (premiumToUndisturbed !== null ? ' <strong>Premium to Undisturbed:</strong> The deal\'s current implied value vs. ' + escHtml(t.shortName) + '\'s pre-announcement market cap (' + fmtM(tAnnMC, 'USD') + '), showing the total value uplift the deal delivers to target shareholders.' : '') +
        ' Implied value to ' + escHtml(t.shortName) + ' shareholders: ' + fmtM(olaImpliedValue, 'USD') + '.' +
      '</div>';
  }

  // =========================================================
  // RENDER: Term Sheet
  // =========================================================
  function renderTermSheet(deal) {
    var tm = deal.terms;
    var pf = deal.proForma;
    var b = deal.bidder;
    var t = deal.target;
    var vs = deal.votingSupport;
    // Deal currency for terms like break fees, cash per share
    var dc = deal.dealCurrency || b.currency || 'USD';

    var html =
      '<div class="term-grid">' +
        '<div class="term-group">' +
          '<h4>Transaction Structure</h4>' +
          '<div class="term-row"><span class="term-key">Exchange Ratio</span><span class="term-val gold">' + tm.exchangeRatio.toFixed(2) + ' ' + escHtml(b.ticker) + ' per ' + escHtml(t.ticker) + ' share</span></div>' +
          '<div class="term-row"><span class="term-key">Cash Component</span><span class="term-val">' + fmtCurrency(tm.cashPerShare, 4, dc) + ' per ' + escHtml(t.ticker) + ' share</span></div>' +
          '<div class="term-row"><span class="term-key">Structure</span><span class="term-val">' + escHtml(tm.structure) + '</span></div>' +
          '<div class="term-row"><span class="term-key">Bidder Break Fee</span><span class="term-val">' + fmtCurrency(tm.bidderBreakFee, 0, dc) + 'M</span></div>' +
          '<div class="term-row"><span class="term-key">Target Break Fee</span><span class="term-val">' + fmtCurrency(tm.targetBreakFee, 0, dc) + 'M</span></div>' +
          '<div class="term-row"><span class="term-key">' + escHtml(b.ticker) + ' Approval</span><span class="term-val">' + escHtml(tm.bidderApproval) + '</span></div>' +
          '<div class="term-row"><span class="term-key">' + escHtml(t.ticker) + ' Approval</span><span class="term-val">' + escHtml(tm.targetApproval) + '</span></div>' +
        '</div>' +
        '<div class="term-group">' +
          '<h4>Pro Forma Governance</h4>' +
          '<div class="term-row"><span class="term-key">' + escHtml(b.ticker) + ' Ownership</span><span class="term-val gold">~' + pf.ownershipBidder + '%</span></div>' +
          '<div class="term-row"><span class="term-key">' + escHtml(t.ticker) + ' Ownership</span><span class="term-val">~' + pf.ownershipTarget + '%</span></div>' +
          '<div class="term-row"><span class="term-key">Board Size</span><span class="term-val">' + pf.boardSize + ' directors</span></div>' +
          '<div class="term-row"><span class="term-key">Board Composition</span><span class="term-val">' + pf.boardBidder + ' ' + escHtml(b.ticker) + ' + ' + pf.boardTarget + ' ' + escHtml(t.ticker) + ' + Chair</span></div>' +
          '<div class="term-row"><span class="term-key">CEO</span><span class="term-val">' + escHtml(pf.ceo) + '</span></div>' +
          '<div class="term-row"><span class="term-key">President</span><span class="term-val">' + escHtml(pf.president) + '</span></div>' +
          '<div class="term-row"><span class="term-key">Chair</span><span class="term-val">' + escHtml(pf.chair) + '</span></div>' +
        '</div>' +
      '</div>';

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
            '<div class="voting-pct">~' + vs.bidder.pct + '%</div>' +
            '<div class="voting-label">' + escHtml(b.shortName) + ' Shareholders</div>' +
            '<div class="voting-desc">' + escHtml(vs.bidder.desc) + '</div>' +
          '</div>' +
          '<div class="voting-card">' +
            '<div class="voting-pct">~' + vs.target.pct + '%</div>' +
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

    var bidderMC = b.marketCapUsd || (c.marketCapUsd * pf.ownershipBidder / 100);
    var targetMC = t.marketCapUsd || (c.marketCapUsd * pf.ownershipTarget / 100);
    var bidderResOz = dbReservesToOz(b.reserves);
    var targetResOz = dbReservesToOz(t.reserves);
    var bidderRscOz = dbReservesToOz(b.resources);
    var targetRscOz = dbReservesToOz(t.resources);
    var bidderProd = dbProdToOz(b.productionHigh || b.productionLow);
    var targetProd = dbProdToOz(t.productionHigh || t.productionLow);

    // Shares outstanding (stored in millions) — convert to actual count
    var bShares = b.sharesOutstanding ? b.sharesOutstanding * 1e6 : null;
    var tShares = t.sharesOutstanding ? t.sharesOutstanding * 1e6 : null;
    var exchangeRatio = deal.terms && deal.terms.exchangeRatio ? deal.terms.exchangeRatio : null;
    var combinedShares = bShares && tShares && exchangeRatio ? bShares + tShares * exchangeRatio : null;

    // Deal currency for EBITDA/FCF/liquidity — these are in whatever currency the deal reports
    var dc = deal.dealCurrency || b.currency || 'USD';

    var rows = [
      { section: 'Market & Valuation' },
      { metric: 'Market Cap (USD)', bidder: fmtM(bidderMC, 'USD'), target: fmtM(targetMC, 'USD'), combined: fmtM(c.marketCapUsd, 'USD') },
      { metric: 'EBITDA 2026E (' + dc + ')', bidder: b.ebitda2026e ? fmtM(b.ebitda2026e, dc) : '—', target: t.ebitda2026e ? fmtM(t.ebitda2026e, dc) : '—', combined: fmtM(c.ebitda2026e, dc) },
      { metric: 'Free Cash Flow 2026E (' + dc + ')', bidder: b.fcf2026e ? fmtM(b.fcf2026e, dc) : '—', target: t.fcf2026e ? fmtM(t.fcf2026e, dc) : '—', combined: fmtM(c.fcf2026e, dc) },
      { metric: 'Liquidity (' + dc + ')', bidder: '—', target: '—', combined: fmtM(c.liquidity, dc) },
      { metric: 'EV/EBITDA 2026E', bidder: bidderMC && b.ebitda2026e ? fmtX(bidderMC / b.ebitda2026e) : '—', target: targetMC && t.ebitda2026e ? fmtX(targetMC / t.ebitda2026e) : '—', combined: c.ebitda2026e ? fmtX(c.marketCapUsd / c.ebitda2026e) : '—' },
      { metric: 'FCF Yield 2026E', bidder: bidderMC && b.fcf2026e ? fmtPct(b.fcf2026e / bidderMC * 100) : '—', target: targetMC && t.fcf2026e ? fmtPct(t.fcf2026e / targetMC * 100) : '—', combined: c.marketCapUsd && c.fcf2026e ? fmtPct(c.fcf2026e / c.marketCapUsd * 100) : '—' },
      { section: 'Production & Reserves' },
      { metric: 'Annual Production', bidder: prodRange(b), target: prodRange(t), combined: fmtNum(c.production) + ' oz' },
      { metric: 'AISC Guidance 2026 (USD)', bidder: b.aiscLow && b.aiscHigh ? fmtCurrency(b.aiscLow, 0, 'USD') + '–' + fmtCurrency(b.aiscHigh, 0, 'USD') + '/oz' : '—', target: t.aiscLow && t.aiscHigh ? fmtCurrency(t.aiscLow, 0, 'USD') + '–' + fmtCurrency(t.aiscHigh, 0, 'USD') + '/oz' : '—', combined: c.aiscLow && c.aiscHigh ? fmtCurrency(c.aiscLow, 0, 'USD') + '–' + fmtCurrency(c.aiscHigh, 0, 'USD') + '/oz' : '—' },
      { metric: 'P&P Reserves', bidder: bidderResOz ? fmtOz(bidderResOz) : '—', target: targetResOz ? fmtOz(targetResOz) : '—', combined: fmtOz(c.ppReserves) },
      { metric: 'M&I Resources (ex. reserves)', bidder: bidderRscOz ? fmtOz(bidderRscOz) : '—', target: targetRscOz ? fmtOz(targetRscOz) : '—', combined: fmtOz(c.miResources) },
      { metric: 'Inferred Resources', bidder: '—', target: '—', combined: fmtOz(c.inferredResources) },
      { metric: 'Reserve Life', bidder: bidderResOz && bidderProd ? (bidderResOz / bidderProd).toFixed(1) + ' years' : '—', target: targetResOz && targetProd ? (targetResOz / targetProd).toFixed(1) + ' years' : '—', combined: (c.ppReserves / c.production).toFixed(1) + ' years' },
      { metric: 'Growth Production Target', bidder: '—', target: '—', combined: '>' + fmtOz(c.productionGrowth) },
      { section: 'Key Ratios' },
      { metric: 'MC / Annual Production (USD/oz)', bidder: bidderMC && bidderProd ? fmtCurrency(bidderMC * 1e6 / bidderProd, 0, 'USD') : '—', target: targetMC && targetProd ? fmtCurrency(targetMC * 1e6 / targetProd, 0, 'USD') : '—', combined: fmtCurrency(c.marketCapUsd * 1e6 / c.production, 0, 'USD') },
      { metric: 'MC / P&P Reserve (USD/oz)', bidder: bidderMC && bidderResOz ? fmtCurrency(bidderMC * 1e6 / bidderResOz, 0, 'USD') : '—', target: targetMC && targetResOz ? fmtCurrency(targetMC * 1e6 / targetResOz, 0, 'USD') : '—', combined: fmtCurrency(c.marketCapUsd * 1e6 / c.ppReserves, 0, 'USD') },
      { metric: 'P&P Reserve oz / 100K Shares', bidder: bidderResOz && bShares ? fmtNum(Math.round(bidderResOz / bShares * 1e5)) : '—', target: targetResOz && tShares ? fmtNum(Math.round(targetResOz / tShares * 1e5)) : '—', combined: c.ppReserves && combinedShares ? fmtNum(Math.round(c.ppReserves / combinedShares * 1e5)) : '—' },
      { metric: 'Production oz / 100K Shares', bidder: bidderProd && bShares ? fmtNum(Math.round(bidderProd / bShares * 1e5)) : '—', target: targetProd && tShares ? fmtNum(Math.round(targetProd / tShares * 1e5)) : '—', combined: c.production && combinedShares ? fmtNum(Math.round(c.production / combinedShares * 1e5)) : '—' }
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
    var goldPrice = parseInt(document.getElementById('sens-gold').value);
    var aisc = parseInt(document.getElementById('sens-aisc').value);
    var resAdj = parseInt(document.getElementById('sens-res').value);

    document.getElementById('sens-gold-val').textContent = fmtCurrency(goldPrice, 0, 'USD');
    document.getElementById('sens-aisc-val').textContent = fmtCurrency(aisc, 0, 'USD');
    document.getElementById('sens-res-val').textContent = resAdj === 0 ? 'Base Case (0%)' : (resAdj > 0 ? '+' : '') + resAdj + '%';

    var c = deal.combined;
    var production = c.production;
    var baseGold = deal.defaultGoldPrice;
    var reserves = c.ppReserves * (1 + resAdj / 100);
    var marketCap = c.marketCapUsd;

    var revenue = production * goldPrice / 1e6;
    var totalCost = production * aisc / 1e6;
    var ebitda = c.ebitda2026e + (goldPrice - baseGold) * production / 1e6;
    var fcf = c.fcf2026e + (goldPrice - baseGold) * production / 1e6;

    var mcPerReserveOz = marketCap * 1e6 / reserves;
    var reserveLife = reserves / production;
    var evEbitda = ebitda > 0 ? marketCap / ebitda : null;
    var fcfYield = marketCap > 0 ? fcf / marketCap * 100 : null;
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
      var eb = c.ebitda2026e + (gp - baseGold) * production / 1e6;
      var fc = c.fcf2026e + (gp - baseGold) * production / 1e6;
      var mg = gp > 0 ? (gp - aisc) / gp * 100 : 0;
      var ev = eb > 0 ? marketCap / eb : null;
      var fy = marketCap > 0 ? fc / marketCap * 100 : null;
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
        '<td>' + fmtM(fc, dc) + '</td>' +
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
          '<div style="font-size:18px;font-weight:700;color:var(--header-mid)">' + fmtM(fcf, dc) + '</div>' +
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
        '<div class="asset-prod">' + fmtOz(a.production) + '</div>' +
        '<div class="asset-prod-label">Annual Production</div>' +
      '</div>';
    });
    html += '</div>';

    if (deal.growthPipeline && deal.growthPipeline.length > 0) {
      var growthProd = 0;
      deal.growthPipeline.forEach(function(a) { growthProd += a.production || 0; });
      html += '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin:20px 0 12px;padding-top:16px;border-top:2px solid #E8EAF0">Growth Pipeline (>' + fmtOz(growthProd) + ' additional)</div>' +
        '<div class="assets-grid">';
      deal.growthPipeline.forEach(function(a) {
        html += '<div class="asset-card" style="border-style:dashed;border-color:#D0D4DE">' +
          '<div class="asset-name">' + escHtml(a.name) + '</div>' +
          '<div class="asset-region">' + escHtml(a.region) + '</div>' +
          '<div class="asset-prod">' + (a.production ? '~' + fmtOz(a.production) : 'TBD') + '</div>' +
          '<div class="asset-prod-label">Target Production</div>' +
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
    var ms = deal.milestones;
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
      var isComplete = m.date <= today || m.status === 'complete';
      var isActive = !isComplete && (i === 0 || ms[i - 1].date <= today);
      var dotClass = isComplete ? 'complete' : isActive ? 'active' : '';

      html += '<div class="timeline-node">' +
        '<div class="timeline-dot ' + dotClass + '"></div>' +
        '<div class="timeline-label">' + escHtml(m.label) + '</div>' +
        '<div class="timeline-date">' + mDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + '</div>' +
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

    var daysToClose = Math.max(0, Math.round((endDate - todayTs) / 86400000));
    html += '<div style="text-align:center;margin-top:8px">' +
      '<span style="font-size:24px;font-weight:800;color:var(--color-gold)">' + daysToClose + '</span>' +
      '<span style="font-size:12px;color:var(--text-secondary);margin-left:6px">days to expected close</span>' +
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
