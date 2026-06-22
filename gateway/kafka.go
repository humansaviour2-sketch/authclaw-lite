package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"strings"
	"time"

	"github.com/segmentio/kafka-go"
)

// kafkaWriter is the package-level Kafka writer; nil when Kafka is unavailable.
var kafkaWriter *kafka.Writer

// kafkaDLQWriter writes to the audit.deadletter topic for unprocessable messages.
var kafkaDLQWriter *kafka.Writer

// InitKafkaProducer configures the Kafka writers using KAFKA_BROKERS env var.
// If the variable is unset, producers are left nil and events fall back to stdout.
func InitKafkaProducer() {
	brokers := os.Getenv("KAFKA_BROKERS")
	if strings.TrimSpace(brokers) == "" {
		log.Println("Kafka producers disabled; audit events will use local fallbacks")
		return
	}

	brokerList := strings.Split(brokers, ",")

	kafkaWriter = &kafka.Writer{
		Addr:                   kafka.TCP(brokerList...),
		Topic:                  "gateway.traffic",
		Balancer:               &kafka.LeastBytes{},
		BatchTimeout:           10 * time.Millisecond,
		Async:                  true,
		AllowAutoTopicCreation: true,
	}

	kafkaDLQWriter = &kafka.Writer{
		Addr:                   kafka.TCP(brokerList...),
		Topic:                  "audit.deadletter",
		Balancer:               &kafka.LeastBytes{},
		BatchTimeout:           10 * time.Millisecond,
		Async:                  true,
		AllowAutoTopicCreation: true,
	}

	log.Printf("Kafka producers initialised (brokers: %s, topics: gateway.traffic, audit.deadletter)", brokers)
}

// PublishAuditEvent serialises the event to JSON and writes it asynchronously to Kafka.
// Returns an error if serialisation fails; Kafka write errors are logged and swallowed.
func PublishAuditEvent(event *AuditEvent) error {
	if kafkaWriter == nil {
		return nil // Kafka not configured — caller falls back to stdout
	}

	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err = kafkaWriter.WriteMessages(ctx, kafka.Message{
		Key:   []byte(event.TenantID),
		Value: payload,
	})
	if err != nil {
		// Non-fatal: log and continue so request path is not affected.
		log.Printf("[KAFKA] Failed to publish audit event: %v", err)
	}

	return nil
}

// DLQMessage is the envelope written to audit.deadletter on consumer failure.
type DLQMessage struct {
	OriginalPayload json.RawMessage `json:"original_payload"`
	ErrorReason     string          `json:"error_reason"`
	FailedAt        time.Time       `json:"failed_at"`
	TenantID        string          `json:"tenant_id,omitempty"`
	RequestID       string          `json:"request_id,omitempty"`
}

// PublishToDLQ writes a failed message envelope to the audit.deadletter topic.
// It is non-blocking: write errors are only logged.
func PublishToDLQ(originalPayload []byte, errorReason, tenantID, requestID string) {
	if kafkaDLQWriter == nil {
		log.Printf("[DLQ] Writer not initialised — dropping failed message (reason: %s)", errorReason)
		return
	}

	dlq := DLQMessage{
		OriginalPayload: json.RawMessage(originalPayload),
		ErrorReason:     errorReason,
		FailedAt:        time.Now().UTC(),
		TenantID:        tenantID,
		RequestID:       requestID,
	}

	envelope, err := json.Marshal(dlq)
	if err != nil {
		log.Printf("[DLQ] Failed to marshal DLQ envelope: %v", err)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := kafkaDLQWriter.WriteMessages(ctx, kafka.Message{
		Key:   []byte(tenantID),
		Value: envelope,
	}); err != nil {
		log.Printf("[DLQ] Failed to publish to audit.deadletter: %v", err)
	} else {
		log.Printf("[DLQ] Published failed event to audit.deadletter (tenant=%s reason=%s)", tenantID, errorReason)
	}
}

// CloseKafkaProducer gracefully flushes and closes both Kafka writers on shutdown.
func CloseKafkaProducer() {
	for _, w := range []*kafka.Writer{kafkaWriter, kafkaDLQWriter} {
		if w != nil {
			if err := w.Close(); err != nil {
				log.Printf("[KAFKA] Error closing writer: %v", err)
			}
		}
	}
}
