package migrations

import (
	"strings"
	"testing"
)

func TestLoadReturnsOrderedChecksummedMigrations(t *testing.T) {
	items, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 6 {
		t.Fatalf("got %d migrations, want 6", len(items))
	}
	for index, item := range items {
		if index > 0 && items[index-1].Name >= item.Name {
			t.Fatalf("migrations are not ordered: %q before %q", items[index-1].Name, item.Name)
		}
		if len(item.Checksum) != 64 {
			t.Fatalf("%s checksum has length %d, want 64", item.Name, len(item.Checksum))
		}
		if strings.TrimSpace(item.SQL) == "" {
			t.Fatalf("%s has empty SQL", item.Name)
		}
	}
}

func TestResolveAction(t *testing.T) {
	const checksum = "expected"
	tests := []struct {
		name    string
		state   migrationState
		want    migrationAction
		wantErr bool
	}{
		{name: "fresh migration applies", want: actionApply},
		{
			name:  "successful matching Prisma migration is adopted",
			state: migrationState{prismaChecksum: checksum},
			want:  actionAdopt,
		},
		{
			name:    "modified Prisma migration fails",
			state:   migrationState{prismaChecksum: "different"},
			wantErr: true,
		},
		{
			name:    "unfinished Prisma migration fails",
			state:   migrationState{prismaDirty: true},
			wantErr: true,
		},
		{
			name:  "matching JaSlide ledger skips",
			state: migrationState{ledgerChecksum: checksum},
			want:  actionSkip,
		},
		{
			name:    "modified JaSlide ledger fails",
			state:   migrationState{ledgerChecksum: "different"},
			wantErr: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := resolveAction(Migration{Name: "example", Checksum: checksum}, test.state)
			if (err != nil) != test.wantErr {
				t.Fatalf("resolveAction() error = %v, wantErr %v", err, test.wantErr)
			}
			if !test.wantErr && got != test.want {
				t.Fatalf("resolveAction() = %q, want %q", got, test.want)
			}
		})
	}
}
