import { NextResponse } from "next/server";
import { backendFetch, handleApiError } from "@/lib/api-client";

export async function POST() {
  try {
    const data = await backendFetch("/v1/users/me/mfa/setup", { method: "POST" });
    return NextResponse.json(data);
  } catch (error: any) {
    return handleApiError(error);
  }
}
