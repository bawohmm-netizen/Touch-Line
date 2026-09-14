// Vercel serverless function: /api/fpl?url=<encoded FPL API url>
// Lets the app read your team by ID without the browser hitting CORS.
export default async function handler(req, res) {
  const target = req.query.url;
  if (!target || !/^https:\/\/fantasy\.premierleague\.com\/api\//.test(target)) {
    return res.status(400).json({ error: 'Only fantasy.premierleague.com/api URLs are allowed.' });
  }
  try {
    const r = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 (touchline)' } });
    const body = await r.text();
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Content-Type', 'application/json');
    return res.status(r.status).send(body);
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach FPL.' });
  }
}
