"""AuthClaw Backend - FastAPI Application"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.db.base import Base

# Initialize FastAPI app
app = FastAPI(
    title="AuthClaw API",
    description="AI Governance & Compliance Platform Control Plane",
    version="0.1.0",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database setup
engine = create_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create tables
from sqlalchemy import text
Base.metadata.create_all(bind=engine)
with engine.connect() as conn:
    conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_backup_codes VARCHAR[];"))
    conn.commit()

# Register Authentication & Tenant Context Middleware
from app.core.auth import AuthMiddleware
app.add_middleware(AuthMiddleware)

# Import & register endpoints
from app.api.v1.endpoints.tenants import router as tenants_router
from app.api.v1.endpoints.gateways import router as gateways_router
from app.api.v1.endpoints.policies import router as policies_router
from app.api.v1.endpoints.redaction import router as redaction_router
from app.api.v1.endpoints.audit import router as audit_router
from app.api.v1.endpoints.workflows import router as workflows_router

app.include_router(tenants_router, prefix="/v1/tenants", tags=["tenants"])
app.include_router(gateways_router, prefix="/v1/gateways", tags=["gateways"])
app.include_router(policies_router, prefix="/v1/policies", tags=["policies"])
app.include_router(redaction_router, prefix="/v1/redaction", tags=["redaction"])
app.include_router(audit_router, prefix="/v1/audit-logs", tags=["audit-logs"])
app.include_router(workflows_router, prefix="/v1/workflows", tags=["workflows"])


@app.get("/health")
def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "authclaw-backend"}


@app.on_event("startup")
async def startup_event():
    """Initialize app on startup"""
    print("AuthClaw Backend Starting Up...")


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    print("AuthClaw Backend Shutting Down...")
