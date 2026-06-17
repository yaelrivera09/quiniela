// Devuelve todas las apuestas guardadas, más recientes primero.
import { redisPipeline } from "../_redis.js";

export default async function handler(req, res) {
  try {
    const idsResult = await redisPipeline([["SMEMBERS", "bets:ids"]]);
    const ids = idsResult[0]?.result || [];

    if (ids.length === 0) {
      res.status(200).json({ bets: [] });
      return;
    }

    const getCommands = ids.map((id) => ["GET", `bet:${id}`]);
    const betsResult = await redisPipeline(getCommands);

    const bets = betsResult
      .map((r) => r.result)
      .filter(Boolean)
      .map((s) => JSON.parse(s))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ bets });
  } catch (err) {
    res.status(200).json({ error: err.message, bets: [] });
  }
}
