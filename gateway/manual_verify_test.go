//go:build manual

package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/lib/pq"
)

func TestManualVerificationScenarios(t *testing.T) {
	// 1. Initialize dependencies
	InitDB()
	InitRedis()

	// Clear DB tables
	_, err := DB.Exec("TRUNCATE TABLE audit_log_metadata, pending_approvals, redaction_tokens, gateway_configs, policies, api_keys, users, tenants CASCADE")
	if err != nil {
		t.Fatalf("Failed to truncate tables: %v", err)
	}

	// 2. Setup mock provider backend
	mockProvider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"choices":[{"message":{"content":"Mocked LLM Response"}}]}`))
	}))
	defer mockProvider.Close()

	// 3. Seed Tenants, Users, API Keys
	tenantA := "a0eebc99-0000-0000-0000-bb6d6bb9bd11"
	tenantB := "b0eebc99-0000-0000-0000-bb6d6bb9bd22"

	_, _ = DB.Exec("INSERT INTO tenants (id, name, tier, status) VALUES ($1, 'Manual Tenant A', 'enterprise', 'active')", tenantA)
	_, _ = DB.Exec("INSERT INTO tenants (id, name, tier, status) VALUES ($1, 'Manual Tenant B', 'starter', 'active')", tenantB)

	userA := "a0eebc99-0000-0000-0000-bb6d6bb9bd33"
	_, _ = DB.Exec("INSERT INTO users (id, tenant_id, email, role, mfa_enabled, is_active) VALUES ($1, $2, 'manualA@example.com', 'admin', false, true)", userA, tenantA)

	userB := "b0eebc99-0000-0000-0000-bb6d6bb9bd44"
	_, _ = DB.Exec("INSERT INTO users (id, tenant_id, email, role, mfa_enabled, is_active) VALUES ($1, $2, 'manualB@example.com', 'admin', false, true)", userB, tenantB)

	apiKeyA := "manual_verify_key_tenant_a"
	hashA := HashKey(apiKeyA)
	_, _ = DB.Exec("INSERT INTO api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by) VALUES (gen_random_uuid(), $1, $2, 'Key A', $3, true, $4)", tenantA, hashA, pq.Array([]string{"read"}), userA)

	apiKeyB := "manual_verify_key_tenant_b"
	hashB := HashKey(apiKeyB)
	_, _ = DB.Exec("INSERT INTO api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by) VALUES (gen_random_uuid(), $1, $2, 'Key B', $3, true, $4)", tenantB, hashB, pq.Array([]string{"read"}), userB)

	// Set gateway config to point to mock provider
	_, _ = DB.Exec("INSERT INTO gateway_configs (id, tenant_id, name, provider, endpoint, redaction_strategy, is_active) VALUES (gen_random_uuid(), $1, 'Mock OpenAI', 'openai', $2, 'mask', true)", tenantA, mockProvider.URL)
	_, _ = DB.Exec("INSERT INTO gateway_configs (id, tenant_id, name, provider, endpoint, redaction_strategy, is_active) VALUES (gen_random_uuid(), $1, 'Mock OpenAI B', 'openai', $2, 'mask', true)", tenantB, mockProvider.URL)

	// 4. Start Gateway on port 9090
	r := chi.NewRouter()
	proxy := NewProxyServer()
	proxy.OpenAIBaseURL = mockProvider.URL // route OpenAI requests to mock
	r.Route("/v1", func(r chi.Router) {
		r.Use(AuthMiddleware)
		r.HandleFunc("/*", proxy.ServeHTTP)
	})

	server := &http.Server{Addr: ":9090", Handler: r}
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("Gateway server error: %v", err)
		}
	}()
	defer server.Close()

	// Wait for server to start
	time.Sleep(200 * time.Millisecond)

	client := &http.Client{}

	fmt.Println("\n==================================================")
	fmt.Println("   STARTING PHASE 5 MANUAL VERIFICATION RUNNER")
	fmt.Println("==================================================")

	// -----------------------------------------------------------------
	// SCENARIO A: Allowed Request (Expected: 200)
	// -----------------------------------------------------------------
	fmt.Println("\n[Scenario A] Allowed Request")
	policyA := `
model_rules:
  whitelist:
    - gpt-4
  blacklist:
    - gpt-3.5-turbo
`
	_, _ = DB.Exec("INSERT INTO policies (id, tenant_id, name, policy_yaml, version, is_active, created_by) VALUES (gen_random_uuid(), $1, 'Policy A', $2, 1, true, $3)", tenantA, policyA, userA)
	InvalidatePolicyCache(tenantA)

	reqBodyA := `{"model":"gpt-4","messages":[{"role":"user","content":"Hello world"}]}`
	reqA, _ := http.NewRequest("POST", "http://localhost:9090/v1/chat/completions", strings.NewReader(reqBodyA))
	reqA.Header.Set("Authorization", "Bearer "+apiKeyA)
	reqA.Header.Set("Content-Type", "application/json")

	respA, err := client.Do(reqA)
	if err != nil {
		t.Fatalf("Request A failed: %v", err)
	}
	bodyA, _ := io.ReadAll(respA.Body)
	respA.Body.Close()

	fmt.Printf("Request: POST /v1/chat/completions (model: gpt-4)\n")
	fmt.Printf("Expected Response Status: 200 OK\n")
	fmt.Printf("Actual Response Status: %d\n", respA.StatusCode)
	fmt.Printf("Response Body: %s\n", string(bodyA))
	if respA.StatusCode != http.StatusOK {
		t.Errorf("Scenario A failed: expected 200 OK, got %d", respA.StatusCode)
	}

	// -----------------------------------------------------------------
	// SCENARIO B: Blacklisted Model (Expected: 403)
	// -----------------------------------------------------------------
	fmt.Println("\n[Scenario B] Blacklisted Model")
	reqBodyB := `{"model":"gpt-3.5-turbo","messages":[{"role":"user","content":"Hello world"}]}`
	reqB, _ := http.NewRequest("POST", "http://localhost:9090/v1/chat/completions", strings.NewReader(reqBodyB))
	reqB.Header.Set("Authorization", "Bearer "+apiKeyA)
	reqB.Header.Set("Content-Type", "application/json")

	respB, err := client.Do(reqB)
	if err != nil {
		t.Fatalf("Request B failed: %v", err)
	}
	bodyB, _ := io.ReadAll(respB.Body)
	respB.Body.Close()

	fmt.Printf("Request: POST /v1/chat/completions (model: gpt-3.5-turbo)\n")
	fmt.Printf("Expected Response Status: 403 Forbidden\n")
	fmt.Printf("Actual Response Status: %d\n", respB.StatusCode)
	fmt.Printf("Response Body: %s\n", string(bodyB))
	if respB.StatusCode != http.StatusForbidden {
		t.Errorf("Scenario B failed: expected 403, got %d", respB.StatusCode)
	}

	// -----------------------------------------------------------------
	// SCENARIO C: Regex Forbidden Topic (Expected: 403)
	// -----------------------------------------------------------------
	fmt.Println("\n[Scenario C] Regex Forbidden Topic")
	policyC := `
regex_rules:
  - pattern: "(?i)confidential"
    reason: "Strict confidentiality block"
`
	_, _ = DB.Exec("DELETE FROM policies WHERE tenant_id = $1", tenantA)
	_, _ = DB.Exec("INSERT INTO policies (id, tenant_id, name, policy_yaml, version, is_active, created_by) VALUES (gen_random_uuid(), $1, 'Policy C', $2, 2, true, $3)", tenantA, policyC, userA)
	InvalidatePolicyCache(tenantA)

	reqBodyC := `{"model":"gpt-4","messages":[{"role":"user","content":"This contains confidential credentials"}]}`
	reqC, _ := http.NewRequest("POST", "http://localhost:9090/v1/chat/completions", strings.NewReader(reqBodyC))
	reqC.Header.Set("Authorization", "Bearer "+apiKeyA)
	reqC.Header.Set("Content-Type", "application/json")

	respC, err := client.Do(reqC)
	if err != nil {
		t.Fatalf("Request C failed: %v", err)
	}
	bodyC, _ := io.ReadAll(respC.Body)
	respC.Body.Close()

	fmt.Printf("Request: POST /v1/chat/completions (prompt: 'This contains confidential credentials')\n")
	fmt.Printf("Expected Response Status: 403 Forbidden\n")
	fmt.Printf("Actual Response Status: %d\n", respC.StatusCode)
	fmt.Printf("Response Body: %s\n", string(bodyC))
	if respC.StatusCode != http.StatusForbidden {
		t.Errorf("Scenario C failed: expected 403, got %d", respC.StatusCode)
	}

	// -----------------------------------------------------------------
	// SCENARIO D: Rate Limit Exceeded (Expected: 403)
	// -----------------------------------------------------------------
	fmt.Println("\n[Scenario D] Rate Limit Exceeded")
	policyD := `
rate_limits:
  requests_per_minute: 1
`
	_, _ = DB.Exec("DELETE FROM policies WHERE tenant_id = $1", tenantA)
	_, _ = DB.Exec("INSERT INTO policies (id, tenant_id, name, policy_yaml, version, is_active, created_by) VALUES (gen_random_uuid(), $1, 'Policy D', $2, 3, true, $3)", tenantA, policyD, userA)
	InvalidatePolicyCache(tenantA)

	// Clean Redis key first
	now := time.Now().Format("200601021504")
	RedisClient.Del(context.Background(), "rate_limit:"+tenantA+":/v1/chat/completions:"+now)

	reqBodyD := `{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}`

	// Request 1: Should succeed
	reqD1, _ := http.NewRequest("POST", "http://localhost:9090/v1/chat/completions", strings.NewReader(reqBodyD))
	reqD1.Header.Set("Authorization", "Bearer "+apiKeyA)
	reqD1.Header.Set("Content-Type", "application/json")
	respD1, _ := client.Do(reqD1)
	respD1.Body.Close()
	fmt.Printf("Request 1 Status: %d\n", respD1.StatusCode)

	// Request 2: Should be blocked
	reqD2, _ := http.NewRequest("POST", "http://localhost:9090/v1/chat/completions", strings.NewReader(reqBodyD))
	reqD2.Header.Set("Authorization", "Bearer "+apiKeyA)
	reqD2.Header.Set("Content-Type", "application/json")
	respD2, err := client.Do(reqD2)
	if err != nil {
		t.Fatalf("Request D2 failed: %v", err)
	}
	bodyD2, _ := io.ReadAll(respD2.Body)
	respD2.Body.Close()

	fmt.Printf("Request 2 (exceeding limit): POST /v1/chat/completions\n")
	fmt.Printf("Expected Response Status: 403 Forbidden\n")
	fmt.Printf("Actual Response Status: %d\n", respD2.StatusCode)
	fmt.Printf("Response Body: %s\n", string(bodyD2))
	if respD2.StatusCode != http.StatusForbidden {
		t.Errorf("Scenario D failed: expected 403, got %d", respD2.StatusCode)
	}

	// -----------------------------------------------------------------
	// SCENARIO E: OPA Stopped/Unavailable (Expected: 403)
	// -----------------------------------------------------------------
	fmt.Println("\n[Scenario E] OPA Stopped/Unavailable")
	// Seed normal policy
	policyE := `model_rules: {blacklist: []}`
	_, _ = DB.Exec("DELETE FROM policies WHERE tenant_id = $1", tenantA)
	_, _ = DB.Exec("INSERT INTO policies (id, tenant_id, name, policy_yaml, version, is_active, created_by) VALUES (gen_random_uuid(), $1, 'Policy E', $2, 4, true, $3)", tenantA, policyE, userA)
	InvalidatePolicyCache(tenantA)

	// Stop OPA docker container
	fmt.Println("Stopping authclaw-opa Docker container...")
	stopCmd := exec.Command("docker", "stop", "authclaw-opa")
	if err := stopCmd.Run(); err != nil {
		t.Fatalf("Failed to stop OPA container: %v", err)
	}

	// Make request (should default deny)
	reqBodyE := `{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}`
	reqE, _ := http.NewRequest("POST", "http://localhost:9090/v1/chat/completions", strings.NewReader(reqBodyE))
	reqE.Header.Set("Authorization", "Bearer "+apiKeyA)
	reqE.Header.Set("Content-Type", "application/json")

	respE, err := client.Do(reqE)

	// Restart OPA docker container immediately to avoid leaving system in broken state
	fmt.Println("Starting authclaw-opa Docker container...")
	startCmd := exec.Command("docker", "start", "authclaw-opa")
	_ = startCmd.Run()

	// Wait for OPA to wake up
	time.Sleep(1 * time.Second)

	if err != nil {
		t.Fatalf("Request E failed: %v", err)
	}
	bodyE, _ := io.ReadAll(respE.Body)
	respE.Body.Close()

	fmt.Printf("Request: POST /v1/chat/completions (OPA unavailable)\n")
	fmt.Printf("Expected Response Status: 403 Forbidden\n")
	fmt.Printf("Actual Response Status: %d\n", respE.StatusCode)
	fmt.Printf("Response Body: %s\n", string(bodyE))
	if respE.StatusCode != http.StatusForbidden {
		t.Errorf("Scenario E failed: expected 403, got %d", respE.StatusCode)
	}

	// -----------------------------------------------------------------
	// SCENARIO F: Cross-Tenant Policy Isolation (Expected: Isolated)
	// -----------------------------------------------------------------
	fmt.Println("\n[Scenario F] Cross-Tenant Policy Isolation")
	policyA_F := `
model_rules:
  blacklist:
    - block-model-for-a
`
	policyB_F := `
model_rules:
  blacklist:
    - block-model-for-b
`
	_, _ = DB.Exec("DELETE FROM policies")
	_, _ = DB.Exec("INSERT INTO policies (id, tenant_id, name, policy_yaml, version, is_active, created_by) VALUES (gen_random_uuid(), $1, 'Policy A F', $2, 5, true, $3)", tenantA, policyA_F, userA)
	_, _ = DB.Exec("INSERT INTO policies (id, tenant_id, name, policy_yaml, version, is_active, created_by) VALUES (gen_random_uuid(), $1, 'Policy B F', $2, 1, true, $3)", tenantB, policyB_F, userB)
	InvalidatePolicyCache(tenantA)
	InvalidatePolicyCache(tenantB)

	// Send request under Tenant A for block-model-for-b (should succeed)
	reqBodyF1 := `{"model":"block-model-for-b","messages":[{"role":"user","content":"Hello"}]}`
	reqF1, _ := http.NewRequest("POST", "http://localhost:9090/v1/chat/completions", strings.NewReader(reqBodyF1))
	reqF1.Header.Set("Authorization", "Bearer "+apiKeyA)
	reqF1.Header.Set("Content-Type", "application/json")
	respF1, _ := client.Do(reqF1)
	bodyF1, _ := io.ReadAll(respF1.Body)
	respF1.Body.Close()

	fmt.Printf("Tenant A querying model 'block-model-for-b' (only Tenant B's blacklist):\n")
	fmt.Printf("Expected Response Status: 200 OK\n")
	fmt.Printf("Actual Response Status: %d\n", respF1.StatusCode)
	fmt.Printf("Response Body: %s\n", string(bodyF1))
	if respF1.StatusCode != http.StatusOK {
		t.Errorf("Scenario F (Tenant A) failed: expected 200 OK, got %d", respF1.StatusCode)
	}

	// Send request under Tenant B for block-model-for-b (should fail 403)
	reqF2, _ := http.NewRequest("POST", "http://localhost:9090/v1/chat/completions", strings.NewReader(reqBodyF1))
	reqF2.Header.Set("Authorization", "Bearer "+apiKeyB)
	reqF2.Header.Set("Content-Type", "application/json")
	respF2, _ := client.Do(reqF2)
	bodyF2, _ := io.ReadAll(respF2.Body)
	respF2.Body.Close()

	fmt.Printf("Tenant B querying model 'block-model-for-b' (Tenant B's blacklist):\n")
	fmt.Printf("Expected Response Status: 403 Forbidden\n")
	fmt.Printf("Actual Response Status: %d\n", respF2.StatusCode)
	fmt.Printf("Response Body: %s\n", string(bodyF2))
	if respF2.StatusCode != http.StatusForbidden {
		t.Errorf("Scenario F (Tenant B) failed: expected 403 Forbidden, got %d", respF2.StatusCode)
	}

	fmt.Println("==================================================")
	fmt.Println("   COMPLETED PHASE 5 MANUAL VERIFICATION RUNNER")
	fmt.Println("==================================================")
}
