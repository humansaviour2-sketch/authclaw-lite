import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { query, queryWithTenantContext } from "@/lib/db";
import { sessionStore } from "@/lib/session-store";
import { sessionCookieOptions } from "@/lib/cookie-options";

export async function POST(request: Request) {
  try {
    const { email, apiKey } = await request.json();

    if (!apiKey) {
      return NextResponse.json(
        { message: "API Key is required" },
        { status: 400 }
      );
    }

    // 1. Hash API key
    const keyHash = createHash("sha256").update(apiKey).digest("hex");

    // 2. Query Postgres resolve_api_key function
    const res = await query(
      "SELECT tenant_id, scopes, created_by FROM resolve_api_key($1)",
      [keyHash]
    );

    if (res.rowCount === 0) {
      return NextResponse.json(
        { message: "Invalid or expired API Key" },
        { status: 401 }
      );
    }

    const { tenant_id: tenantId, scopes, created_by: userId } = res.rows[0];

    // Query tenant name
    const tenantRes = await queryWithTenantContext(tenantId, "SELECT name FROM tenants WHERE id = $1", [tenantId]);
    const tenantName = tenantRes.rowCount && tenantRes.rowCount > 0 ? tenantRes.rows[0].name : "Default Tenant";

    // 3. Create server-side session
    const session = sessionStore.createSession({
      apiKey,
      userId,
      tenantId,
      scopes,
    });

    // 4. Build secure cookie payload (WITHOUT raw api key)
    const cookiePayload = {
      sessionId: session.sessionId,
      userId,
      tenantId,
      tenantName,
      scopes,
      email: email || "admin@authclaw.com",
    };

    const response = NextResponse.json({ success: true, user: cookiePayload });

    // Set secure HTTP-only session cookie
    response.cookies.set("authclaw_session", JSON.stringify(cookiePayload), {
      ...sessionCookieOptions(60 * 60 * 24),
    });

    return response;
  } catch (error: any) {
    console.error("Login API Error:", error);
    return NextResponse.json(
      { message: `Internal server error during login: ${error.message}` },
      { status: 500 }
    );
  }
}
