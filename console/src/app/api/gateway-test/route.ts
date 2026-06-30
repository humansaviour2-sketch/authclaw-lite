import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sessionStore } from "@/lib/session-store";

type Provider = "openai" | "anthropic" | "cohere" | "azure_openai" | "gemini";

interface ProviderCredential {
  provider: string;
  status: string;
}

const GATEWAY_URL =
  process.env.GATEWAY_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_GATEWAY_URL ||
  "http://localhost:8080";

const BACKEND_URL = process.env.API_URL || "http://localhost:8000";

const PROVIDER_LABELS: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  cohere: "Cohere",
  azure_openai: "Azure OpenAI",
  gemini: "Gemini",
};

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
    path: "/v2/chat",
    body: {
      model: "command-r",
      messages: [
        {
          role: "user",
          content: "My email is jane@example.com. Reply with one short safe sentence.",
        },
      ],
    },
  },
  azure_openai: {
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

async function hasActiveProviderCredential(apiKey: string, provider: Provider) {
  const response = await fetch(`${BACKEND_URL}/v1/provider-credentials`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Could not check provider key vault");
  }
  const credentials = (await response.json()) as ProviderCredential[];
  return credentials.some((credential) => credential.provider === provider && credential.status === "active");
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

    const hasProviderKey = await hasActiveProviderCredential(session.apiKey, provider);
    if (!hasProviderKey) {
      return NextResponse.json(
        {
          error: "ProviderCredentialMissing",
          message: `Save an active ${PROVIDER_LABELS[provider]} provider API key before running a live gateway test.`,
          provider,
        },
        { status: 409 },
      );
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
