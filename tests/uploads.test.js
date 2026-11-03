import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.NODE_ENV = "test";
const { createDb, createApp } = await import("../server.js");
function wav() {
  const b = Buffer.alloc(44 + 16000);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(16000, 40);
  return b;
}
test("uploads require author identity, validate media and remain private until moderation", async () => {
  const db = createDb(":memory:"),
    dir = mkdtempSync(join(tmpdir(), "audio-")),
    a = "a".repeat(40),
    b = "b".repeat(40),
    old = process.env.APP_UPLOADERS,
    owner = process.env.APP_OWNER_TOKEN;
  process.env.APP_UPLOADERS = JSON.stringify({
    [createHash("sha256").update(a).digest("hex")]: "alice",
    [createHash("sha256").update(b).digest("hex")]: "bob",
  });
  process.env.APP_OWNER_TOKEN = "z".repeat(40);
  try {
    const app = createApp(db, { uploadDirectory: dir }),
      path =
        "/api/uploads?title=Audio%20test&city=City&lat=1&lng=2&license=CC0-1.0";
    assert.equal(
      (await request(app).post(path).type("audio/wav").send(wav())).status,
      401,
    );
    assert.equal(
      (
        await request(app)
          .post(path)
          .auth(a, { type: "bearer" })
          .type("audio/wav")
          .send(Buffer.from("not audio"))
      ).status,
      400,
    );
    const made = await request(app)
      .post(path)
      .auth(a, { type: "bearer" })
      .type("audio/wav")
      .send(wav());
    assert.equal(made.status, 201);
    const id = made.body.id;
    const hiddenStats=(await request(app).get('/api/stats')).body;
    assert.equal(hiddenStats.moods.reduce((total,mood)=>total+mood.count,0),hiddenStats.summary.recordings);
    assert.equal((await request(app).get("/api/audio/" + id)).status, 404);
    assert.equal((await request(app).get("/api/sounds/" + id)).status, 404);
    assert.equal(
      (await request(app).get("/api/owner/uploads/" + id + "/audio")).status,
      401,
    );
    const preview = await request(app)
      .get("/api/owner/uploads/" + id + "/audio")
      .auth("z".repeat(40), { type: "bearer" });
    assert.equal(preview.status, 200);
    assert.equal(preview.headers["cache-control"], "no-store");
    assert.equal(preview.headers["content-type"], "audio/wav");
    assert.equal((await request(app).get("/api/audio/" + id)).status, 404);
    assert.equal(
      (await request(app).get("/api/uploads/mine").auth(b, { type: "bearer" }))
        .body.length,
      0,
    );
    assert.equal(
      (
        await request(app)
          .patch("/api/owner/uploads/" + id)
          .send({ status: "approved" })
      ).status,
      401,
    );
    assert.equal(
      (
        await request(app)
          .patch("/api/owner/uploads/" + id)
          .auth("z".repeat(40), { type: "bearer" })
          .send({ status: "approved" })
      ).status,
      200,
    );
    const approvedStats=(await request(app).get('/api/stats')).body;
    assert.equal(approvedStats.summary.recordings,hiddenStats.summary.recordings+1);
    assert.equal(approvedStats.moods.reduce((total,mood)=>total+mood.count,0),approvedStats.summary.recordings);
    assert.equal((await request(app).get("/api/audio/" + id)).status, 200);
    assert.equal(
      (await request(app).get("/api/sounds/" + id)).body.duration,
      1,
    );
  } finally {
    if (old === undefined) delete process.env.APP_UPLOADERS;
    else process.env.APP_UPLOADERS = old;
    if (owner === undefined) delete process.env.APP_OWNER_TOKEN;
    else process.env.APP_OWNER_TOKEN = owner;
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
