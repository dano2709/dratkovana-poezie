import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export async function createRuntime({ rootDir, store }) {
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(rootDir, "uploads"));
  const isProduction = process.env.NODE_ENV === "production";
  const adminUsername = process.env.ADMIN_USERNAME || "Admin";
  const adminPassword = process.env.ADMIN_PASSWORD || "Havirov123";
  const sessionSecret = process.env.SESSION_SECRET || "development-only-change-me";
  const maxUploadBytes = Number(process.env.MAX_UPLOAD_MB || 20) * 1024 * 1024;
  const sessions = new Map();
  const pendingUploads = new Map();
  const cookieName = "dratkovana_session";
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const uploadTtl = 10 * 60 * 1000;

  if (isProduction && sessionSecret === "development-only-change-me") {
    console.warn("WARNING: Set SESSION_SECRET in production.");
  }
  await fs.mkdir(uploadDir, { recursive: true });

  const contentTypes = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon"
  };

  function sendJson(res, status, payload, extraHeaders = {}) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
      ...extraHeaders
    });
    res.end(body);
  }

  function cleanText(value, maxLength = 10000) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
  }

  function parsePositiveId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  function safeEqual(left, right) {
    const a = Buffer.from(String(left));
    const b = Buffer.from(String(right));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function signToken(token) {
    return crypto.createHmac("sha256", sessionSecret).update(token).digest("base64url");
  }

  function parseCookies(req) {
    const entries = (req.headers.cookie || "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
      const index = part.indexOf("=");
      return index < 0
        ? [decodeURIComponent(part), ""]
        : [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
    });
    return Object.fromEntries(entries);
  }

  function getSession(req) {
    const signed = parseCookies(req)[cookieName];
    if (!signed) return null;
    const separator = signed.lastIndexOf(".");
    if (separator < 1) return null;
    const token = signed.slice(0, separator);
    if (!safeEqual(signed.slice(separator + 1), signToken(token))) return null;
    const session = sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      sessions.delete(token);
      return null;
    }
    return session;
  }

  function requireAdmin(req, res) {
    if (getSession(req)) return true;
    sendJson(res, 401, { error: "Unauthorized" });
    return false;
  }

  function login(req, res, username, password) {
    if (!safeEqual(username, adminUsername) || !safeEqual(password, adminPassword)) {
      sendJson(res, 401, { error: "Nesprávné přihlašovací údaje" });
      return;
    }
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { expiresAt: Date.now() + sessionTtl });
    const parts = [
      `${cookieName}=${encodeURIComponent(`${token}.${signToken(token)}`)}`,
      "HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${Math.floor(sessionTtl / 1000)}`
    ];
    if (isProduction) parts.push("Secure");
    res.setHeader("set-cookie", parts.join("; "));
    sendJson(res, 200, { success: true });
  }

  function logout(req, res) {
    const token = (parseCookies(req)[cookieName] || "").split(".", 1)[0];
    if (token) sessions.delete(token);
    res.setHeader("set-cookie", `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${isProduction ? "; Secure" : ""}`);
    sendJson(res, 200, { success: true });
  }

  async function readBody(req, maxBytes = 1024 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error("Body too large");
        error.status = 413;
        throw error;
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async function readJson(req, maxBytes) {
    const body = await readBody(req, maxBytes);
    if (!body.length) return {};
    try {
      return JSON.parse(body.toString("utf8"));
    } catch {
      const error = new Error("Invalid JSON");
      error.status = 400;
      throw error;
    }
  }

  function categoryFor(state, categoryId) {
    return categoryId == null ? null : state.categories.find((category) => category.id === categoryId) || null;
  }

  function hydrateItem(state, item) {
    return {
      ...item,
      category: categoryFor(state, item.categoryId),
      photos: state.photos.filter((photo) => photo.itemId === item.id)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    };
  }

  function objectFilename(objectPath) {
    if (typeof objectPath !== "string" || !objectPath.startsWith("/objects/")) return null;
    const filename = path.basename(objectPath);
    return filename && filename !== "." ? filename : null;
  }

  async function removeObjectIfUnused(objectPath, excludingPhotoId = null) {
    const state = store.readStore();
    const used = state.photos.some((photo) => photo.id !== excludingPhotoId && photo.objectPath === objectPath)
      || state.siteSettings.bioPhotoPath === objectPath;
    if (used) return;
    const filename = objectFilename(objectPath);
    if (filename) await fs.rm(path.join(uploadDir, filename), { force: true });
  }

  async function serveFile(res, filePath, cacheControl = "public, max-age=300") {
    const data = await fs.readFile(filePath);
    const type = contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "content-type": type, "content-length": data.length, "cache-control": cacheControl });
    res.end(data);
  }

  return {
    crypto, fs, path, store, uploadDir, maxUploadBytes, uploadTtl, pendingUploads,
    sendJson, cleanText, parsePositiveId, getSession, requireAdmin, login, logout,
    readBody, readJson, hydrateItem, objectFilename, removeObjectIfUnused, serveFile
  };
}
