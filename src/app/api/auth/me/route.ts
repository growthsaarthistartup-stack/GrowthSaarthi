import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const user = await getSession();

    if (!user) {
      return Response.json({ user: null });
    }

    return Response.json({ 
      user: { id: user.id, email: user.email } 
    });

  } catch (error) {
    console.error("[me] Server error:", error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
