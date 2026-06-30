from fastapi import APIRouter

from app.core.oidc import oidc_config

router = APIRouter()


@router.get("/oidc/config")
def get_oidc_config():
    """Return public OIDC/SSO metadata for console login discovery."""
    config = oidc_config()
    return {
        "enabled": config["enabled"],
        "issuer": config["issuer"],
        "client_id": config["client_id"],
        "scopes": config["scopes"],
        "authorization_endpoint": config["authorization_endpoint"],
        "authorization_url": config["authorization_url"],
    }
