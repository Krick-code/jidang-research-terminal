import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { riskProfiles, users } from "@/db/schema";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  const [profile] = await getDb().select().from(riskProfiles).where(eq(riskProfiles.userId, user.id)).orderBy(desc(riskProfiles.version)).limit(1);
  return Response.json({ profile: profile ?? null });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const routine = Number(body.routineRiskPct);
  const absolute = Number(body.absoluteRiskPct);
  const drawdown = Number(body.maxDrawdownPct);
  if (!(routine > 0 && routine <= absolute && absolute <= drawdown && drawdown <= 50) || body.acceptedDisclaimer !== true) return Response.json({ error: "风险参数不一致或尚未确认风险提示" }, { status: 400 });
  const db = getDb();
  const [latest] = await db.select({ version: riskProfiles.version }).from(riskProfiles).where(eq(riskProfiles.userId, user.id)).orderBy(desc(riskProfiles.version)).limit(1);
  const version = (latest?.version ?? 0) + 1;
  await db.insert(riskProfiles).values({ id: crypto.randomUUID(), userId: user.id, version, capitalBand: String(body.capitalBand ?? ""), monthlyContribution: Number(body.monthlyContribution ?? 0), experience: String(body.experience ?? ""), objective: String(body.objective ?? ""), stockHorizon: String(body.stockHorizon ?? "1—2周"), fundHorizon: String(body.fundHorizon ?? "3—12个月"), routineRiskPct: routine, absoluteRiskPct: absolute, maxDrawdownPct: drawdown, preferredAssets: String(body.preferredAssets ?? "A股模拟,公募基金"), excludedScope: String(body.excludedScope ?? ""), currentHoldings: JSON.stringify(Array.isArray(body.currentHoldings) ? body.currentHoldings : []), fundLedgerEnabled: body.fundLedgerEnabled !== false, stockLedgerEnabled: body.stockLedgerEnabled !== false, acceptedDisclaimer: true, createdAt: new Date().toISOString() });
  await db.update(users).set({ onboardingComplete: true }).where(eq(users.id, user.id));
  return Response.json({ ok: true, version }, { status: 201 });
}
