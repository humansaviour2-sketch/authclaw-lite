package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"log"
	"sort"
	"strings"
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

const auditGenesisHash = "GENESIS"

func canonicalUUID(value string) string {
	value = strings.TrimSpace(value)
	if len(value) == 32 && !strings.Contains(value, "-") {
		return strings.ToLower(value[0:8] + "-" + value[8:12] + "-" + value[12:16] + "-" + value[16:20] + "-" + value[20:32])
	}
	return strings.ToLower(value)
}

func standardizeAuditTimestamp(ts time.Time) string {
	return ts.UTC().Format("2006-01-02T15:04:05.000Z")
}

func canonicalAuditJSON(event *AuditEvent) string {
	frameworks := append([]string{}, event.FrameworksAffected...)
	sort.Strings(frameworks)
	payload := map[string]interface{}{
		"record_id":           canonicalUUID(event.ID),
		"tenant_id":           canonicalUUID(event.TenantID),
		"timestamp":           standardizeAuditTimestamp(event.Timestamp),
		"actor_id":            "",
		"actor_type":          "gateway",
		"action":              event.Action,
		"policy_id":           event.PolicyID,
		"provider":            event.Provider,
		"model":               event.Model,
		"reason":              event.DecisionReason,
		"prompt_count":        event.PromptCount,
		"request_size":        event.RequestSize,
		"response_status":     event.ResponseStatus,
		"duration_ms":         event.DurationMs,
		"frameworks_affected": frameworks,
		"execution_trace":     "[]",
		"request_id":          event.RequestID,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return "{}"
	}
	return string(data)
}

func hashAuditEvent(event *AuditEvent, priorHash string) string {
	sum := sha256.Sum256([]byte(canonicalAuditJSON(event) + priorHash))
	return hex.EncodeToString(sum[:])
}

func persistAuditMetadata(event *AuditEvent) {
	if event == nil || DB == nil || event.TenantID == "" || event.ID == "" {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	err := RunInTenantTx(ctx, event.TenantID, func(tx *sql.Tx) error {
		priorHash := auditGenesisHash
		if err := tx.QueryRowContext(ctx, `
			SELECT COALESCE(integrity_hash, '')
			FROM audit_log_metadata
			WHERE tenant_id = $1
			  AND COALESCE(integrity_hash, '') <> ''
			ORDER BY created_at DESC, record_id DESC
			LIMIT 1
		`, event.TenantID).Scan(&priorHash); err != nil && err != sql.ErrNoRows {
			return err
		}
		if priorHash == "" {
			priorHash = auditGenesisHash
		}
		integrityHash := hashAuditEvent(event, priorHash)

		_, err := tx.ExecContext(ctx, `
			INSERT INTO audit_log_metadata (
				id, tenant_id, record_id, actor_id, action, request_id, policy_id,
				provider, model, reason, prompt_count, request_size, response_status,
				duration_ms, frameworks_affected, created_at, prior_hash, integrity_hash
			)
			VALUES (
				gen_random_uuid(), $1, $2::uuid, NULL, $3, $4, NULLIF($5, '')::uuid,
				$6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
			)
			ON CONFLICT (record_id) DO NOTHING
		`,
			event.TenantID,
			event.ID,
			event.Action,
			event.RequestID,
			event.PolicyID,
			event.Provider,
			event.Model,
			event.DecisionReason,
			event.PromptCount,
			event.RequestSize,
			event.ResponseStatus,
			event.DurationMs,
			pq.Array(event.FrameworksAffected),
			event.Timestamp,
			priorHash,
			integrityHash,
		)
		return err
	})
	if err != nil {
		log.Printf("[AUDIT] Postgres metadata fallback failed: %v", err)
	}
}
