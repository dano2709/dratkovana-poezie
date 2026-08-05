// ─────────────────────────────────────────────────────────────────────────────
// Administration
// ─────────────────────────────────────────────────────────────────────────────

const adminState = {
  authenticated: false,
  tab: "gallery",
  items: [],
  categories: [],
  settings: {},
  messages: [],
  editingId: null
};

function renderLogin() {
  app.innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <h1>Administrace</h1>
        <p class="subtitle">Drátkovaná poezie</p>
        <form id="login-form" class="form-grid">
          <div class="field">
            <label for="login-username">Uživatelské jméno</label>
            <input id="login-username" name="username" autocomplete="username" placeholder="Admin" required>
          </div>
          <div class="field">
            <label for="login-password">Heslo</label>
            <input id="login-password" name="password" type="password" autocomplete="current-password" required>
          </div>
          <p id="login-error" class="form-error" hidden></p>
          <button class="btn btn-primary" type="submit">Přihlásit se</button>
        </form>
        <a class="login-back" href="/">← Zpět na stránku</a>
      </div>
    </div>
  `;
  document.getElementById("login-form").addEventListener("submit", login);
}

async function login(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  const errorElement = document.getElementById("login-error");
  const data = new FormData(form);
  errorElement.hidden = true;
  setLoading(button, true, "Přihlašuji…");
  try {
    await api("/api/auth/login", jsonOptions("POST", {
      username: data.get("username"),
      password: data.get("password")
    }));
    adminState.authenticated = true;
    await loadAdminData();
    renderAdmin();
  } catch {
    errorElement.textContent = "Nesprávné přihlašovací údaje.";
    errorElement.hidden = false;
  } finally {
    setLoading(button, false);
  }
}

async function logout() {
  await api("/api/auth/logout", { method: "POST" });
  adminState.authenticated = false;
  renderLogin();
}

async function loadAdminData() {
  const [items, categories, settings, messages] = await Promise.all([
    api("/api/gallery-items/all"),
    api("/api/categories"),
    api("/api/site-settings"),
    api("/api/contact-messages")
  ]);
  adminState.items = items;
  adminState.categories = categories;
  adminState.settings = settings;
  adminState.messages = messages;
}

function renderAdmin() {
  app.innerHTML = `
    <div class="admin-shell">
      <header class="admin-header">
        <h1>Drátkovaná poezie – Admin</h1>
        <div class="admin-header-actions">
          <a href="/" class="btn btn-outline btn-small">Zpět na stránku</a>
          <button id="logout-button" class="btn btn-ghost btn-small">Odhlásit</button>
        </div>
      </header>
      <nav class="admin-tabs" aria-label="Administrace">
        <button class="admin-tab${adminState.tab === "gallery" ? " active" : ""}" data-tab="gallery">Galerie</button>
        <button class="admin-tab${adminState.tab === "categories" ? " active" : ""}" data-tab="categories">Kategorie</button>
        <button class="admin-tab${adminState.tab === "messages" ? " active" : ""}" data-tab="messages">Zprávy${adminState.messages.length ? ` (${adminState.messages.length})` : ""}</button>
        <button class="admin-tab${adminState.tab === "settings" ? " active" : ""}" data-tab="settings">Nastavení</button>
      </nav>
      <main id="admin-content" class="admin-main"></main>
    </div>
    <div id="admin-modal-root"></div>
  `;
  document.getElementById("logout-button").addEventListener("click", logout);
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      adminState.tab = button.dataset.tab;
      renderAdmin();
    });
  });
  renderAdminTab();
}

function renderAdminTab() {
  if (adminState.tab === "categories") return renderCategoriesTab();
  if (adminState.tab === "messages") return renderMessagesTab();
  if (adminState.tab === "settings") return renderSettingsTab();
  renderGalleryTab();
}

function renderGalleryTab() {
  const root = document.getElementById("admin-content");
  root.innerHTML = `
    <div class="admin-title-row">
      <h2>Kousky v galerii</h2>
      <button id="create-item" class="btn btn-primary">+ Přidat nový kousek</button>
    </div>
    <div class="panel">
      ${adminState.items.length ? adminState.items.map((item) => `
        <div class="admin-list-item">
          <div class="admin-list-main">
            <h3>${escapeHtml(item.nazev)}
              <span class="badge ${item.published ? "badge-success" : "badge-draft"}">${item.published ? "Publikováno" : "Koncept"}</span>
            </h3>
            <p>${escapeHtml(item.popisek || "Bez popisku")} · ${item.photos?.length || 0} fotografií${item.category ? ` · ${escapeHtml(item.category.name)}` : ""}</p>
          </div>
          <div class="admin-actions">
            <button class="btn btn-outline btn-small" data-publish-id="${item.id}" data-published="${item.published}">${item.published ? "Skrýt" : "Publikovat"}</button>
            <button class="btn btn-outline btn-small" data-edit-id="${item.id}">Upravit</button>
            <button class="btn btn-danger btn-small" data-delete-id="${item.id}">Smazat</button>
          </div>
        </div>
      `).join("") : '<div class="empty">Žádné kousky.</div>'}
    </div>
  `;
  document.getElementById("create-item").addEventListener("click", () => openItemModal(null));
  root.querySelectorAll("[data-edit-id]").forEach((button) => button.addEventListener("click", () => {
    openItemModal(adminState.items.find((item) => item.id === Number(button.dataset.editId)));
  }));
  root.querySelectorAll("[data-delete-id]").forEach((button) => button.addEventListener("click", () => deleteItem(Number(button.dataset.deleteId))));
  root.querySelectorAll("[data-publish-id]").forEach((button) => button.addEventListener("click", () => togglePublish(
    Number(button.dataset.publishId),
    button.dataset.published !== "true"
  )));
}

async function togglePublish(id, published) {
  try {
    await api(`/api/gallery-items/${id}/publish`, jsonOptions("PATCH", { published }));
    await loadAdminData();
    renderAdmin();
  } catch {
    showToast("Stav publikace se nepodařilo změnit.", true);
  }
}

async function deleteItem(id) {
  if (!confirm("Opravdu smazat tento kousek včetně fotografií?")) return;
  try {
    await api(`/api/gallery-items/${id}`, { method: "DELETE" });
    await loadAdminData();
    renderAdmin();
    showToast("Kousek byl smazán.");
  } catch {
    showToast("Kousek se nepodařilo smazat.", true);
  }
}

function openItemModal(item) {
  adminState.editingId = item?.id || null;
  const root = document.getElementById("admin-modal-root");
  document.body.classList.add("modal-open");
  const photos = [...(item?.photos || [])].sort((a, b) => a.sortOrder - b.sortOrder);
  root.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-card">
        <div class="modal-header">
          <h2>${item ? "Upravit kousek" : "Nový kousek"}</h2>
          <button id="close-item-modal" class="btn btn-ghost btn-icon" aria-label="Zavřít">×</button>
        </div>
        <form id="item-form" class="modal-body">
          <div class="field">
            <label for="item-name">Název</label>
            <input id="item-name" name="nazev" value="${escapeHtml(item?.nazev || "")}" required>
          </div>
          <div class="field">
            <label for="item-description">Popisek</label>
            <textarea id="item-description" name="popisek">${escapeHtml(item?.popisek || "")}</textarea>
          </div>
          <div class="field">
            <label for="item-category">Kategorie</label>
            <select id="item-category" name="categoryId">
              <option value="">Bez kategorie</option>
              ${adminState.categories.map((category) => `<option value="${category.id}"${item?.categoryId === category.id ? " selected" : ""}>${escapeHtml(category.name)}</option>`).join("")}
            </select>
          </div>
          <label class="checkbox-row">
            <input name="published" type="checkbox"${item?.published ? " checked" : ""}>
            Veřejně viditelné v galerii
          </label>
          <p id="item-form-error" class="form-error" hidden></p>
          <div class="modal-footer">
            <button type="button" id="cancel-item" class="btn btn-outline">Zrušit</button>
            <button type="submit" class="btn btn-primary">Uložit údaje</button>
          </div>
          ${item ? `
            <hr style="border:0;border-top:1px solid var(--line);width:100%">
            <div class="admin-title-row" style="margin:0">
              <h2 style="font-size:1.25rem">Fotografie</h2>
              <label class="btn btn-outline btn-small" for="item-photo-input">+ Přidat fotky</label>
              <input id="item-photo-input" type="file" accept="image/*" multiple hidden>
            </div>
            <div class="photo-admin-grid">
              ${photos.length ? photos.map((photo, index) => `
                <div class="photo-admin">
                  <img src="${imageUrl(photo.objectPath)}" alt="">
                  <div class="photo-overlay">
                    <button type="button" data-photo-up="${photo.id}"${index === 0 ? " disabled" : ""}>↑</button>
                    <button type="button" data-photo-down="${photo.id}"${index === photos.length - 1 ? " disabled" : ""}>↓</button>
                    <button type="button" data-photo-delete="${photo.id}">×</button>
                  </div>
                </div>
              `).join("") : '<div class="photo-empty">Zatím žádné fotografie</div>'}
            </div>` : '<p style="color:var(--muted);margin:0">Fotografie lze přidat po prvním uložení kousku.</p>'}
        </form>
      </div>
    </div>
  `;
  document.getElementById("close-item-modal").addEventListener("click", closeAdminModal);
  document.getElementById("cancel-item").addEventListener("click", closeAdminModal);
  document.getElementById("item-form").addEventListener("submit", saveItem);
  root.querySelector(".modal").addEventListener("click", (event) => {
    if (event.target.classList.contains("modal")) closeAdminModal();
  });
  if (item) {
    document.getElementById("item-photo-input").addEventListener("change", (event) => uploadItemPhotos(item.id, event.target.files));
    root.querySelectorAll("[data-photo-delete]").forEach((button) => button.addEventListener("click", () => deletePhoto(item.id, Number(button.dataset.photoDelete))));
    root.querySelectorAll("[data-photo-up]").forEach((button) => button.addEventListener("click", () => movePhoto(item.id, Number(button.dataset.photoUp), -1)));
    root.querySelectorAll("[data-photo-down]").forEach((button) => button.addEventListener("click", () => movePhoto(item.id, Number(button.dataset.photoDown), 1)));
  }
}
