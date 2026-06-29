from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from sqlalchemy import text
import yaml
import re
import os
import redis

from app.db.models import Policy
from app.schemas.models import PolicyCreate, PolicyResponse, PolicyDetailResponse
from app.core.auth import get_tenant_db, require_roles, require_scopes

router = APIRouter()


def validate_policy_yaml(yaml_str: str):
    """Validate YAML parsing and regex compilation within policy config"""
    try:
        config = yaml.safe_load(yaml_str)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid YAML syntax: {str(e)}"
        )

    if not isinstance(config, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Policy YAML must be a dictionary/object"
        )

    regex_rules = config.get("regex_rules", [])
    if not isinstance(regex_rules, list):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="regex_rules must be a list"
        )

    for idx, rule in enumerate(regex_rules):
        if not isinstance(rule, dict):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"regex_rules[{idx}] must be an object"
            )
        pattern = rule.get("pattern")
        if not pattern or not isinstance(pattern, str):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"regex_rules[{idx}] missing pattern string"
            )
        try:
            re.compile(pattern)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid regex pattern in regex_rules[{idx}]: {str(e)}"
            )

        action = rule.get("action", "redact")
        if action not in ("redact", "require_approval", "block"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"regex_rules[{idx}] action must be redact, require_approval, or block"
            )

        timeout = rule.get("hitl_timeout_seconds", 1800)
        if action == "require_approval":
            if not isinstance(timeout, int) or timeout < 10 or timeout > 1800:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"regex_rules[{idx}] hitl_timeout_seconds must be an integer between 10 and 1800"
                )


@router.post("", response_model=PolicyResponse, status_code=status.HTTP_201_CREATED, dependencies=[require_roles(["owner", "admin"])])
def upload_policy(
    request: Request,
    policy_in: PolicyCreate,
    db: Session = Depends(get_tenant_db)
):
    """Upload or update a YAML policy config (isolated by tenant RLS)"""
    tenant_id = request.state.tenant_id
    user_id = request.state.user_id

    # 1. Validate YAML syntax and compiled regular expressions
    validate_policy_yaml(policy_in.policy_yaml)

    try:
        # 2. Query current policies to determine next version
        existing_policies = db.query(Policy).filter(Policy.tenant_id == tenant_id).all()
        next_version = 1
        if existing_policies:
            next_version = max(p.version for p in existing_policies) + 1

        # 3. Deactivate previous policies for this tenant
        db.query(Policy).filter(Policy.tenant_id == tenant_id).update({Policy.is_active: False})

        # 4. Insert new active policy
        policy = Policy(
            tenant_id=tenant_id,
            name=policy_in.name,
            description=policy_in.description,
            policy_yaml=policy_in.policy_yaml,
            version=next_version,
            is_active=True,
            created_by=user_id
        )
        db.add(policy)
        db.flush()
        response = {
            "id": policy.id,
            "name": policy.name,
            "version": policy.version,
            "is_active": policy.is_active,
            "created_at": policy.created_at,
        }
        db.commit()

        # 5. Publish invalidation event to Redis Pub/Sub to trigger Go gateway hot reload
        redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
        try:
            # Parse URL format differences
            if redis_url and not redis_url.startswith("redis://"):
                redis_url = f"redis://{redis_url}"
            r_client = redis.from_url(redis_url)
            r_client.publish("policy_invalidation", str(tenant_id))
        except Exception as re_err:
            # Non-blocking log: cache invalidation issues should not cause client request failure
            print(f"[WARN] Failed to publish policy invalidation to Redis: {re_err}")

        return response
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save policy: {str(e)}"
        )


@router.get("", response_model=list[PolicyResponse], dependencies=[require_scopes(["read"])])
def list_policies(
    request: Request,
    db: Session = Depends(get_tenant_db)
):
    """List all policies for the tenant (including inactive/older versions)"""
    tenant_id = request.state.tenant_id
    return db.query(Policy).filter(Policy.tenant_id == tenant_id).order_by(Policy.version.desc()).all()


@router.get("/active", response_model=PolicyDetailResponse, dependencies=[require_scopes(["read"])])
def get_active_policy(
    request: Request,
    db: Session = Depends(get_tenant_db)
):
    """Get the currently active policy for the tenant"""
    tenant_id = request.state.tenant_id
    policy = db.query(Policy).filter(Policy.tenant_id == tenant_id, Policy.is_active == True).first()
    if not policy:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active policy found"
        )
    return policy
