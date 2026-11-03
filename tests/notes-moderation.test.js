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
    ])
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
  }
});
