package config

import (
	"fmt"
	"net/url"
	"os"
	"strings"
)

type Config struct {
	Address      string
	Environment  string
	DatabaseURL  string
	RedisURL     string
	JWTSecret    string
	RendererURL  string
	PublicOrigin string
}

func Load() (Config, error) {
	publicOrigin := value("PUBLIC_ORIGIN")
	if publicOrigin == "" {
		publicOrigin = value("CORS_ORIGIN")
	}

	config := Config{
		Address:      defaultValue(value("CORE_API_ADDR"), ":4000"),
		Environment:  defaultValue(value("NODE_ENV"), defaultValue(value("APP_ENV"), "development")),
		DatabaseURL:  value("DATABASE_URL"),
		RedisURL:     value("REDIS_URL"),
		JWTSecret:    value("JWT_SECRET"),
		RendererURL:  value("RENDERER_URL"),
		PublicOrigin: publicOrigin,
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
		if err := validateURL("DATABASE_URL", config.DatabaseURL); err != nil {
			return Config{}, err
		}
		if err := validateURL("REDIS_URL", config.RedisURL); err != nil {
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
	if err := validateURL(name, raw); err != nil {
		return err
	}
	parsed, _ := url.Parse(raw)
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("%s must use http or https", name)
	}
	return nil
}
