package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/spsp4755/JaSlide/apps/core-api/migrations"
)

func main() {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}
	result, err := migrations.Apply(context.Background(), databaseURL)
	if err != nil {
		log.Fatalf("schema migration failed: %v", err)
	}
	fmt.Printf(
		"schema migration complete: applied=%d adopted=%d skipped=%d\n",
		result.Applied,
		result.Adopted,
		result.Skipped,
	)
}
