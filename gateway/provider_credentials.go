package main

import (
	"context"
	"database/sql"
)

type ProviderCredential struct {
	Provider string
	Endpoint string
	APIKey   string
}

func LoadProviderCredential(ctx context.Context, tenantID, provider string) (*ProviderCredential, error) {
	if tenantID == "" || provider == "" {
		return nil, nil
	}

	var encryptedSecret string
	var endpoint sql.NullString

	err := RunInTenantTx(ctx, tenantID, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `
			SELECT encrypted_secret, endpoint
			FROM provider_credentials
			WHERE tenant_id = $1
			  AND provider = $2
			  AND status = 'active'
			  AND revoked_at IS NULL
			ORDER BY version DESC, created_at DESC
			LIMIT 1
		`, tenantID, provider).Scan(&encryptedSecret, &endpoint)
	})
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	apiKey, err := DecryptSecret(encryptedSecret)
	if err != nil {
		return nil, err
	}

	credential := &ProviderCredential{
		Provider: provider,
		APIKey:   apiKey,
	}
	if endpoint.Valid {
		credential.Endpoint = endpoint.String
	}
	return credential, nil
}
