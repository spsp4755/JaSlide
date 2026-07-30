package main

import (
	"net/http"
	"testing"
	"time"
)

func TestServeReportsListenError(t *testing.T) {
	errors := serve(&http.Server{Addr: "not a valid address"})

	select {
	case err := <-errors:
		if err == nil {
			t.Fatal("serve() error = nil")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("serve() did not report listen error")
	}
}
