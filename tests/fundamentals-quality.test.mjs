import assert from "node:assert/strict";
import test from "node:test";
import { parseFundHoldings } from "../lib/providers/fundamentals.ts";

const fixture = `
<label>来源：样本 截止至：<font class='px12'>2026-06-30</font></label>
<table><tbody>
<tr><td>1</td><td><a>600001</a></td><td class='tol'><a>样本一</a></td><td></td><td></td><td>详情</td><td>6.45%</td><td>20.00</td><td>25,400.00</td></tr>
<tr><td>2</td><td><a>000002</a></td><td class='tol'><a>样本二</a></td><td></td><td></td><td>详情</td><td>5.57%</td><td>65.20</td><td>21,927.20</td></tr>
</tbody></table>`;

test("parses the latest disclosed fund holdings at one-row-per-security grain", () => {
  const parsed = parseFundHoldings(fixture);
  assert.equal(parsed.cutoff, "2026-06-30");
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rows[0], { rank: 1, code: "600001", name: "样本一", navPercent: 6.45, sharesWan: 20, marketValueWan: 25400 });
  assert.equal(parsed.rows.reduce((sum, row) => sum + row.navPercent, 0), 12.02);
});
test("rejects malformed holdings instead of guessing shifted columns", () => {
  const parsed = parseFundHoldings("<tbody><tr><td>bad</td><td>not-a-code</td></tr></tbody>");
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.cutoff, null);
});
