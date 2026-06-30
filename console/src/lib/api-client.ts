import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionStore } from "./session-store";

const BACKEND_URL = process.env.API_URL || "http://localhost:8000";

type ApiErrorCandidate = {
  detail?: unknown;
  message?: unknown;
  error?: unknown;
};

type ValidationErrorItem = {
  path?: unknown;
  message?: unknown;
  msg?: unknown;
};

class BackendRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "BackendRequestError";
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function apiErrorMessage(data: unknown, fallback: string): string {
  if (!isRecord(data)) return fallback;
  const payload = data as ApiErrorCandidate;
  const candidate = payload.detail ?? payload.message ?? payload.error;
  if (typeof candidate === "string") return candidate;
  if (isRecord(candidate)) {
    if (typeof candidate.message === "string") {
      const errors = Array.isArray(candidate.errors)
        ? candidate.errors
            .map((item: ValidationErrorItem) => {
              const path = typeof item.path === "string" ? item.path : "policy";
              const message = typeof item.message === "string" ? item.message : "";
              return message ? `${path}: ${message}` : "";
            })
            .filter(Boolean)
        : [];
      return errors.length ? `${candidate.message}: ${errors.join("; ")}` : candidate.message;
    }
  }
  if (Array.isArray(candidate)) {
    const messages = candidate
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "msg" in item) return String(item.msg);
        return "";
      })
      .filter(Boolean);
    if (messages.length) return messages.join(" ");
  }
  return fallback;
}

export function getErrorMessage(error: unknown, fallback = "Request failed"): string {
  return error instanceof Error ? error.message : fallback;
}

export function getErrorStatus(error: unknown, fallback = 500): number {
  return isRecord(error) && typeof error.status === "number" ? error.status : fallback;
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
      errorDetail = apiErrorMessage(errorJson, errorDetail);
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

export function handleApiError(error: unknown) {
  const message = getErrorMessage(error);
  const isUnauthorized = message.includes("Unauthorized");
  const status = getErrorStatus(error, isUnauthorized ? 401 : 500);
  const response = NextResponse.json({ error: message }, { status });
  if (isUnauthorized) {
    response.cookies.delete("authclaw_session");
  }
  return response;
}
