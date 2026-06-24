from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from uuid import UUID

from app.db.models import User
from app.schemas.models import UserCreate, UserResponse
from app.core.auth import get_tenant_db, require_roles

router = APIRouter()


@router.get("", response_model=list[UserResponse], dependencies=[require_roles(["owner", "admin"])])
def list_users(request: Request, db: Session = Depends(get_tenant_db)):
    """List all users for the tenant (isolated by tenant RLS)"""
    tenant_id = request.state.tenant_id
    return db.query(User).filter(User.tenant_id == tenant_id).all()


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED, dependencies=[require_roles(["owner"])])
def create_user(
    request: Request,
    user_in: UserCreate,
    db: Session = Depends(get_tenant_db)
):
    """Create a new user under the active tenant"""
    tenant_id = request.state.tenant_id
    
    # Check if user with same email exists in this tenant
    existing = db.query(User).filter(
        User.tenant_id == tenant_id,
        User.email == user_in.email
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User with this email already exists in this tenant"
        )
        
    try:
        user = User(
            tenant_id=tenant_id,
            email=user_in.email,
            password_hash="disabled",
            role=user_in.role,
            mfa_enabled=False,
            is_active=True
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create user: {str(e)}"
        )


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[require_roles(["owner"])])
def delete_user(
    id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db)
):
    """Delete a user for the tenant"""
    tenant_id = request.state.tenant_id
    user = db.query(User).filter(User.tenant_id == tenant_id, User.id == id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    if user.role == "owner":
        active_owner_count = db.query(User).filter(
            User.tenant_id == tenant_id,
            User.role == "owner",
            User.is_active == True,
        ).count()
        if active_owner_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot remove the last active owner"
            )

    user.is_active = False
    db.commit()
