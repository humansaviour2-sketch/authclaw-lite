import os
import io
import json
import logging
from typing import Optional

logger = logging.getLogger("orchestrator.scanner")

class DocumentScanner:
    """Fetches document contents from S3 and extracts raw text for analysis."""

    def __init__(self):
        self.aws_enabled = os.getenv("AWS_ENABLED", "false").lower() == "true"
        self.region = os.getenv("AWS_REGION", "us-east-1")
        self.bucket = os.getenv("AWS_S3_BUCKET", "")
        self.s3_client = None

        if self.aws_enabled and self.bucket and os.getenv("AWS_ACCESS_KEY_ID"):
            try:
                import boto3
                self.s3_client = boto3.client(
                    "s3",
                    region_name=self.region,
                    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
                    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
                )
            except Exception as exc:
                logger.error("Failed to initialize S3 client: %s", exc)

    def list_documents(self, tenant_id: str) -> list[dict]:
        """Lists documents in S3 under the tenant's prefix."""
        if not self.s3_client:
            return []
        
        prefix = f"tenant-{tenant_id}/"
        docs = []
        try:
            paginator = self.s3_client.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
                for obj in page.get("Contents", []):
                    if obj["Key"].endswith("/"):
                        continue
                    docs.append({
                        "object_key": obj["Key"],
                        "file_name": obj["Key"].split("/")[-1] if "/" in obj["Key"] else obj["Key"],
                        "size": obj.get("Size", 0)
                    })
        except Exception as e:
            logger.error("Failed to list documents for tenant %s: %s", tenant_id, e)
        return docs

    def fetch_and_extract_text(self, object_key: str, file_name: str, content_type: Optional[str] = None) -> str:
        """Fetches an object from S3 and extracts its text based on file extension or content type."""
        if not self.s3_client:
            raise RuntimeError("S3 client not initialized. Ensure AWS_ENABLED=true and credentials are set.")

        logger.info("Fetching document %s from S3 bucket %s", object_key, self.bucket)
        response = self.s3_client.get_object(Bucket=self.bucket, Key=object_key)
        body = response["Body"].read()

        ext = file_name.split(".")[-1].lower() if "." in file_name else ""
        
        # 1. Plain text extraction
        if ext in ["txt", "csv", "md"] or (content_type and "text/" in content_type):
            try:
                return body.decode("utf-8")
            except UnicodeDecodeError:
                return body.decode("latin-1", errors="replace")

        # 2. JSON extraction
        if ext == "json" or (content_type and "application/json" in content_type):
            try:
                data = json.loads(body.decode("utf-8"))
                # Dump it back to a formatted string or just return the raw string
                return json.dumps(data, indent=2)
            except Exception as e:
                logger.warning("Failed to parse JSON %s: %s", file_name, e)
                return body.decode("utf-8", errors="replace")

        # 3. PDF extraction
        if ext == "pdf" or (content_type and "application/pdf" in content_type):
            try:
                import pypdf
                reader = pypdf.PdfReader(io.BytesIO(body))
                text_parts = []
                for page in reader.pages:
                    text_parts.append(page.extract_text())
                return "\n".join(text_parts)
            except Exception as e:
                logger.warning("Failed to extract PDF text from %s: %s", file_name, e)
                return ""

        # Fallback for unknown types — try to decode as utf-8
        try:
            return body.decode("utf-8")
        except UnicodeDecodeError:
            logger.warning("Unsupported binary format for %s", file_name)
            return ""

    def simulate_remediation(self, object_key: str, action: str) -> dict:
        """Simulates a remediation action (REPORT ONLY mode)."""
        logger.info("Simulating remediation action '%s' on %s", action, object_key)
        return {
            "connector": "S3Document",
            "control": object_key,
            "status": "success",
            "details": f"Simulated remediation: {action} on {object_key}"
        }
