import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { chromium } from "playwright-core";
import { createBrowserClient } from "browser-sdk";
import { local } from "browser-sdk/local";
import { BrowserRuntime } from "../dist/runtime.js";

let server;
let fixtureUrl;

test.before(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><head><title>MCP fixture</title></head><body>
      <main><h1>Runtime fixture</h1>
      <label>Name <input aria-label="Name" /></label>
      <button type="button" id="run">Run</button>
      <output id="result"></output></main>
      <script>document.querySelector('#run').addEventListener('click', () => { document.querySelector('#result').textContent = 'Hello ' + document.querySelector('input').value; });</script>
    </body></html>`);
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  fixtureUrl = `http://127.0.0.1:${server.address().port}/`;
});

test.after(async () => {
  server.close();
  await once(server, "close");
});

test("runs a stateful snapshot -> action -> read workflow", async () => {
  const browser = createBrowserClient({
    providers: [local({ executablePath: chromium.executablePath() })],
    cache: false,
    retries: 0,
  });
  const runtime = new BrowserRuntime(browser, { maxSessions: 1, allowedDomains: ["127.0.0.1"] });
  const started = await runtime.start({ url: fixtureUrl });
  try {
    assert.equal(started.provider, "local");
    assert.equal(started.url, fixtureUrl);

    const snapshot = await runtime.snapshot(started.sessionId);
    const nameRef = snapshot.refs.find((ref) => ref.role === "textbox" && ref.name === "Name")?.ref;
    const runRef = snapshot.refs.find((ref) => ref.role === "button" && ref.name === "Run")?.ref;
    assert.ok(nameRef);
    assert.ok(runRef);
    assert.match(snapshot.snapshot, new RegExp(`ref=${nameRef}`));

    await runtime.action(started.sessionId, { action: "fill", ref: nameRef, value: "Ada" });
    await runtime.action(started.sessionId, { action: "click", ref: runRef });
    const result = await runtime.read(started.sessionId, { selector: "#result" });
    assert.equal(result.text, "Hello Ada");

    const screenshot = await runtime.screenshot(started.sessionId, { fullPage: true });
    assert.deepEqual([...screenshot.data.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  } finally {
    await runtime.close(started.sessionId);
  }
  assert.deepEqual(await runtime.list(), []);
});

test("does not navigate outside the configured MCP allowlist", async () => {
  const browser = createBrowserClient({
    providers: [local({ executablePath: chromium.executablePath() })],
    cache: false,
    retries: 0,
  });
  const runtime = new BrowserRuntime(browser, { maxSessions: 1, allowedDomains: ["127.0.0.1"] });
  const started = await runtime.start();
  try {
    await assert.rejects(() => runtime.navigate(started.sessionId, "https://example.com"), /outside the MCP browser allowlist/);
  } finally {
    await runtime.close(started.sessionId);
  }
});
