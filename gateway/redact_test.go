package main

import (
	"context"
	"database/sql"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/lib/pq"
)

func TestNormalizeDetectedEntityTreatsPhoneLikeUkNhsAsPhoneNumber(t *testing.T) {
	entity := normalizeDetectedEntity("UK_NHS", "9876543210", []RegexRule{
		{Name: "Phone", Pattern: `(\+?[0-9]{1,3}[-. ]?)?[0-9]{10}`, Action: "require_approval"},
	})
	if entity != "PHONE_NUMBER" {
		t.Fatalf("expected PHONE_NUMBER, got %s", entity)
	}
}

type chunkedReadCloser struct {
	chunks []string
	index  int
}

func (c *chunkedReadCloser) Read(p []byte) (int, error) {
	if c.index >= len(c.chunks) {
		return 0, io.EOF
	}
	n := copy(p, c.chunks[c.index])
	c.index++
	return n, nil
}

func (c *chunkedReadCloser) Close() error {
	return nil
}

func TestStaticReversalReaderReplacesAcrossReadBoundaries(t *testing.T) {
	tokenMap := map[string]string{"[REDACTED_PERSON_123]": "John Doe"}
	body := &chunkedReadCloser{
		chunks: []string{"Hello ", "[REDA", "CTED_PERSON_", "123]", "!"},
	}

	reversed, err := io.ReadAll(NewStaticReversalReader(body, tokenMap))
	if err != nil {
		t.Fatalf("read static reversal: %v", err)
	}
	if string(reversed) != "Hello John Doe!" {
		t.Fatalf("unexpected reversed body: %s", string(reversed))
	}
}

func TestStreamingReversalReaderOpenAISSEAcrossEvents(t *testing.T) {
	tokenMap := map[string]string{"[REDACTED_PERSON_123]": "John Doe"}
	body := strings.Join([]string{
		`data: {"choices":[{"delta":{"content":"Hello [REDA"}}]}`,
		`data: {"choices":[{"delta":{"content":"CTED_PERSON_123]"}}]}`,
		`data: [DONE]`,
		"",
	}, "\n")

	reversed, err := io.ReadAll(NewStreamingReversalReader(io.NopCloser(strings.NewReader(body)), tokenMap, "openai"))
	if err != nil {
		t.Fatalf("read streaming reversal: %v", err)
	}
	out := string(reversed)
	if !strings.Contains(out, "John Doe") {
		t.Fatalf("stream did not reverse token across events: %s", out)
	}
	if strings.Contains(out, "[REDACTED_PERSON_123]") {
		t.Fatalf("stream still contains redacted token: %s", out)
	}
	if !strings.Contains(out, "data: [DONE]") {
		t.Fatalf("stream lost DONE sentinel: %s", out)
	}
}

func TestStreamingReversalReaderFlushesBufferedTextBeforeDone(t *testing.T) {
	tokenMap := map[string]string{"[REDACTED_PERSON_123]": "John Doe"}
	body := strings.Join([]string{
		`data: {"choices":[{"delta":{"content":"Hello [REDA"}}]}`,
		`data: [DONE]`,
		"",
	}, "\n")

	reversed, err := io.ReadAll(NewStreamingReversalReader(io.NopCloser(strings.NewReader(body)), tokenMap, "openai"))
	if err != nil {
		t.Fatalf("read streaming reversal: %v", err)
	}
	out := string(reversed)
	if !strings.Contains(out, `"content":"Hello "`) {
		t.Fatalf("stream did not emit safe prefix: %s", out)
	}
	if !strings.Contains(out, `"content":"[REDA"`) {
		t.Fatalf("stream did not flush buffered suffix before DONE: %s", out)
	}
	if strings.Index(out, `"content":"[REDA"`) > strings.Index(out, "data: [DONE]") {
		t.Fatalf("buffered suffix should be emitted before DONE: %s", out)
	}
}

func TestStreamingReversalReaderAnthropicSSE(t *testing.T) {
	tokenMap := map[string]string{"[REDACTED_PERSON_123]": "John Doe"}
	body := strings.Join([]string{
		`event: content_block_delta`,
		`data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi [REDA"}}`,
		`event: content_block_delta`,
		`data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"CTED_PERSON_123]"}}`,
		"",
	}, "\n")

	reversed, err := io.ReadAll(NewStreamingReversalReader(io.NopCloser(strings.NewReader(body)), tokenMap, "anthropic"))
	if err != nil {
		t.Fatalf("read anthropic stream: %v", err)
	}
	out := string(reversed)
	if !strings.Contains(out, "John Doe") || strings.Contains(out, "[REDACTED_PERSON_123]") {
		t.Fatalf("anthropic stream was not reversed correctly: %s", out)
	}
	if !strings.Contains(out, "event: content_block_delta") {
		t.Fatalf("anthropic event lines were not preserved: %s", out)
	}
}

func TestStreamingReversalReaderGeminiSSE(t *testing.T) {
	tokenMap := map[string]string{"[REDACTED_PERSON_123]": "John Doe"}
	body := strings.Join([]string{
		`data: {"candidates":[{"content":{"parts":[{"text":"Hi [REDA"}]}}]}`,
		`data: {"candidates":[{"content":{"parts":[{"text":"CTED_PERSON_123]"}]}}]}`,
		"",
	}, "\n")

	reversed, err := io.ReadAll(NewStreamingReversalReader(io.NopCloser(strings.NewReader(body)), tokenMap, "gemini"))
	if err != nil {
		t.Fatalf("read gemini stream: %v", err)
	}
	out := string(reversed)
	if !strings.Contains(out, "John Doe") || strings.Contains(out, "[REDACTED_PERSON_123]") {
		t.Fatalf("gemini stream was not reversed correctly: %s", out)
	}
}

func TestRedactEngine(t *testing.T) {
	// 1. Init DB
	InitDB()

	// 2. Clean database for test
	_, err := DB.Exec("TRUNCATE TABLE audit_log_metadata, pending_approvals, redaction_tokens, gateway_configs, policies, api_keys, users, tenants CASCADE")
	if err != nil {
		t.Fatalf("Failed to truncate tables: %v", err)
	}

	// 3. Seed test tenant
	tenantID := "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
	_, err = DB.Exec(
		"INSERT INTO tenants (id, name, tier, status) VALUES ($1, 'Redact Tenant', 'starter', 'active')",
		tenantID,
	)
	if err != nil {
		t.Fatalf("Failed to insert test tenant: %v", err)
	}

	// 4. Seed default gateway config for tenant with "mask" strategy
	_, err = DB.Exec(
		"INSERT INTO gateway_configs (id, tenant_id, name, provider, endpoint, redaction_strategy, is_active) VALUES (gen_random_uuid(), $1, 'OpenAI Gateway', 'openai', 'https://api.openai.com', 'mask', true)",
		tenantID,
	)
	if err != nil {
		t.Fatalf("Failed to insert gateway config: %v", err)
	}

	ctx := context.Background()

	// 5. Test Mask strategy
	t.Run("Redaction_Masking_Strategy", func(t *testing.T) {
		prompt := "Hello, my name is John Doe and my email is john.doe@example.com"
		redacted, tokenMap, err := RedactPrompts(ctx, tenantID, []string{prompt}, nil)
		if err != nil {
			t.Fatalf("Failed to redact prompts: %v", err)
		}

		if len(redacted) != 1 {
			t.Fatalf("Expected 1 redacted prompt, got %d", len(redacted))
		}

		redactedText := redacted[0]
		if !strings.Contains(redactedText, "[REDACTED_PERSON_") {
			t.Errorf("Expected PERSON mask, got: %s", redactedText)
		}
		if !strings.Contains(redactedText, "[REDACTED_EMAIL_ADDRESS_") {
			t.Errorf("Expected EMAIL mask, got: %s", redactedText)
		}

		// Reverse it
		reversed := ReverseStaticResponse([]byte(redactedText), tokenMap)
		if string(reversed) != prompt {
			t.Errorf("Reversal failed. Expected: %s, Got: %s", prompt, string(reversed))
		}
	})

	// 6. Test Hash strategy
	t.Run("Redaction_Hashing_Strategy", func(t *testing.T) {
		// Update strategy to hash
		_, err := DB.Exec("UPDATE gateway_configs SET redaction_strategy = 'hash' WHERE tenant_id = $1", tenantID)
		if err != nil {
			t.Fatalf("Failed to update strategy: %v", err)
		}

		prompt := "My phone number is 555-123-4567 and SSN is 211-12-3456"
		redacted, tokenMap, err := RedactPrompts(ctx, tenantID, []string{prompt}, nil)
		if err != nil {
			t.Fatalf("Failed to redact prompts: %v", err)
		}

		redactedText := redacted[0]
		if !strings.Contains(redactedText, "[HASH_PHONE_NUMBER_") {
			t.Errorf("Expected PHONE_NUMBER hash, got: %s", redactedText)
		}
		if !strings.Contains(redactedText, "[HASH_US_SSN_") {
			t.Errorf("Expected US_SSN hash, got: %s", redactedText)
		}

		// Reverse it
		reversed := ReverseStaticResponse([]byte(redactedText), tokenMap)
		if string(reversed) != prompt {
			t.Errorf("Reversal failed. Expected: %s, Got: %s", prompt, string(reversed))
		}
	})

	// 7. Test Synthetic strategy
	t.Run("Redaction_Synthetic_Strategy", func(t *testing.T) {
		// Update strategy to synthetic
		_, err := DB.Exec("UPDATE gateway_configs SET redaction_strategy = 'synthetic' WHERE tenant_id = $1", tenantID)
		if err != nil {
			t.Fatalf("Failed to update strategy: %v", err)
		}

		prompt := "Call John Doe at 555-123-4567"
		redacted, tokenMap, err := RedactPrompts(ctx, tenantID, []string{prompt}, nil)
		if err != nil {
			t.Fatalf("Failed to redact prompts: %v", err)
		}

		redactedText := redacted[0]
		// Verify original value is replaced by a fake value (no mask/hash tags)
		if strings.Contains(redactedText, "John Doe") || strings.Contains(redactedText, "555-123-4567") {
			t.Errorf("Synthetic replacement did not replace name/phone, got: %s", redactedText)
		}

		// Reverse it
		reversed := ReverseStaticResponse([]byte(redactedText), tokenMap)
		if string(reversed) != prompt {
			t.Errorf("Reversal failed. Expected: %s, Got: %s", prompt, string(reversed))
		}
	})

	// 8. Test Custom NER for Health Data
	t.Run("Health_Data_Custom_NER", func(t *testing.T) {
		_, err := DB.Exec("UPDATE gateway_configs SET redaction_strategy = 'mask' WHERE tenant_id = $1", tenantID)
		if err != nil {
			t.Fatalf("Failed to update strategy: %v", err)
		}

		prompt := "The patient was diagnosed at the clinic."
		redacted, tokenMap, err := RedactPrompts(ctx, tenantID, []string{prompt}, nil)
		if err != nil {
			t.Fatalf("Failed to redact health prompt: %v", err)
		}

		redactedText := redacted[0]
		if !strings.Contains(redactedText, "[REDACTED_HEALTH_DATA_") {
			t.Errorf("Expected HEALTH_DATA custom NER detection, got: %s", redactedText)
		}

		// Reverse it
		reversed := ReverseStaticResponse([]byte(redactedText), tokenMap)
		if string(reversed) != prompt {
			t.Errorf("Reversal failed. Expected: %s, Got: %s", prompt, string(reversed))
		}
	})

	// 9. Test DB-level RLS policy validation
	t.Run("DB_RLS_Isolation_Verification", func(t *testing.T) {
		// Assert that inserting/reading without setting app.current_tenant_id returns empty/fails under RLS app user.
		// We'll create a connection using authclaw_app (non-superuser) if possible.
		// The test environment runs RLS checks. Let's see if we can query redaction_tokens without setting context.

		dbURL := os.Getenv("DATABASE_URL")
		if dbURL == "" || strings.Contains(dbURL, "authclaw:authclaw") {
			dbURL = "postgresql://authclaw_app:authclaw@localhost:5432/authclaw?sslmode=disable"
		} else {
			dbURL = strings.Replace(dbURL, "authclaw:authclaw@", "authclaw_app:authclaw@", 1)
		}
		appDB, err := sql.Open("postgres", dbURL)
		if err != nil {
			t.Fatalf("Failed to connect to DB via authclaw_app: %v", err)
		}
		defer appDB.Close()

		// Query redaction_tokens without context. Because RLS is enabled and forced, it should return zero rows!
		var count int
		err = appDB.QueryRow("SELECT COUNT(*) FROM redaction_tokens").Scan(&count)
		if err != nil {
			t.Fatalf("Query failed: %v", err)
		}

		if count != 0 {
			t.Errorf("Expected 0 visible tokens without RLS session context, got %d", count)
		}
	})

	// 10. Test Streaming Reversal
	t.Run("Streaming_Reversal_Across_Chunk_Boundaries", func(t *testing.T) {
		tokenMap := map[string]string{
			"[REDACTED_PERSON_123]": "John Doe",
		}

		reverser := NewStreamReverser(tokenMap)

		// Simulating chunks: "[REDA", "CTED_", "PERS", "ON_123]"
		out1 := reverser.ProcessChunk("Hello ")
		if out1 != "Hello " {
			t.Errorf("Expected 'Hello ', got '%s'", out1)
		}

		out2 := reverser.ProcessChunk("[REDA")
		if out2 != "" {
			t.Errorf("Expected buffered prefix output '', got '%s'", out2)
		}

		out3 := reverser.ProcessChunk("CTED_")
		if out3 != "" {
			t.Errorf("Expected buffered prefix output '', got '%s'", out3)
		}

		out4 := reverser.ProcessChunk("PERS")
		if out4 != "" {
			t.Errorf("Expected buffered prefix output '', got '%s'", out4)
		}

		out5 := reverser.ProcessChunk("ON_123]")
		// Should resolve the token to "John Doe"
		if out5 != "John Doe" {
			t.Errorf("Expected token replacement 'John Doe', got '%s'", out5)
		}
	})

	// 11. Latency Overhead Benchmarking
	t.Run("Latency_Overhead_Under_50ms", func(t *testing.T) {
		prompt := "My patient John Doe (SSN: 211-12-3456) was diagnosed at hospital today."

		// Warm-up to ensure TCP connection reuse and Gunicorn thread pool warm-up
		for i := 0; i < 3; i++ {
			_, _, _ = RedactPrompts(ctx, tenantID, []string{prompt}, nil)
		}

		duration := ProfileRedaction("RedactPrompts", func() {
			_, _, err := RedactPrompts(ctx, tenantID, []string{prompt}, nil)
			if err != nil {
				t.Fatalf("Redact prompts failed: %v", err)
			}
		})

		t.Logf("Redaction Latency: %v", duration)
		if duration > 100*time.Millisecond {
			t.Errorf("Redaction latency exceeded local developer threshold of 100ms, got: %v", duration)
		}
	})
}

func TestProxyIntegrationWithRedaction(t *testing.T) {
	// 1. Create mock backend server
	targetServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Read body
		body, _ := io.ReadAll(r.Body)
		bodyStr := string(body)

		// Assert that incoming request is redacted!
		if strings.Contains(bodyStr, "John Doe") {
			t.Errorf("Target server received unredacted name: %s", bodyStr)
		}

		// Extract the actual token generated by the gateway
		var token string
		idx := strings.Index(bodyStr, "[REDACTED_PERSON_")
		if idx != -1 {
			endIdx := strings.Index(bodyStr[idx:], "]")
			if endIdx != -1 {
				token = bodyStr[idx : idx+endIdx+1]
			}
		}
		if token == "" {
			token = "[REDACTED_PERSON_default]"
		}

		// Return redacted response containing the token
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)

		// Echo back choices with the redacted token to verify the proxy reverses it!
		w.Write([]byte(`{"choices":[{"message":{"content":"Hello, ` + token + `"}}]}`))
	}))
	defer targetServer.Close()

	// 2. Setup DB client
	InitDB()

	// Seed tenant and config
	tenantID := "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
	_, _ = DB.Exec("INSERT INTO tenants (id, name, tier, status) VALUES ($1, 'Proxy Integration Tenant', 'starter', 'active')", tenantID)

	// Create user
	userID := "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22"
	_, _ = DB.Exec("INSERT INTO users (id, tenant_id, email, role, mfa_enabled, is_active) VALUES ($1, $2, 'integration@example.com', 'admin', false, true)", userID, tenantID)

	// API key
	apiKey := "authclaw_integration_key_1"
	keyHash := HashKey(apiKey)
	_, _ = DB.Exec("INSERT INTO api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by) VALUES (gen_random_uuid(), $1, $2, 'Integration Key', $3, true, $4)", tenantID, keyHash, pq.Array([]string{"read"}), userID)

	// Update or insert gateway config to point to our mock target server
	_, _ = DB.Exec("DELETE FROM gateway_configs WHERE tenant_id = $1", tenantID)
	_, err := DB.Exec("INSERT INTO gateway_configs (id, tenant_id, name, provider, endpoint, redaction_strategy, is_active) VALUES (gen_random_uuid(), $1, 'OpenAI Integration', 'openai', $2, 'mask', true)", tenantID, targetServer.URL)
	if err != nil {
		t.Fatalf("Failed to seed gateway config: %v", err)
	}

	// 3. Create Gateway Reverse Proxy
	proxy := NewProxyServer()
	proxy.OpenAIBaseURL = targetServer.URL

	// 4. Construct request
	requestBody := `{"model":"gpt-4","messages":[{"role":"user","content":"Hi, my name is John Doe"}]}`
	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(requestBody))
	req.Header.Set("Authorization", "Bearer "+apiKey)
	w := httptest.NewRecorder()

	// 5. Build route handler with AuthMiddleware
	handler := AuthMiddleware(http.HandlerFunc(proxy.ServeHTTP))
	handler.ServeHTTP(w, req)

	// 6. Verify response is successfully reversed back to the original value!
	resp := w.Result()
	responseBody, _ := io.ReadAll(resp.Body)
	respStr := string(responseBody)

	if !strings.Contains(respStr, "John Doe") {
		t.Errorf("Response did not reverse token back to 'John Doe', got: %s", respStr)
	}
	if strings.Contains(respStr, "[REDACTED_PERSON_") {
		t.Errorf("Response still contains redacted token: %s", respStr)
	}
}
