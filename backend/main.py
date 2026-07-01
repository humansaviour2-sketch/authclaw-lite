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
from app.core.config import settings
from app.core.startup_checks import validate_production_environment
from app.core.crypto import secret_management_status

validate_production_environment()

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
from app.api.v1.endpoints.provider_credentials import router as provider_credentials_router
from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.onboarding import router as onboarding_router
from app.api.v1.endpoints.chat import router as chat_router
from app.api.v1.endpoints.rag import router as rag_router
from app.api.v1.endpoints.ephemeral_workers import router as ephemeral_workers_router
from app.api.v1.endpoints.compliance_scores import router as compliance_scores_router
from app.api.v1.endpoints.aws import router as aws_router
from app.api.v1.endpoints.usage_limits import router as usage_limits_router
# Phase 16 — Evidence Repository
from app.api.v1.endpoints.evidence import router as evidence_router
# Phase 17 — Findings Dashboard
from app.api.v1.endpoints.findings import router as findings_router

app.include_router(tenants_router, prefix="/v1/tenants", tags=["tenants"])
app.include_router(gateways_router, prefix="/v1/gateways", tags=["gateways"])
app.include_router(policies_router, prefix="/v1/policies", tags=["policies"])
app.include_router(redaction_router, prefix="/v1/redaction", tags=["redaction"])
app.include_router(audit_router, prefix="/v1/audit-logs", tags=["audit-logs"])
app.include_router(workflows_router, prefix="/v1/workflows", tags=["workflows"])
app.include_router(users_router, prefix="/v1/users", tags=["users"])
app.include_router(apikeys_router, prefix="/v1/api-keys", tags=["api-keys"])
app.include_router(provider_credentials_router, prefix="/v1/provider-credentials", tags=["provider-credentials"])
app.include_router(auth_router, prefix="/v1/auth", tags=["auth"])
app.include_router(onboarding_router, prefix="/v1/onboarding", tags=["onboarding"])
app.include_router(chat_router, prefix="/v1/chat", tags=["chat"])
app.include_router(rag_router, prefix="/v1/rag", tags=["rag"])
app.include_router(ephemeral_workers_router, prefix="/v1/ephemeral-workers", tags=["ephemeral-workers"])
app.include_router(compliance_scores_router, prefix="/v1/compliance-scores", tags=["compliance-scores"])
app.include_router(usage_limits_router, prefix="/v1/usage-limits", tags=["usage-limits"])
# Phase 14 — AWS Connector (gated behind AWS_ENABLED env flag at handler level)
app.include_router(aws_router, prefix="/v1/aws", tags=["aws"])
# Phase 16 — Evidence Repository
app.include_router(evidence_router, prefix="/v1/evidence", tags=["evidence"])
# Phase 17 — Findings Dashboard
app.include_router(findings_router, prefix="/v1/findings", tags=["findings"])



@app.get("/health")
def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "authclaw-backend",
        "secret_management": secret_management_status(),
    }


@app.on_event("startup")
async def startup_event():
    """Initialize app on startup"""
    print("AuthClaw Backend Starting Up...")


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    print("AuthClaw Backend Shutting Down...")
