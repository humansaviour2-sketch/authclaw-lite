import { NextResponse } from "next/server";
import { backendFetch, handleApiError } from "@/lib/api-client";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const data = await backendFetch(`/v1/ephemeral-workers/tokens/${id}/revoke`, { method: "POST" });
    return NextResponse.json(data);
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
