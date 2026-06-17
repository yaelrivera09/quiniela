// Vercel Serverless Function: devuelve la tabla de grupos del Mundial 2026
// usando football-data.org. La API key se guarda como variable de entorno
// FOOTBALL_DATA_API_KEY en el proyecto de Vercel (nunca queda expuesta al navegador).

export default async function handler(req, res) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;

  if (!apiKey) {
    res.status(200).json({ error: "NO_API_KEY", standings: [] });
    return;
  }

  try {
    const response = await fetch(
      "https://api.football-data.org/v4/competitions/WC/standings",
      { headers: { "X-Auth-Token": apiKey } }
    );

    if (!response.ok) {
      res.status(200).json({ error: "API_ERROR", status: response.status, standings: [] });
      return;
    }

    const data = await response.json();
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=60");
    res.status(200).json({ standings: data.standings || [] });
  } catch (err) {
    res.status(200).json({ error: "FETCH_FAILED", message: err.message, standings: [] });
  }
}
