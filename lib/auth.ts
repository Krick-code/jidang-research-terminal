import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";

const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string) {
  return new Uint8Array(hex.match(/.{1,2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
}

export async function hashPassword(password: string, saltHex?: string) {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 210_000 }, key, 256);
  return `pbkdf2-sha256$210000$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [, , salt, expected] = stored.split("$");
  if (!salt || !expected) return false;
  const actual = await hashPassword(password, salt);
  return timingSafeEqual(actual, stored);
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}

async function sha256(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(hash));
}

export async function createSession(userId: string) {
  const token = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date();
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  await getDb().insert(sessions).values({ id: crypto.randomUUID(), userId, tokenHash: await sha256(token), createdAt: now.toISOString(), expiresAt: expires.toISOString() });
  return { token, expires };
}

export function sessionCookie(token: string, expires: Date, secure = true) {
  return `jidang_session=${token}; Path=/; HttpOnly; SameSite=Strict; ${secure ? "Secure; " : ""}Expires=${expires.toUTCString()}`;
}

export async function getAuthenticatedUser(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const token = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("jidang_session="))?.slice("jidang_session=".length);
  if (!token) return null;
  const now = new Date().toISOString();
  const rows = await getDb().select({ id: users.id, username: users.username, displayName: users.displayName, role: users.role, onboardingComplete: users.onboardingComplete, mustChangePassword: users.mustChangePassword }).from(sessions).innerJoin(users, eq(sessions.userId, users.id)).where(and(eq(sessions.tokenHash, await sha256(token)), gt(sessions.expiresAt, now), eq(users.status, "active"))).limit(1);
  return rows[0] ?? null;
}
