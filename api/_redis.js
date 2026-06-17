// Helper compartido para hablar con Upstash Redis vía su REST API (pipeline).
// Usa las variables de entorno UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN
// que Vercel agrega automáticamente al conectar la integración de Upstash.

export async function redisPipeline(commands) {
  // Vercel nombra las variables distinto según cómo se conectó la integración:
  // UPSTASH_REDIS_REST_URL/TOKEN (Upstash directo) o KV_REST_API_URL/TOKEN (marketplace de Vercel).
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    throw new Error("NO_REDIS_CONFIG");
  }

  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  if (!res.ok) {
    throw new Error("REDIS_ERROR_" + res.status);
  }

  return res.json();
}
