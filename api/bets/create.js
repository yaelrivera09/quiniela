// Crea una nueva apuesta y la guarda en Redis (Upstash).
import { redisPipeline } from "../_redis.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  try {
    const { targetName, fromName, homeTeamEn, awayTeamEn, amount, context } = req.body || {};

    if (!targetName || !amount) {
      res.status(400).json({ error: "MISSING_FIELDS" });
      return;
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const bet = {
      id,
      targetName,
      fromName: fromName || "",
      homeTeamEn: homeTeamEn || "",
      awayTeamEn: awayTeamEn || "",
      amount: Number(amount),
      context: context || "",
      status: "pendiente",
      createdAt: new Date().toISOString(),
    };

    await redisPipeline([
      ["SET", `bet:${id}`, JSON.stringify(bet)],
      ["SADD", "bets:ids", id],
    ]);

    res.status(200).json({ bet });
  } catch (err) {
    res.status(200).json({ error: err.message });
  }
}
