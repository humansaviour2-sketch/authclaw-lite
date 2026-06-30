import { NextResponse } from "next/server";
import { backendFetch, handleApiError } from "@/lib/api-client";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await backendFetch(`/v1/users/invites/${id}`, { method: "DELETE" });
    return new NextResponse(null, { status: 204 });
  } catch (error: any) {
    return handleApiError(error);
  }
}
