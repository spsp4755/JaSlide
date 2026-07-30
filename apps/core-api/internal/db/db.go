package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/config"
)

const dependencyTimeout = 3 * time.Second

type Store struct {
	pool  *pgxpool.Pool
	redis *redis.Client
}

func Open(parent context.Context, cfg config.Config) (*Store, error) {
	ctx, cancel := context.WithTimeout(parent, dependencyTimeout)
	defer cancel()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("configure postgres: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}

	redisOptions, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		pool.Close()
		return nil, fmt.Errorf("configure redis: %w", err)
	}
	redisClient := redis.NewClient(redisOptions)
	if err := redisClient.Ping(ctx).Err(); err != nil {
		pool.Close()
		_ = redisClient.Close()
		return nil, fmt.Errorf("ping redis: %w", err)
	}

	return &Store{pool: pool, redis: redisClient}, nil
}

func (store *Store) Ready() error {
	ctx, cancel := context.WithTimeout(context.Background(), dependencyTimeout)
	defer cancel()

	if err := store.pool.Ping(ctx); err != nil {
		return fmt.Errorf("postgres unavailable: %w", err)
	}
	if err := store.redis.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("redis unavailable: %w", err)
	}
	return nil
}

func (store *Store) Close() error {
	store.pool.Close()
	return store.redis.Close()
}
