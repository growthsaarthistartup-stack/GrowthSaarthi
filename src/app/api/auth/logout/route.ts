import { NextRequest } from "next/server";
import { clearSession } from "@/lib/auth";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    await clearSession();
    return Response.json({ success: true });
  } catch (error) {
    console.error("[logout] Server error:", error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
