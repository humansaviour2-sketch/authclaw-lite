import uuid
import pytest
import pyotp
from fastapi.testclient import TestClient
from fastapi import status
from sqlalchemy import text, create_engine
from sqlalchemy.orm import sessionmaker, Session

from main import app
from app.db.dependencies import get_db
from app.db.models import Tenant, User, APIKey, PendingApproval, ApprovalAudit
from app.core.auth import hash_key
from app.core.config import settings

db_url = settings.DATABASE_URL.replace("authclaw:authclaw@", "authclaw_app:authclaw@")
engine = create_engine(db_url, echo=False)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)


@pytest.fixture(scope="module")
def db_session() -> Session:
    """Create a clean database session and apply tables/RLS contexts"""
    from app.db.base import Base
    Base.metadata.create_all(bind=engine)
    
    # Truncate tables before run
    with engine.connect() as conn:
        conn.execute(text("TRUNCATE TABLE approval_audit, audit_log_metadata, pending_approvals, compliance_workflows, api_keys, users, tenants CASCADE;"))
        conn.commit()
        
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module")
def client(db_session: Session) -> TestClient:
    """FastAPI TestClient with overridden get_db dependency to enforce RLS"""
    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_phase10_mfa_setup_and_verification(client: TestClient, db_session: Session):
    """Verify MFA registration, TOTP validation, backup codes validation, and ApprovalAudit."""
    # 1. Setup Tenant and User
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    api_key_raw = "system_admin_key_tenant_d"
    api_key_hash = hash_key(api_key_raw)

    db_session.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant = Tenant(id=tenant_id, name="Test Tenant D", tier="enterprise", status="active")
    db_session.add(tenant)
    db_session.commit()

    db_session.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    user = User(id=user_id, tenant_id=tenant_id, email="admin@tenantD.com", role="admin", is_active=True)
    db_session.add(user)
    db_session.commit()

    db_session.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    api_key = APIKey(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        key_hash=api_key_hash,
        name="Admin Key D",
        scopes=["admin", "read", "write"],
        is_active=True,
        created_by=user_id
    )
    db_session.add(api_key)
    db_session.commit()
    db_session.execute(text("SET app.current_tenant_id = ''"))

    headers = {"Authorization": f"Bearer {api_key_raw}"}

    # 2. Setup MFA Setup Endpoint (returns secret and backup codes)
    response = client.post("/v1/workflows/mfa/setup", headers=headers)
    assert response.status_code == status.HTTP_200_OK
    mfa_data = response.json()
    assert "mfa_secret" in mfa_data
    assert "provisioning_uri" in mfa_data
    assert len(mfa_data["backup_codes"]) == 5
    mfa_secret = mfa_data["mfa_secret"]
    backup_codes = mfa_data["backup_codes"]

    # 3. Create Compliance Workflow (will pause at AWAITING_APPROVAL)
    response_wf = client.post("/v1/workflows", headers=headers, json={"framework": "HIPAA"})
    assert response_wf.status_code == status.HTTP_201_CREATED
    wf_data = response_wf.json()
    workflow_id = wf_data["workflow_id"]
    approval_id = wf_data["approval_id"]

    # 4. Attempt Approval without MFA code (should return 400 Bad Request)
    response_no_mfa = client.post(f"/v1/workflows/{workflow_id}/approve", headers=headers)
    assert response_no_mfa.status_code == status.HTTP_400_BAD_REQUEST
    assert "MFA token required" in response_no_mfa.json()["detail"]

    # 5. Attempt Approval with INVALID MFA code (should return 400 Bad Request)
    response_bad_mfa = client.post(
        f"/v1/workflows/{workflow_id}/approve",
        headers=headers,
        json={"totp_code": "000000"}
    )
    assert response_bad_mfa.status_code == status.HTTP_400_BAD_REQUEST
    assert "Invalid MFA token" in response_bad_mfa.json()["detail"]

    # 6. Attempt Approval with VALID MFA backup code (should succeed)
    backup_code_to_use = backup_codes[0]
    response_backup = client.post(
        f"/v1/workflows/{workflow_id}/approve",
        headers=headers,
        json={"totp_code": backup_code_to_use}
    )
    assert response_backup.status_code == status.HTTP_200_OK
    assert response_backup.json()["approval_status"] == "APPROVED"

    # Verify that used backup code was removed from user in DB
    db_session.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    user_db = db_session.query(User).filter(User.id == user_id).first()
    assert backup_code_to_use not in user_db.mfa_backup_codes
    assert len(user_db.mfa_backup_codes) == 4

    # Verify ApprovalAudit log contains approval trace
    audit = db_session.query(ApprovalAudit).filter(ApprovalAudit.approval_id == uuid.UUID(approval_id)).first()
    assert audit is not None
    assert audit.action == "APPROVED"
    assert audit.mfa_verified is True
    assert audit.actor_id == user_id
    db_session.execute(text("SET app.current_tenant_id = ''"))


def test_phase10_approval_expiration(client: TestClient, db_session: Session):
    """Verify that approvals expire after 30 minutes and are recorded in ApprovalAudit."""
    # 1. Setup Tenant and User
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    api_key_raw = "system_admin_key_tenant_e"
    api_key_hash = hash_key(api_key_raw)

    db_session.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant = Tenant(id=tenant_id, name="Test Tenant E", tier="enterprise", status="active")
    db_session.add(tenant)
    db_session.commit()

    db_session.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    user = User(id=user_id, tenant_id=tenant_id, email="admin@tenantE.com", role="admin", is_active=True)
    db_session.add(user)
    db_session.commit()

    db_session.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    api_key = APIKey(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        key_hash=api_key_hash,
        name="Admin Key E",
        scopes=["admin", "read", "write"],
        is_active=True,
        created_by=user_id
    )
    db_session.add(api_key)
    db_session.commit()
    db_session.execute(text("SET app.current_tenant_id = ''"))

    headers = {"Authorization": f"Bearer {api_key_raw}"}

    # 2. Create Compliance Workflow (paused at AWAITING_APPROVAL)
    response_wf = client.post("/v1/workflows", headers=headers, json={"framework": "HIPAA"})
    assert response_wf.status_code == status.HTTP_201_CREATED
    wf_data = response_wf.json()
    workflow_id = wf_data["workflow_id"]
    approval_id = wf_data["approval_id"]

    # 3. Simulate Expiry by updating expires_at to past time in DB
    db_session.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    approval = db_session.query(PendingApproval).filter(PendingApproval.id == uuid.UUID(approval_id)).first()
    from datetime import datetime, timezone, timedelta
    approval.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.commit()
    db_session.execute(text("SET app.current_tenant_id = ''"))

    # 4. Trigger auto-expiration checking (either via direct GET or approvals/expire-stale)
    response_expire = client.post("/v1/workflows/approvals/expire-stale", headers=headers)
    assert response_expire.status_code == status.HTTP_200_OK
    assert response_expire.json()["expired_count"] == 1

    # 5. Verify status is EXPIRED
    response_status = client.get(f"/v1/workflows/{workflow_id}", headers=headers)
    assert response_status.json()["approval_status"] == "EXPIRED"
    assert response_status.json()["execution_status"] == "COMPLETED"

    # Verify ApprovalAudit log contains EXPIRED action
    db_session.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    audit = db_session.query(ApprovalAudit).filter(
        ApprovalAudit.approval_id == uuid.UUID(approval_id),
        ApprovalAudit.action == "EXPIRED"
    ).first()
    assert audit is not None
    assert audit.mfa_verified is False
    db_session.execute(text("SET app.current_tenant_id = ''"))
