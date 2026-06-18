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

func (p *ProxyServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Extract tenant ID and request ID from context (injected by AuthMiddleware)
	tenantID, _ := r.Context().Value(TenantIDContextKey).(string)
	requestID, _ := r.Context().Value(RequestIDContextKey).(string)

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

	// Inbound Prompt Redaction
	var tokenMap map[string]string
	if provider == "openai" || provider == "anthropic" || provider == "gemini" || provider == "bedrock" {
		if normalized != nil && len(normalized.Prompts) > 0 {
			var redactErr error
			var redactedPrompts []string
			redactedPrompts, tokenMap, redactErr = RedactPrompts(r.Context(), tenantID, normalized.Prompts, customRules)
			if redactErr == nil {
				log.Printf("[DEBUG] ORIGINAL PROMPT: %v", normalized.Prompts)
				log.Printf("[DEBUG] REDACTED PROMPT: %v", redactedPrompts)
				newBody, rebuildErr := rebuilder(redactedPrompts)
				if rebuildErr == nil {
					r.Body = io.NopCloser(bytes.NewBuffer(newBody))
					r.ContentLength = int64(len(newBody))
					r.Header.Set("Content-Length", fmt.Sprintf("%d", len(newBody)))
				} else {
					log.Printf("Rebuilding body failed: %v", rebuildErr)
				}
			} else {
				log.Printf("Redaction failed: %v", redactErr)
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
			geminiKey := os.Getenv("GEMINI_API_KEY")
			if geminiKey != "" {
				req.Header.Set("x-goog-api-key", geminiKey)
				q := req.URL.Query()
				q.Set("key", geminiKey)
				req.URL.RawQuery = q.Encode()
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
			bodyBytes, err := io.ReadAll(resp.Body)
			if err != nil {
				return err
			}
			resp.Body.Close()

			reversedBytes := ReverseStaticResponse(bodyBytes, tokenMap)
			resp.Body = io.NopCloser(bytes.NewBuffer(reversedBytes))
			resp.ContentLength = int64(len(reversedBytes))
			resp.Header.Set("Content-Length", fmt.Sprintf("%d", len(reversedBytes)))
		}
		return nil
	}

	startTime := time.Now()

	// Capture response status code
	wrappedWriter := &responseWriter{ResponseWriter: w, status: http.StatusOK}
	proxy.ServeHTTP(wrappedWriter, r)

	duration := time.Since(startTime).Milliseconds()

	// Emit Allow Audit Event
	event := &AuditEvent{
		ID:             generateID(),
		RequestID:      requestID,
		Timestamp:      startTime,
		TenantID:       tenantID,
		PolicyID:       policyID,
		Action:         "allow",
		DecisionReason: "Allowed",
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
