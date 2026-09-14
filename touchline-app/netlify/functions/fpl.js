// Netlify function: /.netlify/functions/fpl?url=<encoded FPL API url>
exports.handler = async (event) => {
  const target = event.queryStringParameters && event.queryStringParameters.url;
  if (!target || !/^https:\/\/fantasy\.premierleague\.com\/api\//.test(target)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Only fantasy.premierleague.com/api URLs are allowed.' }) };
  }
  try {
    const r = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 (touchline)' } });
    return {
      statusCode: r.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
      body: await r.text(),
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Could not reach FPL.' }) };
  }
};
