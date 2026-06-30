import { NextRequest, NextResponse } from "next/server";
import { backendFetch, handleApiError } from "@/lib/api-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await backendFetch("/v1/ephemeral-workers/tokens");
    return NextResponse.json(data);
  } catch (error: unknown) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = await backendFetch("/v1/ephemeral-workers/tokens", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return NextResponse.json(data, { status: 201 });
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
