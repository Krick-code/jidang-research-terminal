import { getDb } from "@/db";
import { users } from "@/db/schema";
import { createSession, hashPassword, sessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  const db = getDb();
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length) return Response.json({ error: "系统已经初始化" }, { status: 409 });
  const body = await request.json() as { username?: string; password?: string; displayName?: string };
  const username = body.username?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  const displayName = body.displayName?.trim() ?? "";
  if (!/^[a-z0-9_]{3,24}$/.test(username) || password.length < 10 || !displayName) return Response.json({ error: "用户名需为3—24位字母数字下划线，密码至少10位" }, { status: 400 });
  const userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, username, displayName, passwordHash: await hashPassword(password), role: "admin", status: "active", mustChangePassword: false, onboardingComplete: false, createdAt: new Date().toISOString() });
  const session = await createSession(userId);
  return new Response(JSON.stringify({ user: { id: userId, username, displayName, role: "admin", onboardingComplete: false, mustChangePassword: false } }), { status: 201, headers: { "content-type": "application/json", "set-cookie": sessionCookie(session.token, session.expires, new URL(request.url).protocol === "https:") } });
}
