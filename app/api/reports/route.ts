import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { reports } from "@/db/schema";
import { getAuthenticatedUser } from "@/lib/auth";
import type { PersonalResearchReport } from "@/lib/report-engine";
import { runManualPersonalReport } from "@/lib/tasks";

function parsePayload(raw: string) {
  try { return JSON.parse(raw) as PersonalResearchReport; }
  catch { return null; }
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  const [row] = await getDb().select().from(reports).where(and(eq(reports.userId, user.id), eq(reports.reportType, "daily_personal"))).orderBy(desc(reports.generatedAt)).limit(1);
  if (!row) return Response.json({ report: null });
  const payload = parsePayload(row.payloadJson);
  if (!payload || payload.schemaVersion !== 1) return Response.json({ error: "最新报告格式无法识别" }, { status: 500 });
  return Response.json({
    report: {
      id: row.id,
      version: row.version,
      status: row.status,
      integrityHash: row.integrityHash,
      lockedAt: row.lockedAt,
      payload,
    },
  });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  if (!user.onboardingComplete) return Response.json({ error: "请先完成独立风险画像" }, { status: 409 });
  try {
    const result = await runManualPersonalReport(user.id);
    return Response.json({ report: { id: result.id, version: result.version, status: result.status, integrityHash: result.integrityHash, payload: result.payload }, calendar: result.calendar }, { status: 201 });
  } catch (error) {
    return Response.json({ error: `生成失败：${error instanceof Error ? error.message : "unknown"}` }, { status: 503 });
  }
}
