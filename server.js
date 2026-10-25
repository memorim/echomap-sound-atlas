import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const root = dirname(fileURLToPath(import.meta.url));

export function createDb(file = resolve(root, 'data', 'echomap.db')) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
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
  const { count } = db.prepare('SELECT COUNT(*) count FROM sounds').get();
  if (!count) db.exec(`
    INSERT INTO sounds VALUES
      (1,'Утро на Яузе','Москва','Басманный','calm',55.759,37.665,84,'#9fc7bd','Вода под мостом, редкие велосипеды и первый трамвай.',174,'water','2026-06-12T05:42:00'),
      (2,'Подземный переход','Москва','Тверской','pulse',55.765,37.605,46,'#e87548','Шаги, объявления и длинное эхо гранитного коридора.',118,'echo','2026-06-18T18:21:00'),
      (3,'Дождь по оранжерее','Москва','Останкино','rain',55.829,37.609,112,'#748ba7','Крупные капли на стеклянной крыше и шелест листьев.',232,'rain','2026-06-27T14:08:00'),
      (4,'Последний трамвай','Москва','Сокольники','night',55.792,37.678,73,'#6c5f91','Металл на повороте, пустая остановка и гул проводов.',92,'metal','2026-07-01T23:47:00'),
      (5,'Двор после школы','Москва','Хамовники','human',55.733,37.574,61,'#e5b85c','Мяч ударяется о стену, кто-то зовёт домой.',208,'voices','2026-06-05T16:34:00'),
      (6,'Ветер в высотках','Москва','Пресня','wind',55.752,37.539,97,'#7b9c7b','Воздушные потоки между башнями и далёкий городской шум.',146,'wind','2026-06-21T20:11:00'),
      (7,'Рынок перед закрытием','Стамбул','Кадыкёй','human',40.991,29.027,129,'#d46b53','Складывают ящики, звенят стаканы, продавцы прощаются.',196,'voices','2026-05-22T19:03:00'),
      (8,'Портовый туман','Хельсинки','Катаянокка','calm',60.167,24.968,105,'#88a9b4','Гудок парома растворяется в тумане над водой.',82,'water','2026-05-14T06:18:00');
    INSERT INTO field_notes(sound_id,author,note,created_at) VALUES
      (1,'Марина','Лучше слушать в наушниках: справа появляется звон велосипеда.','2026-06-13T10:00:00'),
      (3,'Антон','Запись сделана прямо во время летней грозы.','2026-06-28T08:40:00');
  `);
  return db;
}

const noteSchema = z.object({
  soundId: z.number().int().positive(), author: z.string().trim().min(2).max(50),
  note: z.string().trim().min(5).max(300),
});

export function createApp(db = createDb()) {
  const app = express();
  app.use(express.json());
  app.get('/api/sounds', (req, res) => {
    const city = String(req.query.city || 'all');
    const mood = String(req.query.mood || 'all');
    const clauses = []; const params = {};
    if (city !== 'all') { clauses.push('city=$city'); params.$city = city; }
    if (mood !== 'all') { clauses.push('mood=$mood'); params.$mood = mood; }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    res.json(db.prepare(`SELECT * FROM sounds ${where} ORDER BY recorded_at DESC`).all(params));
  });
  app.get('/api/sounds/:id', (req, res) => {
    const sound = db.prepare('SELECT * FROM sounds WHERE id=?').get(Number(req.params.id));
    if (!sound) return res.status(404).json({ message: 'Запись не найдена' });
    const notes = db.prepare('SELECT * FROM field_notes WHERE sound_id=? ORDER BY created_at DESC').all(sound.id);
    res.json({ ...sound, notes });
  });
  app.get('/api/stats', (_req, res) => {
    const summary = db.prepare('SELECT COUNT(*) recordings, COUNT(DISTINCT city) cities, ROUND(SUM(duration)/60.0,1) minutes FROM sounds').get();
    const moods = db.prepare('SELECT mood,COUNT(*) count FROM sounds GROUP BY mood ORDER BY count DESC').all();
    res.json({ summary, moods });
  });
  app.post('/api/notes', (req, res) => {
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: 'Проверьте текст заметки' });
    const sound = db.prepare('SELECT id FROM sounds WHERE id=?').get(parsed.data.soundId);
    if (!sound) return res.status(404).json({ message: 'Запись не найдена' });
    const out = db.prepare('INSERT INTO field_notes(sound_id,author,note,created_at) VALUES(?,?,?,?)').run(parsed.data.soundId, parsed.data.author, parsed.data.note, new Date().toISOString());
    res.status(201).json({ id: Number(out.lastInsertRowid) });
  });
  app.use(express.static(resolve(root, 'public')));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(resolve(root, 'public', 'index.html')));
  app.use((error,_req,res,_next)=>{const status=error?.type==='entity.too.large'?413:error instanceof SyntaxError?400:503;if(status===503)console.error({event:'request_error',error:String(error)});res.status(status).json({message:'Не удалось обработать запрос'});});return app;
}

if (process.env.NODE_ENV !== 'test') createApp().listen(process.env.PORT || 4700,process.env.HOST||'127.0.0.1', () => console.log('EchoMap: http://localhost:4700'));
