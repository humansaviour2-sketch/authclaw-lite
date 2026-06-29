package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Context keys
type contextKeyType string

const RequestTokenMapKey contextKeyType = "request_token_map"

// Presidio structures
type PresidioClient struct {
	BaseURL string
}

type PresidioPattern struct {
	Name  string  `json:"name"`
	Regex string  `json:"regex"`
	Score float64 `json:"score"`
}

type PresidioRecognizer struct {
	Name              string            `json:"name"`
	SupportedLanguage string            `json:"supported_language"`
	Patterns          []PresidioPattern `json:"patterns"`
	SupportedEntity   string            `json:"supported_entity"`
}

type AnalyzeRequest struct {
	Text             string               `json:"text"`
	Language         string               `json:"language"`
	AdHocRecognizers []PresidioRecognizer `json:"ad_hoc_recognizers,omitempty"`
	Entities         []string             `json:"entities,omitempty"`
}

type AnalyzeResult struct {
	Start      int     `json:"start"`
	End        int     `json:"end"`
	EntityType string  `json:"entity_type"`
	Score      float64 `json:"score"`
}

func NewPresidioClient() *PresidioClient {
	url := os.Getenv("PRESIDIO_URL")
	if url == "" {
		url = "http://localhost:3000"
	}
	return &PresidioClient{BaseURL: url}
}

var presidioClientHTTP = &http.Client{
	Transport: &http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 100,
		IdleConnTimeout:     90 * time.Second,
	},
	Timeout: 10 * time.Second,
}

func envDurationMillis(name string, fallback time.Duration, min time.Duration, max time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	ms, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	value := time.Duration(ms) * time.Millisecond
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func presidioAnalyzeTimeout() time.Duration {
	return envDurationMillis("PRESIDIO_ANALYZE_TIMEOUT_MS", 750*time.Millisecond, 100*time.Millisecond, 10*time.Second)
}

func presidioSlowLogThreshold() time.Duration {
	return envDurationMillis("PRESIDIO_SLOW_LOG_MS", 500*time.Millisecond, 100*time.Millisecond, 10*time.Second)
}

func (c *PresidioClient) Analyze(ctx context.Context, text string, customRules []RegexRule) ([]AnalyzeResult, error) {
	recognizers := []PresidioRecognizer{
		{
			Name:              "HealthDataRecognizer",
			SupportedLanguage: "en",
			Patterns: []PresidioPattern{
				{
					Name:  "health_keywords",
					Regex: `(?i)\b(patient|diagnosed|treatment|prescription|symptoms|medical|disease|hospital|doctor|clinic)\b`,
					Score: 0.8,
				},
			},
			SupportedEntity: "HEALTH_DATA",
		},
		{
			Name:              "SsnRecognizer",
			SupportedLanguage: "en",
			Patterns: []PresidioPattern{
				{
					Name:  "ssn_pattern",
					Regex: `\b\d{3}-\d{2}-\d{4}\b`,
					Score: 1.0,
				},
			},
			SupportedEntity: "US_SSN",
		},
		// UK & international phone number recognizer
		// Covers: +44 7700 900123, +1-800-555-0199, 07700900123, (020) 7946 0123
		{
			Name:              "PhoneNumberRecognizer",
			SupportedLanguage: "en",
			Patterns: []PresidioPattern{
				{
					Name:  "intl_phone",
					Regex: `(\+?[\d\s\-\(\)]{7,20})`,
					Score: 0.6,
				},
				{
					Name:  "uk_phone",
					Regex: `(\+44\s?[\d\s]{10,14}|0\d{4}\s?\d{6}|0\d{3}\s?\d{3}\s?\d{4})`,
					Score: 0.85,
				},
			},
			SupportedEntity: "PHONE_NUMBER",
		},
		// UK National Insurance Number: AB123456C pattern
		{
			Name:              "UKNationalIDRecognizer",
			SupportedLanguage: "en",
			Patterns: []PresidioPattern{
				{
					Name:  "uk_nino",
					Regex: `\b[A-CEGHJ-PR-TW-Z]{2}[0-9]{6}[A-D]\b`,
					Score: 0.95,
				},
				// Employee ID patterns (EMP-YYYY-NNN)
				{
					Name:  "employee_id",
					Regex: `\bEMP-\d{4}-\d{3,}\b`,
					Score: 0.9,
				},
				// UK Passport-style national IDs
				{
					Name:  "uk_passport",
					Regex: `\b[0-9]{9}\b`,
					Score: 0.5,
				},
			},
			SupportedEntity: "UK_NATIONAL_ID",
		},
		// Generic staff/manager name context recognizer
		{
			Name:              "ContextualNameRecognizer",
			SupportedLanguage: "en",
			Patterns: []PresidioPattern{
				{
					Name:  "manager_field",
					Regex: `(?i)(?:Manager|Supervisor|Reported to|Managed by|Director|Lead):\s*([A-Z][a-z]+ [A-Z][a-z]+)`,
					Score: 0.9,
				},
			},
			SupportedEntity: "PERSON",
		},
	}

	for _, rule := range customRules {
		recognizers = append(recognizers, PresidioRecognizer{
			Name:              rule.Name + "Recognizer",
			SupportedLanguage: "en",
			Patterns: []PresidioPattern{
				{
					Name:  rule.Name,
					Regex: rule.Pattern,
					Score: 1.0,
				},
			},
			SupportedEntity: strings.ToUpper(strings.ReplaceAll(rule.Name, " ", "_")),
		})
	}

	reqBody := AnalyzeRequest{
		Text:             text,
		Language:         "en",
		AdHocRecognizers: recognizers,
		Entities: []string{
			"PERSON",
			"EMAIL_ADDRESS",
			"PHONE_NUMBER",
			"US_SSN",
			"HEALTH_DATA",
			"UK_NATIONAL_ID",
			"NRP",    // Presidio built-in: nationality, religious/political group
			"UK_NHS", // Presidio built-in: NHS numbers
			"DATE_TIME",
		},
	}

	for _, rule := range customRules {
		reqBody.Entities = append(reqBody.Entities, strings.ToUpper(strings.ReplaceAll(rule.Name, " ", "_")))
	}

	jsonBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", c.BaseURL+"/analyze", bytes.NewBuffer(jsonBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := presidioClientHTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("presidio returned status %d: %s", resp.StatusCode, string(body))
	}

	var results []AnalyzeResult
	if err := json.NewDecoder(resp.Body).Decode(&results); err != nil {
		return nil, err
	}

	return results, nil
}

func analyzePromptWithFallback(ctx context.Context, presidio *PresidioClient, prompt string, customRules []RegexRule) []AnalyzeResult {
	start := time.Now()
	analyzeCtx, cancel := context.WithTimeout(ctx, presidioAnalyzeTimeout())
	defer cancel()

	results, err := presidio.Analyze(analyzeCtx, prompt, customRules)
	duration := time.Since(start)
	if err != nil {
		fallbackStart := time.Now()
		results = fallbackAnalyze(prompt, customRules)
		log.Printf(
			"[REDACTION] analyzer=presidio status=fallback duration_ms=%d fallback_duration_ms=%d prompt_chars=%d err=%v",
			duration.Milliseconds(),
			time.Since(fallbackStart).Milliseconds(),
			len([]rune(prompt)),
			err,
		)
		return results
	}

	results = appendCustomRuleAnalyzeResults(results, prompt, customRules)
	if duration > presidioSlowLogThreshold() {
		log.Printf(
			"[REDACTION] analyzer=presidio status=slow duration_ms=%d prompt_chars=%d findings=%d",
			duration.Milliseconds(),
			len([]rune(prompt)),
			len(results),
		)
	}
	return results
}

func byteIndexToRuneIndex(text string, byteIndex int) int {
	if byteIndex <= 0 {
		return 0
	}
	if byteIndex >= len(text) {
		return len([]rune(text))
	}
	return len([]rune(text[:byteIndex]))
}

func appendRegexAnalyzeResults(results []AnalyzeResult, text, entityType string, pattern *regexp.Regexp) []AnalyzeResult {
	for _, loc := range pattern.FindAllStringIndex(text, -1) {
		if len(loc) != 2 {
			continue
		}
		results = append(results, AnalyzeResult{
			Start:      byteIndexToRuneIndex(text, loc[0]),
			End:        byteIndexToRuneIndex(text, loc[1]),
			EntityType: entityType,
			Score:      1.0,
		})
	}
	return results
}

func normalizedCustomEntity(rule RegexRule) string {
	entity := strings.TrimSpace(rule.Entity)
	if entity == "" {
		entity = rule.Name
	}
	entity = strings.ToUpper(strings.ReplaceAll(entity, " ", "_"))
	if strings.Contains(entity, "PHONE") || strings.Contains(entity, "MOBILE") {
		return "PHONE_NUMBER"
	}
	return entity
}

func appendCustomRuleAnalyzeResults(results []AnalyzeResult, text string, customRules []RegexRule) []AnalyzeResult {
	for _, rule := range customRules {
		if rule.Pattern == "" || rule.normalizedAction() == "block" {
			continue
		}
		pattern, err := regexp.Compile(rule.Pattern)
		if err != nil {
			log.Printf("Skipping invalid custom regex rule %q: %v", rule.Name, err)
			continue
		}
		results = appendRegexAnalyzeResults(results, text, normalizedCustomEntity(rule), pattern)
	}
	return results
}

var phoneLikePattern = regexp.MustCompile(`^\+?\d[\d\s().-]{7,}\d$`)

func normalizeDetectedEntity(entityType, originalValue string, customRules []RegexRule) string {
	entity := strings.ToUpper(strings.TrimSpace(entityType))
	trimmed := strings.TrimSpace(originalValue)
	for _, rule := range customRules {
		if rule.Pattern == "" || !strings.Contains(normalizedCustomEntity(rule), "PHONE") {
			continue
		}
		pattern, err := regexp.Compile(rule.Pattern)
		if err == nil && pattern.MatchString(trimmed) {
			return "PHONE_NUMBER"
		}
	}
	if entity == "UK_NHS" && phoneLikePattern.MatchString(trimmed) {
		return "PHONE_NUMBER"
	}
	return entity
}

func fallbackAnalyze(text string, customRules []RegexRule) []AnalyzeResult {
	results := []AnalyzeResult{}
	builtIns := []struct {
		entityType string
		pattern    *regexp.Regexp
	}{
		{"EMAIL_ADDRESS", regexp.MustCompile(`(?i)\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b`)},
		{"US_SSN", regexp.MustCompile(`\b\d{3}-\d{2}-\d{4}\b`)},
		{"PHONE_NUMBER", regexp.MustCompile(`(?i)(?:\+?\d[\d\s().-]{7,}\d)`)},
		{"HEALTH_DATA", regexp.MustCompile(`(?i)\b(patient|diagnosed|treatment|prescription|symptoms|medical|disease|hospital|doctor|clinic)\b`)},
	}

	for _, item := range builtIns {
		results = appendRegexAnalyzeResults(results, text, item.entityType, item.pattern)
	}
	return appendCustomRuleAnalyzeResults(results, text, customRules)
}

// Encryption Helpers (AES-256 CBC Deterministic)
var encryptionKey []byte

func initEncryptionKey() {
	keyStr := os.Getenv("ENCRYPTION_KEY")
	if keyStr == "" {
		keyStr = os.Getenv("ENVELOPE_KEY")
	}
	if keyStr == "" {
		keyStr = "authclaw-default-32-byte-key-12"
	}
	if len(keyStr) > 32 {
		encryptionKey = []byte(keyStr[:32])
	} else if len(keyStr) < 32 {
		k := make([]byte, 32)
		copy(k, keyStr)
		encryptionKey = k
	} else {
		encryptionKey = []byte(keyStr)
	}
}

func pkcs7Pad(data []byte, blockSize int) []byte {
	padding := blockSize - (len(data) % blockSize)
	padText := bytes.Repeat([]byte{byte(padding)}, padding)
	return append(data, padText...)
}

func pkcs7Unpad(data []byte) ([]byte, error) {
	length := len(data)
	if length == 0 {
		return nil, fmt.Errorf("empty data")
	}
	padding := int(data[length-1])
	if padding < 1 || padding > 16 {
		return nil, fmt.Errorf("invalid padding")
	}
	for i := length - padding; i < length; i++ {
		if int(data[i]) != padding {
			return nil, fmt.Errorf("invalid padding content")
		}
	}
	return data[:length-padding], nil
}

func EncryptDeterministic(plaintext string) (string, error) {
	if encryptionKey == nil {
		initEncryptionKey()
	}
	block, err := aes.NewCipher(encryptionKey)
	if err != nil {
		return "", err
	}
	padded := pkcs7Pad([]byte(plaintext), aes.BlockSize)

	h := sha256.New()
	h.Write([]byte(plaintext))
	h.Write(encryptionKey)
	iv := h.Sum(nil)[:aes.BlockSize]

	ciphertext := make([]byte, len(padded))
	mode := cipher.NewCBCEncrypter(block, iv)
	mode.CryptBlocks(ciphertext, padded)

	combined := append(iv, ciphertext...)
	return base64.StdEncoding.EncodeToString(combined), nil
}

func DecryptDeterministic(ciphertextStr string) (string, error) {
	if encryptionKey == nil {
		initEncryptionKey()
	}
	data, err := base64.StdEncoding.DecodeString(ciphertextStr)
	if err != nil {
		return "", err
	}
	if len(data) < aes.BlockSize {
		return "", fmt.Errorf("ciphertext too short")
	}
	iv := data[:aes.BlockSize]
	ciphertext := data[aes.BlockSize:]

	block, err := aes.NewCipher(encryptionKey)
	if err != nil {
		return "", err
	}

	if len(ciphertext)%aes.BlockSize != 0 {
		return "", fmt.Errorf("ciphertext block size invalid")
	}

	decrypted := make([]byte, len(ciphertext))
	mode := cipher.NewCBCDecrypter(block, iv)
	mode.CryptBlocks(decrypted, ciphertext)

	unpadded, err := pkcs7Unpad(decrypted)
	if err != nil {
		return "", err
	}

	return string(unpadded), nil
}

// DB Tenant Context Execution Helper
func RunInTenantTx(ctx context.Context, tenantID string, fn func(*sql.Tx) error) error {
	tx, err := DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, true)", tenantID)
	if err != nil {
		return err
	}

	if err := fn(tx); err != nil {
		return err
	}

	return tx.Commit()
}

// Tokenization Mappings Store & Helpers
func hashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

func cryptoRandInt(max int) int {
	var n uint32
	binary.Read(rand.Reader, binary.BigEndian, &n)
	return int(n % uint32(max))
}

func generateShortUUID() string {
	b := make([]byte, 4)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func getSyntheticBase(entityType string) string {
	switch entityType {
	case "PERSON":
		names := []string{"Alice Smith", "Bob Jones", "Charlie Brown", "Diana Prince", "Evan Wright", "Fiona Gallagher", "George Clark", "Hannah Abbott"}
		return names[cryptoRandInt(len(names))]
	case "EMAIL_ADDRESS":
		domains := []string{"example.org", "testmail.net", "dummycorp.com"}
		return fmt.Sprintf("user.%d@%s", cryptoRandInt(1000), domains[cryptoRandInt(len(domains))])
	case "PHONE_NUMBER":
		return fmt.Sprintf("555-01%02d", cryptoRandInt(100))
	case "US_SSN":
		return fmt.Sprintf("%03d-%02d-%04d", cryptoRandInt(1000), cryptoRandInt(100), cryptoRandInt(10000))
	case "HEALTH_DATA":
		conditions := []string{"mild condition", "routine treatment", "general symptoms", "medical issue"}
		return conditions[cryptoRandInt(len(conditions))]
	default:
		return "synthetic-placeholder"
	}
}

func isTokenValueExists(ctx context.Context, tx *sql.Tx, tenantID, tokenValue string) (bool, error) {
	var exists bool
	err := tx.QueryRowContext(ctx,
		"SELECT EXISTS(SELECT 1 FROM redaction_tokens WHERE tenant_id = $1 AND token_value = $2)",
		tenantID, tokenValue,
	).Scan(&exists)
	return exists, err
}

func GenerateTokenValue(ctx context.Context, tx *sql.Tx, tenantID, originalValue, entityType, strategy string) (string, error) {
	switch strategy {
	case "mask":
		uuidPart := generateShortUUID()
		return fmt.Sprintf("[REDACTED_%s_%s]", entityType, uuidPart), nil

	case "hash":
		salt := "authclaw_salt_2026"
		h := sha256.New()
		h.Write([]byte(originalValue + salt))
		hashPart := hex.EncodeToString(h.Sum(nil))[:12]
		return fmt.Sprintf("[HASH_%s_%s]", entityType, hashPart), nil

	case "synthetic":
		baseVal := getSyntheticBase(entityType)
		tokenVal := baseVal
		exists, err := isTokenValueExists(ctx, tx, tenantID, tokenVal)
		if err != nil {
			return "", err
		}
		counter := 1
		for exists {
			tokenVal = fmt.Sprintf("%s (%d)", baseVal, counter)
			exists, err = isTokenValueExists(ctx, tx, tenantID, tokenVal)
			if err != nil {
				return "", err
			}
			counter++
		}
		return tokenVal, nil

	default:
		return "[REDACTED]", nil
	}
}

func GetOrCreateRedactionToken(ctx context.Context, tenantID, originalValue, entityType, strategy string) (string, error) {
	encVal, err := EncryptDeterministic(originalValue)
	if err != nil {
		return "", err
	}

	shouldRelabelToken := func(tokenValue string) bool {
		if entityType != "PHONE_NUMBER" {
			return false
		}
		return strings.Contains(tokenValue, "_UK_NHS_") ||
			strings.Contains(tokenValue, "_UK_NATIONAL_ID_")
	}

	var tokenVal string

	err = RunInTenantTx(ctx, tenantID, func(tx *sql.Tx) error {
		var tokenID string
		err := tx.QueryRowContext(ctx,
			"SELECT id::text, token_value FROM redaction_tokens WHERE tenant_id = $1 AND original_value = $2 AND strategy = $3 LIMIT 1",
			tenantID, encVal, strategy,
		).Scan(&tokenID, &tokenVal)

		if err == nil {
			if shouldRelabelToken(tokenVal) {
				tokenVal, err = GenerateTokenValue(ctx, tx, tenantID, originalValue, entityType, strategy)
				if err != nil {
					return err
				}
				_, err = tx.ExecContext(ctx,
					"UPDATE redaction_tokens SET token_value = $1, token_hash = $2 WHERE tenant_id = $3 AND id = $4::uuid",
					tokenVal, hashToken(tokenVal), tenantID, tokenID,
				)
				return err
			}
			return nil
		}
		if err != sql.ErrNoRows {
			return err
		}

		tokenVal, err = GenerateTokenValue(ctx, tx, tenantID, originalValue, entityType, strategy)
		if err != nil {
			return err
		}

		tokenHash := hashToken(tokenVal)

		err = tx.QueryRowContext(ctx, `
			INSERT INTO redaction_tokens (
				id, tenant_id, original_value, token_hash, token_value, strategy, created_at
			)
			VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())
			ON CONFLICT (tenant_id, original_value, strategy)
			DO UPDATE SET token_value = redaction_tokens.token_value
			RETURNING token_value
		`,
			tenantID, encVal, tokenHash, tokenVal, strategy,
		).Scan(&tokenVal)
		return err
	})

	if err != nil {
		return "", err
	}
	return tokenVal, nil
}

func GetRedactionStrategy(ctx context.Context, tenantID string) string {
	var strategy string
	err := RunInTenantTx(ctx, tenantID, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx,
			"SELECT redaction_strategy FROM gateway_configs WHERE tenant_id = $1 AND is_active = true LIMIT 1",
			tenantID,
		).Scan(&strategy)
	})
	if err != nil || strategy == "" {
		return "mask"
	}
	return strategy
}

// RedactPrompts runs Presidio Analyzer and tokenizes original prompts
func RedactPrompts(ctx context.Context, tenantID string, prompts []string, customRules []RegexRule) ([]string, map[string]string, error) {
	presidio := NewPresidioClient()
	strategy := GetRedactionStrategy(ctx, tenantID)
	tokenMap := make(map[string]string)
	redactedPrompts := make([]string, len(prompts))

	for i, prompt := range prompts {
		results := analyzePromptWithFallback(ctx, presidio, prompt, customRules)

		// Sort results descending by start index to prevent offset issues during replacements
		sort.Slice(results, func(i, j int) bool {
			// If starts are equal, process the longer one first (larger end)
			if results[i].Start == results[j].Start {
				return results[i].End > results[j].End
			}
			return results[i].Start > results[j].Start
		})

		runes := []rune(prompt)
		lastProcessedStart := len(runes) + 1

		for _, entity := range results {
			if entity.Start < 0 || entity.End > len(runes) || entity.Start >= entity.End {
				continue
			}
			// Skip if this entity overlaps with the previously processed (which is to the right of this one)
			if entity.End > lastProcessedStart {
				continue
			}

			originalVal := string(runes[entity.Start:entity.End])
			entityType := normalizeDetectedEntity(entity.EntityType, originalVal, customRules)
			tokenVal, err := GetOrCreateRedactionToken(ctx, tenantID, originalVal, entityType, strategy)
			if err != nil {
				return nil, nil, err
			}
			tokenMap[tokenVal] = originalVal

			// Replace text segment
			runes = append(runes[:entity.Start], append([]rune(tokenVal), runes[entity.End:]...)...)
			lastProcessedStart = entity.Start
		}
		redactedPrompts[i] = string(runes)
	}

	return redactedPrompts, tokenMap, nil
}

// Static Reversal
func ReverseStaticResponse(body []byte, tokenMap map[string]string) []byte {
	bodyStr := string(body)
	for token, original := range tokenMap {
		bodyStr = strings.ReplaceAll(bodyStr, token, original)
	}
	return []byte(bodyStr)
}

// Streaming Reversal
type StreamReverser struct {
	tokenMap map[string]string
	buffer   string
}

func NewStreamReverser(tokenMap map[string]string) *StreamReverser {
	return &StreamReverser{tokenMap: tokenMap}
}

func (sr *StreamReverser) ProcessChunk(chunk string) string {
	sr.buffer += chunk

	for token, original := range sr.tokenMap {
		sr.buffer = strings.ReplaceAll(sr.buffer, token, original)
	}

	longestPrefixLen := 0
	for token := range sr.tokenMap {
		for i := 1; i < len(token); i++ {
			prefix := token[:i]
			if strings.HasSuffix(sr.buffer, prefix) {
				if i > longestPrefixLen {
					longestPrefixLen = i
				}
			}
		}
	}

	safeLen := len(sr.buffer) - longestPrefixLen
	if safeLen <= 0 {
		return ""
	}

	output := sr.buffer[:safeLen]
	sr.buffer = sr.buffer[safeLen:]
	return output
}

func (sr *StreamReverser) Flush() string {
	out := sr.buffer
	sr.buffer = ""
	return out
}

type StaticReversalReader struct {
	originalBody io.ReadCloser
	reverser     *StreamReverser
	outBuffer    bytes.Buffer
	eof          bool
}

func NewStaticReversalReader(originalBody io.ReadCloser, tokenMap map[string]string) *StaticReversalReader {
	return &StaticReversalReader{
		originalBody: originalBody,
		reverser:     NewStreamReverser(tokenMap),
	}
}

func (s *StaticReversalReader) Read(p []byte) (int, error) {
	if s.outBuffer.Len() > 0 {
		return s.outBuffer.Read(p)
	}
	if s.eof {
		return 0, io.EOF
	}

	chunk := make([]byte, 32*1024)
	n, err := s.originalBody.Read(chunk)
	if n > 0 {
		s.outBuffer.WriteString(s.reverser.ProcessChunk(string(chunk[:n])))
		if s.outBuffer.Len() > 0 {
			return s.outBuffer.Read(p)
		}
	}
	if err == io.EOF {
		s.eof = true
		s.outBuffer.WriteString(s.reverser.Flush())
		if s.outBuffer.Len() > 0 {
			return s.outBuffer.Read(p)
		}
		return 0, io.EOF
	}
	if err != nil {
		return 0, err
	}
	return s.Read(p)
}

func (s *StaticReversalReader) Close() error {
	return s.originalBody.Close()
}

type StreamingReversalReader struct {
	originalBody  io.ReadCloser
	scanner       *bufio.Scanner
	reverser      *StreamReverser
	provider      string
	outBuffer     bytes.Buffer
	lastSSEPrefix string
	sawStructured bool
	eof           bool
}

func NewStreamingReversalReader(originalBody io.ReadCloser, tokenMap map[string]string, provider string) *StreamingReversalReader {
	scanner := bufio.NewScanner(originalBody)
	scanner.Buffer(make([]byte, 0, 64*1024), 10*1024*1024)
	return &StreamingReversalReader{
		originalBody: originalBody,
		scanner:      scanner,
		reverser:     NewStreamReverser(tokenMap),
		provider:     provider,
	}
}

func (s *StreamingReversalReader) Read(p []byte) (int, error) {
	if s.outBuffer.Len() > 0 {
		return s.outBuffer.Read(p)
	}
	if s.eof {
		return 0, io.EOF
	}

	if s.scanner.Scan() {
		line := s.scanner.Text()
		for _, modifiedLine := range s.processLine(line) {
			s.outBuffer.WriteString(modifiedLine + "\n")
		}
		return s.outBuffer.Read(p)
	}

	if err := s.scanner.Err(); err != nil {
		return 0, err
	}

	s.eof = true
	for _, line := range s.flushPendingLines() {
		s.outBuffer.WriteString(line + "\n")
	}
	if s.outBuffer.Len() > 0 {
		return s.outBuffer.Read(p)
	}

	return 0, io.EOF
}

func (s *StreamingReversalReader) Close() error {
	return s.originalBody.Close()
}

func rewriteMapString(data map[string]interface{}, key string, transform func(string) string) bool {
	value, ok := data[key].(string)
	if !ok {
		return false
	}
	data[key] = transform(value)
	return true
}

func rewriteGenericTextFields(data map[string]interface{}, transform func(string) string) bool {
	rewritten := false
	for _, key := range []string{"text", "content", "completion"} {
		if rewriteMapString(data, key, transform) {
			rewritten = true
		}
	}
	return rewritten
}

func rewriteOpenAIText(data map[string]interface{}, transform func(string) string) bool {
	choices, ok := data["choices"].([]interface{})
	if !ok {
		return false
	}
	rewritten := false
	for _, rawChoice := range choices {
		choice, ok := rawChoice.(map[string]interface{})
		if !ok {
			continue
		}
		if delta, ok := choice["delta"].(map[string]interface{}); ok {
			if rewriteMapString(delta, "content", transform) {
				rewritten = true
			}
		}
		if message, ok := choice["message"].(map[string]interface{}); ok {
			if rewriteMapString(message, "content", transform) {
				rewritten = true
			}
		}
		if rewriteMapString(choice, "text", transform) {
			rewritten = true
		}
	}
	return rewritten
}

func rewriteAnthropicText(data map[string]interface{}, transform func(string) string) bool {
	rewritten := false
	if delta, ok := data["delta"].(map[string]interface{}); ok {
		if rewriteMapString(delta, "text", transform) {
			rewritten = true
		}
	}
	if rewriteMapString(data, "completion", transform) {
		rewritten = true
	}
	if rewriteMapString(data, "text", transform) {
		rewritten = true
	}
	return rewritten
}

func rewriteGeminiText(data map[string]interface{}, transform func(string) string) bool {
	candidates, ok := data["candidates"].([]interface{})
	if !ok {
		return false
	}
	rewritten := false
	for _, rawCandidate := range candidates {
		candidate, ok := rawCandidate.(map[string]interface{})
		if !ok {
			continue
		}
		content, ok := candidate["content"].(map[string]interface{})
		if !ok {
			continue
		}
		parts, ok := content["parts"].([]interface{})
		if !ok {
			continue
		}
		for _, rawPart := range parts {
			part, ok := rawPart.(map[string]interface{})
			if !ok {
				continue
			}
			if rewriteMapString(part, "text", transform) {
				rewritten = true
			}
		}
	}
	return rewritten
}

func rewriteDeltaText(chunk []byte, provider string, transform func(string) string) ([]byte, bool, error) {
	var data map[string]interface{}
	if err := json.Unmarshal(chunk, &data); err != nil {
		return nil, false, err
	}

	rewritten := false
	switch strings.ToLower(provider) {
	case "openai":
		rewritten = rewriteOpenAIText(data, transform)
	case "anthropic":
		rewritten = rewriteAnthropicText(data, transform)
	case "gemini":
		rewritten = rewriteGeminiText(data, transform)
	}

	if !rewritten {
		rewritten = rewriteGenericTextFields(data, transform)
	}
	if !rewritten {
		return nil, false, nil
	}

	modifiedJSON, err := json.Marshal(data)
	return modifiedJSON, true, err
}

func extractDeltaText(chunk []byte, provider string) (string, bool) {
	var text string
	found := false
	_, ok, err := rewriteDeltaText(chunk, provider, func(value string) string {
		if !found {
			text = value
			found = true
		}
		return value
	})
	return text, ok && found && err == nil
}

func injectDeltaText(chunk []byte, provider string, newText string) ([]byte, error) {
	replaced := false
	modifiedJSON, ok, err := rewriteDeltaText(chunk, provider, func(value string) string {
		if !replaced {
			replaced = true
			return newText
		}
		return value
	})
	if err != nil {
		return nil, err
	}
	if !ok {
		return chunk, nil
	}
	return modifiedJSON, nil
}

func splitSSEDataLine(line string) (prefix string, payload string, ok bool) {
	if !strings.HasPrefix(line, "data:") {
		return "", "", false
	}
	payload = strings.TrimPrefix(line, "data:")
	if strings.HasPrefix(payload, " ") {
		return "data: ", strings.TrimPrefix(payload, " "), true
	}
	return "data:", payload, true
}

func syntheticDeltaPayload(provider string, text string) []byte {
	var data map[string]interface{}
	switch strings.ToLower(provider) {
	case "openai":
		data = map[string]interface{}{
			"choices": []interface{}{
				map[string]interface{}{
					"delta": map[string]interface{}{"content": text},
				},
			},
		}
	case "anthropic":
		data = map[string]interface{}{
			"type":  "content_block_delta",
			"delta": map[string]interface{}{"type": "text_delta", "text": text},
		}
	case "gemini":
		data = map[string]interface{}{
			"candidates": []interface{}{
				map[string]interface{}{
					"content": map[string]interface{}{
						"parts": []interface{}{map[string]interface{}{"text": text}},
					},
				},
			},
		}
	default:
		data = map[string]interface{}{"text": text}
	}
	payload, err := json.Marshal(data)
	if err != nil {
		return []byte(text)
	}
	return payload
}

func (s *StreamingReversalReader) flushPendingLines() []string {
	flushedText := s.reverser.Flush()
	if flushedText == "" {
		return nil
	}
	if !s.sawStructured {
		return []string{flushedText}
	}
	payload := string(syntheticDeltaPayload(s.provider, flushedText))
	if s.lastSSEPrefix != "" {
		return []string{s.lastSSEPrefix + payload}
	}
	return []string{payload}
}

func (s *StreamingReversalReader) processLine(line string) []string {
	if prefix, payload, ok := splitSSEDataLine(line); ok {
		if strings.TrimSpace(payload) == "[DONE]" {
			lines := s.flushPendingLines()
			return append(lines, line)
		}
		modifiedJSON, ok, err := rewriteDeltaText([]byte(payload), s.provider, func(text string) string {
			return s.reverser.ProcessChunk(text)
		})
		if err != nil || !ok {
			return []string{line}
		}
		s.lastSSEPrefix = prefix
		s.sawStructured = true
		return []string{prefix + string(modifiedJSON)}
	}

	if strings.HasPrefix(strings.TrimSpace(line), "{") {
		modifiedJSON, ok, err := rewriteDeltaText([]byte(line), s.provider, func(text string) string {
			return s.reverser.ProcessChunk(text)
		})
		if err != nil || !ok {
			return []string{line}
		}
		s.lastSSEPrefix = ""
		s.sawStructured = true
		return []string{string(modifiedJSON)}
	}

	return []string{line}
}

// Latency Profiling Wrapper
func ProfileRedaction(label string, fn func()) time.Duration {
	start := time.Now()
	fn()
	duration := time.Since(start)
	log.Printf("[PROFILER] %s took %v", label, duration)
	return duration
}
