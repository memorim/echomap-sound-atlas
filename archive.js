import { DatabaseSync, backup } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, lstatSync, existsSync, readFileSync, writeFileSync,
  copyFileSync, renameSync, rmSync, chmodSync } from "node:fs";
import { resolve, join, dirname } from "node:path";

const audioName = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.wav$/;
function regular(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Expected a regular file");
}
function directory(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Expected a regular directory");
}
function digest(path) {
  regular(path);
  const bytes = readFileSync(path);
  return { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
function validateDatabase(db) {
  if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").all().length)
    throw new Error("Database integrity check failed");
  for (const table of ["sounds", "field_notes", "user_recordings"])
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))
      throw new Error("Not an EchoMap archive");
}
function recordings(db) {
  const rows = db.prepare("SELECT file,size FROM user_recordings ORDER BY file").all();
  if (rows.some(row => !audioName.test(row.file) || !Number.isSafeInteger(row.size) || row.size < 1 || row.size > 20 * 1024 * 1024))
    throw new Error("Invalid uploaded recording metadata");
  return rows;
}

/** Snapshot the database first, then its immutable referenced WAV files. */
export async function backupArchive(sourceDirectory, destinationDirectory) {
  const source = resolve(sourceDirectory), destination = resolve(destinationDirectory);
  directory(source);
  if (destination === source || destination.startsWith(source + "/") || source.startsWith(destination + "/") || existsSync(destination))
    throw new Error("Destination must be new and outside the source data directory");
  regular(join(source, "echomap.db"));
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const staging = destination + ".partial-" + randomUUID();
  mkdirSync(join(staging, "uploads"), { recursive: true, mode: 0o700 });
  try {
    const db = new DatabaseSync(join(source, "echomap.db"), { readOnly: true });
    try {
      validateDatabase(db);
      writeFileSync(join(staging, "echomap.db"), "", { flag: "wx", mode: 0o600 });
      await backup(db, join(staging, "echomap.db"));
    } finally { db.close(); }
    const snapshot = new DatabaseSync(join(staging, "echomap.db"), { readOnly: true });
    let rows;
    try { validateDatabase(snapshot); rows = recordings(snapshot); }
    finally { snapshot.close(); }
    const files = { "echomap.db": digest(join(staging, "echomap.db")) };
    if (rows.length) directory(join(source, "uploads"));
    for (const row of rows) {
      const input = join(source, "uploads", row.file), output = join(staging, "uploads", row.file);
      regular(input);
      copyFileSync(input, output);
      chmodSync(output, 0o600);
      const metadata = digest(output);
      if (metadata.size !== row.size) throw new Error("Recording size does not match database");
      files["uploads/" + row.file] = metadata;
    }
    writeFileSync(join(staging, "manifest.json"), JSON.stringify({ version: 1, createdAt: new Date().toISOString(), files }, null, 2), { flag: "wx", mode: 0o600 });
    renameSync(staging, destination);
    return { directory: destination, recordings: rows.length };
  } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error; }
}

/** Validate the complete snapshot before creating a new restored data directory. */
export async function restoreArchive(snapshotDirectory, destinationDirectory) {
  const source = resolve(snapshotDirectory);
  directory(source);
  regular(join(source, "manifest.json"));
  const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
  if (manifest.version !== 1 || !manifest.files || Array.isArray(manifest.files) ||
      typeof manifest.files !== "object" || !Object.hasOwn(manifest.files, "echomap.db"))
    throw new Error("Invalid archive manifest");
  for (const [file, expected] of Object.entries(manifest.files)) {
    if (file !== "echomap.db" && !(file.startsWith("uploads/") && audioName.test(file.slice(8))))
      throw new Error("Invalid archive file path");
    if (file.startsWith("uploads/")) directory(join(source, "uploads"));
    const actual = digest(join(source, file));
    if (expected?.size !== actual.size || expected?.sha256 !== actual.sha256)
      throw new Error("Archive checksum mismatch");
  }
  const db = new DatabaseSync(join(source, "echomap.db"), { readOnly: true });
  try {
    validateDatabase(db);
    const expected = ["echomap.db", ...recordings(db).map(row => "uploads/" + row.file)].sort();
    if (JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify(expected))
      throw new Error("Archive manifest does not match database recordings");
  } finally { db.close(); }
  return backupArchive(source, destinationDirectory);
}
