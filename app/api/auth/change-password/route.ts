import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getAuthenticatedUser, hashPassword, verifyPassword } from "@/lib/auth";

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  const body = await request.json() as { currentPassword?: string; newPassword?: string };
  if ((body.newPassword ?? "").length < 10) return Response.json({ error: "新密码至少10位" }, { status: 400 });
  const [stored] = await getDb().select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id)).limit(1);
  if (!stored || !(await verifyPassword(body.currentPassword ?? "", stored.passwordHash))) return Response.json({ error: "当前密码错误" }, { status: 401 });
  await getDb().update(users).set({ passwordHash: await hashPassword(body.newPassword!), mustChangePassword: false }).where(eq(users.id, user.id));
  return Response.json({ ok: true });
}
