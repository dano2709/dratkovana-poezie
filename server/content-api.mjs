export async function handleContentApi(ctx, req, res, pathname, method) {
  const { sendJson, cleanText, readJson, readBody, requireAdmin, getSession, login, logout,
    store, parsePositiveId, removeObjectIfUnused, maxUploadBytes, objectFilename, path, crypto,
    createUploadToken, verifyUploadToken, writeObject, serveObject } = ctx;

  if (method === "GET" && (pathname === "/api/healthz" || pathname === "/api/health")) {
    sendJson(res, 200, { status: "ok" }); return true;
  }
  if (method === "GET" && pathname === "/api/auth/user") {
    const session = getSession(req);
    sendJson(res, 200, { user: session ? { id: "admin", email: null, firstName: "Admin", lastName: null, profileImageUrl: null } : null });
    return true;
  }
  if (method === "POST" && pathname === "/api/auth/login") {
    const body = await readJson(req);
    login(req, res, cleanText(body.username, 100), typeof body.password === "string" ? body.password : "");
    return true;
  }
  if (method === "POST" && pathname === "/api/auth/logout") { logout(req, res); return true; }

  if (method === "GET" && pathname === "/api/contact-messages") {
    if (!requireAdmin(req, res)) return true;
    const state = store.readStore();
    sendJson(res, 200, [...state.contactMessages].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    return true;
  }
  const messageMatch = pathname.match(/^\/api\/contact-messages\/(\d+)$/);
  if (messageMatch && method === "DELETE") {
    if (!requireAdmin(req, res)) return true;
    const id = parsePositiveId(messageMatch[1]);
    const deleted = await store.updateStore((draft) => {
      const before = draft.contactMessages.length;
      draft.contactMessages = draft.contactMessages.filter((message) => message.id !== id);
      return before !== draft.contactMessages.length;
    });
    sendJson(res, deleted ? 200 : 404, deleted ? { success: true } : { error: "Not found" });
    return true;
  }
  if (method === "POST" && pathname === "/api/contact") {
    const body = await readJson(req);
    const jmeno = cleanText(body.jmeno, 200);
    const email = cleanText(body.email, 320);
    const zprava = cleanText(body.zprava, 10000);
    if (!jmeno || !/^\S+@\S+\.\S+$/.test(email) || zprava.length < 10) {
      sendJson(res, 400, { error: "Invalid input" }); return true;
    }
    await store.updateStore((draft) => {
      draft.contactMessages.push({ id: store.nextId(draft, "contactMessage"), jmeno, email, zprava, createdAt: new Date().toISOString() });
    });
    sendJson(res, 200, { success: true }); return true;
  }

  if (method === "GET" && pathname === "/api/site-settings") {
    const settings = store.readStore().siteSettings;
    sendJson(res, 200, {
      bioTitle: settings.bioTitle || null,
      bioText: settings.bioText || null,
      bioPhotoPath: settings.bioPhotoPath || null
    });
    return true;
  }
  if (method === "PUT" && pathname === "/api/site-settings") {
    if (!requireAdmin(req, res)) return true;
    const body = await readJson(req);
    const oldPath = store.readStore().siteSettings.bioPhotoPath;
    const updated = await store.updateStore((draft) => {
      draft.siteSettings = {
        bioTitle: cleanText(body.bioTitle, 240) || null,
        bioText: cleanText(body.bioText, 10000) || null,
        bioPhotoPath: cleanText(body.bioPhotoPath, 500) || null,
        updatedAt: new Date().toISOString()
      };
      return draft.siteSettings;
    });
    if (oldPath && oldPath !== updated.bioPhotoPath) await removeObjectIfUnused(oldPath);
    sendJson(res, 200, updated); return true;
  }

  if (method === "POST" && pathname === "/api/storage/uploads/request-url") {
    if (!requireAdmin(req, res)) return true;
    const body = await readJson(req);
    const name = cleanText(body.name, 255);
    const size = Number(body.size);
    const contentType = cleanText(body.contentType, 120);
    if (!name || !Number.isFinite(size) || size <= 0 || size > maxUploadBytes || !contentType.startsWith("image/")) {
      sendJson(res, 400, { error: `Obrázek je neplatný nebo větší než ${Math.floor(maxUploadBytes / 1024 / 1024)} MB` }); return true;
    }
    const map = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg" };
    const original = path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, "");
    const filename = `${crypto.randomUUID()}${original || map[contentType] || ".img"}`;
    const token = createUploadToken({ filename, maxSize: size, contentType });
    sendJson(res, 200, {
      uploadURL: `/api/storage/uploads/${encodeURIComponent(token)}`,
      objectPath: `/objects/${filename}`,
      metadata: { name, size, contentType }
    });
    return true;
  }

  const uploadMatch = pathname.match(/^\/api\/storage\/uploads\/([A-Za-z0-9._~-]+)$/);
  if (uploadMatch && method === "PUT") {
    if (!requireAdmin(req, res)) return true;
    const pending = verifyUploadToken(decodeURIComponent(uploadMatch[1]));
    if (!pending) { sendJson(res, 404, { error: "Upload URL expired or does not exist" }); return true; }
    const body = await readBody(req, maxUploadBytes);
    if (!body.length) { sendJson(res, 400, { error: "Empty upload" }); return true; }
    if (body.length > pending.maxSize) { sendJson(res, 413, { error: "Uploaded file is larger than declared" }); return true; }
    await writeObject(pending.filename, body, pending.contentType || req.headers["content-type"]);
    sendJson(res, 200, { success: true, objectPath: `/objects/${pending.filename}` }); return true;
  }

  const objectMatch = pathname.match(/^\/api\/storage\/(?:objects|public-objects)\/(.+)$/);
  if (objectMatch && method === "GET") {
    const filename = path.basename(decodeURIComponent(objectMatch[1]));
    if (!filename || !objectFilename(`/objects/${filename}`)) { sendJson(res, 404, { error: "Object not found" }); return true; }
    try { await serveObject(res, filename); }
    catch { sendJson(res, 404, { error: "Object not found" }); }
    return true;
  }
  return false;
}
