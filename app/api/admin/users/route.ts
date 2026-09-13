import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getAuthenticatedUser, hashPassword } from "@/lib/auth";

async function requireAdmin(request: Request) {
  const user = await getAuthenticatedUser(request);
  return user?.role === "admin" ? user : null;
}

export async function GET(request: Request) {
  if (!(await requireAdmin(request))) return Response.json({ error: "仅管理员可访问" }, { status: 403 });
  const rows = await getDb().select({
    id: users.id,
    username: users.username,
    displayName: users.displayName,
    role: users.role,
    status: users.status,
    onboardingComplete: users.onboardingComplete,
    mustChangePassword: users.mustChangePassword,
    createdAt: users.createdAt,
  }).from(users).orderBy(asc(users.createdAt));
  return Response.json({ users: rows, limit: 5 });
}

export async function POST(request: Request) {
  if (!(await requireAdmin(request))) return Response.json({ error: "仅管理员可创建账户" }, { status: 403 });
  const db = getDb();
  const current = await db.select({ id: users.id }).from(users).limit(5);
  if (current.length >= 5) return Response.json({ error: "当前版本最多支持5个账户" }, { status: 409 });
  const body = await request.json() as { username?: string; password?: string; displayName?: string; role?: "admin" | "user" };
  const username = body.username?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  const displayName = body.displayName?.trim() ?? "";
  if (!/^[a-z0-9_]{3,24}$/.test(username) || password.length < 10 || !displayName) {
    return Response.json({ error: "用户名需为3至24位字母数字下划线，临时密码至少10位" }, { status: 400 });
  }
  const duplicate = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
  if (duplicate.length) return Response.json({ error: "用户名已存在" }, { status: 409 });
  const id = crypto.randomUUID();
  await db.insert(users).values({
    id,
    username,
    displayName,
    passwordHash: await hashPassword(password),
    role: body.role === "admin" ? "admin" : "user",
    status: "active",
    mustChangePassword: true,
    onboardingComplete: false,
    createdAt: new Date().toISOString(),
  });
  return Response.json({ user: { id, username, displayName, role: body.role === "admin" ? "admin" : "user", onboardingComplete: false, mustChangePassword: true } }, { status: 201 });
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return Response.json({ error: "仅管理员可管理账户" }, { status: 403 });
  const body = await request.json() as { userId?: string; action?: "disable" | "enable" | "reset_password"; temporaryPassword?: string };
  const [target] = await getDb().select({ id: users.id }).from(users).where(eq(users.id, body.userId ?? "")).limit(1);
  if (!target) return Response.json({ error: "账户不存在" }, { status: 404 });
  if (body.action === "disable") {
    if (target.id === admin.id) return Response.json({ error: "不能停用当前登录管理员" }, { status: 400 });
    await getDb().update(users).set({ status: "disabled" }).where(eq(users.id, target.id));
  } else if (body.action === "enable") {
    await getDb().update(users).set({ status: "active" }).where(eq(users.id, target.id));
  } else if (body.action === "reset_password") {
    if ((body.temporaryPassword ?? "").length < 10) return Response.json({ error: "临时密码至少10位" }, { status: 400 });
    await getDb().update(users).set({ passwordHash: await hashPassword(body.temporaryPassword!), mustChangePassword: true }).where(eq(users.id, target.id));
  } else return Response.json({ error: "未知管理动作" }, { status: 400 });
  return Response.json({ ok: true });
}
