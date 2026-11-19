// Browser-only adapter, loaded exclusively by scripts/build_demo.py.
(() => {
  const state = structuredClone(globalThis.DEMO_SEED);
  const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
  };
  const text = (value, min = 1, max = 200) => {
    if (
      typeof value !== "string" ||
      value.trim().length < min ||
      value.trim().length > max
    )
      fail("Проверьте введённые данные");
    return value.trim();
  };
  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input, globalThis.location.href);
    if (
      url.origin !== globalThis.location.origin ||
      !url.pathname.startsWith("/api/")
    )
      return originalFetch(input, options);
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    try {
      return await handle(
        url,
        options.method || "GET",
        options.body ? JSON.parse(options.body) : {},
        new Headers(options.headers),
      );
    } catch (error) {
      return json(
        { message: error.message, detail: error.message },
        error.status || 400,
      );
    }
  };
  globalThis.PORTFOLIO_DEMO = true;

  const notesKey = "echomap-note-drafts-v1";
  let notes = [];
  try {
    const saved = JSON.parse(localStorage.getItem(notesKey) || "[]");
    if (Array.isArray(saved)) notes = saved;
  } catch {}
  async function handle(url, method, body) {
    if (url.pathname === "/api/capabilities" && method === "GET") return json({ reviewNotes: false });
    if (url.pathname === "/api/notes" && method === "POST") {
      if (body.website || !state["/api/sounds"].some(sound => sound.id === body.soundId))
        fail("Проверьте выбранную запись");
      const note = {
        id: String(crypto.randomUUID()), sound_id: body.soundId,
        author: text(body.author, 2, 50), note: text(body.note, 5, 300),
        created_at: new Date().toISOString(),
      };
      const next = [note, ...notes];
      try { localStorage.setItem(notesKey, JSON.stringify(next)); }
      catch { fail("Не удалось сохранить заметку в браузере", 503); }
      notes = next;
      return json({ id: note.id, status: "approved" }, 201);
    }
    if (method !== "GET") fail("Только чтение", 405);
    const selection = /^\/api\/sounds\/(\d+)$/.exec(url.pathname);
    if (selection) {
      const sound = state["/api/sounds"].find(item => item.id === Number(selection[1]));
      if (!sound) fail("Запись не найдена", 404);
      return json({ ...sound, notes: notes.filter(note => note.sound_id === sound.id) });
    }
    if (url.pathname === "/api/sounds") {
      const mood = url.searchParams.get("mood");
      return json(
        state["/api/sounds"].filter(
          (x) => !mood || mood === "all" || x.mood === mood,
        ),
      );
    }
    if (url.pathname === "/api/stats") return json(state["/api/stats"]);
    fail("Не найдено", 404);
  }
})();
