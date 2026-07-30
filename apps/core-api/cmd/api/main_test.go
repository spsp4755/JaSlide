package main

import (
	"context"
	"net/http"
	"testing"
	"time"
)

func TestRunServerReturnsListenError(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := runServer(ctx, &http.Server{Addr: "not a valid address"}); err == nil {
		t.Fatal("runServer() error = nil")
	}
}
