import { NextResponse } from "next/server";
import { backendFetch, handleApiError } from "@/lib/api-client";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get("limit") || "100";
    const offset = searchParams.get("offset") || "0";
    const action = searchParams.get("action");
    const integrityCheck = searchParams.get("integrity_check") || "false";

    const params: Record<string, string> = {
      limit,
      offset,
      integrity_check: integrityCheck,
    };
    if (action) {
      params.action = action;
    }

    const data = await backendFetch("/v1/audit-logs", { params });
    return NextResponse.json(data);
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
