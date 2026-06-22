package main

import (
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/joho/godotenv"
)

func main() {
	// Try to load .env.local from parent directory
	_ = godotenv.Load("../.env.local")

	// Initialize database
	InitDB()

	// Initialize Kafka producer (non-fatal if Kafka is unavailable)
	InitKafkaProducer()
	defer CloseKafkaProducer()

	r := chi.NewRouter()

	// Standard middleware
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// Basic health check endpoint
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status": "healthy", "service": "authclaw-gateway"}`))
	})

	// Setup LLM provider reverse proxy
	proxy := NewProxyServer()
	r.Route("/v1", func(r chi.Router) {
		r.Use(AuthMiddleware)
		r.HandleFunc("/*", proxy.ServeHTTP)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting AuthClaw Gateway on port %s...", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatalf("Failed to start gateway server: %v", err)
	}
}
