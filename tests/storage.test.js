import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { dataDirectory } from "../storage.js";
process.env.NODE_ENV = "test";
const { createDb, createApp } = await import("../server.js");
test("database and WAV files use the same configured private persistent directory", () => {
  const old = process.env.ECHOMAP_DATA_DIRECTORY;
  const path = mkdtempSync(join(tmpdir(), "echomap-volume-"));
  try {
    process.env.ECHOMAP_DATA_DIRECTORY = path;
    const db = createDb();
    try { createApp(db); } finally { db.close(); }
    assert.ok(existsSync(join(path, "echomap.db")));
    assert.ok(existsSync(join(path, "uploads")));
    process.env.ECHOMAP_DATA_DIRECTORY = resolve("public", "private");
    assert.throws(dataDirectory, /outside the public/);
  } finally {
    if (old === undefined) delete process.env.ECHOMAP_DATA_DIRECTORY;
    else process.env.ECHOMAP_DATA_DIRECTORY = old;
    rmSync(path, { recursive: true, force: true });
  }
});
