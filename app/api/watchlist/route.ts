import { desc, and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { watchlist } from "@/db/schema";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  const rows = await getDb().select().from(watchlist).where(eq(watchlist.userId, user.id)).orderBy(desc(watchlist.createdAt));
  return Response.json({ items: rows });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  const body = await request.json() as { symbol?: string; assetType?: "stock" | "fund" | "etf"; note?: string };
  const symbol = body.symbol?.trim().toUpperCase() ?? "";
  if (!/^[0-9]{6}(?:\.(?:SH|SZ))?$/.test(symbol) || !["stock", "fund", "etf"].includes(body.assetType ?? "")) {
    return Response.json({ error: "证券代码或资产类型无效" }, { status: 400 });
  }
  const id = crypto.randomUUID();
  await getDb().insert(watchlist).values({ id, userId: user.id, symbol, assetType: body.assetType!, note: body.note?.slice(0, 500) ?? "", createdAt: new Date().toISOString() }).onConflictDoNothing();
  return Response.json({ ok: true, id }, { status: 201 });
}

export async function DELETE(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  await getDb().delete(watchlist).where(and(eq(watchlist.id, id), eq(watchlist.userId, user.id)));
  return Response.json({ ok: true });
}
