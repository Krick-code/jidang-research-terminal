import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = (path) => readFileSync(resolve(path), "utf8");

test("private routes bind reads and writes to the authenticated user", () => {
  const watchlist = source("app/api/watchlist/route.ts");
  const ledger = source("app/api/ledger/route.ts");
  const profile = source("app/api/profile/route.ts");
  assert.match(watchlist, /eq\(watchlist\.userId, user\.id\)/);
  assert.match(watchlist, /and\(eq\(watchlist\.id, id\), eq\(watchlist\.userId, user\.id\)\)/);
  assert.match(ledger, /eq\(ledgerEntries\.userId, user\.id\)/);
  assert.match(profile, /eq\(riskProfiles\.userId, user\.id\)/);
  assert.doesNotMatch(watchlist, /userId:\s*body\./);
  assert.doesNotMatch(ledger, /userId:\s*body\./);
});

test("historical market calculations require an authenticated session", () => {
  const history = source("app/api/market/history/route.ts");
  assert.match(history, /getAuthenticatedUser\(request\)/);
  assert.match(history, /if \(!user\).*401/);
  assert.match(history, /\["stock", "fund", "etf"\]\.includes\(assetType\)/);
});

test("fundamental evidence requires authentication and a typed asset", () => {
  const fundamentals = source("app/api/market/fundamentals/route.ts");
  assert.match(fundamentals, /getAuthenticatedUser\(request\)/);
  assert.match(fundamentals, /if \(!user\).*401/);
  assert.match(fundamentals, /\["stock", "fund", "etf"\]\.includes\(assetType\)/);
});

test("news, policy and valuation evidence requires authentication and typed parameters", () => {
  const context = source("app/api/market/context/route.ts");
  assert.match(context, /getAuthenticatedUser\(request\)/);
  assert.match(context, /if \(!user\).*401/);
  assert.match(context, /name\.length < 2/);
  assert.match(context, /\["stock", "fund", "etf"\]\.includes\(assetType\)/);
});

test("personal reports require authentication and never accept a client-supplied user id", () => {
  const reports = source("app/api/reports/route.ts");
  assert.match(reports, /getAuthenticatedUser\(request\)/);
  assert.match(reports, /eq\(reports\.userId, user\.id\)/);
  assert.match(reports, /runManualPersonalReport\(user\.id\)/);
  assert.doesNotMatch(reports, /body\.userId/);
});

test("DeepSeek analysis is server-authenticated and cannot override deterministic report fields", () => {
  const route = source("app/api/ai/analyze/route.ts");
  const narrative = source("lib/ai/report-narrative.ts");
  assert.match(route, /getAuthenticatedUser\(request\)/);
  assert.match(route, /runDeepSeekEvidenceAnalysis/);
  assert.match(narrative, /ai_may_change_score_or_eligibility:\s*false/);
  assert.match(narrative, /DeepSeek只解释程序结果/);
});

test("authentication is invite-only and cookies are server-protected", () => {
  const auth = source("lib/auth.ts");
  const login = source("app/api/auth/login/route.ts");
  assert.match(auth, /HttpOnly; SameSite=Strict/);
  assert.match(auth, /PBKDF2/);
  assert.match(login, /failedCount >= 5/);
  assert.equal(existsSync(resolve("app/api/auth/register/route.ts")), false);
});

test("non-personalized example allocation totals exactly 100 percent", () => {
  const terminal = source("app/research-terminal.tsx");
  const portfolio = terminal.slice(terminal.indexOf("function Portfolio"), terminal.indexOf("function Ledger"));
  const allocations = [...portfolio.matchAll(/<span>(?:现金及货币基金|宽基指数基金|主动与行业基金|A股模拟仓位)<\/span><b>(\d+)%/g)].map((match) => Number(match[1]));
  assert.deepEqual(allocations, [40, 35, 15, 10]);
  assert.equal(allocations.reduce((sum, value) => sum + value, 0), 100);
});
