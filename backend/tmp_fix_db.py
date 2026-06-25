import os
from sqlalchemy import create_engine, text
from app.db.models import ApprovalAudit

url = os.environ.get('OWNER_DATABASE_URL')
engine = create_engine(url)

with engine.begin() as conn:
    conn.execute(text('GRANT SELECT, INSERT, UPDATE, DELETE ON approval_audit TO authclaw_app;'))
    conn.execute(text('ALTER TABLE approval_audit ENABLE ROW LEVEL SECURITY;'))
    conn.execute(text('''
        CREATE POLICY tenant_isolation_policy ON approval_audit
        USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
    '''))

print('Successfully created table and applied permissions')
