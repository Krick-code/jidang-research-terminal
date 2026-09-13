import assert from "node:assert/strict";
import test from "node:test";
import { collectReportEvidence } from "../lib/ai/report-narrative.ts";

function candidate(symbol, evidenceRefs) {
  return { symbol, evidenceRefs };
}

test("one report-level DeepSeek call keeps at least one evidence item per candidate before extras", () => {
  const report = {
    candidates: [
      candidate("600001.SH", [{ id: "a1" }, { id: "a2" }, { id: "a3" }]),
      candidate("000001", [{ id: "b1" }, { id: "b2" }]),
      candidate("000002", [{ id: "c1" }]),
    ],
  };
  const evidence = collectReportEvidence(report, 4);
  assert.deepEqual(evidence.map((item) => item.id), ["a1", "b1", "c1", "a2"]);
});

test("duplicate evidence ids are removed before sending data to DeepSeek", () => {
  const report = { candidates: [candidate("600001.SH", [{ id: "shared" }]), candidate("000001", [{ id: "shared" }, { id: "fund" }])] };
  assert.deepEqual(collectReportEvidence(report).map((item) => item.id), ["shared", "fund"]);
});
