export async function handleGalleryApi(ctx, req, res, pathname, method) {
  const { sendJson, cleanText, parsePositiveId, readJson, requireAdmin, getSession,
    store, hydrateItem, objectFilename, uploadDir, fs, path, removeObjectIfUnused } = ctx;

  if (method === "GET" && pathname === "/api/categories") {
    const state = store.readStore();
    sendJson(res, 200, [...state.categories].sort((a, b) => a.name.localeCompare(b.name, "cs"))); return true;
  }
  if (method === "POST" && pathname === "/api/categories") {
    if (!requireAdmin(req, res)) return true;
    const name = cleanText((await readJson(req)).name, 120);
    if (!name) { sendJson(res, 400, { error: "Invalid input" }); return true; }
    const created = await store.updateStore((draft) => {
      if (draft.categories.some((category) => category.name.toLocaleLowerCase("cs") === name.toLocaleLowerCase("cs"))) return null;
      const category = { id: store.nextId(draft, "category"), name, createdAt: new Date().toISOString() };
      draft.categories.push(category); return category;
    });
    sendJson(res, created ? 201 : 409, created || { error: "Kategorie již existuje" }); return true;
  }
  const categoryMatch = pathname.match(/^\/api\/categories\/(\d+)$/);
  if (categoryMatch && method === "DELETE") {
    if (!requireAdmin(req, res)) return true;
    const id = parsePositiveId(categoryMatch[1]);
    const deleted = await store.updateStore((draft) => {
      const before = draft.categories.length;
      draft.categories = draft.categories.filter((category) => category.id !== id);
      draft.galleryItems = draft.galleryItems.map((item) => item.categoryId === id ? { ...item, categoryId: null } : item);
      return before !== draft.categories.length;
    });
    sendJson(res, deleted ? 200 : 404, deleted ? { success: true } : { error: "Not found" }); return true;
  }

  if (method === "GET" && pathname === "/api/gallery-items") {
    const state = store.readStore();
    sendJson(res, 200, state.galleryItems.filter((item) => item.published)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((item) => hydrateItem(state, item)));
    return true;
  }
  if (method === "GET" && pathname === "/api/gallery-items/all") {
    if (!requireAdmin(req, res)) return true;
    const state = store.readStore();
    sendJson(res, 200, [...state.galleryItems].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((item) => hydrateItem(state, item)));
    return true;
  }
  if (method === "POST" && pathname === "/api/gallery-items") {
    if (!requireAdmin(req, res)) return true;
    const body = await readJson(req);
    const nazev = cleanText(body.nazev, 240);
    const categoryId = body.categoryId == null ? null : parsePositiveId(body.categoryId);
    if (!nazev || (body.categoryId != null && !categoryId)) { sendJson(res, 400, { error: "Invalid input" }); return true; }
    const created = await store.updateStore((draft) => {
      if (categoryId && !draft.categories.some((category) => category.id === categoryId)) return null;
      const item = {
        id: store.nextId(draft, "galleryItem"), nazev, popisek: cleanText(body.popisek, 5000),
        published: Boolean(body.published), categoryId, createdAt: new Date().toISOString()
      };
      draft.galleryItems.push(item); return hydrateItem(draft, item);
    });
    sendJson(res, created ? 201 : 400, created || { error: "Unknown category" }); return true;
  }

  const itemMatch = pathname.match(/^\/api\/gallery-items\/(\d+)$/);
  if (itemMatch && method === "GET") {
    const id = parsePositiveId(itemMatch[1]);
    const state = store.readStore();
    const item = state.galleryItems.find((entry) => entry.id === id);
    if (!item || (!item.published && !getSession(req))) sendJson(res, 404, { error: "Not found" });
    else sendJson(res, 200, hydrateItem(state, item));
    return true;
  }
  if (itemMatch && method === "PATCH") {
    if (!requireAdmin(req, res)) return true;
    const id = parsePositiveId(itemMatch[1]);
    const body = await readJson(req);
    const updated = await store.updateStore((draft) => {
      const item = draft.galleryItems.find((entry) => entry.id === id);
      if (!item) return null;
      if (body.nazev !== undefined) { const name = cleanText(body.nazev, 240); if (!name) return false; item.nazev = name; }
      if (body.popisek !== undefined) item.popisek = cleanText(body.popisek, 5000);
      if (body.published !== undefined) item.published = Boolean(body.published);
      if (Object.hasOwn(body, "categoryId")) {
        const categoryId = body.categoryId == null ? null : parsePositiveId(body.categoryId);
        if (categoryId && !draft.categories.some((category) => category.id === categoryId)) return false;
        item.categoryId = categoryId;
      }
      return hydrateItem(draft, item);
    });
    if (updated === false) sendJson(res, 400, { error: "Invalid input" });
    else sendJson(res, updated ? 200 : 404, updated || { error: "Not found" });
    return true;
  }
  if (itemMatch && method === "DELETE") {
    if (!requireAdmin(req, res)) return true;
    const id = parsePositiveId(itemMatch[1]);
    const paths = await store.updateStore((draft) => {
      if (!draft.galleryItems.some((item) => item.id === id)) return null;
      const found = draft.photos.filter((photo) => photo.itemId === id).map((photo) => photo.objectPath);
      draft.galleryItems = draft.galleryItems.filter((item) => item.id !== id);
      draft.photos = draft.photos.filter((photo) => photo.itemId !== id); return found;
    });
    if (!paths) sendJson(res, 404, { error: "Not found" });
    else { await Promise.all(paths.map((objectPath) => removeObjectIfUnused(objectPath))); sendJson(res, 200, { success: true }); }
    return true;
  }

  const publishMatch = pathname.match(/^\/api\/gallery-items\/(\d+)\/publish$/);
  if (publishMatch && method === "PATCH") {
    if (!requireAdmin(req, res)) return true;
    const id = parsePositiveId(publishMatch[1]);
    const body = await readJson(req);
    if (typeof body.published !== "boolean") { sendJson(res, 400, { error: "Invalid input" }); return true; }
    const updated = await store.updateStore((draft) => {
      const item = draft.galleryItems.find((entry) => entry.id === id);
      if (!item) return null; item.published = body.published; return hydrateItem(draft, item);
    });
    sendJson(res, updated ? 200 : 404, updated || { error: "Not found" }); return true;
  }

  const photosMatch = pathname.match(/^\/api\/gallery-items\/(\d+)\/photos$/);
  if (photosMatch && method === "POST") {
    if (!requireAdmin(req, res)) return true;
    const itemId = parsePositiveId(photosMatch[1]);
    const body = await readJson(req);
    const objectPath = cleanText(body.objectPath, 500);
    const filename = objectFilename(objectPath);
    if (!itemId || !filename) { sendJson(res, 400, { error: "Invalid input" }); return true; }
    try { await fs.access(path.join(uploadDir, filename)); }
    catch { sendJson(res, 400, { error: "Uploaded object does not exist" }); return true; }
    const created = await store.updateStore((draft) => {
      if (!draft.galleryItems.some((item) => item.id === itemId)) return null;
      const photo = {
        id: store.nextId(draft, "photo"), itemId, objectPath,
        altText: cleanText(body.altText, 500) || null,
        sortOrder: Number.isInteger(body.sortOrder) ? body.sortOrder : draft.photos.filter((entry) => entry.itemId === itemId).length,
        createdAt: new Date().toISOString()
      };
      draft.photos.push(photo); return photo;
    });
    sendJson(res, created ? 201 : 404, created || { error: "Gallery item not found" }); return true;
  }
  const photoDelete = pathname.match(/^\/api\/gallery-items\/(\d+)\/photos\/(\d+)$/);
  if (photoDelete && method === "DELETE") {
    if (!requireAdmin(req, res)) return true;
    const itemId = parsePositiveId(photoDelete[1]);
    const photoId = parsePositiveId(photoDelete[2]);
    const deleted = await store.updateStore((draft) => {
      const photo = draft.photos.find((entry) => entry.id === photoId && entry.itemId === itemId);
      if (!photo) return null; draft.photos = draft.photos.filter((entry) => entry.id !== photoId); return photo;
    });
    if (!deleted) sendJson(res, 404, { error: "Not found" });
    else { await removeObjectIfUnused(deleted.objectPath, deleted.id); sendJson(res, 200, { success: true }); }
    return true;
  }
  const reorder = pathname.match(/^\/api\/gallery-items\/(\d+)\/photos\/reorder$/);
  if (reorder && method === "PATCH") {
    if (!requireAdmin(req, res)) return true;
    const itemId = parsePositiveId(reorder[1]);
    const body = await readJson(req);
    const ids = Array.isArray(body.photoIds) ? body.photoIds.map(Number) : null;
    if (!itemId || !ids || ids.some((id) => !Number.isInteger(id))) { sendJson(res, 400, { error: "Invalid input" }); return true; }
    const updated = await store.updateStore((draft) => {
      const item = draft.galleryItems.find((entry) => entry.id === itemId);
      if (!item) return null;
      const existing = draft.photos.filter((photo) => photo.itemId === itemId).map((photo) => photo.id);
      if (existing.length !== ids.length || existing.some((id) => !ids.includes(id))) return false;
      ids.forEach((id, index) => { draft.photos.find((photo) => photo.id === id).sortOrder = index; });
      return hydrateItem(draft, item);
    });
    if (updated === false) sendJson(res, 400, { error: "Photo list does not match item" });
    else sendJson(res, updated ? 200 : 404, updated || { error: "Not found" });
    return true;
  }
  return false;
}
