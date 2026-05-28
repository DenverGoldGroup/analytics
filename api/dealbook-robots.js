// GET /robots.txt on dealbook.miningforum.com — block all crawlers
module.exports = function handler(req, res) {
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.status(200).send('User-agent: *\nDisallow: /\n');
};
