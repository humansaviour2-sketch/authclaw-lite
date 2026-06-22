import { NextResponse } from "next/server";
import { backendFetch, handleApiError } from "@/lib/api-client";

async function proxyRequest(request: Request, method: string) {
  try {
    const { searchParams } = new URL(request.url);
    const path = searchParams.get("path");
    
    if (!path) {
      return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
    }

    const params: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      if (key !== "path") {
        params[key] = value;
      }
    });

    const options: RequestInit & { params?: Record<string, string> } = {
      method,
      params,
    };

    if (method !== "GET" && method !== "HEAD") {
      try {
        const body = await request.json();
        options.body = JSON.stringify(body);
      } catch (e) {
        // ignore body parse error if no body provided
      }
    }

    const data = await backendFetch(path, options);
    return NextResponse.json(data || {});
  } catch (error: any) {
    return handleApiError(error);
  }
}

export async function GET(request: Request) {
  return proxyRequest(request, "GET");
}

export async function POST(request: Request) {
  return proxyRequest(request, "POST");
}

export async function PATCH(request: Request) {
  return proxyRequest(request, "PATCH");
}

export async function DELETE(request: Request) {
  return proxyRequest(request, "DELETE");
}
