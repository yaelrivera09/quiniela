// Elimina una apuesta (por si alguien se equivoca al capturarla).
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

    await redisPipeline([
      ["DEL", `bet:${id}`],
      ["SREM", "bets:ids", id],
    ]);

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(200).json({ error: err.message });
  }
}
