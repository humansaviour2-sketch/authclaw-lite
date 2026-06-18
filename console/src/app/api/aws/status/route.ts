import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { backendFetch, handleApiError } from "@/lib/api-client";
import { sessionStore } from "@/lib/session-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("authclaw_session")?.value;
    if (!sessionToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const payload = JSON.parse(sessionToken);
    if (!sessionStore.getSession(payload.sessionId)) {
      return NextResponse.json({ error: "Session expired" }, { status: 401 });
    }
    const data = await backendFetch("/v1/aws/status");
    return NextResponse.json(data);
  } catch (error: any) {
    return handleApiError(error);
  }
}
