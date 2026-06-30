import { NextResponse } from "next/server";
import { backendFetch, handleApiError } from "@/lib/api-client";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const data = await backendFetch(`/v1/gateways/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return NextResponse.json(data);
  } catch (error: unknown) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await backendFetch(`/v1/gateways/${id}`, {
      method: "DELETE",
    });
    return new Response(null, { status: 204 });
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
