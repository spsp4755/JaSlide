package migrations

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

//go:embed */migration.sql
var migrationFiles embed.FS

type Migration struct {
	Name     string
	SQL      string
	Checksum string
}

type Result struct {
	Applied int
	Adopted int
	Skipped int
}

type migrationAction string

const (
	actionApply migrationAction = "apply"
	actionAdopt migrationAction = "adopt"
	actionSkip  migrationAction = "skip"
)

type migrationState struct {
	ledgerChecksum string
	prismaChecksum string
	prismaDirty    bool
}

func Load() ([]Migration, error) {
	paths, err := fs.Glob(migrationFiles, "*/migration.sql")
	if err != nil {
		return nil, fmt.Errorf("list embedded migrations: %w", err)
	}
	sort.Strings(paths)

	items := make([]Migration, 0, len(paths))
	for _, path := range paths {
		body, err := migrationFiles.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read embedded migration %s: %w", path, err)
		}
		sum := sha256.Sum256(body)
		items = append(items, Migration{
			Name:     strings.SplitN(path, "/", 2)[0],
			SQL:      string(body),
			Checksum: hex.EncodeToString(sum[:]),
		})
	}
	if len(items) == 0 {
		return nil, errors.New("no embedded migrations found")
	}
	return items, nil
}

func Apply(ctx context.Context, databaseURL string) (Result, error) {
	items, err := Load()
	if err != nil {
		return Result{}, err
	}
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return Result{}, fmt.Errorf("connect to PostgreSQL: %w", err)
	}
	defer conn.Close(ctx)
	return apply(ctx, conn, items)
}

func apply(ctx context.Context, conn *pgx.Conn, items []Migration) (result Result, err error) {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return result, fmt.Errorf("begin migration transaction: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(1249042782)"); err != nil {
		return result, fmt.Errorf("lock schema migrations: %w", err)
	}

	var hasLedger, hasPrisma, hasApplicationTables bool
	if err = tx.QueryRow(ctx, `
		SELECT
			to_regclass(current_schema() || '._jaslide_schema_migrations') IS NOT NULL,
			to_regclass(current_schema() || '._prisma_migrations') IS NOT NULL,
			EXISTS (
				SELECT 1
				FROM pg_tables
				WHERE schemaname = current_schema()
				  AND tablename NOT IN ('_jaslide_schema_migrations', '_prisma_migrations')
			)
	`).Scan(&hasLedger, &hasPrisma, &hasApplicationTables); err != nil {
		return result, fmt.Errorf("inspect schema migration state: %w", err)
	}
	if hasApplicationTables && !hasLedger && !hasPrisma {
		return result, errors.New("refusing unmanaged non-empty schema: expected _prisma_migrations or _jaslide_schema_migrations")
	}

	if _, err = tx.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS "_jaslide_schema_migrations" (
			"name" TEXT PRIMARY KEY,
			"checksum" TEXT NOT NULL,
			"source" TEXT NOT NULL CHECK ("source" IN ('jaslide', 'prisma')),
			"applied_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`); err != nil {
		return result, fmt.Errorf("create migration ledger: %w", err)
	}

	names := make([]string, len(items))
	for index, item := range items {
		names[index] = item.Name
	}
	if err = rejectUnknownOrDirtyMigrations(ctx, tx, names, hasPrisma); err != nil {
		return result, err
	}

	for _, item := range items {
		state, stateErr := readMigrationState(ctx, tx, item.Name, hasPrisma)
		if stateErr != nil {
			return result, stateErr
		}
		action, actionErr := resolveAction(item, state)
		if actionErr != nil {
			return result, actionErr
		}

		switch action {
		case actionSkip:
			result.Skipped++
			continue
		case actionApply:
			if _, err = tx.Exec(ctx, item.SQL); err != nil {
				return result, fmt.Errorf("apply migration %s: %w", item.Name, err)
			}
			result.Applied++
		case actionAdopt:
			result.Adopted++
		}

		source := "jaslide"
		if action == actionAdopt {
			source = "prisma"
		}
		if _, err = tx.Exec(ctx, `
			INSERT INTO "_jaslide_schema_migrations" ("name", "checksum", "source")
			VALUES ($1, $2, $3)
		`, item.Name, item.Checksum, source); err != nil {
			return result, fmt.Errorf("record migration %s: %w", item.Name, err)
		}
	}

	if err = tx.Commit(ctx); err != nil {
		return result, fmt.Errorf("commit schema migrations: %w", err)
	}
	return result, nil
}

func rejectUnknownOrDirtyMigrations(ctx context.Context, tx pgx.Tx, names []string, hasPrisma bool) error {
	var unknown string
	err := tx.QueryRow(ctx, `
		SELECT "name"
		FROM "_jaslide_schema_migrations"
		WHERE NOT ("name" = ANY($1::TEXT[]))
		ORDER BY "name"
		LIMIT 1
	`, names).Scan(&unknown)
	if err == nil {
		return fmt.Errorf("database contains unknown JaSlide migration %s", unknown)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("inspect JaSlide migration ledger: %w", err)
	}
	if !hasPrisma {
		return nil
	}

	err = tx.QueryRow(ctx, `
		SELECT "migration_name"
		FROM "_prisma_migrations"
		WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL
		ORDER BY "started_at"
		LIMIT 1
	`).Scan(&unknown)
	if err == nil {
		return fmt.Errorf("Prisma migration %s is unfinished", unknown)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("inspect dirty Prisma migrations: %w", err)
	}

	err = tx.QueryRow(ctx, `
		SELECT "migration_name"
		FROM "_prisma_migrations"
		WHERE "finished_at" IS NOT NULL
		  AND "rolled_back_at" IS NULL
		  AND NOT ("migration_name" = ANY($1::TEXT[]))
		ORDER BY "migration_name"
		LIMIT 1
	`, names).Scan(&unknown)
	if err == nil {
		return fmt.Errorf("database contains unknown Prisma migration %s", unknown)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("inspect unknown Prisma migrations: %w", err)
	}
	return nil
}

func readMigrationState(ctx context.Context, tx pgx.Tx, name string, hasPrisma bool) (migrationState, error) {
	var state migrationState
	err := tx.QueryRow(ctx, `
		SELECT "checksum"
		FROM "_jaslide_schema_migrations"
		WHERE "name" = $1
	`, name).Scan(&state.ledgerChecksum)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return state, fmt.Errorf("read JaSlide migration %s: %w", name, err)
	}
	if state.ledgerChecksum != "" || !hasPrisma {
		return state, nil
	}

	err = tx.QueryRow(ctx, `
		SELECT "checksum"
		FROM "_prisma_migrations"
		WHERE "migration_name" = $1
		  AND "finished_at" IS NOT NULL
		  AND "rolled_back_at" IS NULL
		ORDER BY "finished_at" DESC
		LIMIT 1
	`, name).Scan(&state.prismaChecksum)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return state, fmt.Errorf("read Prisma migration %s: %w", name, err)
	}
	if state.prismaChecksum == "" {
		err = tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1
				FROM "_prisma_migrations"
				WHERE "migration_name" = $1
				  AND "finished_at" IS NULL
				  AND "rolled_back_at" IS NULL
			)
		`, name).Scan(&state.prismaDirty)
		if err != nil {
			return state, fmt.Errorf("inspect Prisma migration %s: %w", name, err)
		}
	}
	return state, nil
}

func resolveAction(item Migration, state migrationState) (migrationAction, error) {
	if state.ledgerChecksum != "" {
		if state.ledgerChecksum != item.Checksum {
			return "", fmt.Errorf("JaSlide migration %s checksum mismatch", item.Name)
		}
		return actionSkip, nil
	}
	if state.prismaDirty {
		return "", fmt.Errorf("Prisma migration %s is unfinished", item.Name)
	}
	if state.prismaChecksum != "" {
		if state.prismaChecksum != item.Checksum {
			return "", fmt.Errorf("Prisma migration %s checksum mismatch", item.Name)
		}
		return actionAdopt, nil
	}
	return actionApply, nil
}
