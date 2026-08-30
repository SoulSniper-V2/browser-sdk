import test from "node:test";
import assert from "node:assert/strict";
import { anchor } from "../dist/providers/anchor.js";
import { browserbase } from "../dist/providers/browserbase.js";
import { browserUse } from "../dist/providers/browser-use.js";
import { cloudflare } from "../dist/providers/cloudflare.js";
import { browserless } from "../dist/providers/browserless.js";
import { hyperbrowser } from "../dist/providers/hyperbrowser.js";
import { steel } from "../dist/providers/steel.js";

function context(fetchFn) {
  return { fetch: fetchFn, requestId: "test-request", logger: {} };
}

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
}

test("Browserbase maps session creation and releases with REQUEST_RELEASE", async () => {
  const calls = [];
  const provider = browserbase({ apiKey: "bb_test", projectId: "project_test", baseUrl: "https://bb.test" });
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (String(url).endsWith("/v1/sessions")) return jsonResponse({ id: "session_1", status: "RUNNING", connectUrl: "wss://connect.test/session_1" }, 201);
    return jsonResponse({ id: "session_1", status: "COMPLETED" });
  };
  const session = await provider.createSession({ timeoutMs: 60_000, keepAlive: true }, context(fetchFn));
  await provider.closeSession("session_1", context(fetchFn));
  const body = JSON.parse(calls[0].init.body);
  assert.equal(session.id, "session_1");
  assert.equal(body.timeout, 60);
  assert.equal(body.keepAlive, true);
  assert.equal(JSON.parse(calls[1].init.body).status, "REQUEST_RELEASE");
});

test("Browserbase Fetch stays aligned with the raw Fetch API", async () => {
  let body;
  const provider = browserbase({ apiKey: "bb_test", baseUrl: "https://bb.test" });
  const result = await provider.content("https://example.com", {}, context(async (_url, init) => {
    body = JSON.parse(init.body);
    return jsonResponse({ content: "<h1>Raw</h1>", statusCode: 200, contentType: "text/html" });
  }));
  assert.equal(result.content, "<h1>Raw</h1>");
  assert.equal("format" in body, false);
  assert.equal(body.allowRedirects, true);
});

test("Cloudflare Browser Run maps Quick Action JSON and CDP URLs", async () => {
  const calls = [];
  const provider = cloudflare({ apiToken: "cf_test", accountId: "account_test" });
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (String(url).endsWith("/devtools/browser?keep_alive=120000")) return jsonResponse({ sessionId: "cf_session", webSocketDebuggerUrl: "wss://cf.test/session" });
    return jsonResponse({ success: true, result: "# Rendered page" });
  };
  const session = await provider.createSession({ keepAliveMs: 120_000 }, context(fetchFn));
  const result = await provider.markdown("https://example.com", {}, context(fetchFn));
  assert.equal(session.id, "cf_session");
  assert.equal(session.connectUrl, "wss://cf.test/session");
  assert.equal(result.markdown, "# Rendered page");
  assert.equal(calls[0].init.headers.Authorization, "Bearer cf_test");
  assert.equal(calls[1].url.endsWith("/markdown"), true);
});

test("Cloudflare Browser Run lists and closes real DevTools sessions", async () => {
  const calls = [];
  const provider = cloudflare({ apiToken: "cf_test", accountId: "account_test", baseUrl: "https://cf.test/client/v4" });
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (init.method === "DELETE") return jsonResponse({ status: "closing" });
    if (String(url).includes("/devtools/session?")) return jsonResponse([{ sessionId: "cf_session", startTime: 1_700_000_000_000 }]);
    return jsonResponse({ sessionId: "cf_session", startTime: 1_700_000_000_000, webSocketDebuggerUrl: "wss://cf.test/session" });
  };
  const session = await provider.getSession("cf_session", context(fetchFn));
  const listed = await provider.listSessions({ limit: 10 }, context(fetchFn));
  await provider.closeSession(session.id, context(fetchFn));
  assert.equal(session.status, "running");
  assert.equal(listed[0].id, "cf_session");
  assert.equal(calls[2].init.method, "DELETE");
  assert.equal(calls[2].url.endsWith("/devtools/browser/cf_session"), true);
});

test("Cloudflare screenshot uses the documented format value", async () => {
  let body;
  const provider = cloudflare({ apiToken: "cf_test", accountId: "account_test" });
  const result = await provider.screenshot("https://example.com", { format: "png" }, context(async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { "content-type": "image/png" } });
  }));
  assert.equal(body.screenshotOptions.type, "png");
  assert.deepEqual([...result.data], [0x89, 0x50, 0x4e, 0x47]);
});

test("Cloudflare crawl follows the asynchronous job contract", async () => {
  const calls = [];
  let polls = 0;
  const provider = cloudflare({ apiToken: "cf_test", accountId: "account_test" });
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (init.method === "POST") return jsonResponse({ success: true, result: "crawl_1" });
    if (String(url).includes("limit=1")) {
      polls += 1;
      return jsonResponse({ success: true, result: { id: "crawl_1", status: polls === 1 ? "running" : "completed" } });
    }
    return jsonResponse({ success: true, result: { id: "crawl_1", status: "completed", total: 1, finished: 1, records: [{ url: "https://example.com", status: "completed", markdown: "# Example" }] } });
  };
  const result = await provider.crawl("https://example.com", { limit: 4, depth: 2, includePatterns: ["**/docs/**"], excludePatterns: ["**/drafts/**"], formats: ["markdown"], pollIntervalMs: 250 }, context(fetchFn));
  const body = JSON.parse(calls[0].init.body);
  assert.equal(result.jobId, "crawl_1");
  assert.equal(result.records[0].markdown, "# Example");
  assert.equal(body.limit, 4);
  assert.equal(body.depth, 2);
  assert.deepEqual(body.options.includePatterns, ["**/docs/**"]);
  assert.deepEqual(body.options.excludePatterns, ["**/drafts/**"]);
  assert.equal(calls.length, 4);
});

test("Browserless creates a real REST session and releases its stop URL", async () => {
  const calls = [];
  const provider = browserless({ token: "bl_test" });
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (String(url).includes("/session?token=")) {
      return jsonResponse({ id: "bl_session", connect: "wss://browserless.test/chromium?session=bl_session", stop: "https://browserless.test/session/bl_session?token=bl_test" });
    }
    return new Response("<html><title>Example</title><body><h1>Rendered</h1></body></html>", { status: 200, headers: { "content-type": "text/html" } });
  };
  const result = await provider.content("https://example.com", {}, context(fetchFn));
  const session = await provider.createSession({ timeoutMs: 120_000, keepAlive: true, stealth: true }, context(fetchFn));
  await provider.closeSession(session.id, context(fetchFn));
  assert.equal(result.title, "Example");
  assert.equal(session.connectUrl.startsWith("wss://"), true);
  assert.equal(JSON.parse(calls[1].init.body).ttl, 120_000);
  assert.equal(JSON.parse(calls[1].init.body).stealth, true);
  assert.equal(calls[2].init.method, "DELETE");
});

test("Steel maps one-shot markdown responses", async () => {
  const provider = steel({ apiKey: "steel_test", baseUrl: "https://steel.test" });
  const fetchFn = async () => jsonResponse({ content: { markdown: "# Steel" }, metadata: { title: "Steel page" } });
  const result = await provider.markdown("https://example.com", {}, context(fetchFn));
  assert.equal(result.markdown, "# Steel");
  assert.equal(result.title, "Steel page");
});

test("Steel fetches hosted artifacts from the documented endpoints", async () => {
  const calls = [];
  const provider = steel({ apiKey: "steel_test", baseUrl: "https://steel.test" });
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (String(url).endsWith("/v1/screenshot")) return jsonResponse({ url: "https://files.test/page.png" });
    if (String(url).endsWith("/v1/pdf")) return jsonResponse({ url: "https://files.test/page.pdf" });
    if (String(url).endsWith("page.png")) return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { "content-type": "image/png" } });
    return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200, headers: { "content-type": "application/pdf" } });
  };
  const screenshot = await provider.screenshot("https://example.com", { fullPage: true }, context(fetchFn));
  const pdf = await provider.pdf("https://example.com", {}, context(fetchFn));
  assert.deepEqual([...screenshot.data], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(screenshot.format, "png");
  assert.deepEqual([...pdf.data], [0x25, 0x50, 0x44, 0x46]);
  assert.equal(calls[0].url.endsWith("/v1/screenshot"), true);
  assert.equal(JSON.parse(calls[0].init.body).fullPage, true);
  assert.equal(calls[2].url.endsWith("/v1/pdf"), true);
});

test("Anchor maps nested session responses and supported session options", async () => {
  const calls = [];
  const provider = anchor({ apiKey: "anchor_test", baseUrl: "https://anchor.test" });
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (init.method === "DELETE") return jsonResponse({ data: { status: "closed" } });
    if (init.method === "GET") return jsonResponse({ data: { session_id: "anchor_1", status: "active", created_at: "2026-08-30T12:00:00.000Z" } });
    return jsonResponse({ data: { id: "anchor_1", cdp_url: "wss://anchor.test/cdp", live_view_url: "https://anchor.test/live" } });
  };
  const session = await provider.createSession({ timeoutMs: 300_000, keepAliveMs: 60_000, proxy: true, viewport: { width: 1280, height: 800 }, recording: true, stealth: true, headless: true, metadata: { workflow: "test" } }, context(fetchFn));
  const refreshed = await provider.getSession(session.id, context(fetchFn));
  await provider.closeSession(session.id, context(fetchFn));
  const body = JSON.parse(calls[0].init.body);
  assert.equal(session.connectUrl, "wss://anchor.test/cdp");
  assert.equal(session.dashboardUrl, "https://anchor.test/live");
  assert.equal(body.session.timeout.max_duration, 5);
  assert.equal(body.session.timeout.idle_timeout, 1);
  assert.equal(body.session.proxy.type, "anchor_proxy");
  assert.equal(body.browser.extra_stealth.active, true);
  assert.equal(refreshed.status, "running");
  assert.equal(calls[2].init.method, "DELETE");
});

test("Hyperbrowser maps its session lifecycle endpoints", async () => {
  const calls = [];
  const provider = hyperbrowser({ apiKey: "hyper_test", baseUrl: "https://hyper.test" });
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (String(url).includes("/api/sessions")) return jsonResponse({ sessions: [{ id: "hyper_1", status: "active" }], totalCount: 1 });
    if (String(url).endsWith("/stop")) return jsonResponse({ success: true });
    return jsonResponse({ id: "hyper_1", status: "active", wsEndpoint: "wss://hyper.test/cdp", liveUrl: "https://hyper.test/live", launchState: { region: "us-west" } });
  };
  const session = await provider.createSession({ profileId: "profile_1", region: "us-west", timeoutMs: 120_000, proxy: true, viewport: { width: 1024, height: 768 }, recording: true, stealth: true, solveCaptchas: true, allowedDomains: ["example.com"] }, context(fetchFn));
  const listed = await provider.listSessions({ limit: 10 }, context(fetchFn));
  await provider.closeSession(session.id, context(fetchFn));
  const body = JSON.parse(calls[0].init.body);
  assert.equal(session.connectUrl, "wss://hyper.test/cdp");
  assert.equal(body.timeoutMinutes, 2);
  assert.equal(body.profile.id, "profile_1");
  assert.equal(body.allowOut[0], "example.com");
  assert.equal(listed[0].id, "hyper_1");
  assert.equal(calls[2].init.method, "PUT");
});

test("Browser Use maps v3 browser sessions and PATCH stop", async () => {
  const calls = [];
  const provider = browserUse({ apiKey: "bu_test", baseUrl: "https://bu.test/api/v3" });
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (init.method === "PATCH") return jsonResponse({ id: "bu_1", status: "stopped" });
    if (init.method === "GET") return jsonResponse({ items: [{ id: "bu_1", status: "active", startedAt: "2026-08-30T12:00:00.000Z" }], totalItems: 1, pageNumber: 1, pageSize: 10 });
    return jsonResponse({ id: "bu_1", status: "active", cdpUrl: "wss://bu.test/cdp", liveUrl: "https://bu.test/live", timeoutAt: "2026-08-30T13:00:00.000Z" }, 201);
  };
  const session = await provider.createSession({ profileId: "profile_1", region: "gb", timeoutMs: 600_000, proxy: true, viewport: { width: 1280, height: 720 }, recording: true, metadata: { workflow: "test" } }, context(fetchFn));
  const listed = await provider.listSessions({ status: "running", limit: 10 }, context(fetchFn));
  await provider.closeSession(session.id, context(fetchFn));
  const body = JSON.parse(calls[0].init.body);
  assert.equal(session.connectUrl, "wss://bu.test/cdp");
  assert.equal(body.profileId, "profile_1");
  assert.equal(body.proxyCountryCode, "gb");
  assert.equal(body.timeout, 10);
  assert.equal(body.metadata.workflow, "test");
  assert.equal(listed[0].id, "bu_1");
  assert.equal(calls[2].init.method, "PATCH");
});
