"""Authentication and tenant context middleware / dependencies"""
import hashlib
from typing import Generator, List
from fastapi import Request, Depends, HTTPException, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.db.dependencies import get_db


def hash_key(key: str) -> str:
    """Compute SHA-256 hash of the API key"""
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


class AuthMiddleware(BaseHTTPMiddleware):
    """Middleware to validate API keys and inject tenant_id and scopes"""
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        
        # Bypass authentication for public routes
        public_paths = {
            "/health",
            "/docs",
            "/openapi.json",
            "/redoc",
            "/v1/onboarding/signup",
            "/v1/onboarding/resend",
            "/v1/onboarding/verify",
        }
        if path in public_paths or path.startswith("/static"):
            return await call_next(request)

        auth_header = request.headers.get("Authorization")
        if not auth_header:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Missing Authorization Header"}
            )

        parts = auth_header.split(" ")
        if len(parts) != 2 or parts[0].lower() != "bearer":
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Invalid Authorization Format. Expected: Bearer <key>"}
            )

        api_key = parts[1]
        key_hash = hash_key(api_key)

        db = SessionLocal()
        try:
            # Query the resolve_api_key function (bypasses RLS due to SECURITY DEFINER)
            result = db.execute(
                text("SELECT tenant_id, scopes, created_by FROM resolve_api_key(:key_hash)"),
                {"key_hash": key_hash}
            ).first()

            if not result:
                return JSONResponse(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    content={"detail": "Unauthorized: Invalid or expired API Key"}
                )

            # Inject tenant info and scopes into request state
            request.state.tenant_id = result.tenant_id
            request.state.scopes = result.scopes
            request.state.user_id = result.created_by
        except Exception as e:
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"detail": f"Internal server error during auth: {str(e)}"}
            )
        finally:
            db.close()

        return await call_next(request)


def get_tenant_db(request: Request, db: Session = Depends(get_db)) -> Generator[Session, None, None]:
    """
    Dependency that sets the tenant context on the DB session to enforce RLS
    and clears it when the session is closed/returned to the pool.
    """
    tenant_id = getattr(request.state, "tenant_id", None)
    if tenant_id:
        db.execute(
            text("SELECT set_config('app.current_tenant_id', :tenant_id, false)"),
            {"tenant_id": str(tenant_id)},
        )
    try:
        yield db
    finally:
        # Reset the tenant context parameter
        db.execute(text("SELECT set_config('app.current_tenant_id', '', false)"))


def require_scopes(required_scopes: List[str]):
    """Enforce that the requesting client has the required scopes"""
    def dependency(request: Request):
        scopes = getattr(request.state, "scopes", [])
        if "admin" in scopes:
            return
        for scope in required_scopes:
            if scope not in scopes:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Forbidden: Insufficient scopes"
                )
    return Depends(dependency)

def get_current_tenant(request: Request) -> str:
    """Dependency to retrieve the current tenant_id from the request state"""
    return str(request.state.tenant_id)
