import os
import sys
import uuid
import asyncio

sys.path.append(os.path.join(os.path.dirname(__file__), "backend"))

from app.db.session import SessionLocal
from app.db.models import Tenant
from app.orchestrator.runner import ComplianceWorkflowRunner

def main():
    db = SessionLocal()
    tenant = db.query(Tenant).first()
    if not tenant:
        print("No tenant found.")
        return
        
    print(f"Triggering workflow for tenant {tenant.id}...")
    
    runner = ComplianceWorkflowRunner(db)
    result = runner.start(str(tenant.id), "GDPR", "test-request-1")
    
    print("\n--- WORKFLOW RESULT ---")
    print(f"Current State: {result.get('current_state')}")
    print(f"Risk Score: {result.get('risk_score')}")
    print(f"Findings: {len(result.get('findings', []))}")
    for f in result.get('findings', []):
        print(f"  - {f['control']}: {f['status']} ({f['description']})")
        
    print(f"Remediation Plan Actions: {len(result.get('remediation_plan', []))}")

if __name__ == "__main__":
    main()
