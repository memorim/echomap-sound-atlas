import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { backupArchive, restoreArchive } from "../archive.js";

test("archive restores notes and every upload status, rejects corruption and preserves existing data", async () => {
  const root = mkdtempSync(join(tmpdir(), "echomap-archive-"));
  const source = join(root, "data"), snapshot = join(root, "snapshot"), restored = join(root, "restored");
  mkdirSync(join(source, "uploads"), { recursive: true });
  const db = new DatabaseSync(join(source, "echomap.db"));
  db.exec("CREATE TABLE sounds(id INTEGER PRIMARY KEY); CREATE TABLE field_notes(note TEXT); CREATE TABLE user_recordings(file TEXT UNIQUE,size INTEGER,status TEXT); INSERT INTO field_notes VALUES('keep this note')");
  for (const [index, status] of ["pending", "approved", "rejected"].entries()) {
    const file = `${String(index).repeat(8)}-0000-4000-8000-000000000000.wav`;
    writeFileSync(join(source, "uploads", file), Buffer.from([index, 1, 2, 3]));
    db.prepare("INSERT INTO user_recordings VALUES(?,4,?)").run(file, status);
  }
  db.close();
  try {
    assert.equal((await backupArchive(source, snapshot)).recordings, 3);
    await restoreArchive(snapshot, restored);
    const result = new DatabaseSync(join(restored, "echomap.db"), { readOnly: true });
    assert.equal(result.prepare("SELECT note FROM field_notes").get().note, "keep this note");
    assert.equal(result.prepare("SELECT count(*) n FROM user_recordings").get().n, 3);
    result.close();
    for (const file of readdirSync(join(source, "uploads")))
      assert.deepEqual(readFileSync(join(restored, "uploads", file)), readFileSync(join(source, "uploads", file)));
    await assert.rejects(() => restoreArchive(snapshot, restored), /new and outside/);
    const audio = readdirSync(join(snapshot, "uploads"))[0];
    writeFileSync(join(snapshot, "uploads", audio), "bad");
    await assert.rejects(() => restoreArchive(snapshot, join(root, "bad-restore")), /checksum/);
    await assert.rejects(() => backupArchive(source, join(source, "backups")), /new and outside/);
    rmSync(join(source, "uploads", audio));
    await assert.rejects(() => backupArchive(source, join(root, "incomplete")));
    assert.ok(!readdirSync(root).some(name => name.includes(".partial-")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
