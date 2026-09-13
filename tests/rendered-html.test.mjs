import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL(`../dist/server/index.js?test=${process.pid}-${Date.now()}`, import.meta.url);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, DB: { prepare() { throw new Error("D1 should not be required to render the public shell"); } } }, { waitUntil() {}, passThroughOnException() {} });
}

test("renders the authenticated 激荡 application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>激荡｜A股与公募基金研究终端<\/title>/);
  assert.match(html, /正在核验本地会话/);
  assert.match(html, /股票与基金研究终端/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/);
});
