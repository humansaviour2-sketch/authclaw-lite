import { NextResponse } from "next/server";
import { backendFetch, handleApiError } from "@/lib/api-client";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const data = await backendFetch(`/v1/workflows/approvals/${id}/approve`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return NextResponse.json(data);
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
