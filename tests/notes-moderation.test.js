import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createHash } from "node:crypto";
process.env.NODE_ENV = "test";
const { createDb, createApp } = await import("../server.js");
test("public notes require an author, stay private until approved and share persistent budgets", async () => {
  const saved = { ...process.env };
  const db = createDb(":memory:");
  const token = "a".repeat(40),
    owner = "z".repeat(40);
  Object.assign(process.env, {
    APP_PUBLIC_ORIGIN: "https://echo.example",
    APP_OWNER_TOKEN: owner,
    ECHOMAP_NOTES_REQUIRE_REVIEW: "1",
    APP_UPLOADERS: JSON.stringify({
      [createHash("sha256").update(token).digest("hex")]: "alice",
    }),
  });
  try {
    const app = createApp(db),
      body = {
        soundId: 1,
        author: "Forged name",
        note: "A pending public note",
      };
    const send = (target = app) =>
      request(target).post("/api/notes").set("Host", "echo.example");
    assert.equal((await send().send(body)).status, 401);
    const created = await send().auth(token, { type: "bearer" }).send(body);
    assert.equal(created.status, 201);
    assert.equal(created.body.status, "pending");
    assert.equal(
      db
        .prepare("SELECT author FROM field_notes WHERE id=?")
        .get(created.body.id).author,
      "alice",
    );
    const read = () =>
      request(app).get("/api/sounds/1").set("Host", "echo.example");
    assert.ok(!(await read()).body.notes.some((n) => n.id === created.body.id));
    const moderate = () =>
      request(app)
        .patch("/api/owner/notes/" + created.body.id)
        .set("Host", "echo.example");
    assert.equal((await moderate().send({ status: "approved" })).status, 401);
    assert.equal(
      (
        await moderate()
          .auth(owner, { type: "bearer" })
          .send({ status: "approved" })
      ).status,
      200,
    );
    assert.ok((await read()).body.notes.some((n) => n.id === created.body.id));
    for (let i = 1; i < 10; i++)
      assert.equal(
        (await send().auth(token, { type: "bearer" }).send(body)).status,
        201,
      );
    const limited = await send(createApp(db))
      .auth(token, { type: "bearer" })
      .send(body);
    assert.equal(limited.status, 429);
    assert.ok(limited.headers["retry-after"]);
  } finally {
    db.close();
    for (const name of [
      "APP_PUBLIC_ORIGIN",
      "APP_OWNER_TOKEN",
      "APP_UPLOADERS",
      "ECHOMAP_NOTES_REQUIRE_REVIEW",
    ])
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
  }
});

test("guests can publish a note and the owner can hide it", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    APP_PUBLIC_ORIGIN: "https://echo.example",
    APP_OWNER_TOKEN: "z".repeat(40),
    ECHOMAP_NOTES_REQUIRE_REVIEW: "0",
  });
  const db = createDb(":memory:");
  try {
    const app = createApp(db);
    const call = (method, path) => request(app)[method](path).set("Host", "echo.example");
    const note = { soundId: 1, author: "Guest", note: "A new field note" };
    assert.equal((await call("post", "/api/notes").send({ ...note, website: "spam" })).status, 400);
    const added = await call("post", "/api/notes").send(note);
    assert.equal(added.status, 201);
    assert.equal(added.body.status, "approved");
    const read = () => call("get", "/api/sounds/1");
    assert.equal((await read()).body.notes.find(n => n.id === added.body.id).author, "Guest (гость)");
    const hide = () => call("patch", "/api/owner/notes/" + added.body.id).send({ status: "rejected" });
    assert.equal((await hide()).status, 401);
    assert.equal((await hide().auth("z".repeat(40), { type: "bearer" })).status, 200);
    assert.ok(!(await read()).body.notes.some(n => n.id === added.body.id));
  } finally {
    db.close();
    for (const name of ["APP_PUBLIC_ORIGIN", "APP_OWNER_TOKEN", "ECHOMAP_NOTES_REQUIRE_REVIEW"])
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
  }
});
