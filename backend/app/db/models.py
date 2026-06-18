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
    Enum("admin", "operator", "viewer", name="user_role"),
    nullable=False,
    default="viewer"
    )  # admin, operator, viewer
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
    frameworks_affected = Column(ARRAY(String), nullable=True)  # GDPR, HIPAA, SOC2
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
