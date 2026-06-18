"""AuthClaw Backend - FastAPI Application"""
import os
from dotenv import load_dotenv

# Load environment variables from .env.local
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env.local")
if os.path.exists(env_path):
    load_dotenv(env_path)
else:
    load_dotenv()

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
from app.api.v1.endpoints.users import router as users_router
from app.api.v1.endpoints.apikeys import router as apikeys_router
from app.api.v1.endpoints.chat import router as chat_router
from app.api.v1.endpoints.aws import router as aws_router

app.include_router(tenants_router, prefix="/v1/tenants", tags=["tenants"])
app.include_router(gateways_router, prefix="/v1/gateways", tags=["gateways"])
app.include_router(policies_router, prefix="/v1/policies", tags=["policies"])
app.include_router(redaction_router, prefix="/v1/redaction", tags=["redaction"])
app.include_router(audit_router, prefix="/v1/audit-logs", tags=["audit-logs"])
app.include_router(workflows_router, prefix="/v1/workflows", tags=["workflows"])
app.include_router(users_router, prefix="/v1/users", tags=["users"])
app.include_router(apikeys_router, prefix="/v1/api-keys", tags=["api-keys"])
app.include_router(chat_router, prefix="/v1/chat", tags=["chat"])
# Phase 14 — AWS Connector (gated behind AWS_ENABLED env flag at handler level)
app.include_router(aws_router, prefix="/v1/aws", tags=["aws"])



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
