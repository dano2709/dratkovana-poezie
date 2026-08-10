import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { del, get, head, put } from "@vercel/blob";

export async function createRuntime({ rootDir, store }) {
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(rootDir, "uploads"));
  const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  const blobEnabled = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  const adminUsername = process.env.ADMIN_USERNAME || "Admin";
  const adminPassword = process.env.ADMIN_PASSWORD || "Havirov123";
  const sessionSecret = process.env.SESSION_SECRET || "development-only-change-me";
  const maxUploadBytes = Number(process.env.MAX_UPLOAD_MB || (blobEnabled ? 4 : 20)) * 1024 * 1024;
  const cookieName = "dratkovana_session";
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const uploadTtl = 10 * 60 * 1000;

  if (isProduction && sessionSecret === "development-only-change-me") {
    console.warn("WARNING: Set SESSION_SECRET in production.");
  }
  if (!blobEnabled) await fs.mkdir(uploadDir, { recursive: true });

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
    try {
      const entries = (req.headers.cookie || "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
        const index = part.indexOf("=");
        return index < 0
          ? [decodeURIComponent(part), ""]
          : [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      });
      return Object.fromEntries(entries);
    } catch {
      return {};
    }
  }

  function createSignedPayload(payload, purpose) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${encoded}.${signToken(`${purpose}:${encoded}`)}`;
  }

  function verifySignedPayload(token, purpose) {
    if (typeof token !== "string") return null;
    const separator = token.lastIndexOf(".");
    if (separator < 1) return null;
    const encoded = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    if (!safeEqual(signature, signToken(`${purpose}:${encoded}`))) return null;
    try {
      return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      return null;
    }
  }

  function getSession(req) {
    const payload = verifySignedPayload(parseCookies(req)[cookieName], "session");
    if (!payload || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) return null;
    return payload;
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
    const signed = createSignedPayload({
      expiresAt: Date.now() + sessionTtl,
      nonce: crypto.randomBytes(16).toString("hex")
    }, "session");
    const parts = [
      `${cookieName}=${encodeURIComponent(signed)}`,
      "HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${Math.floor(sessionTtl / 1000)}`
    ];
    if (isProduction) parts.push("Secure");
    res.setHeader("set-cookie", parts.join("; "));
    sendJson(res, 200, { success: true });
  }

  function logout(req, res) {
    res.setHeader("set-cookie", `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${isProduction ? "; Secure" : ""}`);
    sendJson(res, 200, { success: true });
  }

  function createUploadToken({ filename, maxSize, contentType }) {
    return createSignedPayload({ filename, maxSize, contentType, expiresAt: Date.now() + uploadTtl }, "upload");
  }

  function verifyUploadToken(token) {
    const payload = verifySignedPayload(token, "upload");
    if (!payload || !payload.filename || !Number.isFinite(payload.maxSize) || payload.expiresAt <= Date.now()) return null;
    return payload;
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

  async function objectExists(objectPath) {
    const filename = objectFilename(objectPath);
    if (!filename) return false;
    if (blobEnabled) {
      try {
        await head(`objects/${filename}`);
        return true;
      } catch {
        return false;
      }
    }
    try {
      await fs.access(path.join(uploadDir, filename));
      return true;
    } catch {
      return false;
    }
  }

  async function writeObject(filename, body, contentType) {
    if (blobEnabled) {
      await put(`objects/${filename}`, body, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: contentType || "application/octet-stream",
        cacheControlMaxAge: 31536000
      });
      return;
    }
    await fs.writeFile(path.join(uploadDir, filename), body);
  }

  async function removeObjectIfUnused(objectPath, excludingPhotoId = null) {
    const state = store.readStore();
    const used = state.photos.some((photo) => photo.id !== excludingPhotoId && photo.objectPath === objectPath)
      || state.siteSettings.bioPhotoPath === objectPath;
    if (used) return;
    const filename = objectFilename(objectPath);
    if (!filename) return;
    if (blobEnabled) {
      try { await del(`objects/${filename}`); } catch {}
      return;
    }
    await fs.rm(path.join(uploadDir, filename), { force: true });
  }

  async function serveObject(res, filename) {
    if (blobEnabled) {
      const result = await get(`objects/${filename}`, { access: "private" });
      if (!result || result.statusCode !== 200 || !result.stream) {
        const error = new Error("Object not found");
        error.code = "ENOENT";
        throw error;
      }
      res.writeHead(200, {
        "content-type": result.blob?.contentType || "application/octet-stream",
        "cache-control": "public, max-age=86400",
        ...(result.blob?.etag ? { etag: result.blob.etag } : {})
      });
      Readable.fromWeb(result.stream).pipe(res);
      return;
    }
    await serveFile(res, path.join(uploadDir, filename), "public, max-age=31536000, immutable");
  }

  async function serveFile(res, filePath, cacheControl = "public, max-age=300") {
    const data = await fs.readFile(filePath);
    const type = contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "content-type": type, "content-length": data.length, "cache-control": cacheControl });
    res.end(data);
  }

  return {
    crypto, fs, path, store, uploadDir, maxUploadBytes, uploadTtl, blobEnabled,
    sendJson, cleanText, parsePositiveId, getSession, requireAdmin, login, logout,
    createUploadToken, verifyUploadToken, readBody, readJson, hydrateItem, objectFilename,
    objectExists, writeObject, removeObjectIfUnused, serveObject, serveFile
  };
}
