import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ledgerEntries } from "@/db/schema";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  const rows = await getDb().select().from(ledgerEntries).where(eq(ledgerEntries.userId, user.id)).orderBy(desc(ledgerEntries.tradeDate), desc(ledgerEntries.createdAt));
  return Response.json({ entries: rows });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const ledgerType = body.ledgerType === "fund_real" ? "fund_real" : body.ledgerType === "stock_sim" ? "stock_sim" : null;
  const side = ["buy", "sell", "subscribe", "redeem", "dividend"].includes(String(body.side)) ? String(body.side) as "buy" | "sell" | "subscribe" | "redeem" | "dividend" : null;
  const symbol = String(body.symbol ?? "").trim().toUpperCase();
  const tradeDate = String(body.tradeDate ?? "");
  const assetName = String(body.assetName ?? "").trim();
  if (!ledgerType || !side || !/^[0-9]{6}(?:\.(?:SH|SZ))?$/.test(symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate) || !assetName) {
    return Response.json({ error: "账本字段不完整或格式无效" }, { status: 400 });
  }
  const numeric = (key: string) => Math.max(0, Number(body[key] ?? 0) || 0);
  const id = crypto.randomUUID();
  await getDb().insert(ledgerEntries).values({
    id,
    userId: user.id,
    ledgerType,
    symbol,
    assetName,
    side,
    tradeDate,
    price: numeric("price"),
    quantity: numeric("quantity"),
    amount: numeric("amount"),
    fees: numeric("fees"),
    thesis: String(body.thesis ?? "").slice(0, 2000),
    invalidation: String(body.invalidation ?? "").slice(0, 1000),
    createdAt: new Date().toISOString(),
  });
  return Response.json({ ok: true, id }, { status: 201 });
}
