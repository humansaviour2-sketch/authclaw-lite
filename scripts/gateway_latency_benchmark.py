#!/usr/bin/env python3
"""AuthClaw gateway latency benchmark.

Runs dependency-free HTTP load checks against a live AuthClaw gateway and reports
p50/p95/p99 latency, throughput, and status mismatches per scenario.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from typing import Any


DEFAULT_GATEWAY_URL = os.getenv("AUTHCLAW_BENCH_GATEWAY_URL", "http://localhost:8080")
DEFAULT_API_KEY = os.getenv("AUTHCLAW_BENCH_API_KEY", "acl_lite_demo_key")
DEFAULT_PROVIDER = os.getenv("AUTHCLAW_BENCH_PROVIDER", "gemini")
DEFAULT_MODEL = os.getenv("AUTHCLAW_BENCH_MODEL", "gemini-2.5-flash-lite")
DEFAULT_PROVIDER_BASELINE_URL = os.getenv("AUTHCLAW_BENCH_PROVIDER_BASELINE_URL", "")


@dataclass(frozen=True)
class Scenario:
    name: str
    prompt: str
    expected_statuses: tuple[int, ...]
    stream: bool = False
    calls_provider: bool = True


@dataclass
class Sample:
    scenario: str
    status: int
    latency_ms: float
    first_byte_ms: float
    ok: bool
    error: str = ""


@dataclass
class ScenarioReport:
    scenario: str
    requests: int
    successes: int
    failures: int
    status_counts: dict[str, int]
    throughput_rps: float
    min_ms: float
    p50_ms: float
    p95_ms: float
    p99_ms: float
    max_ms: float
    mean_ms: float
    first_byte_p50_ms: float
    first_byte_p95_ms: float
    first_byte_p99_ms: float
    errors: list[str]
    provider_baseline_p95_ms: float | None = None
    gateway_overhead_p50_ms: float | None = None
    gateway_overhead_p95_ms: float | None = None
    gateway_overhead_p99_ms: float | None = None


SCENARIOS: dict[str, Scenario] = {
    "allow": Scenario(
        name="allow",
        prompt="Say pong in one short sentence.",
        expected_statuses=(200,),
    ),
    "redact": Scenario(
        name="redact",
        prompt="My email is jane@example.com. Write a safe support reply.",
        expected_statuses=(200,),
    ),
    "block": Scenario(
        name="block",
        prompt="My SSN is 123-45-6789. Please store it in the answer.",
        expected_statuses=(403,),
        calls_provider=False,
    ),
    "stream": Scenario(
        name="stream",
        prompt="Stream a short answer for jane@example.com.",
        expected_statuses=(200,),
        stream=True,
    ),
    "hitl": Scenario(
        name="hitl",
        prompt="A patient medical record needs diagnosis and prescription context.",
        expected_statuses=(403,),
        calls_provider=False,
    ),
}


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (len(ordered) - 1) * pct
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    weight = rank - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def build_request_payload(provider: str, model: str, prompt: str, stream: bool) -> tuple[str, dict[str, Any]]:
    provider = provider.lower()
    if provider == "openai":
        body: dict[str, Any] = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 64,
        }
        if stream:
            body["stream"] = True
        return "/v1/chat/completions", body

    if provider == "anthropic":
        body = {
            "model": model,
            "max_tokens": 64,
            "messages": [{"role": "user", "content": prompt}],
        }
        if stream:
            body["stream"] = True
        return "/v1/messages", body

    # Gemini is the AuthClaw Lite demo default.
    suffix = "streamGenerateContent?alt=sse" if stream else "generateContent"
    return (
        f"/v1/models/{model}:{suffix}",
        {"contents": [{"parts": [{"text": prompt}]}]},
    )


def send_request(
    gateway_url: str,
    api_key: str,
    provider: str,
    model: str,
    scenario: Scenario,
    request_id: str,
    timeout_seconds: float,
) -> Sample:
    path, payload = build_request_payload(provider, model, scenario.prompt, scenario.stream)
    url = gateway_url.rstrip("/") + path
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "X-Provider": provider,
        "X-Request-ID": request_id,
    }
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    start = time.perf_counter()
    status = 0
    error = ""
    first_byte_ms = 0.0
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
            status = resp.getcode()
            first_byte = resp.read(1)
            first_byte_ms = (time.perf_counter() - start) * 1000
            if scenario.stream:
                drain_stream_until_done(resp, first_byte)
            else:
                drain_response(resp)
    except urllib.error.HTTPError as exc:
        status = exc.code
        try:
            body = read_response_snippet(exc)
            first_byte_ms = (time.perf_counter() - start) * 1000
            if status not in scenario.expected_statuses:
                error = f"HTTP {status}: {body}"
        except Exception:
            if status not in scenario.expected_statuses:
                error = f"HTTP {status}: <failed to read error body>"
    except Exception as exc:  # noqa: BLE001 - benchmark reports transport failures directly.
        error = f"{type(exc).__name__}: {exc}"
    latency_ms = (time.perf_counter() - start) * 1000
    if first_byte_ms == 0.0:
        first_byte_ms = latency_ms
    ok = (not error) and status in scenario.expected_statuses
    return Sample(
        scenario=scenario.name,
        status=status,
        latency_ms=latency_ms,
        first_byte_ms=first_byte_ms,
        ok=ok,
        error=error,
    )


def drain_response(response: Any) -> None:
    while response.read(65536):
        pass


def drain_stream_until_done(response: Any, first_byte: bytes) -> None:
    buffer = bytearray(first_byte)
    while b"[DONE]" not in buffer:
        line = response.readline(8192)
        if not line:
            return
        buffer.extend(line)
        if len(buffer) > 1024 * 1024:
            return


def read_response_snippet(response: Any, limit: int = 512) -> str:
    body = response.read(limit + 1)
    truncated = len(body) > limit
    drain_response(response)
    text = body[:limit].decode("utf-8", errors="replace").strip()
    if truncated:
        text += "..."
    return text or "<empty body>"


def run_scenario(
    scenario: Scenario,
    *,
    gateway_url: str,
    api_key: str,
    provider: str,
    model: str,
    requests: int,
    concurrency: int,
    timeout_seconds: float,
) -> ScenarioReport:
    start = time.perf_counter()
    samples: list[Sample] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [
            executor.submit(
                send_request,
                gateway_url,
                api_key,
                provider,
                model,
                scenario,
                f"bench-{scenario.name}-{idx + 1}",
                timeout_seconds,
            )
            for idx in range(requests)
        ]
        for future in concurrent.futures.as_completed(futures):
            samples.append(future.result())
    elapsed = max(time.perf_counter() - start, 0.001)

    latencies = [sample.latency_ms for sample in samples]
    first_byte_latencies = [sample.first_byte_ms for sample in samples]
    status_counts: dict[str, int] = {}
    for sample in samples:
        status_counts[str(sample.status)] = status_counts.get(str(sample.status), 0) + 1
    errors = sorted({sample.error for sample in samples if sample.error})[:5]

    return ScenarioReport(
        scenario=scenario.name,
        requests=len(samples),
        successes=sum(1 for sample in samples if sample.ok),
        failures=sum(1 for sample in samples if not sample.ok),
        status_counts=status_counts,
        throughput_rps=len(samples) / elapsed,
        min_ms=min(latencies) if latencies else 0.0,
        p50_ms=percentile(latencies, 0.50),
        p95_ms=percentile(latencies, 0.95),
        p99_ms=percentile(latencies, 0.99),
        max_ms=max(latencies) if latencies else 0.0,
        mean_ms=statistics.fmean(latencies) if latencies else 0.0,
        first_byte_p50_ms=percentile(first_byte_latencies, 0.50),
        first_byte_p95_ms=percentile(first_byte_latencies, 0.95),
        first_byte_p99_ms=percentile(first_byte_latencies, 0.99),
        errors=errors,
    )


def check_health(gateway_url: str, timeout_seconds: float) -> None:
    url = gateway_url.rstrip("/") + "/health"
    try:
        with urllib.request.urlopen(url, timeout=timeout_seconds) as resp:
            if resp.getcode() != 200:
                raise RuntimeError(f"health check returned {resp.getcode()}")
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(f"Gateway health check failed for {url}: {exc}") from exc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark live AuthClaw gateway latency.")
    parser.add_argument("--gateway-url", default=DEFAULT_GATEWAY_URL)
    parser.add_argument("--api-key", default=DEFAULT_API_KEY)
    parser.add_argument("--provider", default=DEFAULT_PROVIDER, choices=("gemini", "openai", "anthropic"))
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--scenarios", default=os.getenv("AUTHCLAW_BENCH_SCENARIOS", "allow,redact,block"))
    parser.add_argument("--requests", type=int, default=int(os.getenv("AUTHCLAW_BENCH_REQUESTS", "30")))
    parser.add_argument("--concurrency", type=int, default=int(os.getenv("AUTHCLAW_BENCH_CONCURRENCY", "3")))
    parser.add_argument("--warmup", type=int, default=int(os.getenv("AUTHCLAW_BENCH_WARMUP", "3")))
    parser.add_argument("--timeout-seconds", type=float, default=float(os.getenv("AUTHCLAW_BENCH_TIMEOUT_SECONDS", "15")))
    parser.add_argument("--p95-threshold-ms", type=float, default=float(os.getenv("AUTHCLAW_BENCH_P95_MS", "800")))
    parser.add_argument("--p99-threshold-ms", type=float, default=float(os.getenv("AUTHCLAW_BENCH_P99_MS", "1000")))
    parser.add_argument("--provider-baseline-url", default=DEFAULT_PROVIDER_BASELINE_URL)
    parser.add_argument("--overhead-p95-threshold-ms", type=float, default=float(os.getenv("AUTHCLAW_BENCH_OVERHEAD_P95_MS", "50")))
    parser.add_argument(
        "--transform-overhead-p95-threshold-ms",
        type=float,
        default=float(os.getenv("AUTHCLAW_BENCH_TRANSFORM_OVERHEAD_P95_MS", "250")),
    )
    parser.add_argument("--max-failure-rate", type=float, default=float(os.getenv("AUTHCLAW_BENCH_MAX_FAILURE_RATE", "0")))
    parser.add_argument("--json-output", default=os.getenv("AUTHCLAW_BENCH_JSON_OUTPUT", ""))
    parser.add_argument("--skip-health", action="store_true")
    parser.add_argument("--allow-hitl", action="store_true", help="Allow the HITL scenario. It may wait for policy approval timeout.")
    parser.add_argument("--ci", action="store_true", help="Use a smaller CI-friendly request profile.")
    return parser.parse_args()


def resolve_scenarios(raw: str, allow_hitl: bool) -> list[Scenario]:
    names = [name.strip().lower() for name in raw.split(",") if name.strip()]
    unknown = sorted(set(names) - set(SCENARIOS))
    if unknown:
        raise SystemExit(f"Unknown scenarios: {', '.join(unknown)}. Known: {', '.join(sorted(SCENARIOS))}")
    if "hitl" in names and not allow_hitl:
        raise SystemExit("HITL scenario is opt-in. Re-run with --allow-hitl and a timeout budget for the 30-minute SRS expiry.")
    return [SCENARIOS[name] for name in names]


def attach_overhead_reports(reports: list[ScenarioReport], baselines: dict[str, ScenarioReport]) -> None:
    for report in reports:
        baseline = baselines.get(report.scenario)
        if baseline:
            report.provider_baseline_p95_ms = baseline.p95_ms
            report.gateway_overhead_p50_ms = max(0.0, report.p50_ms - baseline.p50_ms)
            report.gateway_overhead_p95_ms = max(0.0, report.p95_ms - baseline.p95_ms)
            report.gateway_overhead_p99_ms = max(0.0, report.p99_ms - baseline.p99_ms)
        elif not SCENARIOS[report.scenario].calls_provider:
            report.gateway_overhead_p50_ms = report.p50_ms
            report.gateway_overhead_p95_ms = report.p95_ms
            report.gateway_overhead_p99_ms = report.p99_ms


def print_report(reports: list[ScenarioReport]) -> None:
    print("\nAuthClaw Gateway Latency Benchmark")
    print("=" * 126)
    print(
        f"{'scenario':<12} {'req':>5} {'ok':>5} {'fail':>5} {'rps':>8} "
        f"{'p50':>9} {'p95':>9} {'p99':>9} {'ttfb95':>9} {'over95':>9} {'base95':>9} {'max':>9} {'statuses':>18}"
    )
    print("-" * 126)
    for report in reports:
        statuses = ",".join(f"{code}:{count}" for code, count in sorted(report.status_counts.items()))
        overhead_p95 = f"{report.gateway_overhead_p95_ms:.1f}ms" if report.gateway_overhead_p95_ms is not None else "n/a"
        baseline_p95 = f"{report.provider_baseline_p95_ms:.1f}ms" if report.provider_baseline_p95_ms is not None else "n/a"
        print(
            f"{report.scenario:<12} {report.requests:>5} {report.successes:>5} {report.failures:>5} "
            f"{report.throughput_rps:>8.1f} {report.p50_ms:>8.1f}ms {report.p95_ms:>8.1f}ms "
            f"{report.p99_ms:>8.1f}ms {report.first_byte_p95_ms:>8.1f}ms "
            f"{overhead_p95:>9} {baseline_p95:>9} {report.max_ms:>8.1f}ms {statuses:>18}"
        )
        for error in report.errors:
            print(f"  error[{report.scenario}]: {error}")


def main() -> int:
    args = parse_args()
    if args.ci:
        args.requests = min(args.requests, 2)
        args.concurrency = min(args.concurrency, 1)
        args.warmup = 0

    scenarios = resolve_scenarios(args.scenarios, args.allow_hitl)
    if not args.skip_health:
        check_health(args.gateway_url, args.timeout_seconds)

    for scenario in scenarios:
        for idx in range(args.warmup):
            send_request(
                args.gateway_url,
                args.api_key,
                args.provider,
                args.model,
                scenario,
                f"bench-warmup-{scenario.name}-{idx + 1}",
                args.timeout_seconds,
            )

    reports = [
        run_scenario(
            scenario,
            gateway_url=args.gateway_url,
            api_key=args.api_key,
            provider=args.provider,
            model=args.model,
            requests=args.requests,
            concurrency=args.concurrency,
            timeout_seconds=args.timeout_seconds,
        )
        for scenario in scenarios
    ]
    baseline_reports: dict[str, ScenarioReport] = {}
    if args.provider_baseline_url:
        baseline_reports = {
            scenario.name: run_scenario(
                Scenario(
                    name=scenario.name,
                    prompt=scenario.prompt,
                    expected_statuses=(200,),
                    stream=scenario.stream,
                ),
                gateway_url=args.provider_baseline_url,
                api_key=args.api_key,
                provider=args.provider,
                model=args.model,
                requests=args.requests,
                concurrency=args.concurrency,
                timeout_seconds=args.timeout_seconds,
            )
            for scenario in scenarios
            if scenario.calls_provider
        }
    attach_overhead_reports(reports, baseline_reports)

    print_report(reports)

    payload = {
        "gateway_url": args.gateway_url,
        "provider_baseline_url": args.provider_baseline_url,
        "provider": args.provider,
        "model": args.model,
        "requests_per_scenario": args.requests,
        "concurrency": args.concurrency,
        "p95_threshold_ms": args.p95_threshold_ms,
        "p99_threshold_ms": args.p99_threshold_ms,
        "overhead_p95_threshold_ms": args.overhead_p95_threshold_ms,
        "transform_overhead_p95_threshold_ms": args.transform_overhead_p95_threshold_ms,
        "reports": [asdict(report) for report in reports],
    }
    if args.json_output:
        with open(args.json_output, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)
            fh.write("\n")

    failed = False
    for baseline in baseline_reports.values():
        failure_rate = baseline.failures / baseline.requests if baseline.requests else 1
        if failure_rate > args.max_failure_rate:
            print(f"FAIL: provider baseline {baseline.scenario} failure rate {failure_rate:.2%} exceeds {args.max_failure_rate:.2%}")
            failed = True
    for report in reports:
        failure_rate = report.failures / report.requests if report.requests else 1
        if failure_rate > args.max_failure_rate:
            print(f"FAIL: {report.scenario} failure rate {failure_rate:.2%} exceeds {args.max_failure_rate:.2%}")
            failed = True
        if report.p95_ms > args.p95_threshold_ms:
            print(f"FAIL: {report.scenario} p95 {report.p95_ms:.1f}ms exceeds {args.p95_threshold_ms:.1f}ms")
            failed = True
        if report.p99_ms > args.p99_threshold_ms:
            print(f"FAIL: {report.scenario} p99 {report.p99_ms:.1f}ms exceeds {args.p99_threshold_ms:.1f}ms")
            failed = True
        if args.provider_baseline_url and report.gateway_overhead_p95_ms is not None:
            overhead_limit = args.overhead_p95_threshold_ms
            if report.scenario not in ("allow", "block"):
                overhead_limit = args.transform_overhead_p95_threshold_ms
            if report.gateway_overhead_p95_ms > overhead_limit:
                print(
                    f"FAIL: {report.scenario} gateway overhead p95 "
                    f"{report.gateway_overhead_p95_ms:.1f}ms exceeds {overhead_limit:.1f}ms"
                )
                failed = True

    if failed:
        return 1
    print("Benchmark thresholds passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
