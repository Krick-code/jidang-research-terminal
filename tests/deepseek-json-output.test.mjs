import assert from "node:assert/strict";
import test from "node:test";
import { parseJsonOutput } from "../lib/ai/json-output.ts";

test("accepts strict JSON", () => {
  assert.deepEqual(parseJsonOutput('{"ok":true}', "stop"), { ok: true, value: { ok: true } });
});

test("safely unwraps a JSON code fence or short preamble", () => {
  assert.deepEqual(parseJsonOutput('```json\n{"ok":true}\n```', "stop"), { ok: true, value: { ok: true } });
  assert.deepEqual(parseJsonOutput('结果如下：\n{"ok":true}\n以上。', "stop"), { ok: true, value: { ok: true } });
});

test("does not guess a truncated JSON object", () => {
  assert.deepEqual(parseJsonOutput('{"candidates":[{"symbol":"000001"}', "length"), { ok: false, reason: "truncated" });
});

test("rejects non-JSON prose", () => {
  assert.deepEqual(parseJsonOutput('这不是JSON', "stop"), { ok: false, reason: "invalid" });
});
