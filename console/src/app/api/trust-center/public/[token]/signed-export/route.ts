import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.API_URL || "http://localhost:8000";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const framework = request.nextUrl.searchParams.get("framework");
    const query = framework ? `?framework=${encodeURIComponent(framework)}` : "";
    const response = await fetch(`${BACKEND_URL}/v1/trust-center/public/${encodeURIComponent(token)}/signed-export${query}`, {
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Signed export request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
