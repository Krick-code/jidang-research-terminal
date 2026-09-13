import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { reports, reportSupplements, riskProfiles, taskRuns, users, watchlist as watchlistTable } from "@/db/schema";
import { buildPersonalResearchReport, type PersonalResearchReport, type ReportRiskProfile, type ReportWatchItem } from "@/lib/report-engine";
import { enrichReportWithDeepSeek } from "@/lib/ai/report-narrative";
import { getMarketUniverseSnapshot } from "@/lib/providers/market-universe";
import { resolveAshareTradingDay } from "@/lib/providers/trading-calendar";
import { taskKey } from "@/lib/schedule";

function shanghaiParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function isoDate(parts: Record<string, string>) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function nextShanghaiDate(now: Date) {
  return isoDate(shanghaiParts(new Date(now.getTime() + 24 * 60 * 60 * 1000)));
}

async function resolveTradingDay(date: string) {
  return resolveAshareTradingDay(date);
}

async function nextOpenTradingDate(now: Date) {
  for (let offset = 1; offset <= 10; offset += 1) {
    const date = isoDate(shanghaiParts(new Date(now.getTime() + offset * 24 * 60 * 60 * 1000)));
    const calendar = await resolveTradingDay(date);
    if (calendar.open) return { date, calendar };
  }
  throw new Error("NEXT_TRADING_DAY_NOT_FOUND");
}

async function beginTask(type: string, scheduledFor: string) {
  const key = taskKey(type, scheduledFor);
  const db = getDb();
  const id = crypto.randomUUID();
  const inserted = await db.insert(taskRuns).values({ id, taskKey: key, taskType: type, scheduledFor, startedAt: new Date().toISOString(), status: "running", detail: "" }).onConflictDoNothing().returning({ id: taskRuns.id });
  return inserted[0]?.id ?? null;
}

async function finishTask(id: string, status: string, detail: string) {
  await getDb().update(taskRuns).set({ status, detail, finishedAt: new Date().toISOString() }).where(eq(taskRuns.id, id));
}

function toReportProfile(profile: typeof riskProfiles.$inferSelect): ReportRiskProfile {
  return {
    version: profile.version,
    capitalBand: profile.capitalBand,
    monthlyContribution: profile.monthlyContribution,
    stockHorizon: profile.stockHorizon,
    fundHorizon: profile.fundHorizon,
    routineRiskPct: profile.routineRiskPct,
    absoluteRiskPct: profile.absoluteRiskPct,
    maxDrawdownPct: profile.maxDrawdownPct,
    excludedScope: profile.excludedScope,
  };
}

async function buildReportForUser(userId: string, tradingDate: string, generatedAt: string) {
  const db = getDb();
  const [profile] = await db.select().from(riskProfiles).where(eq(riskProfiles.userId, userId)).orderBy(desc(riskProfiles.version)).limit(1);
  if (!profile) throw new Error("RISK_PROFILE_REQUIRED");
  const watched = await db.select().from(watchlistTable).where(eq(watchlistTable.userId, userId)).orderBy(desc(watchlistTable.createdAt));
  const items: ReportWatchItem[] = watched.map((item) => ({ symbol: item.symbol, assetType: item.assetType, note: item.note }));
  const universe = await getMarketUniverseSnapshot(new Date(generatedAt));
  const deterministicReport = await buildPersonalResearchReport(items, toReportProfile(profile), tradingDate, generatedAt, universe);
  return enrichReportWithDeepSeek(userId, deterministicReport);
}

async function savePersonalReport(userId: string, payload: PersonalResearchReport) {
  const db = getDb();
  const [latest] = await db.select({ version: reports.version }).from(reports).where(and(eq(reports.userId, userId), eq(reports.reportType, "daily_personal"), eq(reports.tradingDate, payload.tradingDate))).orderBy(desc(reports.version)).limit(1);
  const reportStatus = payload.analyzedCount > 0 ? "published" as const : "partial" as const;
  const id = crypto.randomUUID();
  const hash = await integrityHash(payload);
  const version = (latest?.version ?? 0) + 1;
  await db.insert(reports).values({
    id,
    userId,
    reportType: "daily_personal",
    tradingDate: payload.tradingDate,
    generatedAt: payload.generatedAt,
    dataCutoff: payload.generatedAt,
    profileVersion: payload.riskBoundary.profileVersion,
    version,
    status: reportStatus,
    payloadJson: JSON.stringify(payload),
    integrityHash: hash,
    lockedAt: payload.generatedAt,
  });
  return { id, version, status: reportStatus, integrityHash: hash, payload };
}

export async function runManualPersonalReport(userId: string, now = new Date()) {
  const { date, calendar } = await nextOpenTradingDate(now);
  const payload = await buildReportForUser(userId, date, now.toISOString());
  const saved = await savePersonalReport(userId, payload);
  return { ...saved, calendar, manual: true };
}

export async function runEveningReport(now = new Date()) {
  const tradingDate = nextShanghaiDate(now);
  const id = await beginTask("daily-evening", tradingDate);
  if (!id) return { duplicate: true, tradingDate };
  const calendar = await resolveTradingDay(tradingDate);
  if (!calendar.open) { await finishTask(id, "skipped", `次日不是交易日；日历来源：${calendar.source}`); return { skipped: true, tradingDate, calendar }; }
  const db = getDb();
  const generatedAt = now.toISOString();
  const status = calendar.confidence === "confirmed" ? "published" : "partial";
  const publicPayload = { title: `${tradingDate} 交易日前夜公共状态报告`, candidates: [], conclusion: "公共报告不读取任何用户自选；真实候选只写入各用户隔离的个人报告。", calendarSource: calendar.source, evidenceState: "public-boundary" };
  await db.insert(reports).values({ id: crypto.randomUUID(), userId: null, reportType: "daily_public", tradingDate, generatedAt, dataCutoff: generatedAt, version: 1, status, payloadJson: JSON.stringify(publicPayload), integrityHash: await integrityHash(publicPayload), lockedAt: generatedAt });
  const activeUsers = await db.select({ id: users.id, complete: users.onboardingComplete }).from(users).where(and(eq(users.status, "active"), eq(users.onboardingComplete, true)));
  let completeReports = 0;
  let partialReports = 0;
  for (const user of activeUsers) {
    try {
      const payload = await buildReportForUser(user.id, tradingDate, generatedAt);
      const saved = await savePersonalReport(user.id, payload);
      if (saved.status === "published") completeReports += 1;
      else partialReports += 1;
    } catch {
      partialReports += 1;
    }
  }
  const taskStatus = status === "published" && partialReports === 0 ? "success" : "partial";
  await finishTask(id, taskStatus, `已生成公共边界报告、${completeReports}份完整个人报告和${partialReports}份缺失/失败个人报告；日历来源：${calendar.source}`);
  return { tradingDate, status: taskStatus, users: activeUsers.length, completeReports, partialReports, calendar };
}

export async function runPreopenSupplement(now = new Date()) {
  const date = isoDate(shanghaiParts(now));
  const id = await beginTask("preopen", date);
  if (!id) return { duplicate: true, tradingDate: date };
  const db = getDb();
  const [report] = await db.select().from(reports).where(and(eq(reports.reportType, "daily_public"), eq(reports.tradingDate, date))).orderBy(desc(reports.generatedAt)).limit(1);
  if (!report) { await finishTask(id, "skipped", "没有找到前一晚报告"); return { skipped: true, reason: "missing-evening-report" }; }
  await db.insert(reportSupplements).values({ id: crypto.randomUUID(), reportId: report.id, status: "维持原判断", content: "新增公告与新闻Provider未配置，无法完成真实盘前核验；原报告保持锁定。", createdAt: now.toISOString() });
  await finishTask(id, "partial", "已追加降级说明，未覆盖原报告");
  return { tradingDate: date, status: "partial", lockedReport: report.id };
}

export async function runWeeklyReview(now = new Date()) {
  const date = isoDate(shanghaiParts(now));
  const id = await beginTask("weekly-review", date);
  if (!id) return { duplicate: true, date };
  const payload = { title: `${date} 周度复盘`, sampleCount: 0, conclusion: "尚无连续一周的锁定候选样本，不计算胜率。", failuresRetained: true };
  await getDb().insert(reports).values({ id: crypto.randomUUID(), userId: null, reportType: "weekly", tradingDate: date, generatedAt: now.toISOString(), dataCutoff: now.toISOString(), version: 1, status: "partial", payloadJson: JSON.stringify(payload), integrityHash: await integrityHash(payload), lockedAt: now.toISOString() });
  await finishTask(id, "partial", "样本不足，已保留空复盘而未编造绩效");
  return { date, status: "partial" };
}

async function integrityHash(payload: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
