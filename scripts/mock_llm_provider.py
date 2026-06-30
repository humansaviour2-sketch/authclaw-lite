#!/usr/bin/env python3
"""Minimal local LLM provider for gateway benchmark runs."""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class MockProviderHandler(BaseHTTPRequestHandler):
    server_version = "AuthClawMockProvider/1.0"

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_json(200, {"status": "ok"})
            return
        self.send_json(404, {"error": "not_found"})

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw_body = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            payload = {}

        text = extract_text(payload)
        if "streamGenerateContent" in self.path or payload.get("stream") is True:
            self.send_stream(text)
            return

        if ":generateContent" in self.path:
            self.send_json(
                200,
                {
                    "candidates": [
                        {
                            "content": {
                                "parts": [{"text": f"Mock provider response for: {text}"}],
                                "role": "model",
                            }
                        }
                    ]
                },
            )
            return

        if self.path.startswith("/v1/chat/completions"):
            self.send_json(
                200,
                {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": f"Mock provider response for: {text}",
                            }
                        }
                    ]
                },
            )
            return

        if self.path.startswith("/v1/messages"):
            self.send_json(
                200,
                {"content": [{"type": "text", "text": f"Mock provider response for: {text}"}]},
            )
            return

        self.send_json(200, {"text": f"Mock provider response for: {text}"})

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_stream(self, text: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        chunks = [
            {"candidates": [{"content": {"parts": [{"text": "Mock stream response for: "}]}}]},
            {"candidates": [{"content": {"parts": [{"text": text}]}}]},
        ]
        for chunk in chunks:
            self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode("utf-8"))
            self.wfile.flush()
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()

    def log_message(self, format: str, *args: object) -> None:
        return


def extract_text(payload: dict) -> str:
    texts: list[str] = []
    for content in payload.get("contents", []):
        for part in content.get("parts", []):
            value = part.get("text")
            if value:
                texts.append(value)
    for message in payload.get("messages", []):
        value = message.get("content")
        if isinstance(value, str):
            texts.append(value)
        elif isinstance(value, list):
            for part in value:
                if isinstance(part, dict) and part.get("text"):
                    texts.append(part["text"])
    return " ".join(texts)[:500] or "hello"


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", 18081), MockProviderHandler)
    print("Mock LLM provider listening on http://0.0.0.0:18081", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
