import uuid
from fastapi.testclient import TestClient
from sqlalchemy import text, create_engine
from sqlalchemy.orm import sessionmaker

from main import app
from app.db.models import Tenant, User, APIKey, EvidenceRecord, Finding
from app.core.auth import hash_key
from app.core.config import settings

db_url = settings.DATABASE_URL.replace("authclaw:authclaw@", "authclaw_app:authclaw@")
engine = create_engine(db_url, echo=False)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)

def run_test():
    with TestClient(app) as client:
        # Create tenant and api key
        tenant_id = uuid.uuid4()
        user_id = uuid.uuid4()
        raw_key = "findings_test_key"
        key_hash = hash_key(raw_key)

        with TestingSessionLocal() as db:
            db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
            tenant = Tenant(id=tenant_id, name="Findings Tenant", tier="enterprise", status="active")
            db.add(tenant)
            db.flush()
            
            user = User(id=user_id, tenant_id=tenant_id, email="findings@test.com", role="admin", is_active=True)
            db.add(user)
            db.flush()
            
            api_key = APIKey(id=uuid.uuid4(), tenant_id=tenant_id, key_hash=key_hash, name="Findings Key", scopes=["admin", "read", "write"], is_active=True, created_by=user_id)
            db.add(api_key)
            db.commit()

        headers = {"Authorization": f"Bearer {raw_key}"}

        # Let's hit the findings endpoints
        resp = client.get("/v1/findings", headers=headers)
        assert resp.status_code == 200
        print("GET /v1/findings OK", resp.json())
        
        # Test dashboard summary
        resp = client.get("/v1/findings/summary/dashboard", headers=headers)
        assert resp.status_code == 200
        print("GET /v1/findings/summary/dashboard OK", resp.json())

        # Create a finding manually to test detailed endpoints
        finding_id = uuid.uuid4()
        with TestingSessionLocal() as db:
            db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
            finding = Finding(
                id=finding_id,
                tenant_id=tenant_id,
                framework="GDPR",
                finding_key="GDPR|PII_EXPOSURE|test.txt",
                title="Test Finding",
                finding_type="PII_EXPOSURE",
                severity="critical",
                status="OPEN",
            )
            db.add(finding)
            db.commit()

        # Update finding status
        resp = client.patch(f"/v1/findings/{finding_id}/status", json={"status": "RESOLVED"}, headers=headers)
        assert resp.status_code == 200
        print("PATCH /v1/findings/status OK", resp.json())

        # Check summary again
        resp = client.get("/v1/findings/summary/dashboard", headers=headers)
        assert resp.status_code == 200
        print("GET /v1/findings/summary/dashboard OK", resp.json())
        
        print("All Findings tests passed successfully!")

if __name__ == "__main__":
    run_test()
