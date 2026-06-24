from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from uuid import UUID
from datetime import datetime, timedelta, timezone
import os

from app.db.models import OnboardingEmailOTP, Tenant, User
from app.schemas.models import UserCreate, UserInviteRequest, UserInviteResponse, UserResponse
from app.core.auth import get_tenant_db, require_roles
from app.api.v1.endpoints.onboarding import (
    OTP_TTL_MINUTES,
    _deliver_otp,
    _generate_otp,
    _next_resend_at,
    _otp_hash,
)
from app.services.email_service import EmailDeliveryError

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


@router.post("/invite", response_model=UserInviteResponse, status_code=status.HTTP_202_ACCEPTED, dependencies=[require_roles(["owner"])])
def invite_user(
    request: Request,
    invite_in: UserInviteRequest,
    db: Session = Depends(get_tenant_db),
):
    """Send an email OTP invite for adding a user to the active tenant."""
    tenant_id = request.state.tenant_id
    inviter_id = request.state.user_id
    email = invite_in.email.strip().lower()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=OTP_TTL_MINUTES)

    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    existing = db.query(User).filter(
        User.tenant_id == tenant_id,
        User.email == email,
        User.is_active == True,
    ).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An active user already exists for this tenant")

    pending = db.query(OnboardingEmailOTP).filter(
        OnboardingEmailOTP.tenant_id == tenant_id,
        OnboardingEmailOTP.email == email,
        OnboardingEmailOTP.status == "pending",
        OnboardingEmailOTP.purpose == "invite",
    ).first()
    if pending:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A pending invite already exists for this email")

    otp = _generate_otp()
    invite_row = OnboardingEmailOTP(
        email=email,
        tenant_name=tenant.name,
        otp_hash=_otp_hash(email, otp),
        status="pending",
        expires_at=expires_at,
        sent_at=now,
        purpose="invite",
        invited_role=invite_in.role,
        invited_by=inviter_id,
        tenant_id=tenant_id,
    )
    db.add(invite_row)
    db.flush()

    console_url = (
        os.getenv("PUBLIC_CONSOLE_URL")
        or os.getenv("NEXT_PUBLIC_CONSOLE_URL")
        or os.getenv("NEXT_PUBLIC_APP_URL")
    )
    action_url = f"{console_url.rstrip('/')}/signup?invite={invite_row.id}" if console_url else None

    try:
        delivery, dev_otp = _deliver_otp(
            email,
            otp,
            tenant.name,
            purpose="tenant invite",
            action_url=action_url,
        )
        invite_row.last_delivery = delivery
        invite_row.delivery_error = None
        db.commit()
        db.refresh(invite_row)
        return UserInviteResponse(
            signup_id=invite_row.id,
            email=email,
            tenant_name=tenant.name,
            invited_role=invite_in.role,
            expires_at=invite_row.expires_at,
            delivery=delivery,
            next_resend_at=_next_resend_at(invite_row.sent_at),
            dev_otp=dev_otp,
        )
    except EmailDeliveryError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


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
