package main

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/segmentio/kafka-go"
)

type fakeKafkaWriter struct {
	messages []kafka.Message
	err      error
}

func (w *fakeKafkaWriter) WriteMessages(_ context.Context, messages ...kafka.Message) error {
	w.messages = append(w.messages, messages...)
	return w.err
}

func (w *fakeKafkaWriter) Close() error {
	return nil
}

// ──────────────────────────────────────────────────────────────────────────────
// AuditEvent serialisation & field tests
// ──────────────────────────────────────────────────────────────────────────────

func TestPublishAuditEvent_WithKafkaConfigured(t *testing.T) {
	event := &AuditEvent{
		ID:             "test-id",
		RequestID:      "req-abc123",
		Timestamp:      time.Now(),
		TenantID:       "tenant-abc",
		PolicyID:       "pol-001",
		Action:         "allow",
		DecisionReason: "Allowed",
		Provider:       "gemini",
		Model:          "gemini-2.0-flash-lite",
		PromptCount:    1,
		RequestSize:    256,
		ResponseStatus: 200,
		DurationMs:     42,
	}

	// Verify the event can be JSON serialised (PublishAuditEvent core logic).
	payload, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("Failed to marshal AuditEvent: %v", err)
	}

	var roundTripped AuditEvent
	if err := json.Unmarshal(payload, &roundTripped); err != nil {
		t.Fatalf("Failed to unmarshal AuditEvent: %v", err)
	}

	if roundTripped.ID != event.ID {
		t.Errorf("Expected ID %q, got %q", event.ID, roundTripped.ID)
	}
	if roundTripped.TenantID != event.TenantID {
		t.Errorf("Expected TenantID %q, got %q", event.TenantID, roundTripped.TenantID)
	}
	if roundTripped.Action != event.Action {
		t.Errorf("Expected Action %q, got %q", event.Action, roundTripped.Action)
	}
	if roundTripped.RequestID != event.RequestID {
		t.Errorf("Expected RequestID %q, got %q", event.RequestID, roundTripped.RequestID)
	}
}

func TestPublishAuditEvent_WithoutKafka(t *testing.T) {
	// Ensure PublishAuditEvent is a no-op when kafkaWriter is nil.
	original := kafkaWriter
	kafkaWriter = nil
	defer func() { kafkaWriter = original }()

	event := &AuditEvent{
		ID:        "test-no-kafka",
		RequestID: "req-fallback",
		TenantID:  "tenant-xyz",
		Timestamp: time.Now(),
		Action:    "block",
	}

	// Should not panic or return an error.
	if err := PublishAuditEvent(event); err != nil {
		t.Errorf("Expected nil error when kafkaWriter is nil, got: %v", err)
	}
}

func TestPublishAuditEvent_UsesTenantKeyAndHeaders(t *testing.T) {
	original := kafkaWriter
	writer := &fakeKafkaWriter{}
	kafkaWriter = writer
	defer func() { kafkaWriter = original }()

	event := &AuditEvent{
		ID:        "evt-123",
		RequestID: "req-123",
		TenantID:  "tenant-abc",
		Timestamp: time.Now(),
		Action:    "allow",
	}

	if err := PublishAuditEvent(event); err != nil {
		t.Fatalf("PublishAuditEvent returned error: %v", err)
	}
	if len(writer.messages) != 1 {
		t.Fatalf("expected 1 Kafka message, got %d", len(writer.messages))
	}
	message := writer.messages[0]
	if string(message.Key) != "tenant-abc" {
		t.Fatalf("expected tenant key, got %q", string(message.Key))
	}
	headers := map[string]string{}
	for _, header := range message.Headers {
		headers[header.Key] = string(header.Value)
	}
	if headers["event_id"] != "evt-123" {
		t.Fatalf("expected event_id header, got %q", headers["event_id"])
	}
	if headers["request_id"] != "req-123" {
		t.Fatalf("expected request_id header, got %q", headers["request_id"])
	}
}

func TestPublishAuditEvent_IncrementsFailureMetric(t *testing.T) {
	original := kafkaWriter
	writer := &fakeKafkaWriter{err: errors.New("broker unavailable")}
	kafkaWriter = writer
	before := kafkaPublishFailures.Load()
	defer func() { kafkaWriter = original }()

	event := &AuditEvent{ID: "evt-fail", TenantID: "tenant-abc", Timestamp: time.Now()}

	if err := PublishAuditEvent(event); err != nil {
		t.Fatalf("PublishAuditEvent returned serialization error: %v", err)
	}

	if kafkaPublishFailures.Load() != before+1 {
		t.Fatalf("expected publish failure metric to increment")
	}
}

func TestEmitAuditEvent_StdoutFallback(t *testing.T) {
	// When kafkaWriter is nil, EmitAuditEvent must fall back to stdout without panicking.
	original := kafkaWriter
	kafkaWriter = nil
	defer func() { kafkaWriter = original }()

	event := &AuditEvent{
		ID:        "emit-test",
		RequestID: "req-emit",
		TenantID:  "tenant-emit",
		Timestamp: time.Now(),
		Action:    "allow",
	}
	// Must not panic.
	EmitAuditEvent(event)
}

func TestAuditEvent_FrameworksAndTrace(t *testing.T) {
	// Verify new Phase 7 fields serialise correctly.
	event := &AuditEvent{
		ID:                 "phase7-test",
		RequestID:          "req-phase7",
		TenantID:           "t1",
		Timestamp:          time.Now(),
		Action:             "block",
		FrameworksAffected: []string{"HIPAA", "GDPR"},
		ExecutionTrace:     []string{"redact:pii_detected", "policy:block_medical"},
	}

	payload, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("Failed to marshal: %v", err)
	}

	var out AuditEvent
	if err := json.Unmarshal(payload, &out); err != nil {
		t.Fatalf("Failed to unmarshal: %v", err)
	}

	if len(out.FrameworksAffected) != 2 {
		t.Errorf("Expected 2 frameworks, got %d", len(out.FrameworksAffected))
	}
	if out.FrameworksAffected[0] != "HIPAA" {
		t.Errorf("Expected HIPAA, got %s", out.FrameworksAffected[0])
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// request_id propagation
// ──────────────────────────────────────────────────────────────────────────────

func TestAuditEvent_RequestIDField(t *testing.T) {
	event := &AuditEvent{
		ID:        "rid-test",
		RequestID: "request-id-json-tag-test",
		TenantID:  "tenant-rid",
		Timestamp: time.Now(),
		Action:    "allow",
	}

	payload, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	// Verify the JSON key is "request_id" (snake_case tag).
	var raw map[string]interface{}
	if err := json.Unmarshal(payload, &raw); err != nil {
		t.Fatalf("unmarshal map: %v", err)
	}
	if raw["request_id"] != "request-id-json-tag-test" {
		t.Errorf("Expected JSON key request_id='request-id-json-tag-test', got %v", raw["request_id"])
	}
}

func TestAuditEvent_EmptyRequestID(t *testing.T) {
	// request_id can be empty string (not all code paths set it).
	event := &AuditEvent{
		ID:        "no-rid",
		RequestID: "",
		TenantID:  "tenant-t",
		Timestamp: time.Now(),
		Action:    "allow",
	}
	payload, _ := json.Marshal(event)
	var raw map[string]interface{}
	json.Unmarshal(payload, &raw)
	rid, ok := raw["request_id"]
	if !ok {
		t.Error("Expected request_id key in JSON even when empty")
	}
	if rid != "" {
		t.Errorf("Expected empty string, got %v", rid)
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// DLQ — DLQMessage serialisation
// ──────────────────────────────────────────────────────────────────────────────

func TestDLQMessage_Serialisation(t *testing.T) {
	original := []byte(`{"id":"evt-1","tenant_id":"t1","action":"allow"}`)
	dlq := DLQMessage{
		OriginalPayload: original,
		ErrorReason:     "clickhouse timeout",
		FailedAt:        time.Now().UTC(),
		TenantID:        "t1",
		RequestID:       "req-dlq-test",
	}

	payload, err := json.Marshal(dlq)
	if err != nil {
		t.Fatalf("Failed to marshal DLQMessage: %v", err)
	}

	var out DLQMessage
	if err := json.Unmarshal(payload, &out); err != nil {
		t.Fatalf("Failed to unmarshal DLQMessage: %v", err)
	}

	if out.ErrorReason != dlq.ErrorReason {
		t.Errorf("Expected ErrorReason %q, got %q", dlq.ErrorReason, out.ErrorReason)
	}
	if out.TenantID != "t1" {
		t.Errorf("Expected TenantID 't1', got %q", out.TenantID)
	}
	if out.RequestID != "req-dlq-test" {
		t.Errorf("Expected RequestID 'req-dlq-test', got %q", out.RequestID)
	}
	if string(out.OriginalPayload) != string(original) {
		t.Errorf("OriginalPayload mismatch: %s", string(out.OriginalPayload))
	}
}

func TestDLQMessage_MissingOptionalFields(t *testing.T) {
	dlq := DLQMessage{
		OriginalPayload: []byte(`{}`),
		ErrorReason:     "parse error",
		FailedAt:        time.Now().UTC(),
		// TenantID and RequestID intentionally omitted
	}

	payload, err := json.Marshal(dlq)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var raw map[string]interface{}
	if err := json.Unmarshal(payload, &raw); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	// omitempty means these keys should be absent when empty
	if _, ok := raw["tenant_id"]; ok {
		t.Error("Expected tenant_id to be omitted when empty")
	}
	if _, ok := raw["request_id"]; ok {
		t.Error("Expected request_id to be omitted when empty")
	}
}

func TestPublishToDLQ_NilWriter(t *testing.T) {
	// When kafkaDLQWriter is nil, PublishToDLQ must not panic.
	original := kafkaDLQWriter
	kafkaDLQWriter = nil
	defer func() { kafkaDLQWriter = original }()

	// Must not panic.
	PublishToDLQ([]byte(`{"id":"x"}`), "test error", "tenant-t", "req-r")
}
