import { NextRequest, NextResponse } from "next/server";
import { backendFetch, handleApiError } from "@/lib/api-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await backendFetch("/v1/trust-center/shares");
    return NextResponse.json(data);
  } catch (error: unknown) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const origin = request.headers.get("origin") || new URL(request.url).origin;
    const data = await backendFetch("/v1/trust-center/shares", {
      method: "POST",
      headers: { "x-console-origin": origin },
      body: JSON.stringify(body),
    });
    return NextResponse.json(data, { status: 201 });
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
