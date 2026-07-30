package outboundpolicy

import (
	"errors"
	"net"
	"net/url"
	"os"
	"regexp"
	"strings"
)

type Policy struct {
	endpoints []*url.URL
	envKeys   map[string]bool
}

var envName = regexp.MustCompile(`^[A-Z_][A-Z0-9_]{0,127}$`)

func New(endpointAllowlist, environmentKeyAllowlist []string) (*Policy, error) {
	policy := &Policy{envKeys: map[string]bool{}}
	for _, raw := range endpointAllowlist {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		endpoint, err := parseEndpoint(raw)
		if err != nil || metadataHost(endpoint.Hostname()) {
			return nil, errors.New("LLM endpoint allowlist contains an invalid endpoint")
		}
		policy.endpoints = append(policy.endpoints, endpoint)
	}
	for _, name := range environmentKeyAllowlist {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		if !envName.MatchString(name) {
			return nil, errors.New("LLM API key environment allowlist contains an invalid name")
		}
		policy.envKeys[name] = true
	}
	return policy, nil
}

func (policy *Policy) ValidateEndpoint(raw string) error {
	endpoint, err := parseEndpoint(raw)
	if err != nil || metadataHost(endpoint.Hostname()) {
		return errors.New("LLM endpoint is not allowed")
	}
	for _, allowed := range policy.endpoints {
		if endpoint.Scheme != allowed.Scheme || !strings.EqualFold(endpoint.Host, allowed.Host) {
			continue
		}
		basePath := strings.TrimRight(allowed.EscapedPath(), "/")
		path := strings.TrimRight(endpoint.EscapedPath(), "/")
		if path == basePath || strings.HasPrefix(path, basePath+"/") {
			return nil
		}
	}
	return errors.New("LLM endpoint is not allowed")
}

func (policy *Policy) APIKeyFromEnvironment(name string) (string, bool) {
	if policy == nil || !policy.envKeys[name] {
		return "", false
	}
	return os.LookupEnv(name)
}

func parseEndpoint(raw string) (*url.URL, error) {
	endpoint, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || endpoint.User != nil || endpoint.Host == "" ||
		(endpoint.Scheme != "http" && endpoint.Scheme != "https") ||
		endpoint.RawQuery != "" || endpoint.Fragment != "" {
		return nil, errors.New("invalid HTTP endpoint")
	}
	return endpoint, nil
}

func metadataHost(host string) bool {
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	if host == "metadata.google.internal" || strings.HasSuffix(host, ".metadata.google.internal") {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.Equal(net.ParseIP("169.254.169.254")) ||
		ip.Equal(net.ParseIP("100.100.100.200"))
}
