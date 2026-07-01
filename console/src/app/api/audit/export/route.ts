import { NextRequest, NextResponse } from "next/server";
import { backendFetch, handleApiError } from "@/lib/api-client";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const data = await backendFetch("/v1/audit-logs/export", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return NextResponse.json(data);
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
