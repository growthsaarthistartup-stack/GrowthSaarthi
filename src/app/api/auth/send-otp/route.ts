import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { otps } from "@/lib/db/schema";
import { generateULID } from "@/lib/ulid";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const { email } = await request.json();

    if (!email || !email.includes("@")) {
      return Response.json({ error: "Valid email is required" }, { status: 400 });
    }

    // Generate a 6-digit OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Expires in 10 minutes
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Save to database
    await db.insert(otps).values({
      id: generateULID(),
      email: email.toLowerCase(),
      code,
      expiresAt,
    });

    // Always log OTP to server console for debugging/testing
    console.log(`\n========================================`);
    console.log(`[GrowthSaarthi OTP] Email: ${email}`);
    console.log(`[GrowthSaarthi OTP] Code: ${code}`);
    console.log(`[GrowthSaarthi OTP] Expires: ${expiresAt.toISOString()}`);
    console.log(`========================================\n`);

    // Send email using Resend
    const resendApiKey = process.env.RESEND_API_KEY;
    if (resendApiKey) {
      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f9fa; margin: 0; padding: 40px 20px;">
          <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
            <div style="background: linear-gradient(135deg, #199874 0%, #0d6b52 100%); padding: 32px; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">GrowthSaarthi</h1>
              <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">Your AI Growth Copilot</p>
            </div>
            <div style="padding: 40px 32px;">
              <h2 style="margin: 0 0 8px; color: #1a1a1a; font-size: 20px; font-weight: 700;">Your Login Code</h2>
              <p style="margin: 0 0 28px; color: #6b7280; font-size: 15px;">Use this one-time code to sign in to your GrowthSaarthi account.</p>
              
              <div style="background: #f0fdf8; border: 2px solid #199874; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 28px;">
                <span style="font-size: 42px; font-weight: 900; letter-spacing: 12px; color: #199874; font-family: 'Courier New', monospace;">${code}</span>
              </div>
              
              <p style="margin: 0; color: #9ca3af; font-size: 13px; text-align: center;">
                This code expires in <strong>10 minutes</strong>. Do not share it with anyone.
              </p>
            </div>
            <div style="background: #f8f9fa; padding: 20px 32px; text-align: center;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                If you didn&apos;t request this, you can safely ignore this email.
              </p>
            </div>
          </div>
        </body>
        </html>
      `;

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "GrowthSaarthi <onboarding@resend.dev>",
          to: [email],
          subject: `${code} — Your GrowthSaarthi Login Code`,
          html: emailHtml,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({})) as { message?: string; name?: string };
        const errMsg = errorData?.message ?? "Unknown Resend error";
        console.warn(`[send-otp] Resend API error (${res.status}): ${errMsg}`);
        
        // Resend free tier only allows sending to verified email addresses.
        // The OTP is logged above for development. In production add a custom domain.
        if (errMsg.includes("testing email") || errMsg.includes("verified") || errMsg.includes("domain")) {
          console.warn("[send-otp] Resend free tier restriction: OTP is in the server logs above.");
        }
      } else {
        const data = await res.json() as { id?: string };
        console.log(`[send-otp] Email sent via Resend, id=${data.id}`);
      }
    }

    return Response.json({ 
      success: true, 
      message: "OTP sent to your email. Check your inbox.",
      // In dev mode, also return the code so the user can test without email
      ...(process.env.NODE_ENV === "development" ? { devCode: code } : {}),
    });
  } catch (error) {
    console.error("[send-otp] Server error:", error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
