import { NextRequest } from "next/server";
import { eq, and, desc, gt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { otps, users } from "@/lib/db/schema";
import { generateULID } from "@/lib/ulid";
import { createSession } from "@/lib/auth";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const { email, code } = await request.json();

    if (!email || !code) {
      return Response.json({ error: "Email and code are required" }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase();

    // Find the most recent OTP for this email
    const [otpRecord] = await db
      .select()
      .from(otps)
      .where(
        and(
          eq(otps.email, normalizedEmail),
          gt(otps.expiresAt, new Date()) // Check expiration directly in query
        )
      )
      .orderBy(desc(otps.createdAt))
      .limit(1);

    if (!otpRecord) {
      return Response.json({ error: "OTP expired or not found" }, { status: 400 });
    }

    if (otpRecord.code !== code) {
      return Response.json({ error: "Invalid OTP code" }, { status: 400 });
    }

    // OTP is valid. Delete it to prevent reuse
    await db.delete(otps).where(eq(otps.id, otpRecord.id));

    // Find or create user
    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (!user) {
      [user] = await db
        .insert(users)
        .values({
          id: generateULID(),
          email: normalizedEmail,
        })
        .returning();
    }

    // Create session cookie
    await createSession(user.id);

    return Response.json({ 
      success: true, 
      user: { id: user.id, email: user.email } 
    });

  } catch (error) {
    console.error("[verify-otp] Server error:", error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
