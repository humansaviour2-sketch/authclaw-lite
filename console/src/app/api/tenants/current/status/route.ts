import { NextResponse } from "next/server";
import { backendFetch, handleApiError } from "@/lib/api-client";

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const data = await backendFetch("/v1/tenants/current/status", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return NextResponse.json(data);
  } catch (error: any) {
    return handleApiError(error);
  }
}
