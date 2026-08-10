function closeAdminModal() {
  document.getElementById("admin-modal-root").innerHTML = "";
  document.body.classList.remove("modal-open");
  adminState.editingId = null;
}

async function saveItem(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const errorElement = document.getElementById("item-form-error");
  const data = new FormData(form);
  const body = {
    nazev: String(data.get("nazev") || "").trim(),
    popisek: String(data.get("popisek") || "").trim(),
    categoryId: data.get("categoryId") ? Number(data.get("categoryId")) : null,
    published: data.get("published") === "on"
  };
  if (!body.nazev) {
    errorElement.textContent = "Název je povinný.";
    errorElement.hidden = false;
    return;
  }
  setLoading(button, true, "Ukládám…");
  try {
    if (adminState.editingId) {
      await api(`/api/gallery-items/${adminState.editingId}`, jsonOptions("PATCH", body));
    } else {
      await api("/api/gallery-items", jsonOptions("POST", body));
    }
    await loadAdminData();
    closeAdminModal();
    renderAdmin();
    showToast("Údaje byly uloženy.");
  } catch (error) {
    errorElement.textContent = error.message || "Uložení se nepodařilo.";
    errorElement.hidden = false;
  } finally {
    setLoading(button, false);
  }
}

async function loadImageForCompression(file) {
  if ("createImageBitmap" in window) return await createImageBitmap(file);
  return await new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Obrázek se nepodařilo načíst.")); };
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Obrázek se nepodařilo zmenšit.")), type, quality);
  });
}

async function prepareImageForUpload(file) {
  const targetBytes = Math.floor(3.6 * 1024 * 1024);
  if (file.size <= targetBytes) return file;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Tento obrázek je příliš velký. Použijte JPG, PNG nebo WebP do 4 MB.");
  }

  const image = await loadImageForCompression(file);
  let maxSide = 2400;
  let quality = 0.86;
  let result = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d", { alpha: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    result = await canvasToBlob(canvas, "image/webp", quality);
    if (result.size <= targetBytes) break;
    maxSide = Math.round(maxSide * 0.82);
    quality = Math.max(0.58, quality - 0.08);
  }

  if (typeof image.close === "function") image.close();
  if (!result || result.size > targetBytes) throw new Error("Fotografii se nepodařilo zmenšit pod 4 MB.");
  const baseName = file.name.replace(/\.[^.]+$/, "") || "fotografie";
  return new File([result], `${baseName}.webp`, { type: "image/webp", lastModified: Date.now() });
}

async function uploadFile(originalFile) {
  const file = await prepareImageForUpload(originalFile);
  const upload = await api("/api/storage/uploads/request-url", jsonOptions("POST", {
    name: file.name,
    size: file.size,
    contentType: file.type || "image/jpeg"
  }));
  await api(upload.uploadURL, {
    method: "PUT",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file
  });
  return upload.objectPath;
}

async function uploadItemPhotos(itemId, files) {
  if (!files?.length) return;
  showToast("Nahrávám fotografie…");
  try {
    const current = adminState.items.find((item) => item.id === itemId);
    let sortOrder = current?.photos?.length || 0;
    for (const file of files) {
      const objectPath = await uploadFile(file);
      await api(`/api/gallery-items/${itemId}/photos`, jsonOptions("POST", { objectPath, sortOrder }));
      sortOrder += 1;
    }
    await loadAdminData();
    openItemModal(adminState.items.find((item) => item.id === itemId));
    showToast("Fotografie byly nahrány.");
  } catch (error) {
    showToast(error.message || "Fotografie se nepodařilo nahrát.", true);
  }
}

async function deletePhoto(itemId, photoId) {
  if (!confirm("Opravdu smazat tuto fotografii?")) return;
  try {
    await api(`/api/gallery-items/${itemId}/photos/${photoId}`, { method: "DELETE" });
    await loadAdminData();
    openItemModal(adminState.items.find((item) => item.id === itemId));
    showToast("Fotografie byla smazána.");
  } catch {
    showToast("Fotografii se nepodařilo smazat.", true);
  }
}

async function movePhoto(itemId, photoId, direction) {
  const item = adminState.items.find((entry) => entry.id === itemId);
  const photos = [...(item?.photos || [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const index = photos.findIndex((photo) => photo.id === photoId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= photos.length) return;
  [photos[index], photos[targetIndex]] = [photos[targetIndex], photos[index]];
  try {
    await api(`/api/gallery-items/${itemId}/photos/reorder`, jsonOptions("PATCH", { photoIds: photos.map((photo) => photo.id) }));
    await loadAdminData();
    openItemModal(adminState.items.find((entry) => entry.id === itemId));
  } catch {
    showToast("Pořadí fotografií se nepodařilo změnit.", true);
  }
}

function renderCategoriesTab() {
  const root = document.getElementById("admin-content");
  root.innerHTML = `
    <div class="admin-title-row"><h2>Kategorie</h2></div>
    <form id="category-form" class="inline-form">
      <div class="field" style="flex:1"><input name="name" placeholder="Název nové kategorie" required></div>
      <button class="btn btn-primary" type="submit">Přidat kategorii</button>
    </form>
    <div class="panel">
      ${adminState.categories.length ? adminState.categories.map((category) => `
        <div class="admin-list-item">
          <div class="admin-list-main"><h3>${escapeHtml(category.name)}</h3></div>
          <button class="btn btn-danger btn-small" data-delete-category="${category.id}">Smazat</button>
        </div>
      `).join("") : '<div class="empty">Žádné kategorie.</div>'}
    </div>
  `;
  document.getElementById("category-form").addEventListener("submit", createCategory);
  root.querySelectorAll("[data-delete-category]").forEach((button) => button.addEventListener("click", () => deleteCategory(Number(button.dataset.deleteCategory))));
}

async function createCategory(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  const name = String(new FormData(form).get("name") || "").trim();
  if (!name) return;
  setLoading(button, true, "Přidávám…");
  try {
    await api("/api/categories", jsonOptions("POST", { name }));
    await loadAdminData();
    renderAdmin();
    showToast("Kategorie byla vytvořena.");
  } catch (error) {
    showToast(error.message || "Kategorie se nepodařila vytvořit.", true);
  } finally {
    setLoading(button, false);
  }
}

async function deleteCategory(id) {
  if (!confirm("Smazat tuto kategorii? Kousky zůstanou bez kategorie.")) return;
  try {
    await api(`/api/categories/${id}`, { method: "DELETE" });
    await loadAdminData();
    renderAdmin();
    showToast("Kategorie byla smazána.");
  } catch {
    showToast("Kategorie se nepodařila smazat.", true);
  }
}

function renderMessagesTab() {
  const root = document.getElementById("admin-content");
  root.innerHTML = `
    <div class="admin-title-row"><h2>Kontaktní zprávy</h2></div>
    <div class="panel">
      ${adminState.messages.length ? adminState.messages.map((message) => `
        <article class="admin-message">
          <div class="admin-message-head">
            <div>
              <h3>${escapeHtml(message.jmeno)}</h3>
              <a href="mailto:${escapeHtml(message.email)}">${escapeHtml(message.email)}</a>
            </div>
            <div class="admin-actions">
              <time>${new Date(message.createdAt).toLocaleString("cs-CZ")}</time>
              <button class="btn btn-danger btn-small" data-delete-message="${message.id}">Smazat</button>
            </div>
          </div>
          <p>${escapeHtml(message.zprava)}</p>
        </article>
      `).join("") : '<div class="empty">Zatím nebyly odeslány žádné zprávy.</div>'}
    </div>
  `;
  root.querySelectorAll("[data-delete-message]").forEach((button) => {
    button.addEventListener("click", () => deleteMessage(Number(button.dataset.deleteMessage)));
  });
}

async function deleteMessage(id) {
  if (!confirm("Opravdu smazat tuto zprávu?")) return;
  try {
    await api(`/api/contact-messages/${id}`, { method: "DELETE" });
    await loadAdminData();
    renderAdmin();
    showToast("Zpráva byla smazána.");
  } catch {
    showToast("Zprávu se nepodařilo smazat.", true);
  }
}

function renderSettingsTab() {
  const root = document.getElementById("admin-content");
  const settings = adminState.settings || {};
  root.innerHTML = `
    <div class="admin-title-row"><h2>Nastavení webu</h2></div>
    <form id="settings-form" class="panel settings-panel">
      <div class="field">
        <label for="bio-title">Nadpis sekce o autorce</label>
        <input id="bio-title" name="bioTitle" value="${escapeHtml(settings.bioTitle || "")}">
      </div>
      <div class="field">
        <label for="bio-text">Text o autorce</label>
        <textarea id="bio-text" name="bioText">${escapeHtml(settings.bioText || "")}</textarea>
      </div>
      <div class="field">
        <label>Profilová fotografie</label>
        ${settings.bioPhotoPath ? `<img class="bio-preview" src="${imageUrl(settings.bioPhotoPath)}" alt="Profilová fotografie">` : ""}
        <input id="bio-path" name="bioPhotoPath" type="hidden" value="${escapeHtml(settings.bioPhotoPath || "")}">
        <div><label class="btn btn-outline btn-small" for="bio-photo-input">Nahrát fotografii</label></div>
        <input id="bio-photo-input" type="file" accept="image/*" hidden>
      </div>
      <div><button class="btn btn-primary" type="submit">Uložit nastavení</button></div>
    </form>
  `;
  document.getElementById("settings-form").addEventListener("submit", saveSettings);
  document.getElementById("bio-photo-input").addEventListener("change", uploadBioPhoto);
}

async function uploadBioPhoto(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  showToast("Nahrávám fotografii…");
  try {
    const objectPath = await uploadFile(file);
    document.getElementById("bio-path").value = objectPath;
    const currentPreview = document.querySelector(".bio-preview");
    if (currentPreview) currentPreview.src = imageUrl(objectPath);
    else {
      const image = document.createElement("img");
      image.className = "bio-preview";
      image.src = imageUrl(objectPath);
      image.alt = "Profilová fotografie";
      document.getElementById("bio-path").before(image);
    }
    showToast("Fotografie byla nahrána. Uložte nastavení.");
  } catch (error) {
    showToast(error.message || "Fotografii se nepodařilo nahrát.", true);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const data = new FormData(form);
  setLoading(button, true, "Ukládám…");
  try {
    await api("/api/site-settings", jsonOptions("PUT", {
      bioTitle: String(data.get("bioTitle") || "").trim(),
      bioText: String(data.get("bioText") || "").trim(),
      bioPhotoPath: String(data.get("bioPhotoPath") || "").trim()
    }));
    await loadAdminData();
    renderAdmin();
    showToast("Nastavení bylo uloženo.");
  } catch {
    showToast("Nastavení se nepodařilo uložit.", true);
  } finally {
    setLoading(button, false);
  }
}

async function initAdmin() {
  app.innerHTML = '<div class="loader">Načítám administraci…</div>';
  try {
    const auth = await api("/api/auth/user");
    adminState.authenticated = Boolean(auth.user);
    if (!adminState.authenticated) {
      renderLogin();
      return;
    }
    await loadAdminData();
    renderAdmin();
  } catch {
    renderLogin();
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.getElementById("admin-modal-root")?.innerHTML) {
      closeAdminModal();
    }
  });
}
