import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { backendFetch, handleApiError } from "@/lib/api-client";
import { sessionStore } from "@/lib/session-store";

export const dynamic = "force-dynamic";

// GET /api/aws/s3 → GET /v1/aws/s3/documents (list synced documents from Postgres)
export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("authclaw_session")?.value;
    if (!sessionToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const payload = JSON.parse(sessionToken);
    if (!sessionStore.getSession(payload.sessionId)) {
      return NextResponse.json({ error: "Session expired" }, { status: 401 });
    }
    const data = await backendFetch("/v1/aws/s3/documents");
    return NextResponse.json(data);
  } catch (error: any) {
    return handleApiError(error);
  }
}

// POST /api/aws/s3 → POST /v1/aws/s3/sync (trigger S3 metadata sync)
export async function POST() {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("authclaw_session")?.value;
    if (!sessionToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const payload = JSON.parse(sessionToken);
    if (!sessionStore.getSession(payload.sessionId)) {
      return NextResponse.json({ error: "Session expired" }, { status: 401 });
    }
    const data = await backendFetch("/v1/aws/s3/sync", { method: "POST" });
    return NextResponse.json(data);
  } catch (error: any) {
    return handleApiError(error);
  }
}
