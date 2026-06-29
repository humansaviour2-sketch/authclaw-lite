"""SQLAlchemy ORM Models for AuthClaw"""
from datetime import datetime
from typing import Optional, List
from sqlalchemy import (
    Column, String, UUID, DateTime, Boolean, ForeignKey,
    Integer, Text, ARRAY, JSON, Index, Float, create_engine
)
from app.db.base import Base
from sqlalchemy.orm import relationship
import uuid
from sqlalchemy import UniqueConstraint, Enum


class Tenant(Base):
    """Multi-tenant tenant model"""
    __tablename__ = "tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False, unique=True)
    tier = Column(String(50), nullable=False, default="starter")  # starter, pro, enterprise
    status = Column(String(50), nullable=False, default="active")  # active, suspended
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    users = relationship("User", back_populates="tenant", cascade="all, delete-orphan")
    api_keys = relationship("APIKey", back_populates="tenant", cascade="all, delete-orphan")
    policies = relationship("Policy", back_populates="tenant", cascade="all, delete-orphan")
    gateways = relationship("GatewayConfig", back_populates="tenant", cascade="all, delete-orphan")
    redaction_tokens = relationship("RedactionToken", back_populates="tenant", cascade="all, delete-orphan")
    workflows = relationship("ComplianceWorkflow", back_populates="tenant", cascade="all, delete-orphan")
    chat_sessions = relationship("ChatSession", back_populates="tenant", cascade="all, delete-orphan")
    # Phase 16 — Evidence Repository
    evidence_records = relationship("EvidenceRecord", back_populates="tenant", cascade="all, delete-orphan")
    # Phase 17 — Findings Dashboard
    findings = relationship("Finding", back_populates="tenant", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_tenant_status", "status"),
    )


class User(Base):
    """User model with tenant isolation"""
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    email = Column(String(255), nullable=False)
    password_hash = Column(String(255), nullable=True)
    role = Column(
    Enum("owner", "admin", "developer", "operator", "viewer", name="user_role"),
    nullable=False,
    default="viewer"
    )  # owner, admin, developer, operator, viewer
    mfa_enabled = Column(Boolean, default=False)
    mfa_secret = Column(String(32), nullable=True)  # TOTP secret (encrypted)
    mfa_backup_codes = Column(ARRAY(String), nullable=True)  # TOTP backup codes
    is_active = Column(Boolean, default=True)
    last_login = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    tenant = relationship("Tenant", back_populates="users")
    approvals = relationship("PendingApproval", back_populates="approver", foreign_keys="PendingApproval.approver_id")

    __table_args__ = (
    UniqueConstraint(
        "tenant_id",
        "email",
        name="uq_tenant_email"
    ),
    Index("idx_user_tenant_email", "tenant_id", "email"),
    Index("idx_user_is_active", "is_active"),
    )


class APIKey(Base):
    """API Key for service-to-service authentication"""
    __tablename__ = "api_keys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    key_hash = Column(String(255), nullable=False, unique=True)  # SHA-256 hash
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    scopes = Column(ARRAY(String), nullable=False, default=["read"])  # read, write, admin
    is_active = Column(Boolean, default=True)
    last_used = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    tenant = relationship("Tenant", back_populates="api_keys")

    __table_args__ = (
        Index("idx_apikey_tenant", "tenant_id"),
        Index("idx_apikey_active", "is_active"),
    )


class Policy(Base):
    """YAML Policy storage per tenant"""
    __tablename__ = "policies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    policy_yaml = Column(Text, nullable=False)  # Full YAML policy content
    version = Column(Integer, nullable=False, default=1)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    tenant = relationship("Tenant", back_populates="policies")

    __table_args__ = (
        Index("idx_policy_tenant", "tenant_id"),
        Index("idx_policy_active", "is_active"),
    )


class GatewayConfig(Base):
    """Gateway routing configuration per tenant"""
    __tablename__ = "gateway_configs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    name = Column(String(255), nullable=False)
    provider = Column(String(50), nullable=False)  # openai, anthropic, cohere, azure_openai
    endpoint = Column(String(512), nullable=False)
    model_whitelist = Column(ARRAY(String), nullable=True)  # If null, allow all models
    redaction_strategy = Column(String(50), nullable=False, default="mask")  # mask, hash, synthetic
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    tenant = relationship("Tenant", back_populates="gateways")

    __table_args__ = (
        Index("idx_gateway_tenant", "tenant_id"),
        Index("idx_gateway_active", "is_active"),
    )


class ProviderCredential(Base):
    """Encrypted model-provider credential for AuthClaw Lite gateway egress."""
    __tablename__ = "provider_credentials"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    provider = Column(String(50), nullable=False)
    display_name = Column(String(255), nullable=False)
    endpoint = Column(String(512), nullable=True)
    encrypted_secret = Column(Text, nullable=False)
    auth_scheme = Column(String(50), nullable=False, default="api_key")
    status = Column(String(50), nullable=False, default="active")
    last_verified_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    rotated_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("idx_provider_credential_tenant", "tenant_id"),
        Index("idx_provider_credential_provider", "tenant_id", "provider"),
        Index("idx_provider_credential_status", "status"),
    )


class OnboardingEmailOTP(Base):
    """Public signup email OTP state before a tenant-scoped key exists."""
    __tablename__ = "onboarding_email_otps"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), nullable=False)
    tenant_name = Column(String(255), nullable=False)
    otp_hash = Column(String(255), nullable=False)
    status = Column(String(50), nullable=False, default="pending")
    attempts = Column(Integer, nullable=False, default=0)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    resend_count = Column(Integer, nullable=False, default=0)
    last_delivery = Column(String(50), nullable=True)
    delivery_error = Column(Text, nullable=True)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    purpose = Column(String(50), nullable=False, default="signup")
    invited_role = Column(String(50), nullable=True)
    invited_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=True)
    api_key_id = Column(UUID(as_uuid=True), ForeignKey("api_keys.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_onboarding_otp_email", "email"),
        Index("idx_onboarding_otp_status", "status"),
        Index("idx_onboarding_otp_expires", "expires_at"),
    )


class OnboardingStatus(Base):
    """Tenant-scoped onboarding checklist state."""
    __tablename__ = "onboarding_status"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, unique=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    signup_id = Column(UUID(as_uuid=True), ForeignKey("onboarding_email_otps.id"), nullable=True)
    email_verified = Column(Boolean, nullable=False, default=False)
    tenant_created = Column(Boolean, nullable=False, default=False)
    api_key_issued = Column(Boolean, nullable=False, default=False)
    provider_key_saved = Column(Boolean, nullable=False, default=False)
    route_created = Column(Boolean, nullable=False, default=False)
    policy_created = Column(Boolean, nullable=False, default=False)
    snippet_viewed = Column(Boolean, nullable=False, default=False)
    current_step = Column(String(50), nullable=False, default="connect_provider")
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_onboarding_status_tenant", "tenant_id"),
        Index("idx_onboarding_status_step", "current_step"),
    )


class RedactionToken(Base):
    """Reversible redaction token mappings per tenant"""
    __tablename__ = "redaction_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    original_value = Column(Text, nullable=False)  # Encrypted
    token_hash = Column(String(255), nullable=False)  # SHA-256 hash of token
    token_value = Column(String(255), nullable=False)  # Synthetic/masked value
    strategy = Column(String(50), nullable=False)  # mask, hash, synthetic
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    # Relationships
    tenant = relationship("Tenant", back_populates="redaction_tokens")

    __table_args__ = (
        UniqueConstraint("tenant_id", "original_value", "strategy", name="uq_redaction_tokens_tenant_original_strategy"),
        Index("idx_redaction_tenant", "tenant_id"),
        Index("idx_redaction_hash", "token_hash"),
    )


class PendingApproval(Base):
    """HITL approval workflow state"""
    __tablename__ = "pending_approvals"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    action_id = Column(String(255), nullable=False)  # Unique action identifier
    action_type = Column(String(50), nullable=False)  # remediation, configuration_change, etc.
    action_description = Column(Text, nullable=False)
    action_payload = Column(JSON, nullable=False)  # Full action details
    status = Column(String(50), nullable=False, default="PENDING")  # PENDING, APPROVED, REJECTED, EXPIRED
    requester_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    approver_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    mfa_verified = Column(Boolean, default=False)
    mfa_timestamp = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)  # 30 min from creation
    approved_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    approver = relationship("User", back_populates="approvals", foreign_keys=[approver_id])

    __table_args__ = (
        Index("idx_approval_tenant", "tenant_id"),
        Index("idx_approval_status", "status"),
        Index("idx_approval_expires", "expires_at"),
    )


class ApprovalAudit(Base):
    """Immutable audit log of all approval decisions"""
    __tablename__ = "approval_audit"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    approval_id = Column(UUID(as_uuid=True), ForeignKey("pending_approvals.id"), nullable=False)
    actor_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    action = Column(String(50), nullable=False)  # APPROVED, REJECTED, EXPIRED
    mfa_verified = Column(Boolean, default=False)
    mfa_timestamp = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("idx_approval_audit_tenant", "tenant_id"),
        Index("idx_approval_audit_approval", "approval_id"),
    )


class AuditLogMetadata(Base):
    """Metadata reference table for ClickHouse audit logs (actual logs stored in ClickHouse)"""
    __tablename__ = "audit_log_metadata"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    record_id = Column(UUID(as_uuid=True), nullable=False, unique=True)  # Matches ClickHouse record_id
    actor_id = Column(UUID(as_uuid=True), nullable=True)
    action = Column(String(255), nullable=False)
    request_id = Column(String(255), nullable=True)
    policy_id = Column(UUID(as_uuid=True), nullable=True)
    provider = Column(String(100), nullable=True)
    model = Column(String(255), nullable=True)
    reason = Column(Text, nullable=True)
    prompt_count = Column(Integer, nullable=False, default=0)
    request_size = Column(Integer, nullable=False, default=0)
    response_status = Column(Integer, nullable=False, default=0)
    duration_ms = Column(Integer, nullable=False, default=0)
    frameworks_affected = Column(ARRAY(String), nullable=True)  # GDPR, HIPAA, SOC2
    prior_hash = Column(String(64), nullable=True)
    integrity_hash = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("idx_audit_metadata_tenant", "tenant_id"),
        Index("idx_audit_metadata_record", "record_id"),
        Index("idx_audit_metadata_created", "created_at"),
    )


class ComplianceWorkflow(Base):
    """LangGraph compliance workflow execution state"""
    __tablename__ = "compliance_workflows"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    workflow_id = Column(String(255), nullable=False, unique=True)  # LangGraph workflow execution ID
    request_id = Column(String(255), nullable=True)  # Request correlation ID
    framework = Column(String(50), nullable=False)  # GDPR, HIPAA, SOC2
    current_state = Column(String(50), nullable=False, default="GATHER_EVIDENCE")
    findings = Column(JSON, nullable=True)
    risk_score = Column(Float, nullable=True)
    remediation_plan = Column(JSON, nullable=True)
    approval_id = Column(UUID(as_uuid=True), ForeignKey("pending_approvals.id"), nullable=True)
    approval_status = Column(String(50), nullable=True)  # PENDING, APPROVED, REJECTED, EXPIRED
    execution_status = Column(String(50), nullable=False, default="RUNNING")
    execution_result = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)
    retry_count = Column(Integer, nullable=False, default=0)
    state_data = Column(JSON, nullable=True)  # Full LangGraph state snapshot for recovery
    started_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    tenant = relationship("Tenant", back_populates="workflows")
    approval = relationship("PendingApproval")

    __table_args__ = (
        Index("idx_workflow_tenant", "tenant_id"),
        Index("idx_workflow_status", "execution_status"),
        Index("idx_workflow_state", "current_state"),
        Index("idx_workflow_wfid", "workflow_id"),
    )


class ChatSession(Base):
    """Compliance agent chat sessions"""
    __tablename__ = "chat_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    title = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    # Relationships
    tenant = relationship("Tenant", back_populates="chat_sessions")
    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_chatsession_tenant", "tenant_id"),
    )


class ChatMessage(Base):
    """Messages in a compliance agent chat session"""
    __tablename__ = "chat_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("chat_sessions.id"), nullable=False)
    sender = Column(Enum("user", "agent", name="chat_sender"), nullable=False)
    text = Column(Text, nullable=False)
    results = Column(JSON, nullable=True)
    timestamp = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    # Relationships
    session = relationship("ChatSession", back_populates="messages")

    __table_args__ = (
        Index("idx_chatmessage_session", "session_id"),
    )


# =============================================================================
# Phase 14 — AWS Connector Framework
# All tables below are new and additive. No existing model was modified.
# =============================================================================

class AWSUsageLimits(Base):
    """Per-tenant Bedrock daily usage counters and hard limits.
    
    The Go Gateway reads this table BEFORE forwarding any Bedrock request.
    If daily_requests >= max_daily_requests the request is blocked locally,
    never reaching AWS, preventing runaway billing.
    """
    __tablename__ = "aws_usage_limits"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, unique=True)

    # Running daily counters
    daily_requests      = Column(Integer, nullable=False, default=0)
    daily_tokens        = Column(Integer, nullable=False, default=0)
    daily_cost_estimate = Column(Float, nullable=False, default=0.0)

    # Configurable hard limits
    max_daily_requests  = Column(Integer, nullable=False, default=100)
    max_daily_tokens    = Column(Integer, nullable=False, default=50000)
    max_daily_cost_usd  = Column(Float, nullable=False, default=1.0)

    last_reset  = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at  = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_aws_usage_tenant", "tenant_id"),
    )


class AWSS3Document(Base):
    """Metadata of S3 objects synced for a tenant.
    
    Populated by POST /v1/aws/s3/sync. Stores only metadata — no file content.
    Used by Phase 15 RAG pipeline as its document inventory source.
    """
    __tablename__ = "aws_s3_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)

    bucket_name     = Column(String(255), nullable=False)
    object_key      = Column(Text, nullable=False)       # Full S3 key
    file_name       = Column(String(512), nullable=False) # Basename
    file_size_bytes = Column(Integer, nullable=True)
    content_type    = Column(String(255), nullable=True)
    last_modified   = Column(DateTime(timezone=True), nullable=True)
    etag            = Column(String(255), nullable=True)   # S3 ETag for change detection
    synced_at       = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("idx_s3_docs_tenant", "tenant_id"),
        Index("idx_s3_docs_synced", "synced_at"),
        # Prevent duplicate keys per tenant+bucket
        UniqueConstraint("tenant_id", "bucket_name", "object_key", name="uq_s3_doc_tenant_key"),
    )


# =============================================================================
# Phase 16 — Evidence Repository
# All tables below are new and additive. No existing model was modified.
# =============================================================================

class EvidenceRecord(Base):
    """Permanent evidence record for all compliance activity.

    Created whenever a compliance scan, approval event, or gateway action
    produces a trackable finding. This table is the source of truth consumed
    by Phase 17+ (Findings Dashboard, Reports, RAG, Enterprise Governance).
    """
    __tablename__ = "evidence_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)

    # Link back to the workflow that produced this evidence (nullable for events
    # that occur outside of a workflow, e.g. gateway redactions)
    workflow_id = Column(String(255), nullable=True)

    # The compliance framework this evidence belongs to
    framework = Column(String(50), nullable=False)  # GDPR, HIPAA, SOC2

    # Where the evidence came from
    # s3_document | gateway_event | audit_event | approval_event | policy_evaluation
    source_type = Column(String(100), nullable=False)

    # A human-readable reference to the specific source artifact
    # e.g. "tenant-xxx/file.txt", "audit-event-<uuid>", "approval-<uuid>"
    source_reference = Column(Text, nullable=True)

    # What kind of evidence this is
    # pii_detected | policy_violation | approval_record | audit_log | scan_result
    evidence_type = Column(String(100), nullable=False)

    # Full structured payload — Presidio results, approval details, etc.
    evidence_data = Column(JSON, nullable=False, default=dict)

    # Severity classification: critical | high | medium | low | info
    severity = Column(String(50), nullable=False, default="info")

    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    # Relationships
    tenant = relationship("Tenant", back_populates="evidence_records")
    links = relationship("EvidenceLink", back_populates="evidence", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_evidence_tenant", "tenant_id"),
        Index("idx_evidence_workflow", "workflow_id"),
        Index("idx_evidence_framework", "framework"),
        Index("idx_evidence_type", "evidence_type"),
        Index("idx_evidence_severity", "severity"),
        Index("idx_evidence_created", "created_at"),
    )


class EvidenceLink(Base):
    """Traceability links — connects one evidence record to any related entity.

    Supported linked_type values:
      finding   — a specific finding within a workflow
      workflow  — a ComplianceWorkflow
      approval  — a PendingApproval
      report    — a future compliance report (Phase 18+)
    """
    __tablename__ = "evidence_links"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    evidence_id = Column(UUID(as_uuid=True), ForeignKey("evidence_records.id"), nullable=False)

    # Type of the linked entity: finding | workflow | approval | report
    linked_type = Column(String(50), nullable=False)

    # String ID of the linked entity (UUID or workflow_id string)
    linked_id = Column(String(255), nullable=False)

    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    # Relationships
    evidence = relationship("EvidenceRecord", back_populates="links")

    __table_args__ = (
        Index("idx_evidence_link_tenant", "tenant_id"),
        Index("idx_evidence_link_evidence", "evidence_id"),
        Index("idx_evidence_link_linked", "linked_type", "linked_id"),
    )


# =============================================================================
# Phase 17 — Findings Dashboard
# =============================================================================

class Finding(Base):
    """Actionable compliance issues derived from evidence."""
    __tablename__ = "findings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    workflow_id = Column(String(255), nullable=True)
    evidence_id = Column(UUID(as_uuid=True), ForeignKey("evidence_records.id"), nullable=True)
    
    framework = Column(String(50), nullable=False)
    finding_key = Column(String(512), nullable=False)  # framework|finding_type|source_reference
    
    title = Column(String(512), nullable=False)
    description = Column(Text, nullable=True)
    
    # critical, high, medium, low, info
    severity = Column(String(50), nullable=False, default="medium")
    
    # OPEN, ACKNOWLEDGED, IN_PROGRESS, AWAITING_APPROVAL, RESOLVED, FALSE_POSITIVE, ACCEPTED_RISK
    status = Column(String(50), nullable=False, default="OPEN")
    
    # PII_EXPOSURE, POLICY_VIOLATION, ACCESS_CONTROL, DATA_RETENTION, ENCRYPTION, AUDIT_GAP, AI_GOVERNANCE
    finding_type = Column(String(100), nullable=False)
    
    risk_score = Column(Float, nullable=False, default=0.0)
    remediation_summary = Column(Text, nullable=True)
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    resolved_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    tenant = relationship("Tenant", back_populates="findings")
    evidence = relationship("EvidenceRecord")
    owner = relationship("User")

    __table_args__ = (
        Index("idx_finding_tenant", "tenant_id"),
        Index("idx_finding_workflow", "workflow_id"),
        Index("idx_finding_framework", "framework"),
        Index("idx_finding_status", "status"),
        Index("idx_finding_severity", "severity"),
        Index("idx_finding_type", "finding_type"),
        Index("idx_finding_created", "created_at"),
        Index("idx_finding_key", "finding_key"),
    )
