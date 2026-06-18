package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// OpenAIRequest represents a standard OpenAI Chat Completion request body
type OpenAIRequest struct {
	Model    string    `json:"model"`
	Messages []Message `json:"messages"`
}

// AnthropicRequest represents a standard Anthropic Messages request body
type AnthropicRequest struct {
	Model    string    `json:"model"`
	System   string    `json:"system,omitempty"`
	Messages []Message `json:"messages"`
}

type GeminiPart struct {
	Text string `json:"text"`
}

type GeminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []GeminiPart `json:"parts"`
}

// GeminiRequest represents a standard Gemini request body
type GeminiRequest struct {
	Contents []GeminiContent `json:"contents"`
}

func extractGeminiModel(path string) string {
	parts := strings.Split(path, "/models/")
	if len(parts) > 1 {
		subParts := strings.Split(parts[1], ":")
		return subParts[0]
	}
	return ""
}

// NormalizedRequest is the gateway's internal standard format
type NormalizedRequest struct {
	Provider string
	Model    string
	Prompts  []string // Extracted text content to redact/evaluate
}

// ExtractAndNormalize parses the request body and returns a NormalizedRequest 
// and a helper function to rebuild the request body with modified prompts
func ExtractAndNormalize(r *http.Request, provider string) (*NormalizedRequest, func([]string) ([]byte, error), error) {
	// Read original body
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, nil, err
	}
	// Restore body for downstream proxying
	r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

	normalized := &NormalizedRequest{
		Provider: provider,
	}

	switch provider {
	case "openai":
		var openAIReq OpenAIRequest
		if err := json.Unmarshal(bodyBytes, &openAIReq); err != nil {
			return nil, nil, err
		}
		normalized.Model = openAIReq.Model
		for _, msg := range openAIReq.Messages {
			normalized.Prompts = append(normalized.Prompts, msg.Content)
		}

		rebuilder := func(newPrompts []string) ([]byte, error) {
			for i, p := range newPrompts {
				if i < len(openAIReq.Messages) {
					openAIReq.Messages[i].Content = p
				}
			}
			return json.Marshal(openAIReq)
		}
		return normalized, rebuilder, nil

	case "anthropic":
		var anthropicReq AnthropicRequest
		if err := json.Unmarshal(bodyBytes, &anthropicReq); err != nil {
			return nil, nil, err
		}
		normalized.Model = anthropicReq.Model
		if anthropicReq.System != "" {
			normalized.Prompts = append(normalized.Prompts, anthropicReq.System)
		}
		for _, msg := range anthropicReq.Messages {
			normalized.Prompts = append(normalized.Prompts, msg.Content)
		}

		rebuilder := func(newPrompts []string) ([]byte, error) {
			idx := 0
			if anthropicReq.System != "" && idx < len(newPrompts) {
				anthropicReq.System = newPrompts[idx]
				idx++
			}
			for i := range anthropicReq.Messages {
				if idx < len(newPrompts) {
					anthropicReq.Messages[i].Content = newPrompts[idx]
					idx++
				}
			}
			return json.Marshal(anthropicReq)
		}
		return normalized, rebuilder, nil

	case "gemini":
		var geminiReq GeminiRequest
		if err := json.Unmarshal(bodyBytes, &geminiReq); err != nil {
			return nil, nil, err
		}
		normalized.Model = extractGeminiModel(r.URL.Path)
		for _, content := range geminiReq.Contents {
			for _, part := range content.Parts {
				if part.Text != "" {
					normalized.Prompts = append(normalized.Prompts, part.Text)
				}
			}
		}

		rebuilder := func(newPrompts []string) ([]byte, error) {
			idx := 0
			for i := range geminiReq.Contents {
				for j := range geminiReq.Contents[i].Parts {
					if geminiReq.Contents[i].Parts[j].Text != "" && idx < len(newPrompts) {
						geminiReq.Contents[i].Parts[j].Text = newPrompts[idx]
						idx++
					}
				}
			}
			return json.Marshal(geminiReq)
		}
		return normalized, rebuilder, nil

	// Phase 14: Bedrock uses the Anthropic Messages API format for Claude models
	// and the Amazon Titan format for Titan models. We normalize both to NormalizedRequest.
	case "bedrock":
		// Try Anthropic Messages API format first (Claude via Bedrock)
		var anthropicReq AnthropicRequest
		if err := json.Unmarshal(bodyBytes, &anthropicReq); err == nil && anthropicReq.Model != "" {
			normalized.Model = anthropicReq.Model
			if anthropicReq.System != "" {
				normalized.Prompts = append(normalized.Prompts, anthropicReq.System)
			}
			for _, msg := range anthropicReq.Messages {
				normalized.Prompts = append(normalized.Prompts, msg.Content)
			}
			rebuilder := func(newPrompts []string) ([]byte, error) {
				idx := 0
				if anthropicReq.System != "" && idx < len(newPrompts) {
					anthropicReq.System = newPrompts[idx]
					idx++
				}
				for i := range anthropicReq.Messages {
					if idx < len(newPrompts) {
						anthropicReq.Messages[i].Content = newPrompts[idx]
						idx++
					}
				}
				return json.Marshal(anthropicReq)
			}
			return normalized, rebuilder, nil
		}
		// Fallback: extract model from URL path (Bedrock model ID is in the path)
		normalized.Model = ExtractBedrockModel("")
		rebuilder := func(newPrompts []string) ([]byte, error) { return bodyBytes, nil }
		return normalized, rebuilder, nil

	default:
		// Non-parsed or passthrough
		rebuilder := func(newPrompts []string) ([]byte, error) {
			return bodyBytes, nil
		}
		return normalized, rebuilder, nil
	}
}
