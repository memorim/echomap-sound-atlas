// Browser-only adapter, loaded exclusively by scripts/build_demo.py.
// ponytail: state lasts for one page session; use the documented server for shared, durable data.
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

  async function handle(url, method) {
    if (method !== "GET") fail("Только чтение", 405);
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
