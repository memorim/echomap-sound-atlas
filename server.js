import { seedSql } from "./seed.js";
import { adaptDatabase, createPostgres } from "./database.js";
import { createAudioStore } from "./audio-store.js";
import { consumeBudget, initializeBudgets } from "./request-budget.js";
import { initializeUploads, uploadRoutes, authorAccess } from "./uploads.js";
import { ownerAccess, publicOrigin } from "./owner-access.js";
import { dataDirectory } from "./storage.js";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const root = dirname(fileURLToPath(import.meta.url));
const recordings = JSON.parse(
  readFileSync(resolve(root, "public/audio/recordings.json"), "utf8"),
);
const withRecording = (sound) => ({ ...sound, ...recordings[sound.id] });

export function createDb(file = resolve(dataDirectory(), "echomap.db")) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sounds (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, city TEXT NOT NULL,
      district TEXT NOT NULL, mood TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
      duration INTEGER NOT NULL, color TEXT NOT NULL, description TEXT NOT NULL,
      frequency INTEGER NOT NULL, texture TEXT NOT NULL, recorded_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS field_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sound_id INTEGER NOT NULL,
      author TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY(sound_id) REFERENCES sounds(id)
    );
  `);
  const { count } = db.prepare("SELECT COUNT(*) count FROM sounds").get();
  if (!count)
    db.exec(`
    ${seedSql}
  `);
  const columns = db
    .prepare("PRAGMA table_info(field_notes)")
    .all()
    .map((c) => c.name);
  if (!columns.includes("status"))
    db.exec(
      "ALTER TABLE field_notes ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'",
    );
  initializeBudgets(db);
  initializeUploads(db);
  return db;
}

const noteSchema = z.object({
  soundId: z.number().int().positive(),
  author: z.string().trim().min(2).max(50),
  note: z.string().trim().min(5).max(300),
});

export function createApp(
  db = createDb(),
  { uploadDirectory = resolve(dataDirectory(), "uploads"), audioStore } = {},
) {
  db = adaptDatabase(db);
  const app = express();
  const hosted = publicOrigin();
  app.use("/api", (req, res, next) => {
    if (
      hosted
        ? req.get("host") !== hosted.host
        : !["localhost", "127.0.0.1", "[::1]"].includes(req.hostname)
    )
      return res.status(403).json({ message: "Host not allowed" });
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (req.get("sec-fetch-site") === "cross-site" ||
        (req.get("origin") &&
          req.get("origin") !==
            (hosted?.origin || `${req.protocol}://${req.get("host")}`)))
    )
      return res.status(403).json({ message: "Origin not allowed" });
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  uploadRoutes(app, db, {
    directory: uploadDirectory,
    store: audioStore,
    moderator: ownerAccess(),
  });
  const decorate = async (sound) => {
    const row = await db
      .prepare("SELECT sound_id FROM user_recordings WHERE sound_id=?")
      .get(sound.id);
    return row
      ? {
          ...sound,
          audio_url: "/api/audio/" + sound.id,
          source_url: "/api/sounds/" + sound.id,
        }
      : withRecording(sound);
  };
  app.get("/api/sounds", async (req, res) => {
    const city = String(req.query.city || "all");
    const mood = String(req.query.mood || "all");
    const clauses = [
      "id NOT IN (SELECT sound_id FROM user_recordings WHERE status!='approved')",
    ];
    const params = {};
    if (city !== "all") {
      clauses.push("city=$city");
      params.$city = city;
    }
    if (mood !== "all") {
      clauses.push("mood=$mood");
      params.$mood = mood;
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    res.json(
      await Promise.all((await db
        .prepare(`SELECT * FROM sounds ${where} ORDER BY recorded_at DESC`)
        .all(params)).map(decorate)),
    );
  });
  app.get("/api/sounds/:id", async (req, res) => {
    const sound = await db
      .prepare(
        "SELECT * FROM sounds WHERE id=? AND id NOT IN (SELECT sound_id FROM user_recordings WHERE status!='approved')",
      )
      .get(Number(req.params.id));
    if (!sound) return res.status(404).json({ message: "Запись не найдена" });
    const notes = await db
      .prepare(
        "SELECT * FROM field_notes WHERE sound_id=? AND status='approved' ORDER BY created_at DESC",
      )
      .all(sound.id);
    res.json({ ...await decorate(sound), notes });
  });
  app.get("/api/stats", async (_req, res) => {
    const sounds = await Promise.all((await db
      .prepare(
        "SELECT * FROM sounds WHERE id NOT IN (SELECT sound_id FROM user_recordings WHERE status!='approved')",
      )
      .all()).map(decorate));
    const summary = {
      recordings: sounds.length,
      cities: new Set(sounds.map((s) => s.city)).size,
      minutes:
        Math.round(sounds.reduce((total, s) => total + s.duration, 0) / 6) / 10,
    };
    const moods = await db
      .prepare(
        "SELECT mood,COUNT(*) count FROM sounds WHERE id NOT IN (SELECT sound_id FROM user_recordings WHERE status!='approved') GROUP BY mood ORDER BY count DESC",
      )
      .all();
    res.json({ summary, moods });
  });
  app.get("/api/owner/notes", ownerAccess(), async (_req, res) =>
    res.json(
      await db
        .prepare(
          "SELECT * FROM field_notes WHERE status='pending' ORDER BY id DESC LIMIT 100",
        )
        .all(),
    ),
  );
  app.patch("/api/owner/notes/:id", ownerAccess(), async (req, res) => {
    if (!["approved", "rejected"].includes(req.body.status))
      return res.status(400).json({ message: "Неверный статус" });
    const out = await db
      .prepare(
        "UPDATE field_notes SET status=? WHERE id=? AND status='pending'",
      )
      .run(req.body.status, Number(req.params.id));
    res.status(out.changes ? 200 : 409).json({ ok: !!out.changes });
  });
  app.post(
    "/api/notes",
    (req, res, next) => (hosted ? authorAccess(req, res, next) : next()),
    async (req, res) => {
      const budget = await consumeBudget(
        db,
        "notes:" + (req.authorId || "local"),
        10,
        Date.now(),
      );
      if (!budget.allowed)
        return res
          .set("Retry-After", String(budget.retryAfter))
          .status(429)
          .json({ message: "Слишком много заметок. Повторите позже" });
      const parsed = noteSchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ message: "Проверьте текст заметки" });
      const sound = await db
        .prepare(
          "SELECT id FROM sounds WHERE id=? AND id NOT IN (SELECT sound_id FROM user_recordings WHERE status!='approved')",
        )
        .get(parsed.data.soundId);
      if (!sound) return res.status(404).json({ message: "Запись не найдена" });
      const out = await db
        .prepare(
          "INSERT INTO field_notes(sound_id,author,note,created_at,status) VALUES(?,?,?,?,?)",
        )
        .run(
          parsed.data.soundId,
          req.authorId || parsed.data.author,
          parsed.data.note,
          new Date().toISOString(),
          hosted ? "pending" : "approved",
        );
      res
        .status(201)
        .json({
          id: Number(out.lastInsertRowid),
          status: hosted ? "pending" : "approved",
        });
    },
  );
  app.use(express.static(resolve(root, "public")));
  app.get(/^(?!\/api).*/, (_req, res) =>
    res.sendFile(resolve(root, "public", "index.html")),
  );
  app.use((error, _req, res, _next) => {
    const status =
      error?.type === "entity.too.large"
        ? 413
        : error instanceof SyntaxError
          ? 400
          : 503;
    if (status === 503)
      console.error({ event: "request_error", error: String(error) });
    res.status(status).json({ message: "Не удалось обработать запрос" });
  });
  return app;
}

if (process.env.NODE_ENV !== "test")
  createApp(
    process.env.DATABASE_URL ? await createPostgres() : createDb(),
    { audioStore: createAudioStore() },
  ).listen(
    process.env.PORT || 4700,
    process.env.HOST || "127.0.0.1",
    () => console.log("EchoMap: http://localhost:4700"),
  );

