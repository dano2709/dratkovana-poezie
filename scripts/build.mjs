import fs from "node:fs/promises";

const requiredFiles = [
  "public/index.html",
  "public/styles.css",
  "public/app-core.js",
  "public/app-admin-main.js",
  "public/app-admin-extra.js",
  "public/app.js",
  "server/index.mjs",
  "server/runtime.mjs",
  "server/content-api.mjs",
  "server/gallery-api.mjs",
  "server/store.mjs",
  "data/db.json",
];

for (const file of requiredFiles) {
  await fs.access(file);
}

console.log("Build check passed: all production files are present.");
