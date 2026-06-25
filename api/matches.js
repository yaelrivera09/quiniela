// Vercel Serverless Function: devuelve los partidos del Mundial 2026
// (en vivo, programados y finalizados) usando football-data.org.
//
// Estabilización de llaves: football-data.org a veces "pierde" temporalmente
// los equipos ya asignados al cuadro de eliminación (los manda en null y luego
// otra vez con nombre). Para que el cuadro no parpadee para NADIE, recordamos
// en Redis el último equipo conocido de cada cruce y lo reinyectamos cuando la
// API lo manda vacío. Si la API trae un equipo distinto (corrección real), ese
// gana y se actualiza el recuerdo.

import { redisPipeline } from "./_redis.js";

const BRACKET_KEY = "bracketTeams";

async function stabilizeKnockout(matches) {
  let mem = {};
  try {
    const r = await redisPipeline([["GET", BRACKET_KEY]]);
    if (r[0]?.result) mem = JSON.parse(r[0].result);
  } catch (e) {
    return; // sin Redis: devolvemos los partidos tal cual
  }

  let changed = false;
  for (const m of matches) {
    if (!m.stage || m.stage === "GROUP_STAGE") continue;
    const prev = mem[m.id];
    if (prev) {
      if (!m.homeTeam?.name && prev.home) m.homeTeam = prev.home;
      if (!m.awayTeam?.name && prev.away) m.awayTeam = prev.away;
    }
    if (m.homeTeam?.name || m.awayTeam?.name) {
      const entry = {
        home: m.homeTeam?.name ? m.homeTeam : prev?.home || null,
        away: m.awayTeam?.name ? m.awayTeam : prev?.away || null,
      };
      if (JSON.stringify(prev) !== JSON.stringify(entry)) {
        mem[m.id] = entry;
        changed = true;
      }
    }
  }

  if (changed) {
    try {
      await redisPipeline([["SET", BRACKET_KEY, JSON.stringify(mem)]]);
    } catch (e) {
      /* no se pudo guardar: igual devolvemos lo estabilizado en memoria */
    }
  }
}

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
    const matches = data.matches || [];

    await stabilizeKnockout(matches);

    res.setHeader("Cache-Control", "s-maxage=8, stale-while-revalidate=5");
    res.status(200).json({ matches });
  } catch (err) {
    res.status(200).json({ error: "FETCH_FAILED", message: err.message, matches: [] });
  }
}
