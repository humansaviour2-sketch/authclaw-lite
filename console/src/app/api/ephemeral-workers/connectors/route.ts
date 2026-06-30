import { NextResponse } from "next/server";
import { backendFetch, handleApiError } from "@/lib/api-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await backendFetch("/v1/ephemeral-workers/connectors");
    return NextResponse.json(data);
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
