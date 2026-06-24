from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from uuid import UUID
import uuid
import secrets
import hashlib
from typing import List
from pydantic import BaseModel
from datetime import datetime

from app.db.models import APIKey
from app.schemas.models import APIKeyCreate, APIKeyResponse
from app.core.auth import get_tenant_db, require_roles

router = APIRouter()


class APIKeyCreateResponse(BaseModel):
    id: UUID
    name: str
    scopes: List[str]
    is_active: bool
    created_at: datetime
    api_key: str


@router.get("", response_model=list[APIKeyResponse], dependencies=[require_roles(["owner"])])
def list_api_keys(request: Request, db: Session = Depends(get_tenant_db)):
    """List all API keys for the tenant (isolated by tenant RLS)"""
    tenant_id = request.state.tenant_id
    return db.query(APIKey).filter(APIKey.tenant_id == tenant_id, APIKey.is_active == True).all()


@router.post("", response_model=APIKeyCreateResponse, status_code=status.HTTP_201_CREATED, dependencies=[require_roles(["owner"])])
def generate_api_key(
    request: Request,
    key_in: APIKeyCreate,
    db: Session = Depends(get_tenant_db)
):
    """Generate a new API key for the tenant"""
    tenant_id = request.state.tenant_id
    user_id = request.state.user_id

    # Generate a raw api key
    raw_key = "ak_" + secrets.token_urlsafe(24)
    key_hash = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()

    try:
        new_key = APIKey(
            tenant_id=tenant_id,
            key_hash=key_hash,
            name=key_in.name,
            description=key_in.description,
            scopes=key_in.scopes,
            is_active=True,
            created_by=user_id
        )
        db.add(new_key)
        db.commit()
        db.refresh(new_key)

        return APIKeyCreateResponse(
            id=new_key.id,
            name=new_key.name,
            scopes=new_key.scopes,
            is_active=new_key.is_active,
            created_at=new_key.created_at,
            api_key=raw_key
        )
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate API key: {str(e)}"
        )


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[require_roles(["owner"])])
def revoke_api_key(
    id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db)
):
    """Revoke (delete) an API key for the tenant"""
    tenant_id = request.state.tenant_id
    key = db.query(APIKey).filter(APIKey.tenant_id == tenant_id, APIKey.id == id).first()
    if not key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API Key not found"
        )
    key.is_active = False
    db.commit()
