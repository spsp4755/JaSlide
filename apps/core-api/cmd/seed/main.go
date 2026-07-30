package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/jackc/pgx/v5"
)

func main() {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}
	// A wipe this destructive must never run from a stray env var left set in
	// a shell — it requires the operator to type the confirmation themselves.
	if os.Getenv("JASLIDE_CONFIRM_RESET") != "wipe all users and templates" {
		log.Fatal(`refusing to run: set JASLIDE_CONFIRM_RESET="wipe all users and templates" to confirm`)
	}
	adminEmail := envOr("SEED_ADMIN_EMAIL", "admin@koreacb.com")
	adminPassword := envOr("SEED_ADMIN_PASSWORD", "admin1234")

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)

	if err := Reset(ctx, conn, adminEmail, adminPassword); err != nil {
		log.Fatalf("reset failed: %v", err)
	}
	fmt.Printf("reset complete: every user/admin and template were wiped; single admin %s is ready\n", adminEmail)
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
