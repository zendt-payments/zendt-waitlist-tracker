import { put, get, BlobNotFoundError } from "@vercel/blob";

const ALLOWED = new Set([
  "zendt-waitlist-leads-v3",
  "zendt-waitlist-config-v1",
  "zendt-waitlist-dupelog-v1",
]);

const pathFor = (key) => `waitlist/${key}.json`;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    const key = String(req.query.key || "");
    if (!ALLOWED.has(key)) return res.status(400).json({ error: "invalid key" });
    try {
      const result = await get(pathFor(key), { access: "private", useCache: false });
      if (!result || result.statusCode !== 200) return res.json({ value: null });
      const value = await new Response(result.stream).text();
      return res.json({ value });
    } catch (error) {
      if (error instanceof BlobNotFoundError) return res.json({ value: null });
      console.error(error);
      return res.status(500).json({ error: "read failed" });
    }
  }

  if (req.method === "PUT") {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const key = String(body.key || "");
    const value = body.value;
    if (!ALLOWED.has(key) || typeof value !== "string") {
      return res.status(400).json({ error: "invalid payload" });
    }
    await put(pathFor(key), value, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60,
    });
    return res.json({ ok: true });
  }

  res.setHeader("Allow", "GET, PUT");
  return res.status(405).json({ error: "method not allowed" });
}
