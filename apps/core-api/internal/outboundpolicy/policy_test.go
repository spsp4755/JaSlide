package outboundpolicy

import (
	"os"
	"testing"
)

func TestPolicyAllowsOnlyConfiguredInternalLLMOrigins(t *testing.T) {
	policy, err := New([]string{"http://vllm.internal:8000/v1", "http://127.0.0.1:1234/v1"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, allowed := range []string{
		"http://vllm.internal:8000/v1",
		"http://vllm.internal:8000/v1/chat/completions",
		"http://127.0.0.1:1234/v1",
	} {
		if err := policy.ValidateEndpoint(allowed); err != nil {
			t.Fatalf("expected %s to be allowed: %v", allowed, err)
		}
	}
	for _, blocked := range []string{
		"http://evil.internal:8000/v1",
		"http://vllm.internal:8001/v1",
		"http://vllm.internal:8000/not-v1",
		"http://169.254.169.254/latest/meta-data",
		"http://metadata.google.internal/computeMetadata/v1",
		"file:///etc/passwd",
		"http://vllm.internal:8000@evil.test/v1",
	} {
		if err := policy.ValidateEndpoint(blocked); err == nil {
			t.Fatalf("expected %s to be blocked", blocked)
		}
	}
}

func TestPolicyReadsOnlyApprovedAPIKeyEnvironmentVariables(t *testing.T) {
	t.Setenv("APPROVED_LLM_KEY", "approved-secret")
	t.Setenv("DATABASE_URL", "must-not-leak")
	policy, err := New([]string{"http://vllm.internal/v1"}, []string{"APPROVED_LLM_KEY"})
	if err != nil {
		t.Fatal(err)
	}
	if value, ok := policy.APIKeyFromEnvironment("APPROVED_LLM_KEY"); !ok || value != "approved-secret" {
		t.Fatal("approved key was not resolved")
	}
	if value, ok := policy.APIKeyFromEnvironment("DATABASE_URL"); ok || value != "" {
		t.Fatal("unapproved environment secret was exposed")
	}
	os.Unsetenv("APPROVED_LLM_KEY")
}

func TestPolicyRejectsInvalidAllowlistAtStartup(t *testing.T) {
	if _, err := New([]string{"not-a-url"}, nil); err == nil {
		t.Fatal("expected malformed allowlist to be rejected")
	}
	if _, err := New([]string{"http://169.254.169.254/v1"}, nil); err == nil {
		t.Fatal("metadata endpoint must never be allowlisted")
	}
}
