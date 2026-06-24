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

    const tenantRes = await queryWithTenantContext(
      tenantId,
      "SELECT name, status FROM tenants WHERE id = $1",
      [tenantId]
    );
    const tenant = tenantRes.rowCount && tenantRes.rowCount > 0 ? tenantRes.rows[0] : null;
    if (!tenant || tenant.status !== "active") {
      return NextResponse.json(
        { message: "Tenant is not active" },
        { status: 403 }
      );
    }
    const tenantName = tenant.name || "Default Tenant";

    const userRes = await queryWithTenantContext(
      tenantId,
      "SELECT email, role, is_active FROM users WHERE id = $1 AND tenant_id = $2",
      [userId, tenantId]
    );
    const user = userRes.rowCount && userRes.rowCount > 0 ? userRes.rows[0] : null;
    if (!user || !user.is_active) {
      return NextResponse.json(
        { message: "User is inactive or not found" },
        { status: 401 }
      );
    }
    const role = user.role || "viewer";

    // 3. Create server-side session
    const session = sessionStore.createSession({
      apiKey,
      userId,
      tenantId,
      scopes,
      role,
    });

    // 4. Build secure cookie payload (WITHOUT raw api key)
    const cookiePayload = {
      sessionId: session.sessionId,
      userId,
      tenantId,
      tenantName,
      scopes,
      role,
      email: user.email || email || "admin@authclaw.com",
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
