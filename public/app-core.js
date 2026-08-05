const app = document.getElementById("app");
const toastElement = document.getElementById("toast");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function imageUrl(objectPath) {
  const filename = String(objectPath || "").split("/").filter(Boolean).pop();
  return filename ? `/api/storage/objects/${encodeURIComponent(filename)}` : "";
}

function ornament() {
  return '<div class="ornament" aria-hidden="true"><span></span></div>';
}

let toastTimer;
function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  toastElement.textContent = message;
  toastElement.className = `toast show${isError ? " error" : ""}`;
  toastTimer = setTimeout(() => {
    toastElement.className = "toast";
  }, 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(data?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  };
}

function setLoading(button, loading, label = "Pracuji...") {
  if (!button) return;
  if (loading) {
    button.dataset.originalText = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public website
// ─────────────────────────────────────────────────────────────────────────────

const publicState = {
  items: [],
  categories: [],
  settings: {},
  selectedCategoryId: null,
  lightboxPhotos: [],
  lightboxIndex: 0
};

function publicLayout() {
  app.innerHTML = `
    <main>
      <section class="hero">
        <div class="hero-content">
          <svg class="hero-flourish" viewBox="0 0 76 34" fill="none" aria-hidden="true">
            <path d="M1 29 Q18 4 38 17 Q57 31 75 4" stroke="currentColor" stroke-width="1"/>
            <path d="M9 33 Q27 12 46 22 Q63 31 75 10" stroke="currentColor" stroke-width=".55" opacity=".55"/>
          </svg>
          <h1>Drátkovaná<br>poezie</h1>
          ${ornament()}
          <p class="hero-tagline">Jemná autorská tvorba z drátu,<br>detailu a osobitého příběhu.</p>
          <div class="hero-actions">
            <a class="btn btn-primary serif" href="#galerie">Prohlédnout galerii</a>
            <a class="btn btn-outline serif" href="#kontakt">Kontaktovat mě</a>
          </div>
        </div>
      </section>

      <section id="o-tvorbe" class="section section-alt">
        <div class="container">
          <h2 class="section-heading">O tvorbě</h2>
          ${ornament()}
          <p class="section-copy">Drátkovaná poezie je prostor pro jemnou ruční tvorbu, ve které se drát mění v detail, ozdobu a drobný příběh. Každý kousek vzniká s důrazem na tvar, strukturu, lehkost a osobitý charakter.</p>
        </div>
      </section>

      <div id="bio-section"></div>

      <section id="galerie" class="section section-alt">
        <div class="container">
          <h2 class="section-heading">Galerie</h2>
          ${ornament()}
          <div id="gallery-filters" class="filters"></div>
          <div id="gallery-content" class="loader">Načítám galerii…</div>
        </div>
      </section>

      <section id="kontakt" class="section">
        <div class="container">
          <h2 class="section-heading">Kontakt</h2>
          ${ornament()}
          <p class="section-copy">Zaujal Vás některý kousek nebo máte zájem o tvorbu na míru?<br>Napište mi — ráda se Vám ozvu.</p>
          <div class="contact-wrap">
            <form id="contact-form" class="form-grid" novalidate>
              <div class="field">
                <label for="contact-name">Jméno</label>
                <input id="contact-name" name="jmeno" autocomplete="name" required>
              </div>
              <div class="field">
                <label for="contact-email">E-mail</label>
                <input id="contact-email" name="email" type="email" autocomplete="email" required>
              </div>
              <div class="field">
                <label for="contact-message">Zpráva</label>
                <textarea id="contact-message" name="zprava" minlength="10" required></textarea>
              </div>
              <p id="contact-error" class="form-error" hidden></p>
              <button class="btn btn-primary serif" type="submit">Odeslat zprávu</button>
            </form>
          </div>
          <div class="instagram">
            <a href="https://www.instagram.com/dratkovana_poezie/" target="_blank" rel="noopener noreferrer">Sledujte tvorbu na Instagramu</a>
          </div>
        </div>
      </section>
    </main>
    <footer class="footer">
      <h4>Drátkovaná poezie</h4>
      <p>Autorská tvorba z drátu, detailu a jemné poezie</p>
      <a class="admin-link" href="/admin">Admin</a>
    </footer>
    <div id="lightbox-root"></div>
  `;

  document.getElementById("contact-form").addEventListener("submit", submitContactForm);
}

function renderBio() {
  const root = document.getElementById("bio-section");
  const settings = publicState.settings || {};
  const hasBio = settings.bioTitle || settings.bioText || settings.bioPhotoPath;
  if (!hasBio) {
    root.innerHTML = "";
    return;
  }
  const hasPhoto = Boolean(settings.bioPhotoPath);
  root.innerHTML = `
    <section id="o-mne" class="section">
      <div class="container">
        <div class="bio-grid${hasPhoto ? "" : " no-photo"}">
          ${hasPhoto ? `
            <div class="bio-photo-wrap">
              <img class="bio-photo" src="${imageUrl(settings.bioPhotoPath)}" alt="${escapeHtml(settings.bioTitle || "Tvůrce")}">
            </div>` : ""}
          <div class="bio-content">
            <h2>${escapeHtml(settings.bioTitle || "Kdo vlastně jsem?")}</h2>
            ${ornament()}
            ${settings.bioText ? `<p>${escapeHtml(settings.bioText)}</p>` : ""}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderFilters() {
  const root = document.getElementById("gallery-filters");
  if (!publicState.categories.length) {
    root.innerHTML = "";
    return;
  }
  root.innerHTML = `
    <button class="filter-btn${publicState.selectedCategoryId === null ? " active" : ""}" data-category="all">Vše</button>
    ${publicState.categories.map((category) => `
      <button class="filter-btn${publicState.selectedCategoryId === category.id ? " active" : ""}" data-category="${category.id}">${escapeHtml(category.name)}</button>
    `).join("")}
  `;
  root.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      publicState.selectedCategoryId = button.dataset.category === "all" ? null : Number(button.dataset.category);
      renderFilters();
      renderGallery();
    });
  });
}

function renderGallery() {
  const root = document.getElementById("gallery-content");
  const items = publicState.selectedCategoryId === null
    ? publicState.items
    : publicState.items.filter((item) => item.categoryId === publicState.selectedCategoryId);

  if (!items.length) {
    root.className = "empty";
    root.textContent = publicState.selectedCategoryId === null
      ? "Galerie je momentálně prázdná."
      : "V této kategorii nejsou žádné kousky.";
    return;
  }

  root.className = "gallery-grid";
  root.innerHTML = items.map((item) => {
    const photos = [...(item.photos || [])].sort((a, b) => a.sortOrder - b.sortOrder);
    return `
      <article class="gallery-card">
        ${photos.length ? `
          <div class="gallery-image" data-item-id="${item.id}" tabindex="0" role="button" aria-label="Otevřít fotografie ${escapeHtml(item.nazev)}">
            <img src="${imageUrl(photos[0].objectPath)}" alt="${escapeHtml(photos[0].altText || item.nazev)}" loading="lazy">
            ${photos.length > 1 ? `<span class="photo-count">+${photos.length - 1}</span>` : ""}
          </div>` : ""}
        <h3>${escapeHtml(item.nazev)}</h3>
        ${item.category ? `<span class="category-label">${escapeHtml(item.category.name)}</span>` : ""}
        ${item.popisek ? `<p>${escapeHtml(item.popisek)}</p>` : ""}
      </article>
    `;
  }).join("");

  root.querySelectorAll("[data-item-id]").forEach((element) => {
    const open = () => {
      const item = publicState.items.find((entry) => entry.id === Number(element.dataset.itemId));
      openLightbox(item?.photos || [], 0);
    };
    element.addEventListener("click", open);
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") open();
    });
  });
}

function openLightbox(photos, index) {
  if (!photos.length) return;
  publicState.lightboxPhotos = [...photos].sort((a, b) => a.sortOrder - b.sortOrder);
  publicState.lightboxIndex = index;
  document.body.classList.add("modal-open");
  renderLightbox();
}

function renderLightbox() {
  const root = document.getElementById("lightbox-root");
  const photos = publicState.lightboxPhotos;
  const photo = photos[publicState.lightboxIndex];
  if (!photo) {
    root.innerHTML = "";
    document.body.classList.remove("modal-open");
    return;
  }
  root.innerHTML = `
    <div class="lightbox" role="dialog" aria-modal="true" aria-label="Fotogalerie">
      <button class="lightbox-close" aria-label="Zavřít">×</button>
      ${photos.length > 1 ? '<button class="lightbox-nav lightbox-prev" aria-label="Předchozí">‹</button>' : ""}
      <img src="${imageUrl(photo.objectPath)}" alt="${escapeHtml(photo.altText || "Fotografie")}">
      ${photos.length > 1 ? '<button class="lightbox-nav lightbox-next" aria-label="Další">›</button>' : ""}
      <div class="lightbox-counter">${publicState.lightboxIndex + 1} / ${photos.length}</div>
    </div>
  `;
  root.querySelector(".lightbox-close").addEventListener("click", closeLightbox);
  root.querySelector(".lightbox-prev")?.addEventListener("click", () => moveLightbox(-1));
  root.querySelector(".lightbox-next")?.addEventListener("click", () => moveLightbox(1));
  root.querySelector(".lightbox").addEventListener("click", (event) => {
    if (event.target.classList.contains("lightbox")) closeLightbox();
  });
}

function closeLightbox() {
  publicState.lightboxPhotos = [];
  renderLightbox();
}

function moveLightbox(direction) {
  const total = publicState.lightboxPhotos.length;
  publicState.lightboxIndex = (publicState.lightboxIndex + direction + total) % total;
  renderLightbox();
}

async function submitContactForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const errorElement = document.getElementById("contact-error");
  const formData = new FormData(form);
  const body = {
    jmeno: String(formData.get("jmeno") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    zprava: String(formData.get("zprava") || "").trim()
  };
  errorElement.hidden = true;
  if (!body.jmeno || !/^\S+@\S+\.\S+$/.test(body.email) || body.zprava.length < 10) {
    errorElement.textContent = "Vyplňte prosím všechna pole. Zpráva musí mít alespoň 10 znaků.";
    errorElement.hidden = false;
    return;
  }
  setLoading(button, true, "Odesílám…");
  try {
    await api("/api/contact", jsonOptions("POST", body));
    form.reset();
    showToast("Zpráva byla odeslána. Děkuji.");
  } catch {
    errorElement.textContent = "Zprávu se nepodařilo odeslat. Zkuste to prosím znovu.";
    errorElement.hidden = false;
  } finally {
    setLoading(button, false);
  }
}

async function initPublic() {
  publicLayout();
  try {
    const [items, categories, settings] = await Promise.all([
      api("/api/gallery-items"),
      api("/api/categories"),
      api("/api/site-settings")
    ]);
    publicState.items = items;
    publicState.categories = categories;
    publicState.settings = settings;
    renderBio();
    renderFilters();
    renderGallery();
  } catch (error) {
    document.getElementById("gallery-content").className = "empty";
    document.getElementById("gallery-content").textContent = "Galerii se nepodařilo načíst.";
    showToast("Web se nepodařilo načíst. Zkuste stránku obnovit.", true);
  }

  document.addEventListener("keydown", (event) => {
    if (!publicState.lightboxPhotos.length) return;
    if (event.key === "Escape") closeLightbox();
    if (event.key === "ArrowLeft") moveLightbox(-1);
    if (event.key === "ArrowRight") moveLightbox(1);
  });
}
