package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Address              string
	Environment          string
	DatabaseURL          string
	RedisURL             string
	JWTSecret            string
	JWTLifetime          time.Duration
	RendererURL          string
	PublicOrigin         string
	FrontendURL          string
	KeycloakIssuer       string
	KeycloakClientID     string
	KeycloakClientSecret string
	KeycloakRedirectURI  string
	KeycloakAdminRoles   []string
}

func Load() (Config, error) {
	publicOrigin := value("PUBLIC_ORIGIN")
	if publicOrigin == "" {
		publicOrigin = value("CORS_ORIGIN")
	}

	jwtLifetime, err := parseLifetime(defaultValue(value("JWT_EXPIRES_IN"), "7d"))
	if err != nil {
		return Config{}, fmt.Errorf("JWT_EXPIRES_IN: %w", err)
	}
	keycloakRedirectURI := value("KEYCLOAK_REDIRECT_URI")
	if keycloakRedirectURI == "" && value("APP_URL") != "" {
		keycloakRedirectURI = strings.TrimRight(value("APP_URL"), "/") + "/api/auth/keycloak/callback"
	}
	config := Config{
		Address:              defaultValue(value("CORE_API_ADDR"), ":4000"),
		Environment:          defaultValue(value("NODE_ENV"), defaultValue(value("APP_ENV"), "development")),
		DatabaseURL:          value("DATABASE_URL"),
		RedisURL:             value("REDIS_URL"),
		JWTSecret:            value("JWT_SECRET"),
		JWTLifetime:          jwtLifetime,
		RendererURL:          value("RENDERER_URL"),
		PublicOrigin:         publicOrigin,
		FrontendURL:          defaultValue(value("FRONTEND_URL"), "http://localhost:3000"),
		KeycloakIssuer:       strings.TrimRight(value("KEYCLOAK_ISSUER"), "/"),
		KeycloakClientID:     value("KEYCLOAK_CLIENT_ID"),
		KeycloakClientSecret: value("KEYCLOAK_CLIENT_SECRET"),
		KeycloakRedirectURI:  keycloakRedirectURI,
		KeycloakAdminRoles:   commaSeparated(value("KEYCLOAK_ADMIN_ROLES")),
	}

	if strings.EqualFold(config.Environment, "production") {
		for name, value := range map[string]string{
			"DATABASE_URL":  config.DatabaseURL,
			"REDIS_URL":     config.RedisURL,
			"JWT_SECRET":    config.JWTSecret,
			"RENDERER_URL":  config.RendererURL,
			"PUBLIC_ORIGIN": config.PublicOrigin,
		} {
			if value == "" {
				return Config{}, fmt.Errorf("%s is required in production", name)
			}
		}
		if len([]byte(config.JWTSecret)) < 32 {
			return Config{}, fmt.Errorf("JWT_SECRET must be at least 32 bytes in production")
		}
		if err := validateURLScheme("DATABASE_URL", config.DatabaseURL, "postgres", "postgresql"); err != nil {
			return Config{}, err
		}
		if err := validateURLScheme("REDIS_URL", config.RedisURL, "redis", "rediss"); err != nil {
			return Config{}, err
		}
		if err := validateHTTPURL("RENDERER_URL", config.RendererURL); err != nil {
			return Config{}, err
		}
		if err := validateHTTPURL("PUBLIC_ORIGIN", config.PublicOrigin); err != nil {
			return Config{}, err
		}
	}

	return config, nil
}

func parseLifetime(value string) (time.Duration, error) {
	if strings.HasSuffix(value, "d") {
		days, err := strconv.Atoi(strings.TrimSuffix(value, "d"))
		if err != nil || days <= 0 {
			return 0, fmt.Errorf("must be a positive duration")
		}
		return time.Duration(days) * 24 * time.Hour, nil
	}
	duration, err := time.ParseDuration(value)
	if err != nil || duration <= 0 {
		return 0, fmt.Errorf("must be a positive duration")
	}
	return duration, nil
}

func commaSeparated(value string) []string {
	var result []string
	for _, item := range strings.Split(value, ",") {
		if item = strings.TrimSpace(item); item != "" {
			result = append(result, item)
		}
	}
	return result
}

func value(name string) string { return strings.TrimSpace(os.Getenv(name)) }

func defaultValue(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func validateURL(name, raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("%s must be a valid URL", name)
	}
	return nil
}

func validateHTTPURL(name, raw string) error {
	return validateURLScheme(name, raw, "http", "https")
}

func validateURLScheme(name, raw string, schemes ...string) error {
	if err := validateURL(name, raw); err != nil {
		return err
	}
	parsed, _ := url.Parse(raw)
	for _, scheme := range schemes {
		if parsed.Scheme == scheme {
			return nil
		}
	}
	return fmt.Errorf("%s must use %s", name, strings.Join(schemes, " or "))
}
