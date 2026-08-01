-- AlterEnum
-- The Go generation API and outline prompt already treat TABLE as a valid
-- slide type (apps/core-api/internal/generation/service.go's slideTypes map),
-- but the Slide."type" column's Postgres enum never included it, so any
-- generated TABLE slide failed to persist with
-- "invalid input value for enum \"SlideType\": \"TABLE\"".
ALTER TYPE "SlideType" ADD VALUE 'TABLE';
