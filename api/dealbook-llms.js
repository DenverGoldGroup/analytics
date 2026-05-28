// GET /api/dealbook-llms — Dynamic llms.txt for announced deals
var { createClient } = require('@supabase/supabase-js');

var SUPABASE_URL = 'https://ljyogcspkvqgjbiyzfbn.supabase.co';

function getSupabase() {
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return createClient(SUPABASE_URL, key);
}

function fmtM(n) {
  if (n == null || isNaN(n)) return 'N/A';
  if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(1) + 'B';
  return '$' + Number(n).toFixed(0) + 'M';
}

function fmtOz(n) {
  if (n == null || isNaN(n)) return 'N/A';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M oz';
  if (n >= 1000) return Math.round(n / 1000) + 'K oz';
  return n + ' oz';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end('Method not allowed');

  try {
    var sb = getSupabase();
    var { data: deals, error } = await sb.from('deals')
      .select('*')
      .eq('is_announced', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('llms.txt fetch error:', error);
      return res.status(500).end('Internal server error');
    }

    var lines = [];
    lines.push('# Denver Gold Group — M&A Dealbook');
    lines.push('');
    lines.push('> Machine-readable deal data for announced mining M&A transactions.');
    lines.push('> Source: https://dealbook.miningforum.com');
    lines.push('> Updated: ' + new Date().toISOString().slice(0, 10));
    lines.push('');

    if (!deals || deals.length === 0) {
      lines.push('No announced deals at this time.');
    } else {
      lines.push('## Deals (' + deals.length + ')');
      lines.push('');

      deals.forEach(function(deal) {
        var d = deal.deal_data || {};
        var b = d.bidder || {};
        var t = d.target || {};
        var c = d.combined || {};
        var tm = d.terms || {};

        lines.push('### ' + deal.title);
        lines.push('');
        lines.push('- **URL**: https://dealbook.miningforum.com/deals/' + deal.slug);
        lines.push('- **Status**: ' + (deal.status || 'unknown'));
        lines.push('- **Mineral**: ' + (deal.mineral || 'N/A'));
        lines.push('- **Announced**: ' + (d.announcementDate || 'N/A'));
        lines.push('- **Expected Close**: ' + (d.expectedClose || 'N/A'));
        lines.push('');

        lines.push('#### Parties');
        lines.push('- **Acquirer**: ' + (b.name || deal.bidder_name || 'N/A') + ' (' + (b.ticker || 'N/A') + ')');
        lines.push('- **Target**: ' + (t.name || deal.target_name || 'N/A') + ' (' + (t.ticker || 'N/A') + ')');
        lines.push('');

        if (tm.exchangeRatio != null || tm.structure) {
          lines.push('#### Terms');
          if (tm.structure) lines.push('- **Structure**: ' + tm.structure);
          if (tm.exchangeRatio != null) lines.push('- **Exchange Ratio**: ' + tm.exchangeRatio);
          if (tm.cashPerShare != null) lines.push('- **Cash per Share**: $' + tm.cashPerShare);
          lines.push('');
        }

        if (c.marketCapUsd || c.production || c.ebitda2026e) {
          lines.push('#### Combined Metrics');
          if (c.marketCapUsd) lines.push('- **Market Cap**: ' + fmtM(c.marketCapUsd));
          if (c.production) lines.push('- **Annual Production**: ' + fmtOz(c.production));
          if (c.ebitda2026e) lines.push('- **EBITDA 2026E**: ' + fmtM(c.ebitda2026e));
          if (c.fcf2026e) lines.push('- **FCF 2026E**: ' + fmtM(c.fcf2026e));
          if (c.ppReserves) lines.push('- **P&P Reserves**: ' + fmtOz(c.ppReserves));
          lines.push('');
        }

        lines.push('---');
        lines.push('');
      });
    }

    lines.push('');
    lines.push('## About');
    lines.push('');
    lines.push('The Denver Gold Group M&A Dealbook tracks announced mergers and acquisitions');
    lines.push('in the precious metals mining sector. Data sourced from public filings,');
    lines.push('investor presentations, and press releases.');
    lines.push('');
    lines.push('Contact: info@denvergold.org');

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=600');
    return res.status(200).end(lines.join('\n'));
  } catch (err) {
    console.error('llms.txt error:', err);
    return res.status(500).end('Internal server error');
  }
};
