import { NextResponse } from "next/server";
import { backendFetch, handleApiError } from "@/lib/api-client";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const data = await backendFetch("/v1/users/invite", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return NextResponse.json(data, { status: 202 });
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
