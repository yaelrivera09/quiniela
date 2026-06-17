// Marca una apuesta como aceptada.
import { redisPipeline } from "../_redis.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  try {
    const { id } = req.body || {};
    if (!id) {
      res.status(400).json({ error: "MISSING_ID" });
      return;
    }

    const getResult = await redisPipeline([["GET", `bet:${id}`]]);
    const raw = getResult[0]?.result;
    if (!raw) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    const bet = JSON.parse(raw);
    bet.status = "aceptada";
    bet.acceptedAt = new Date().toISOString();

    await redisPipeline([["SET", `bet:${id}`, JSON.stringify(bet)]]);

    res.status(200).json({ bet });
  } catch (err) {
    res.status(200).json({ error: err.message });
  }
}
