import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { loginAttempts, users } from "@/db/schema";
import { createSession, sessionCookie, verifyPassword } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json() as { username?: string; password?: string };
  const username = body.username?.trim().toLowerCase() ?? "";
  const db = getDb();
  const [attempt] = await db.select().from(loginAttempts).where(eq(loginAttempts.username, username)).limit(1);
  const now = new Date();
  if (attempt?.lockedUntil && new Date(attempt.lockedUntil) > now) return Response.json({ error: "登录失败次数过多，请15分钟后重试" }, { status: 429 });
  const rows = await db.select().from(users).where(eq(users.username, username)).limit(1);
  const user = rows[0];
  if (!user || user.status !== "active" || !(await verifyPassword(body.password ?? "", user.passwordHash))) {
    const withinWindow = attempt && now.getTime() - new Date(attempt.windowStartedAt).getTime() < 15 * 60 * 1000;
    const failedCount = withinWindow ? attempt.failedCount + 1 : 1;
    const record = { username, failedCount, windowStartedAt: withinWindow ? attempt.windowStartedAt : now.toISOString(), lockedUntil: failedCount >= 5 ? new Date(now.getTime() + 15 * 60 * 1000).toISOString() : null };
    await db.insert(loginAttempts).values(record).onConflictDoUpdate({ target: loginAttempts.username, set: record });
    return Response.json({ error: "用户名或密码错误" }, { status: 401 });
  }
  await db.delete(loginAttempts).where(eq(loginAttempts.username, username));
  const session = await createSession(user.id);
  return new Response(JSON.stringify({ user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role, onboardingComplete: user.onboardingComplete, mustChangePassword: user.mustChangePassword } }), { headers: { "content-type": "application/json", "set-cookie": sessionCookie(session.token, session.expires, new URL(request.url).protocol === "https:") } });
}
