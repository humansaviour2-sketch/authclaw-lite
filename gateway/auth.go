package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"net/http"
	"strings"

	"github.com/lib/pq"
)

type contextKey string

const (
	TenantIDContextKey   contextKey = "tenant_id"
	ScopesContextKey     contextKey = "scopes"
	RequestIDContextKey  contextKey = "request_id"
	UserIDContextKey     contextKey = "user_id"
	APIKeyHashContextKey contextKey = "api_key_hash"
)

// generateRequestID creates a random 16-byte hex request identifier.
func generateRequestID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "unknown"
	}
	return hex.EncodeToString(b)
}

// HashKey computes the SHA-256 hash of the API key
func HashKey(key string) string {
	h := sha256.New()
	h.Write([]byte(key))
	return hex.EncodeToString(h.Sum(nil))
}

// AuthMiddleware extracts the API key, validates it, and injects tenant info into context
func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 1. Extract Authorization header
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, "Missing Authorization header", http.StatusUnauthorized)
			return
		}

		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
			http.Error(w, "Invalid Authorization format. Expected: Bearer <key>", http.StatusUnauthorized)
			return
		}

		apiKey := parts[1]
		keyHash := HashKey(apiKey)

		// 2. Query DB to validate key and retrieve tenant_id
		var apiKeyID string
		var tenantID string
		var userID string
		var scopes []string

		err := DB.QueryRow(
			"SELECT id, tenant_id, scopes, created_by FROM resolve_api_key($1)",
			keyHash,
		).Scan(&apiKeyID, &tenantID, pq.Array(&scopes), &userID)

		if err != nil {
			http.Error(w, "Unauthorized: Invalid or expired API Key", http.StatusUnauthorized)
			return
		}

		// 3. Inject tenant info and request_id into context
		// Honour an upstream X-Request-ID header; generate one if absent.
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = generateRequestID()
		}
		w.Header().Set("X-Request-ID", requestID)
		userAgent := r.UserAgent()
		if len(userAgent) > 512 {
			userAgent = userAgent[:512]
		}
		remoteIP := r.RemoteAddr
		if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
			remoteIP = strings.TrimSpace(strings.Split(forwarded, ",")[0])
		}
		_ = RunInTenantTx(r.Context(), tenantID, func(tx *sql.Tx) error {
			_, err := tx.ExecContext(
				r.Context(),
				`UPDATE api_keys
				 SET last_used = NOW(),
				     last_used_ip = $2,
				     last_used_user_agent = $3,
				     last_used_request_id = $4,
				     updated_at = NOW()
				 WHERE id = $1`,
				apiKeyID,
				remoteIP,
				userAgent,
				requestID,
			)
			return err
		})

		ctx := context.WithValue(r.Context(), TenantIDContextKey, tenantID)
		ctx = context.WithValue(ctx, ScopesContextKey, scopes)
		ctx = context.WithValue(ctx, RequestIDContextKey, requestID)
		ctx = context.WithValue(ctx, UserIDContextKey, userID)
		ctx = context.WithValue(ctx, APIKeyHashContextKey, keyHash)

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
