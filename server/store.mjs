import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { get, put } from "@vercel/blob";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, "data"));
const dbPath = path.join(dataDir, "db.json");
const blobPath = "system/db.json";

const initialState = {
  counters: { category: 0, galleryItem: 0, photo: 0, contactMessage: 0 },
  categories: [],
  galleryItems: [],
  photos: [],
  contactMessages: [],
  siteSettings: {
    bioTitle: "O autorce",
    bioText: "Drátkovaná poezie vzniká z radosti z detailu, materiálu a ruční práce.",
    bioPhotoPath: null
  }
};

let state;
let writeQueue = Promise.resolve();

function useBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function normalizeState(loaded = {}) {
  return {
    ...structuredClone(initialState),
    ...loaded,
    counters: { ...initialState.counters, ...(loaded.counters || {}) },
    siteSettings: { ...initialState.siteSettings, ...(loaded.siteSettings || {}) }
  };
}

async function readBlobState() {
  try {
    const result = await get(blobPath, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const raw = await new Response(result.stream).text();
    return JSON.parse(raw);
  } catch (error) {
    if (error?.status === 404 || error?.statusCode === 404 || /not found/i.test(String(error?.message || ""))) return null;
    throw error;
  }
}

async function persist() {
  if (useBlob()) {
    await put(blobPath, JSON.stringify(state, null, 2), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60
    });
    return;
  }

  await fs.mkdir(dataDir, { recursive: true });
  const tempPath = `${dbPath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tempPath, dbPath);
}

export async function initializeStore() {
  if (useBlob()) {
    const loaded = await readBlobState();
    if (loaded) {
      state = normalizeState(loaded);
      return;
    }
    state = normalizeState();
    await persist();
    return;
  }

  if (state) return;
  await fs.mkdir(dataDir, { recursive: true });
  try {
    const raw = await fs.readFile(dbPath, "utf8");
    state = normalizeState(JSON.parse(raw));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    state = normalizeState();
    await persist();
  }
}

export function readStore() {
  if (!state) throw new Error("Store has not been initialized");
  return structuredClone(state);
}

export async function updateStore(mutator) {
  const operation = writeQueue.then(async () => {
    const draft = structuredClone(state);
    const result = await mutator(draft);
    state = draft;
    await persist();
    return result;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

export function nextId(draft, counterName) {
  draft.counters[counterName] = Number(draft.counters[counterName] || 0) + 1;
  return draft.counters[counterName];
}
