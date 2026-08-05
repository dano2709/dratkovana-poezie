import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const port = 3199;
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dratkovana-smoke-"));
const dataDir = path.join(tempDir, "data");
const uploadDir = path.join(tempDir, "uploads");
const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: path.resolve("."),
  env: {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dataDir,
    UPLOAD_DIR: uploadDir,
    SESSION_SECRET: "smoke-test-secret",
    NODE_ENV: "test",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let logs = "";
child.stdout.on("data", (chunk) => { logs += chunk; });
child.stderr.on("data", (chunk) => { logs += chunk; });

const base = `http://127.0.0.1:${port}`;
let cookie = "";

async function request(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${base}${url}`, { ...options, headers });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";", 1)[0];
  return response;
}

async function waitForServer() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const response = await fetch(`${base}/api/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start. Logs:\n${logs}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await waitForServer();
  let response = await request("/");
  assert(response.ok && (await response.text()).includes("Drátkovaná poezie"), "Public page failed");

  response = await request("/admin");
  assert(response.ok && (await response.text()).includes("/app.js"), "Admin page failed");

  response = await request("/api/gallery-items/all");
  assert(response.status === 401, "Protected API is accessible without login");

  response = await request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "Admin", password: "Havirov123" }),
  });
  assert(response.ok && cookie, "Login failed");

  response = await request("/api/categories", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Náramky" }),
  });
  const category = await response.json();
  assert(response.status === 201 && category.id === 1, "Category creation failed");

  response = await request("/api/gallery-items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nazev: "Testovací kousek", popisek: "Test", published: true, categoryId: 1 }),
  });
  const item = await response.json();
  assert(response.status === 201 && item.id === 1, "Gallery item creation failed");

  response = await request("/api/storage/uploads/request-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "test.png", size: 8, contentType: "image/png" }),
  });
  const upload = await response.json();
  assert(response.ok && upload.uploadURL, "Upload URL request failed");

  response = await request(upload.uploadURL, {
    method: "PUT",
    headers: { "content-type": "image/png" },
    body: Buffer.from("testdata"),
  });
  assert(response.ok, "File upload failed");

  response = await request(`/api/storage/objects/${upload.objectPath.split("/").pop()}`);
  assert(response.ok && (await response.text()) === "testdata", "Uploaded object serving failed");

  response = await request("/api/gallery-items/1/photos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ objectPath: upload.objectPath, sortOrder: 0 }),
  });
  assert(response.status === 201, "Photo registration failed");

  response = await request("/api/gallery-items");
  const items = await response.json();
  assert(response.ok && items.length === 1 && items[0].photos.length === 1, "Public gallery failed");

  response = await request("/api/site-settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bioTitle: "O mně", bioText: "Testovací text", bioPhotoPath: upload.objectPath }),
  });
  const settings = await response.json();
  assert(response.ok && settings.bioTitle === "O mně", "Site settings failed");

  response = await request("/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jmeno: "Test", email: "test@example.com", zprava: "Toto je testovací zpráva." }),
  });
  assert(response.ok, "Contact form failed");

  response = await request("/api/contact-messages");
  const messages = await response.json();
  assert(response.ok && messages.length === 1 && messages[0].email === "test@example.com", "Contact message administration failed");

  console.log("Smoke test passed: pages, authentication, categories, gallery, uploads, settings, contact form and message administration work.");
} finally {
  child.kill("SIGTERM");
  await fs.rm(tempDir, { recursive: true, force: true });
}
