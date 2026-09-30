// Member Post-Show Briefing — a two-page PDF for presenting issuers on how the forum went.
// Built entirely from the Analyst Briefing's parts (analyst-brief.js): the same summariser, drawing
// primitives and section renderers, composed for a member audience with its own lede and page order.
// Runs unchanged in the browser (pdfkit.standalone) and in node (tests). Load analyst-brief.js first.
(function(root) {
  'use strict';

  var AB = (typeof module !== 'undefined' && module.exports) ? require('./analyst-brief.js') : root.AnalystBrief;
  var S = AB.sections, F = AB.fmt, ST = AB.style;
  var KICKER = 'Member post-show briefing';

  function join(parts) {
    return parts.filter(Boolean).join(' ');
  }

  // The lede: the forum in three or four sentences, past tense, no projections
  function lede(data, s) {
    var evt = data.event;
    var nth = evt.event_type === 'MFA' ? 'the ' + F.ordinal(evt.year - 1988) + ' annual ' : '';
    var a = s.audience, h = s.holdings, m = s.meetings;
    var days = null;
    var start = F.parseDate(evt.start_date), end = F.parseDate(evt.end_date);
    if (start && end) days = Math.round((end - start) / 864e5) + 1;
    var first = 'Thank you for presenting at ' + nth + evt.event_name + '. ' +
      (days ? 'Over ' + ['one', 'two', 'three', 'four', 'five'][days - 1] + ' days, ' : '') +
      F.int(s.n) + ' issuers with an aggregate market capitalization of ' + F.usdWords(s.mcap) + ' presented' +
      (a ? ' to ' + F.int(a.total) + ' attendees from ' + F.int(a.countries.length) + ' countries' +
        (s.buyside ? ', including ' + F.int(s.buyside.value) + ' buy-side investors' : '') : '') + '.';
    var second = h && h.ratio != null
      ? 'Investors who attended hold ' + F.usdWords(h.held) + ' of participating issuers’ shares, ' + F.pct(h.ratio) +
        ' of aggregate event market cap' + (h.priorRatio != null ? ', against ' + F.pct(h.priorRatio) + ' last year.' : '.')
      : null;
    var third = m
      ? F.int(m.shownTotal) + ' one-on-one meetings were ' + (m.projected ? 'projected' : 'held') +
        (m.perIssuer != null ? ', ' + m.perIssuer.toFixed(1) + ' on average for each issuer taking meetings' : '') +
        (m.priorFinal ? ' (' + F.int(m.priorFinal) + ' in ' + (evt.year - 1) + ').' : '.')
      : null;
    return join([first, second, third]);
  }

  function pageOne(b, data, s, assets, asOf) {
    var evt = data.event;
    var y = S.headerBand(b, data, assets, KICKER);
    y = S.lede(b, lede(data, s), y);
    // What matters most to a presenting issuer: who came, who owns them, and the meetings
    var tiles = ['attendees', 'buyside', 'holdings', 'meetings', 'issuers']
      .map(function(k) { return S.tile(s, evt, k); }).filter(Boolean);
    if (tiles.length < 5) tiles.push(S.tile(s, evt, 'mcap'));
    y = S.kpiRow(b, tiles, y);
    if (s.audience) y = S.audience(b, s, y, { title: 'Who was in the room' }) + 16;
    if (s.meetings) y = S.meetings(b, s, evt, y) + 12;
    // Use what is left of the page for where the audience came from, as many rows as fit
    if (s.audience) {
      var rows = Math.floor((ST.PAGE_H - 52 - y - 13) / 15.5);
      if (rows >= 3) S.audienceCountries(b, s, y, Math.min(rows, 8));
    }
    b.footer(1, asOf);
  }

  function pageTwo(b, data, s, metal, asOf) {
    var evt = data.event;
    var y = S.runningHead(b, data, KICKER);
    var hasMetal = S.marketFits(evt, metal);
    var n = (s.holdings ? 1 : 0) + 1 + (hasMetal ? 1 : 0);
    var gapY = n >= 3 ? 16 : 26;
    if (s.holdings) y = S.holdings(b, s, evt, y) + gapY;
    y = S.roster(b, s, y, { title: 'Your peers on stage', compact: true, rowH: 17 });
    if (hasMetal) y = S.market(b, evt, metal, y) + gapY;
    if (ST.PAGE_H - 48 - y > 70) S.about(b, evt, y);
    b.footer(2, asOf);
  }

  function generate(PDFDocument, data, assets, metal) {
    var asOf = data.generated_at ? new Date(data.generated_at) : new Date();
    var evt = data.event;
    var doc = new PDFDocument({
      size: 'LETTER', margin: 0, autoFirstPage: true,
      info: { Title: evt.event_name + ' — Member Post-Show Briefing', Author: 'Denver Gold Group',
        Subject: 'How ' + evt.event_name + ' went, for presenting issuers', Keywords: 'mining, gold, investor forum' }
    });
    var f = assets.fonts;
    doc.registerFont('regular', f.regular);
    doc.registerFont('bold', f.bold);
    doc.registerFont('black', f.black || f.bold);
    doc.registerFont('light', f.light || f.regular);
    doc.registerFont('italic', f.italic || f.regular);
    doc.registerFont('serif', f.serif);
    var s = AB.summarise(data, asOf);
    var b = new AB.Brief(doc);
    pageOne(b, data, s, assets, asOf);
    doc.addPage({ size: 'LETTER', margin: 0 });
    pageTwo(b, data, s, metal, asOf);
    return doc;
  }

  var api = { generate: generate, summarise: AB.summarise };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MemberBrief = api;
})(typeof window !== 'undefined' ? window : this);
