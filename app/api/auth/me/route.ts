import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  return user ? Response.json({ user }) : Response.json({ user: null }, { status: 401 });
}
