import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.API_URL || "http://localhost:8000";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const response = await fetch(`${BACKEND_URL}/v1/trust-center/public/${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Trust Center request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
