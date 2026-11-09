import { localAudioStore } from "./audio-store.js";
export const authorAccess = (req, res, next) => {
  try {
    const registry = JSON.parse(process.env.APP_UPLOADERS || "{}"),
      header = req.get("authorization") || "",
      token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const name = registry[createHash("sha256").update(token).digest("hex")];
    if (
      token.length < 32 ||
      token.length > 256 ||
      typeof name !== "string" ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(name)
    )
      return res.status(401).json({ message: "Войдите с ключом автора" });
    req.authorId = name;
    next();
  } catch {
    return res.status(503).json({ message: "Доступ авторов не настроен" });
  }
};

import express from "express";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
export function wavDuration(buffer) {
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length < 44 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE" ||
    buffer.readUInt32LE(4) + 8 !== buffer.length
  )
    throw new Error("Требуется несжатый PCM WAV");
  let format,
    dataBytes = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const type = buffer.toString("ascii", offset, offset + 4),
      size = buffer.readUInt32LE(offset + 4),
      start = offset + 8;
    if (start + size > buffer.length) throw new Error("Некорректный WAV");
    if (type === "fmt ") {
      if (size < 16) throw new Error("Некорректный WAV");
      format = {
        kind: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sample: buffer.readUInt32LE(start + 4),
        rate: buffer.readUInt32LE(start + 8),
        align: buffer.readUInt16LE(start + 12),
        bits: buffer.readUInt16LE(start + 14),
      };
    }
    if (type === "data") dataBytes += size;
    offset = start + size + (size % 2);
  }
  if (
    !format ||
    format.kind !== 1 ||
    ![1, 2].includes(format.channels) ||
    ![8, 16, 24, 32].includes(format.bits) ||
    format.sample < 8000 ||
    format.sample > 192000 ||
    format.align !== (format.channels * format.bits) / 8 ||
    format.rate !== format.sample * format.align ||
    dataBytes % format.align !== 0
  )
    throw new Error("Поддерживается PCM WAV: 1–2 канала, 8–32 бит");
  const duration = dataBytes / format.rate;
  if (duration < 1 || duration > 600)
    throw new Error("Длительность должна быть 1–600 секунд");
  return Math.round(duration);
}
export function initializeUploads(db) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS user_recordings(sound_id INTEGER PRIMARY KEY,owner_id TEXT NOT NULL,file TEXT NOT NULL UNIQUE,status TEXT NOT NULL DEFAULT 'pending',size INTEGER NOT NULL,created_at TEXT NOT NULL);`,
  );
}
export function uploadRoutes(app, db, { directory, moderator, store = localAudioStore(directory) }) {
  const user = authorAccess;
  app.post(
    "/api/uploads",
    user,
    express.raw({ type: "audio/wav", limit: "20mb" }),
    async (req, res, next) => {
      const parsed = z
        .object({
          title: z.string().trim().min(3).max(100),
          city: z.string().trim().min(2).max(80),
          lat: z.coerce.number().min(-90).max(90),
          lng: z.coerce.number().min(-180).max(180),
          license: z.literal("CC0-1.0"),
        })
        .strict()
        .safeParse(req.query);
      if (!parsed.success)
        return res.status(400).json({
          message: "Проверьте название, город, координаты и лицензию CC0",
        });
      let duration;
      try {
        duration = wavDuration(req.body);
      } catch (error) {
        return res.status(400).json({ message: error.message });
      }
      const file = randomUUID() + ".wav",
        now = new Date().toISOString();
      let written = false;
      try {
        const result = await db.transaction(async () => {
        const quota = await db
          .prepare(
            "SELECT count(*) count,COALESCE(sum(size),0) bytes FROM user_recordings WHERE owner_id=?",
          )
          .get(req.authorId);
        if (
          quota.count >= 100 ||
          quota.bytes + req.body.length > 100 * 1024 * 1024 ||
          (await db
            .prepare("SELECT COALESCE(sum(size),0) bytes FROM user_recordings")
            .get()).bytes +
            req.body.length >
            1024 * 1024 * 1024
        ) {
          return null;
        }
        await store.put(file, req.body);
        written = true;
        const p = parsed.data;
        const out = await db
          .prepare(
            "INSERT INTO sounds(title,city,district,mood,lat,lng,duration,color,description,frequency,texture,recorded_at) VALUES(?,?,?,'calm',?,?,?,'#9fc7bd',?,0,'user',?)",
          )
          .run(
            p.title,
            p.city,
            "Пользовательская запись",
            p.lat,
            p.lng,
            duration,
            "Запись автора, опубликована по CC0",
            now,
          );
        await db.prepare(
          "INSERT INTO user_recordings(sound_id,owner_id,file,size,created_at) VALUES(?,?,?,?,?)",
        ).run(out.lastInsertRowid, req.authorId, file, req.body.length, now);
        return { id: Number(out.lastInsertRowid), status: "pending" };
        });
        if (!result) return res.status(429).json({ message: "Исчерпана квота хранилища" });
        res.status(201).json(result);
      } catch (error) {
        // An uncertain COMMIT outcome may already reference this object. Keep it
        // private for reconciliation rather than risk deleting committed audio.
        if (written) console.error({ event: "upload_reconciliation_required", file });
        next(error);
      }
    },
  );
  app.get("/api/uploads/mine", user, async (req, res) =>
    res.json(
      await db
        .prepare(
          "SELECT sound_id,status,created_at FROM user_recordings WHERE owner_id=? ORDER BY sound_id DESC",
        )
        .all(req.authorId),
    ),
  );
  app.get("/api/owner/uploads", moderator, async (req, res) =>
    res.json(
      await db
        .prepare(
          "SELECT u.sound_id,u.owner_id,u.status,s.title,s.city FROM user_recordings u JOIN sounds s ON s.id=u.sound_id ORDER BY u.sound_id DESC LIMIT 100",
        )
        .all(),
    ),
  );
  app.get("/api/owner/uploads/:id/audio", moderator, async (req, res) => {
    const row = await db
      .prepare("SELECT file FROM user_recordings WHERE sound_id=?")
      .get(Number(req.params.id));
    if (!row) return res.status(404).end();
    res.set({
      "Content-Type": "audio/wav",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
    await store.send(req, res, row.file);
  });
  app.patch("/api/owner/uploads/:id", moderator, async (req, res) => {
    if (!["approved", "rejected"].includes(req.body.status))
      return res.status(400).json({ message: "Неверный статус" });
    const out = await db
      .prepare(
        "UPDATE user_recordings SET status=? WHERE sound_id=? AND status='pending'",
      )
      .run(req.body.status, Number(req.params.id));
    res.status(out.changes ? 200 : 409).json({ ok: !!out.changes });
  });
  app.get("/api/audio/:id", async (req, res) => {
    const row = await db
      .prepare(
        "SELECT file FROM user_recordings WHERE sound_id=? AND status='approved'",
      )
      .get(Number(req.params.id));
    if (!row) return res.status(404).end();
    res.set({
      "Content-Type": "audio/wav",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
    await store.send(req, res, row.file);
  });
}

