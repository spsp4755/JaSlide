package migrations

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestApplyFreshAndPrismaUpgrade(t *testing.T) {
	databaseURL := os.Getenv("JASLIDE_MIGRATION_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("JASLIDE_MIGRATION_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)

	resetSchema := func(t *testing.T) {
		t.Helper()
		if _, err := conn.Exec(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public`); err != nil {
			t.Fatal(err)
		}
	}
	countLedger := func(t *testing.T) int {
		t.Helper()
		var count int
		if err := conn.QueryRow(ctx, `SELECT COUNT(*) FROM "_jaslide_schema_migrations"`).Scan(&count); err != nil {
			t.Fatal(err)
		}
		return count
	}

	t.Run("fresh bootstrap and idempotent rerun", func(t *testing.T) {
		resetSchema(t)
		first, err := Apply(ctx, databaseURL)
		if err != nil {
			t.Fatal(err)
		}
		if first.Applied != 6 || countLedger(t) != 6 {
			t.Fatalf("fresh result = %+v, ledger count = %d", first, countLedger(t))
		}
		second, err := Apply(ctx, databaseURL)
		if err != nil {
			t.Fatal(err)
		}
		if second.Skipped != 6 || second.Applied != 0 || second.Adopted != 0 {
			t.Fatalf("idempotent result = %+v", second)
		}
	})

	t.Run("Prisma ledger is adopted and data is preserved", func(t *testing.T) {
		resetSchema(t)
		items, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if _, err := conn.Exec(ctx, `
			CREATE TABLE "_prisma_migrations" (
				"id" VARCHAR(36) PRIMARY KEY,
				"checksum" VARCHAR(64) NOT NULL,
				"finished_at" TIMESTAMPTZ,
				"migration_name" VARCHAR(255) NOT NULL,
				"logs" TEXT,
				"rolled_back_at" TIMESTAMPTZ,
				"started_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				"applied_steps_count" INTEGER NOT NULL DEFAULT 0
			)
		`); err != nil {
			t.Fatal(err)
		}
		for index, item := range items[:3] {
			if _, err := conn.Exec(ctx, item.SQL); err != nil {
				t.Fatalf("seed Prisma migration %s: %v", item.Name, err)
			}
			if _, err := conn.Exec(ctx, `
				INSERT INTO "_prisma_migrations"
					("id", "checksum", "finished_at", "migration_name", "applied_steps_count")
				VALUES ($1, $2, NOW(), $3, 1)
			`, fmt.Sprintf("migration-%d", index), item.Checksum, item.Name); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := conn.Exec(ctx, `CREATE TABLE upgrade_probe (value TEXT NOT NULL)`); err != nil {
			t.Fatal(err)
		}
		if _, err := conn.Exec(ctx, `INSERT INTO upgrade_probe (value) VALUES ('preserved')`); err != nil {
			t.Fatal(err)
		}

		result, err := Apply(ctx, databaseURL)
		if err != nil {
			t.Fatal(err)
		}
		if result.Adopted != 3 || result.Applied != 3 || countLedger(t) != 6 {
			t.Fatalf("upgrade result = %+v, ledger count = %d", result, countLedger(t))
		}
		var value string
		if err := conn.QueryRow(ctx, `SELECT value FROM upgrade_probe`).Scan(&value); err != nil {
			t.Fatal(err)
		}
		if value != "preserved" {
			t.Fatalf("upgrade probe = %q", value)
		}
	})

	t.Run("unmanaged non-empty schema is rejected without mutation", func(t *testing.T) {
		resetSchema(t)
		if _, err := conn.Exec(ctx, `CREATE TABLE unmanaged_probe (value TEXT NOT NULL)`); err != nil {
			t.Fatal(err)
		}
		if _, err := Apply(ctx, databaseURL); err == nil {
			t.Fatal("Apply() accepted an unmanaged non-empty schema")
		}
		var hasLedger bool
		if err := conn.QueryRow(ctx, `
			SELECT to_regclass('public._jaslide_schema_migrations') IS NOT NULL
		`).Scan(&hasLedger); err != nil {
			t.Fatal(err)
		}
		if hasLedger {
			t.Fatal("failed preflight left a JaSlide migration ledger behind")
		}
	})
}
