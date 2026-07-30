package main

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

func TestResetWipesEveryoneAndSeedsExactlyOneAdmin(t *testing.T) {
	databaseURL := os.Getenv("JASLIDE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set JASLIDE_TEST_DATABASE_URL")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(context.Background())

	suffix := fmt.Sprint(time.Now().UnixNano())
	leftoverID, templateID := "leftover-"+suffix, "leftover-template-"+suffix
	if _, err := conn.Exec(ctx,
		`INSERT INTO "User" (id,email,role,"updatedAt") VALUES ($1,$2,'SYSTEM_ADMIN',NOW())`,
		leftoverID, "leftover-"+suffix+"@example.com"); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx,
		`INSERT INTO "Template" (id,name,config,"updatedAt") VALUES ($1,'Leftover','{}'::jsonb,NOW())`,
		templateID); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx,
		`INSERT INTO "Presentation" (id,title,"userId","sourceType","createdAt","updatedAt")
		 VALUES ($1,'Leftover deck',$2,'TEXT',NOW(),NOW())`,
		"leftover-pres-"+suffix, leftoverID); err != nil {
		t.Fatal(err)
	}

	adminEmail, adminPassword := "admin-"+suffix+"@example.com", "correct-horse-battery"
	if err := Reset(ctx, conn, adminEmail, adminPassword); err != nil {
		t.Fatal(err)
	}

	var userCount int
	if err := conn.QueryRow(ctx, `SELECT count(*) FROM "User"`).Scan(&userCount); err != nil {
		t.Fatal(err)
	}
	if userCount != 1 {
		t.Fatalf("user count after reset = %d, want exactly 1", userCount)
	}

	var templateCount int
	if err := conn.QueryRow(ctx, `SELECT count(*) FROM "Template"`).Scan(&templateCount); err != nil {
		t.Fatal(err)
	}
	if templateCount != 0 {
		t.Fatalf("template count after reset = %d, want 0", templateCount)
	}

	var presentationCount int
	if err := conn.QueryRow(ctx, `SELECT count(*) FROM "Presentation"`).Scan(&presentationCount); err != nil {
		t.Fatal(err)
	}
	if presentationCount != 0 {
		t.Fatalf("presentation count after reset = %d, want 0 (cascaded from the wiped user)", presentationCount)
	}

	var email, role string
	var hash string
	if err := conn.QueryRow(ctx, `SELECT email,role,password FROM "User"`).Scan(&email, &role, &hash); err != nil {
		t.Fatal(err)
	}
	if email != adminEmail || role != "SYSTEM_ADMIN" {
		t.Fatalf("seeded admin = %s/%s, want %s/SYSTEM_ADMIN", email, role, adminEmail)
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(adminPassword)) != nil {
		t.Fatal("seeded admin password does not match what Reset was given")
	}
}
