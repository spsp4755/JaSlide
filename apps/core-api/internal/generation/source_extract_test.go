package generation

import (
	"archive/zip"
	"bytes"
	"fmt"
	"strings"
	"testing"
)

func TestExtractXLSXRejectsTooManyArchiveEntries(t *testing.T) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for index := 0; index < maxOfficeArchiveEntries+1; index++ {
		entry, err := writer.Create(fmt.Sprintf("xl/unused/%04d.xml", index))
		if err != nil {
			t.Fatal(err)
		}
		_, _ = entry.Write([]byte("<x/>"))
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := extractXLSX(buffer.Bytes()); err == nil {
		t.Fatal("expected excessive XLSX entries to be rejected")
	}
}

func TestExtractXLSXRejectsExcessiveAggregateUncompressedSize(t *testing.T) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	entry, err := writer.Create("xl/worksheets/sheet1.xml")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = entry.Write([]byte(strings.Repeat("a", maxOfficeUncompressedBytes+1)))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := extractXLSX(buffer.Bytes()); err == nil {
		t.Fatal("expected oversized XLSX archive to be rejected")
	}
}
