CREATE TYPE "public"."import_trigger" AS ENUM('manual', 'webhook');--> statement-breakpoint
ALTER TABLE "import_logs" ADD COLUMN "trigger" "import_trigger" DEFAULT 'manual' NOT NULL;