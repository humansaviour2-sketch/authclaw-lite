import { NextResponse } from "next/server";
import { backendFetch, handleApiError } from "@/lib/api-client";

export async function GET() {
  try {
    const data = await backendFetch("/v1/users/me/security");
    return NextResponse.json(data);
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
