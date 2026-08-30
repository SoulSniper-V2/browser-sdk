import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "../dist/index.js");
let fixture;
let fixtureUrl;

test.before(async () => {
  fixture = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><head><title>MCP wire fixture</title></head><body>
      <h1>Wire fixture</h1><input aria-label="Email" />
      <button type="button" id="save">Save</button><output id="status"></output>
      <script>document.querySelector('#save').onclick = () => { document.querySelector('#status').textContent = document.querySelector('input').value; };</script>
    </body></html>`);
  }).listen(0, "127.0.0.1");
  await once(fixture, "listening");
  fixtureUrl = `http://127.0.0.1:${fixture.address().port}/`;
});

test.after(async () => {
  fixture.close();
  await once(fixture, "close");
});

function parseText(result) {
  const block = result.content.find((item) => item.type === "text");
  assert.ok(block);
  return JSON.parse(block.text);
}

test("stdio MCP server exposes read tools and runs a browser session over the wire", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: join(here, "../../.."),
    env: {
      ...process.env,
      BROWSERBASE_API_KEY: "",
      CLOUDFLARE_API_TOKEN: "",
      CF_API_TOKEN: "",
      CLOUDFLARE_ACCOUNT_ID: "",
      CF_ACCOUNT_ID: "",
      BROWSERLESS_API_KEY: "",
      BROWSERLESS_TOKEN: "",
      STEEL_API_KEY: "",
      ANCHOR_API_KEY: "",
      HYPERBROWSER_API_KEY: "",
      BROWSER_USE_API_KEY: "",
      BROWSER_SDK_EXTENDED_PROVIDERS: "false",
      CHROMIUM_EXECUTABLE_PATH: chromium.executablePath(),
      BROWSER_SDK_ALLOWED_DOMAINS: "127.0.0.1",
      BROWSER_SDK_MAX_SESSIONS: "1",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "browser-sdk-test-client", version: "0.1.0" });
  let sessionId;
  try {
    await client.connect(transport);
    assert.match(client.getInstructions() ?? "", /llms\.txt/);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    for (const name of ["browser_markdown", "browser_extract", "browser_route", "browser_session_start", "browser_session_snapshot", "browser_session_action", "browser_session_screenshot", "browser_session_close"]) {
      assert.ok(names.includes(name), name);
    }
    const route = parseText(await client.callTool({ name: "browser_route", arguments: { operation: "markdown" } }));
    assert.ok(route.providers.some((provider) => provider.name === "local"));

    const started = parseText(await client.callTool({ name: "browser_session_start", arguments: { url: fixtureUrl } }));
    sessionId = started.sessionId;
    assert.equal(started.provider, "local");
    const snapshot = parseText(await client.callTool({ name: "browser_session_snapshot", arguments: { sessionId } }));
    const emailRef = snapshot.refs.find((ref) => ref.role === "textbox" && ref.name === "Email").ref;
    const saveRef = snapshot.refs.find((ref) => ref.role === "button" && ref.name === "Save").ref;
    assert.ok(emailRef);
    assert.ok(saveRef);
    await client.callTool({ name: "browser_session_action", arguments: { sessionId, action: "fill", ref: emailRef, value: "ada@example.com" } });
    await client.callTool({ name: "browser_session_action", arguments: { sessionId, action: "click", ref: saveRef } });
    const read = parseText(await client.callTool({ name: "browser_session_read", arguments: { sessionId, selector: "#status" } }));
    assert.equal(read.text, "ada@example.com");
    const screenshot = await client.callTool({ name: "browser_session_screenshot", arguments: { sessionId, fullPage: true } });
    assert.equal(screenshot.content[0].type, "image");
    assert.deepEqual([...Buffer.from(screenshot.content[0].data, "base64").subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    const closed = parseText(await client.callTool({ name: "browser_session_close", arguments: { sessionId } }));
    assert.equal(closed.closed, true);
    sessionId = undefined;
  } finally {
    if (sessionId) await client.callTool({ name: "browser_session_close", arguments: { sessionId } }).catch(() => undefined);
    await client.close();
  }
});
