import { NextResponse } from "next/server";
import { backendFetch, handleApiError } from "@/lib/api-client";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ framework: string }> }) {
  try {
    const { framework } = await params;
    const data = await backendFetch(`/v1/compliance-scores/${framework}`);
    return NextResponse.json(data);
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
