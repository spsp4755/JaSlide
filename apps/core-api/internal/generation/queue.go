package generation

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

const generationQueueKey = "jaslide:generation"

type RedisQueue struct{ redis *redis.Client }

func NewRedisQueue(client *redis.Client) *RedisQueue { return &RedisQueue{redis: client} }

func (queue *RedisQueue) Add(ctx context.Context, id string) error {
	return queue.redis.LPush(ctx, generationQueueKey, id).Err()
}

func (queue *RedisQueue) Pop(ctx context.Context) (string, error) {
	values, err := queue.redis.BRPop(ctx, 5*time.Second, generationQueueKey).Result()
	if err != nil {
		return "", err
	}
	return values[1], nil
}
