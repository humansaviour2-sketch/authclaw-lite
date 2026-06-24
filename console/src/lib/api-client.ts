import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionStore } from "./session-store";

const BACKEND_URL = process.env.API_URL || "http://localhost:8000";

class BackendRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "BackendRequestError";
    this.status = status;
  }
}

interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
}

export async function backendFetch(path: string, options: RequestOptions = {}) {
  // 1. Resolve session_id from cookie
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("authclaw_session")?.value;
  
  if (!sessionToken) {
    throw new Error("Unauthorized: No session cookie found");
  }

  let sessionId = "";
  try {
    const sessionPayload = JSON.parse(sessionToken);
    sessionId = sessionPayload.sessionId;
  } catch {
    throw new Error("Unauthorized: Invalid session format");
  }

  // 2. Fetch API key from server session store
  const session = sessionStore.getSession(sessionId);
  if (!session) {
    throw new Error("Unauthorized: Session expired or invalid");
  }

  // 3. Construct URL & headers
  let url = `${BACKEND_URL}${path}`;
  if (options.params) {
    const searchParams = new URLSearchParams(options.params);
    url += `?${searchParams.toString()}`;
  }

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${session.apiKey}`);
  headers.set("Content-Type", "application/json");

  // 4. Perform request
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorDetail = "Backend request failed";
    try {
      const errorJson = await response.json();
      errorDetail = errorJson.detail || errorJson.message || errorDetail;
    } catch {
      // ignore JSON parse error
    }
    throw new BackendRequestError(errorDetail, response.status);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export function handleApiError(error: any) {
  const isUnauthorized = error.message?.includes("Unauthorized");
  const status = error.status || (isUnauthorized ? 401 : 500);
  const response = NextResponse.json({ error: error.message }, { status });
  if (isUnauthorized) {
    response.cookies.delete("authclaw_session");
  }
  return response;
}
