package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

// Reset wipes every user (including admins) and every template — and
// everything that references them (presentations, generation jobs, comments,
// sessions, and so on, via TRUNCATE ... CASCADE) — then seeds exactly one
// admin account. Built for the closed-network release: no dev/test data may
// ship, and the deployment starts from exactly one known admin login.
func Reset(ctx context.Context, conn *pgx.Conn, adminEmail, adminPassword string) error {
	if _, err := conn.Exec(ctx, `TRUNCATE TABLE "User", "Template" CASCADE`); err != nil {
		return fmt.Errorf("truncate existing data: %w", err)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(adminPassword), 10)
	if err != nil {
		return fmt.Errorf("hash admin password: %w", err)
	}
	if _, err := conn.Exec(ctx, `
		INSERT INTO "User" (id,email,password,role,"updatedAt")
		VALUES ($1,$2,$3,'SYSTEM_ADMIN',now())`,
		newID(), adminEmail, string(hash)); err != nil {
		return fmt.Errorf("seed admin account: %w", err)
	}
	return nil
}

func newID() string {
	var raw [12]byte
	if _, err := rand.Read(raw[:]); err != nil {
		panic(err)
	}
	return "c" + hex.EncodeToString(raw[:])
}
