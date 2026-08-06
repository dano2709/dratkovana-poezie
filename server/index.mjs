import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleContentApi } from "./content-api.mjs";
import { handleGalleryApi } from "./gallery-api.mjs";
import { createRuntime } from "./runtime.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  const envText = await fs.readFile(path.join(rootDir, ".env"), "utf8");
  for (const rawLine of envText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const store = await import("./store.mjs");
await store.initializeStore();
const ctx = await createRuntime({ rootDir, store });
const publicDir = path.join(rootDir, "public");
const port = Number(process.env.PORT || 3001);
if (!Number.isFinite(port) || port <= 0) throw new Error("PORT must be a positive number");

async function handleApi(req, res, pathname) {
  const method = req.method || "GET";
  if (method === "GET" && pathname === "/api/health") {
    return ctx.sendJson(res, 200, { ok: true });
  }
  if (await handleContentApi(ctx, req, res, pathname, method)) return;
  if (await handleGalleryApi(ctx, req, res, pathname, method)) return;
  ctx.sendJson(res, 404, { error: "API endpoint not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith("/api/")) return await handleApi(req, res, pathname);
    if (req.method !== "GET" && req.method !== "HEAD") {
      return ctx.sendJson(res, 405, { error: "Method not allowed" }, { allow: "GET, HEAD" });
    }
    let requested = pathname === "/" || pathname === "/admin" ? "/index.html" : pathname;
    requested = path.posix.normalize(requested).replace(/^\.\.(\/|\\)/, "");
    const filePath = path.join(publicDir, requested);
    if (!filePath.startsWith(publicDir)) return ctx.sendJson(res, 403, { error: "Forbidden" });
    try { await ctx.serveFile(res, filePath); }
    catch { await ctx.serveFile(res, path.join(publicDir, "index.html"), "no-cache"); }
  } catch (error) {
    console.error(error);
    if (!res.headersSent) ctx.sendJson(res, error?.status || 500, { error: error?.status === 413 ? "File is too large" : "Internal server error" });
    else res.end();
  }
});

server.listen(port, "0.0.0.0", () => console.log(`Drátkovaná poezie running on http://localhost:${port}`));
function shutdown() { server.close(() => process.exit(0)); }
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
