import { NextRequest, NextResponse } from "next/server";
import { backendFetch, handleApiError } from "@/lib/api-client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const framework = searchParams.get("framework");
    const days = searchParams.get("days") || "30";
    const params: Record<string, string> = { days };
    if (framework) params.framework = framework;
    const data = await backendFetch("/v1/compliance-scores/history/trend", { params });
    return NextResponse.json(data);
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
