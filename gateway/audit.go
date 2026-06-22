package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"time"

	"github.com/lib/pq"
)

// AuditEvent represents the schema of traffic events logged by the gateway.
type AuditEvent struct {
	ID                 string    `json:"id"`
	RequestID          string    `json:"request_id"`
	Timestamp          time.Time `json:"timestamp"`
	TenantID           string    `json:"tenant_id"`
	PolicyID           string    `json:"policy_id"`
	Action             string    `json:"action"`
	DecisionReason     string    `json:"reason"`
	Provider           string    `json:"provider"`
	Model              string    `json:"model"`
	PromptCount        int       `json:"prompt_count"`
	RequestSize        int       `json:"request_size"`
	ResponseStatus     int       `json:"response_status"`
	DurationMs         int64     `json:"duration_ms"`
	FrameworksAffected []string  `json:"frameworks_affected,omitempty"`
	ExecutionTrace     []string  `json:"execution_trace,omitempty"`
}

// EmitAuditEvent publishes the event to Kafka when the producer is initialised,
// and falls back to a structured stdout log if Kafka is unavailable.
// The function is intentionally non-blocking; failures are logged and swallowed.
func EmitAuditEvent(event *AuditEvent) {
	persistAuditMetadata(event)

	// Attempt Kafka publish first.
	if err := PublishAuditEvent(event); err != nil {
		log.Printf("[AUDIT] Kafka serialisation error: %v — falling back to stdout", err)
		logToStdout(event)
		return
	}

	// If kafkaWriter is nil (not configured), also log to stdout as fallback.
	if kafkaWriter == nil {
		logToStdout(event)
	}
}

// logToStdout emits a structured JSON audit log to stdout.
func logToStdout(event *AuditEvent) {
	eventBytes, err := json.Marshal(event)
	if err != nil {
		log.Printf("Failed to marshal audit event: %v", err)
		return
	}
	log.Printf("[AUDIT] %s", string(eventBytes))
}

func persistAuditMetadata(event *AuditEvent) {
	if event == nil || DB == nil || event.TenantID == "" || event.ID == "" {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	err := RunInTenantTx(ctx, event.TenantID, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `
			INSERT INTO audit_log_metadata (
				id, tenant_id, record_id, actor_id, action, frameworks_affected, created_at
			)
			VALUES (
				gen_random_uuid(), $1, $2::uuid, NULL, $3, $4, $5
			)
			ON CONFLICT (record_id) DO NOTHING
		`, event.TenantID, event.ID, event.Action, pq.Array(event.FrameworksAffected), event.Timestamp)
		return err
	})
	if err != nil {
		log.Printf("[AUDIT] Postgres metadata fallback failed: %v", err)
	}
}
