// Vercel Serverless Function: tabla de goleadores del Mundial 2026
// usando football-data.org (endpoint /scorers).

export default async function handler(req, res) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;

  if (!apiKey) {
    res.status(200).json({ error: "NO_API_KEY", scorers: [] });
    return;
  }

  try {
    const response = await fetch(
      "https://api.football-data.org/v4/competitions/WC/scorers?limit=25",
      { headers: { "X-Auth-Token": apiKey } }
    );

    if (!response.ok) {
      res.status(200).json({ error: "API_ERROR", status: response.status, scorers: [] });
      return;
    }

    const data = await response.json();
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=60");
    res.status(200).json({ scorers: data.scorers || [] });
  } catch (err) {
    res.status(200).json({ error: "FETCH_FAILED", message: err.message, scorers: [] });
  }
}
