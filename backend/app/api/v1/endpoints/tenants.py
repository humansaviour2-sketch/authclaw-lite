from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import text
import uuid

from app.db.dependencies import get_db
from app.db.models import Tenant
from app.schemas.models import TenantCreate, TenantResponse
from app.core.auth import require_scopes

router = APIRouter()


@router.post("", response_model=TenantResponse, status_code=status.HTTP_201_CREATED, dependencies=[require_scopes(["admin"])])
def create_tenant(tenant_in: TenantCreate, db: Session = Depends(get_db)):
    """Create a new tenant (Admin only)"""
    # Check if tenant name already exists
    existing = db.query(Tenant).filter(Tenant.name == tenant_in.name).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tenant with this name already exists"
        )

    tenant_id = uuid.uuid4()
    # Set current_tenant_id to the new tenant's ID to satisfy the RLS checks
    db.execute(
        text("SELECT set_config('app.current_tenant_id', :tenant_id, false)"),
        {"tenant_id": str(tenant_id)},
    )
    try:
        tenant = Tenant(
            id=tenant_id,
            name=tenant_in.name,
            tier=tenant_in.tier,
            status="active"
        )
        db.add(tenant)
        db.commit()
        db.refresh(tenant)
        return tenant
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create tenant: {str(e)}"
        )
    finally:
        db.execute(text("SELECT set_config('app.current_tenant_id', '', false)"))
