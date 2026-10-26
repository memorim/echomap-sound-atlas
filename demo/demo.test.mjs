import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
function browser() {
  let offset = 0;
  class Clock extends Date {
    static now() {
      return Date.now() + offset;
    }
  }
  let network = 0;
  const scope = {
    DEMO_SEED: JSON.parse(
      readFileSync(new URL("./seed.json", import.meta.url), "utf8"),
    ),
    structuredClone,
    Response,
    Headers,
    URL,
    DOMException,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Date: Clock,
    crypto: webcrypto,
    location: new URL("https://example.test/project/"),
    fetch: async () => {
      network++;
      throw Error("Unexpected network request");
    },
  };
  runInNewContext(
    readFileSync(new URL("./browser.js", import.meta.url), "utf8"),
    scope,
  );
  return {
    call: async (path, method = "GET", body, headers) => {
      const response = await scope.fetch(path, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
        headers,
      });
      return { status: response.status, body: await response.json() };
    },
    advance: (ms) => {
      offset += ms;
    },
    network: () => network,
  };
}
test("mood filtering and catalog statistics remain available offline", async () => {
  const b = browser();
  const all = (await b.call("/api/sounds")).body;
  assert(all.length > 0);
  const subset = (await b.call("/api/sounds?mood=" + all[0].mood)).body;
  assert(subset.length > 0);
  assert(subset.every((x) => x.mood === all[0].mood));
  assert.equal(
    (await b.call("/api/stats")).body.summary.recordings,
    all.length,
  );
  assert.equal(b.network(), 0);
});
