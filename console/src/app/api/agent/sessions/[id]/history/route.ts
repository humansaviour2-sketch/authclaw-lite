import { NextResponse } from "next/server";
import { backendFetch } from "@/lib/api-client";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await backendFetch(`/v1/chat/sessions/${id}/history`);
    return NextResponse.json(data);
  } catch (error: unknown) {
    return NextResponse.json({ error: (error instanceof Error ? error.message : "Request failed") }, { status: 500 });
  }
}
