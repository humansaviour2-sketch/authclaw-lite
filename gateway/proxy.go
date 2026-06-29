package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"time"
)

// ProxyServer manages LLM provider routing and proxying
type ProxyServer struct {
	OpenAIBaseURL      string
	AnthropicBaseURL   string
	CohereBaseURL      string
	AzureOpenAIBaseURL string
	GeminiBaseURL      string
	// Phase 14: AWS Bedrock
	BedrockBaseURL string
}

func NewProxyServer() *ProxyServer {
	openAIBase := os.Getenv("OPENAI_BASE_URL")
	if openAIBase == "" {
		openAIBase = "https://api.openai.com"
	}
	anthropicBase := os.Getenv("ANTHROPIC_BASE_URL")
	if anthropicBase == "" {
		anthropicBase = "https://api.anthropic.com"
	}
	cohereBase := os.Getenv("COHERE_BASE_URL")
	if cohereBase == "" {
		cohereBase = "https://api.cohere.ai"
	}
	azureBase := os.Getenv("AZURE_OPENAI_BASE_URL")
	geminiBase := os.Getenv("GEMINI_BASE_URL")
	if geminiBase == "" {
		geminiBase = "https://generativelanguage.googleapis.com"
	}
	// Phase 14: Bedrock endpoint (only populated when BEDROCK_ENABLED=true)
	bedrockBase := ""
	if isBedrockEnabled() {
		bedrockBase = BedrockEndpoint()
	}
	return &ProxyServer{
		OpenAIBaseURL:      openAIBase,
		AnthropicBaseURL:   anthropicBase,
		CohereBaseURL:      cohereBase,
		AzureOpenAIBaseURL: azureBase,
		GeminiBaseURL:      geminiBase,
		BedrockBaseURL:     bedrockBase,
	}
}

// RouteRequest determines the target provider base URL based on the request
func (p *ProxyServer) RouteRequest(r *http.Request) string {
	provider := r.Header.Get("X-Provider")
	if provider != "" {
		switch strings.ToLower(provider) {
		case "openai":
			return p.OpenAIBaseURL
		case "anthropic":
			return p.AnthropicBaseURL
		case "cohere":
			return p.CohereBaseURL
		case "azure":
			return p.AzureOpenAIBaseURL
		case "gemini":
			return p.GeminiBaseURL
		// Phase 14: Bedrock provider via explicit header
		case "bedrock":
			if p.BedrockBaseURL != "" {
				return p.BedrockBaseURL
			}
		}
	}

	path := r.URL.Path
	// Phase 14: Bedrock path prefix routing (e.g. /bedrock/model/anthropic.claude.../invoke)
	if strings.HasPrefix(path, "/bedrock/") && p.BedrockBaseURL != "" {
		return p.BedrockBaseURL
	}
	if strings.Contains(path, ":generateContent") {
		return p.GeminiBaseURL
	}
	if strings.HasPrefix(path, "/v1/chat/completions") || strings.HasPrefix(path, "/v1/models") {
		return p.OpenAIBaseURL
	}
	if strings.HasPrefix(path, "/v1/messages") || strings.HasPrefix(path, "/v1/complete") {
		return p.AnthropicBaseURL
	}
	if strings.HasPrefix(path, "/v1/generate") || strings.HasPrefix(path, "/v1/embed") {
		return p.CohereBaseURL
	}

	return p.OpenAIBaseURL
}

type responseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

func generateID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "unknown"
	}
	return hex.EncodeToString(b)
}

func requiresTenantProviderCredential(provider string) bool {
	switch provider {
	case "openai", "anthropic", "cohere", "gemini":
		return true
	default:
		return false
	}
}

func (p *ProxyServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Extract tenant ID and request ID from context (injected by AuthMiddleware)
	tenantID, _ := r.Context().Value(TenantIDContextKey).(string)
	requestID, _ := r.Context().Value(RequestIDContextKey).(string)
	requesterID, _ := r.Context().Value(UserIDContextKey).(string)

	// Determine provider
	targetURLStr := p.RouteRequest(r)
	if targetURLStr == "" {
		http.Error(w, "Provider endpoint not configured", http.StatusBadGateway)
		return
	}

	provider := "openai"
	if strings.Contains(targetURLStr, "anthropic") {
		provider = "anthropic"
	} else if strings.Contains(targetURLStr, "cohere") {
		provider = "cohere"
	} else if targetURLStr == p.GeminiBaseURL || strings.Contains(targetURLStr, "googleapis.com") {
		provider = "gemini"
	} else if strings.Contains(targetURLStr, "bedrock-runtime") || strings.Contains(targetURLStr, "bedrock.") {
		// Phase 14: detect Bedrock by endpoint URL
		provider = "bedrock"
	}

	providerCredential, credentialErr := LoadProviderCredential(r.Context(), tenantID, provider)
	if credentialErr != nil {
		log.Printf("Provider credential load failed: %v", credentialErr)
		http.Error(w, "Provider credential could not be loaded", http.StatusBadGateway)
		return
	}
	if tenantID != "" && requiresTenantProviderCredential(provider) && (providerCredential == nil || providerCredential.APIKey == "") {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		w.Write([]byte(`{"error":"ProviderCredentialMissing","message":"Save an active provider API key before sending gateway traffic."}`))
		EmitAuditEvent(&AuditEvent{
			ID: generateID(), RequestID: requestID, Timestamp: time.Now(),
			TenantID: tenantID, Action: "block", DecisionReason: "Provider credential missing",
			Provider: provider, ResponseStatus: http.StatusBadGateway, DurationMs: 0,
		})
		return
	}
	if providerCredential != nil && providerCredential.Endpoint != "" {
		targetURLStr = providerCredential.Endpoint
	}

	// Extract and normalize request details
	var model string
	var promptCount int
	var originalPrompts []string
	normalized, rebuilder, err := ExtractAndNormalize(r, provider)
	if err == nil && normalized != nil {
		model = normalized.Model
		promptCount = len(normalized.Prompts)
		originalPrompts = make([]string, len(normalized.Prompts))
		copy(originalPrompts, normalized.Prompts)
	}

	// Load Policy early for Redaction
	config, policyID, _ := LoadPolicyWithCache(r.Context(), tenantID)
	var customRules []RegexRule
	if config != nil {
		customRules = config.RegexRules
	}

	if normalized != nil && len(normalized.Prompts) > 0 {
		blockMatch, blockMatchErr := FindBlockingRuleMatch(config, normalized.Prompts)
		if blockMatchErr != nil {
			log.Printf("Custom block rule evaluation failed: %v", blockMatchErr)
			http.Error(w, "Request blocked: custom policy evaluation failed", http.StatusForbidden)
			EmitAuditEvent(&AuditEvent{
				ID: generateID(), RequestID: requestID, Timestamp: time.Now(),
				TenantID: tenantID, PolicyID: policyID, Action: "block",
				DecisionReason: "Custom block policy evaluation failed", Provider: provider, Model: model,
				PromptCount: promptCount, RequestSize: int(r.ContentLength),
				ResponseStatus: http.StatusForbidden, DurationMs: 0,
			})
			return
		}
		if blockMatch != nil {
			reason := blockMatch.Rule.Reason
			if reason == "" {
				reason = fmt.Sprintf("Custom policy rule '%s' blocked request", blockMatch.Rule.Name)
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			w.Write([]byte(fmt.Sprintf(`{"error":"PolicyBlocked","message":"%s"}`, reason)))
			EmitAuditEvent(&AuditEvent{
				ID: generateID(), RequestID: requestID, Timestamp: time.Now(),
				TenantID: tenantID, PolicyID: policyID, Action: "block",
				DecisionReason: reason, Provider: provider, Model: model,
				PromptCount: promptCount, RequestSize: int(r.ContentLength),
				ResponseStatus: http.StatusForbidden, DurationMs: 0,
			})
			return
		}
	}

	// HITL gate for high-risk custom redaction policies.
	// This runs before redaction and before provider egress. The prompt itself is not
	// stored in the approval payload; only hashes and policy metadata are stored.
	finalAllowReason := "Allowed"
	if normalized != nil && len(normalized.Prompts) > 0 {
		approvalMatch, approvalMatchErr := FindApprovalRuleMatch(config, normalized.Prompts)
		if approvalMatchErr != nil {
			log.Printf("HITL rule evaluation failed: %v", approvalMatchErr)
			http.Error(w, "Request blocked: approval policy evaluation failed", http.StatusForbidden)
			EmitAuditEvent(&AuditEvent{
				ID: generateID(), RequestID: requestID, Timestamp: time.Now(),
				TenantID: tenantID, PolicyID: policyID, Action: "block",
				DecisionReason: "HITL policy evaluation failed", Provider: provider, Model: model,
				PromptCount: promptCount, RequestSize: int(r.ContentLength),
				ResponseStatus: http.StatusForbidden, DurationMs: 0,
			})
			return
		}
		if approvalMatch != nil {
			approvalID, timeout, approvalErr := CreateGatewayApproval(
				r.Context(), tenantID, requesterID, requestID, provider, model, normalized.Prompts, approvalMatch,
			)
			if approvalErr != nil {
				log.Printf("Failed to create gateway approval: %v", approvalErr)
				http.Error(w, "Request blocked: failed to create human approval", http.StatusForbidden)
				EmitAuditEvent(&AuditEvent{
					ID: generateID(), RequestID: requestID, Timestamp: time.Now(),
					TenantID: tenantID, PolicyID: policyID, Action: "block",
					DecisionReason: "Failed to create HITL approval", Provider: provider, Model: model,
					PromptCount: promptCount, RequestSize: int(r.ContentLength),
					ResponseStatus: http.StatusForbidden, DurationMs: 0,
				})
				return
			}

			log.Printf("[HITL] approval_id=%s request_id=%s rule=%s timeout=%s", approvalID, requestID, approvalMatch.Rule.Name, timeout)
			status, waitErr := WaitForGatewayApproval(r.Context(), tenantID, approvalID, timeout)
			if waitErr != nil {
				log.Printf("Gateway approval wait failed: %v", waitErr)
				http.Error(w, "Request blocked: human approval wait failed", http.StatusForbidden)
				EmitAuditEvent(&AuditEvent{
					ID: generateID(), RequestID: requestID, Timestamp: time.Now(),
					TenantID: tenantID, PolicyID: policyID, Action: "block",
					DecisionReason: "HITL approval wait failed", Provider: provider, Model: model,
					PromptCount: promptCount, RequestSize: int(r.ContentLength),
					ResponseStatus: http.StatusForbidden, DurationMs: 0,
				})
				return
			}
			if status != "APPROVED" {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				w.Write([]byte(fmt.Sprintf(`{"error":"ApprovalRequired","message":"Request blocked: HITL approval status is %s","approval_id":"%s"}`, status, approvalID)))
				EmitAuditEvent(&AuditEvent{
					ID: generateID(), RequestID: requestID, Timestamp: time.Now(),
					TenantID: tenantID, PolicyID: policyID, Action: "block",
					DecisionReason: fmt.Sprintf("HITL approval %s", status), Provider: provider, Model: model,
					PromptCount: promptCount, RequestSize: int(r.ContentLength),
					ResponseStatus: http.StatusForbidden, DurationMs: 0,
				})
				return
			}
			EmitAuditEvent(&AuditEvent{
				ID: generateID(), RequestID: requestID, Timestamp: time.Now(),
				TenantID: tenantID, PolicyID: policyID, Action: "approval_allow",
				DecisionReason: fmt.Sprintf("HITL approved: %s", approvalMatch.Rule.Reason),
				Provider:       provider, Model: model, PromptCount: promptCount,
				RequestSize: int(r.ContentLength), ResponseStatus: http.StatusOK, DurationMs: 0,
			})
			finalAllowReason = fmt.Sprintf("HITL approved: %s", approvalMatch.Rule.Reason)
		}
	}

	// Inbound Prompt Redaction
	var tokenMap map[string]string
	if provider == "openai" || provider == "anthropic" || provider == "gemini" || provider == "bedrock" {
		if normalized != nil && len(normalized.Prompts) > 0 {
			var redactErr error
			var redactedPrompts []string
			redactStart := time.Now()
			redactedPrompts, tokenMap, redactErr = RedactPrompts(r.Context(), tenantID, normalized.Prompts, customRules)
			redactDurationMs := time.Since(redactStart).Milliseconds()
			if redactErr == nil {
				if time.Duration(redactDurationMs)*time.Millisecond >= presidioSlowLogThreshold() {
					log.Printf("[REDACTION] status=slow_complete duration_ms=%d request_id=%s provider=%s prompt_count=%d token_count=%d", redactDurationMs, requestID, provider, len(normalized.Prompts), len(tokenMap))
				}
				log.Printf("[DEBUG] ORIGINAL PROMPT: %v", normalized.Prompts)
				log.Printf("[DEBUG] REDACTED PROMPT: %v", redactedPrompts)
				if len(tokenMap) > 0 {
					if finalAllowReason == "Allowed" {
						finalAllowReason = "Allowed after redaction"
					} else if !strings.Contains(strings.ToLower(finalAllowReason), "redact") {
						finalAllowReason += " + redacted"
					}
					EmitAuditEvent(&AuditEvent{
						ID:             generateID(),
						RequestID:      requestID,
						Timestamp:      time.Now(),
						TenantID:       tenantID,
						PolicyID:       policyID,
						Action:         "redact",
						DecisionReason: "Prompt redaction applied",
						Provider:       provider,
						Model:          model,
						PromptCount:    promptCount,
						RequestSize:    int(r.ContentLength),
						ResponseStatus: 0,
						DurationMs:     0,
					})
				}
				newBody, rebuildErr := rebuilder(redactedPrompts)
				if rebuildErr == nil {
					r.Body = io.NopCloser(bytes.NewBuffer(newBody))
					r.ContentLength = int64(len(newBody))
					r.Header.Set("Content-Length", fmt.Sprintf("%d", len(newBody)))
				} else {
					log.Printf("Rebuilding body failed: %v", rebuildErr)
				}
			} else {
				log.Printf("[REDACTION] status=error duration_ms=%d request_id=%s provider=%s prompt_count=%d err=%v", redactDurationMs, requestID, provider, len(normalized.Prompts), redactErr)
			}
		}
	}

	// Policy Evaluation
	var topics []string
	for token := range tokenMap {
		if strings.Contains(token, "_HEALTH_DATA_") {
			topics = append(topics, "medical")
			break
		}
	}

	route := r.URL.Path
	allow, reason, polID, evalErr := EvaluatePolicy(r.Context(), tenantID, model, route, originalPrompts, topics)
	policyID = polID
	if evalErr != nil {
		log.Printf("Policy evaluation error: %v", evalErr)
	}

	if !allow {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(fmt.Sprintf(`{"error": "Forbidden", "message": "%s"}`, reason)))

		// Emit Block Audit Event
		event := &AuditEvent{
			ID:             generateID(),
			RequestID:      requestID,
			Timestamp:      time.Now(),
			TenantID:       tenantID,
			PolicyID:       policyID,
			Action:         "block",
			DecisionReason: reason,
			Provider:       provider,
			Model:          model,
			PromptCount:    promptCount,
			RequestSize:    int(r.ContentLength),
			ResponseStatus: http.StatusForbidden,
			DurationMs:     0,
		}
		EmitAuditEvent(event)
		return
	}

	// Phase 14: Bedrock hard usage limit enforcement
	// Runs AFTER OPA (which can also block on model whitelist).
	// Checked here to prevent any AWS request when daily cap is exceeded.
	if provider == "bedrock" {
		if limitErr := CheckBedrockUsageLimits(r.Context(), tenantID); limitErr != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(fmt.Sprintf(`{"error": "BedrockLimitExceeded", "message": "%s"}`, limitErr.Error())))
			EmitAuditEvent(&AuditEvent{
				ID: generateID(), RequestID: requestID, Timestamp: time.Now(),
				TenantID: tenantID, PolicyID: policyID, Action: "block",
				DecisionReason: limitErr.Error(), Provider: provider, Model: model,
				PromptCount: promptCount, RequestSize: int(r.ContentLength),
				ResponseStatus: http.StatusTooManyRequests, DurationMs: 0,
			})
			return
		}
	}

	target, err := url.Parse(targetURLStr)
	if err != nil {
		http.Error(w, "Invalid target URL", http.StatusInternalServerError)
		return
	}

	// Create reverse proxy
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.ErrorHandler = func(rw http.ResponseWriter, req *http.Request, proxyErr error) {
		log.Printf("[PROXY] status=bad_gateway request_id=%s provider=%s target=%s err=%v", requestID, provider, target.String(), proxyErr)
		rw.Header().Set("Content-Type", "application/json")
		rw.WriteHeader(http.StatusBadGateway)
		rw.Write([]byte(fmt.Sprintf(`{"error":"ProviderProxyError","message":"upstream request failed","provider":"%s"}`, provider)))
	}

	// Customize director to rewrite target host and request URL
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.Host = target.Host
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		if provider == "gemini" {
			// Existing Gemini auth — UNCHANGED
			req.Header.Del("Authorization")
			geminiKey := ""
			if providerCredential != nil {
				geminiKey = providerCredential.APIKey
			}
			if geminiKey == "" && tenantID == "" {
				geminiKey = os.Getenv("GEMINI_API_KEY")
			}
			if geminiKey != "" {
				req.Header.Set("x-goog-api-key", geminiKey)
				q := req.URL.Query()
				q.Set("key", geminiKey)
				req.URL.RawQuery = q.Encode()
			}
		} else if provider == "anthropic" {
			req.Header.Del("Authorization")
			if providerCredential != nil && providerCredential.APIKey != "" {
				req.Header.Set("x-api-key", providerCredential.APIKey)
				if req.Header.Get("anthropic-version") == "" {
					req.Header.Set("anthropic-version", "2023-06-01")
				}
			}
		} else if provider == "cohere" || provider == "openai" {
			req.Header.Del("Authorization")
			if providerCredential != nil && providerCredential.APIKey != "" {
				req.Header.Set("Authorization", "Bearer "+providerCredential.APIKey)
			}
		} else if provider == "bedrock" {
			// Phase 14: AWS SigV4 signing for Bedrock
			// Strip the /bedrock prefix from the path before forwarding
			req.URL.Path = strings.TrimPrefix(req.URL.Path, "/bedrock")
			req.Header.Del("Authorization")
			// bodyBytes already captured by ExtractAndNormalize; re-read for signing
			var bodyForSigning []byte
			if req.Body != nil {
				bodyForSigning, _ = io.ReadAll(req.Body)
				req.Body = io.NopCloser(bytes.NewBuffer(bodyForSigning))
			}
			if signErr := SignBedrockRequest(req, bodyForSigning); signErr != nil {
				log.Printf("[BEDROCK] SigV4 signing failed: %v", signErr)
			}
		}
	}

	// Outbound Completion Reversal
	proxy.ModifyResponse = func(resp *http.Response) error {
		if resp.StatusCode != http.StatusOK {
			return nil
		}

		if len(tokenMap) == 0 {
			return nil
		}

		contentType := resp.Header.Get("Content-Type")
		if strings.Contains(contentType, "text/event-stream") {
			resp.Body = NewStreamingReversalReader(resp.Body, tokenMap, provider)
		} else {
			resp.Body = NewStaticReversalReader(resp.Body, tokenMap)
			resp.ContentLength = -1
			resp.Header.Del("Content-Length")
		}
		return nil
	}

	startTime := time.Now()

	// Capture response status code
	wrappedWriter := &responseWriter{ResponseWriter: w, status: http.StatusOK}
	proxy.ServeHTTP(wrappedWriter, r)

	duration := time.Since(startTime).Milliseconds()

	// Emit Allow Audit Event
	auditAction := "allow"
	if strings.HasPrefix(requestID, "connect-test-") {
		auditAction = "test_request"
	}
	event := &AuditEvent{
		ID:             generateID(),
		RequestID:      requestID,
		Timestamp:      startTime,
		TenantID:       tenantID,
		PolicyID:       policyID,
		Action:         auditAction,
		DecisionReason: finalAllowReason,
		Provider:       provider,
		Model:          model,
		PromptCount:    promptCount,
		RequestSize:    int(r.ContentLength),
		ResponseStatus: wrappedWriter.status,
		DurationMs:     duration,
	}
	EmitAuditEvent(event)

	// Phase 14: Increment Bedrock usage counters after a successful response
	if provider == "bedrock" && wrappedWriter.status == http.StatusOK {
		// Estimate tokens from prompt count (Bedrock response body already consumed)
		// 4 chars ≈ 1 token — rough estimate for cost tracking
		estimatedTokens := 0
		for _, p := range originalPrompts {
			estimatedTokens += len(p) / 4
		}
		go IncrementBedrockUsage(r.Context(), tenantID, estimatedTokens)
	}
}
