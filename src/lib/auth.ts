import { cookies } from "next/headers";
import { eq, and, gt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sessions, users } from "@/lib/db/schema";
import { generateULID } from "@/lib/ulid";

const SESSION_COOKIE_NAME = "growth_saarthi_session";

// 30 days session expiration
const SESSION_EXPIRATION_MS = 1000 * 60 * 60 * 24 * 30;

export async function createSession(userId: string) {
  const sessionId = generateULID();
  const expiresAt = new Date(Date.now() + SESSION_EXPIRATION_MS);

  // Store in DB
  await db.insert(sessions).values({
    id: sessionId,
    userId,
    expiresAt,
  });

  // Set cookie
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

export async function getSession() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionId) {
    return null;
  }

  // Look up the session in the database
  const [sessionRecord] = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.id, sessionId),
        gt(sessions.expiresAt, new Date()) // Ensure it's not expired
      )
    )
    .limit(1);

  if (!sessionRecord) {
    // Optionally clear the invalid cookie
    return null;
  }

  return sessionRecord.user;
}

export async function clearSession() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (sessionId) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}
