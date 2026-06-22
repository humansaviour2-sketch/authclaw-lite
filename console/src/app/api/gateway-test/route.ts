import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sessionStore } from "@/lib/session-store";

type Provider = "openai" | "anthropic" | "cohere" | "gemini";

const GATEWAY_URL =
  process.env.GATEWAY_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_GATEWAY_URL ||
  "http://localhost:8080";

const TESTS: Record<Provider, { path: string; body: unknown }> = {
  openai: {
    path: "/v1/chat/completions",
    body: {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: "My email is jane@example.com. Reply with one short safe sentence.",
        },
      ],
    },
  },
  anthropic: {
    path: "/v1/messages",
    body: {
      model: "claude-3-5-sonnet",
      max_tokens: 80,
      messages: [
        {
          role: "user",
          content: "My email is jane@example.com. Reply with one short safe sentence.",
        },
      ],
    },
  },
  cohere: {
    path: "/v1/chat",
    body: {
      model: "command-r",
      message: "My email is jane@example.com. Reply with one short safe sentence.",
    },
  },
  gemini: {
    path: "/v1/models/gemini-2.5-flash-lite:generateContent",
    body: {
      contents: [
        {
          parts: [
            {
              text: "My email is jane@example.com. Reply with one short safe sentence.",
            },
          ],
        },
      ],
    },
  },
};

function trimBody(value: string) {
  return value.length > 1200 ? `${value.slice(0, 1200)}...` : value;
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("authclaw_session")?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = JSON.parse(sessionToken);
    const session = sessionStore.getSession(payload.sessionId);
    if (!session) {
      const response = NextResponse.json({ error: "Unauthorized: Session expired or invalid" }, { status: 401 });
      response.cookies.delete("authclaw_session");
      return response;
    }

    const body = await request.json().catch(() => ({}));
    const provider = (body.provider || "gemini") as Provider;
    const test = TESTS[provider];
    if (!test) {
      return NextResponse.json({ error: "Unsupported provider" }, { status: 400 });
    }

    const requestId = `connect-test-${Date.now()}`;
    const startedAt = Date.now();
    const gatewayResponse = await fetch(`${GATEWAY_URL}${test.path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.apiKey}`,
        "X-Provider": provider,
        "X-Request-ID": requestId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(test.body),
      cache: "no-store",
    });
    const responseText = await gatewayResponse.text();
    const durationMs = Date.now() - startedAt;

    let parsed: unknown = null;
    try {
      parsed = responseText ? JSON.parse(responseText) : null;
    } catch {
      parsed = null;
    }

    return NextResponse.json({
      ok: gatewayResponse.ok,
      status: gatewayResponse.status,
      provider,
      request_id: requestId,
      duration_ms: durationMs,
      path: test.path,
      gateway_url: GATEWAY_URL,
      response: parsed,
      raw: parsed ? undefined : trimBody(responseText),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Gateway test failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
