// Vercel Serverless Function: devuelve los partidos del Mundial 2026
// (en vivo, programados y finalizados) usando football-data.org.

export default async function handler(req, res) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;

  if (!apiKey) {
    res.status(200).json({ error: "NO_API_KEY", matches: [] });
    return;
  }

  try {
    const response = await fetch(
      "https://api.football-data.org/v4/competitions/WC/matches",
      { headers: { "X-Auth-Token": apiKey } }
    );

    if (!response.ok) {
      res.status(200).json({ error: "API_ERROR", status: response.status, matches: [] });
      return;
    }

    const data = await response.json();
    res.setHeader("Cache-Control", "s-maxage=8, stale-while-revalidate=5");
    res.status(200).json({ matches: data.matches || [] });
  } catch (err) {
    res.status(200).json({ error: "FETCH_FAILED", message: err.message, matches: [] });
  }
}
