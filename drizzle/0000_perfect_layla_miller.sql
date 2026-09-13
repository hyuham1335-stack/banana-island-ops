CREATE TYPE "public"."calc_kind" AS ENUM('actual', 'simulation');--> statement-breakpoint
CREATE TYPE "public"."channel_kind" AS ENUM('sales', 'content');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('draft', 'in_review', 'approved', 'rejected', 'published');--> statement-breakpoint
CREATE TYPE "public"."cost_basis" AS ENUM('per_unit', 'per_batch');--> statement-breakpoint
CREATE TYPE "public"."cost_sheet_status" AS ENUM('draft', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."cost_stage" AS ENUM('ph', 'kr', 'us');--> statement-breakpoint
CREATE TYPE "public"."distribution_route" AS ENUM('kr_domestic', 'us_export', 'ph_local');--> statement-breakpoint
CREATE TYPE "public"."example_reason" AS ENUM('admin_approval', 'high_conversion', 'repeated_edit');--> statement-breakpoint
CREATE TYPE "public"."fx_source" AS ENUM('api', 'manual');--> statement-breakpoint
CREATE TYPE "public"."history_reason" AS ENUM('regenerate', 'rejected_edit', 'manual_edit', 'submit');--> statement-breakpoint
CREATE TYPE "public"."import_target" AS ENUM('ad_performance', 'content_performance', 'cost_items', 'publish_plans');--> statement-breakpoint
CREATE TYPE "public"."input_source" AS ENUM('csv', 'manual', 'sheet', 'api');--> statement-breakpoint
CREATE TYPE "public"."lang" AS ENUM('ko', 'en');--> statement-breakpoint
CREATE TYPE "public"."link_policy" AS ENUM('inline', 'bio', 'none');--> statement-breakpoint
CREATE TYPE "public"."performance_source" AS ENUM('utm_ga4', 'nt_smartstore', 'amazon_attribution', 'redirect');--> statement-breakpoint
CREATE TYPE "public"."post_type" AS ENUM('health_info', 'activity_news', 'comparison', 'review');--> statement-breakpoint
CREATE TYPE "public"."publish_method" AS ENUM('manual', 'api');--> statement-breakpoint
CREATE TYPE "public"."rule_scope" AS ENUM('common', 'country', 'channel', 'product');--> statement-breakpoint
CREATE TYPE "public"."rule_status" AS ENUM('draft', 'active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."rule_type" AS ENUM('ban', 'must', 'tone', 'format', 'persona');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('block', 'warn');--> statement-breakpoint
CREATE TYPE "public"."tracking_method" AS ENUM('utm_ga4', 'nt_smartstore', 'amazon_attribution', 'redirect');--> statement-breakpoint
CREATE TYPE "public"."url_check" AS ENUM('ok', 'unreachable', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'editor', 'viewer');--> statement-breakpoint
CREATE TABLE "ad_performance" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"channel_id" bigint NOT NULL,
	"product_id" bigint,
	"content_id" bigint,
	"import_id" bigint,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"spend" numeric(14, 4) NOT NULL,
	"revenue" numeric(14, 4),
	"orders" integer,
	"currency" char(3) NOT NULL,
	"input_source" "input_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_performance_uk" UNIQUE("channel_id","period_start","period_end")
);
--> statement-breakpoint
CREATE TABLE "brand_examples" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"content_id" bigint,
	"channel_id" bigint NOT NULL,
	"lang" "lang" NOT NULL,
	"summary" text NOT NULL,
	"reason" "example_reason" NOT NULL,
	"evidence" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_rule_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rule_id" bigint NOT NULL,
	"changed_by" bigint,
	"change_type" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_rules" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"scope" "rule_scope" NOT NULL,
	"country" char(2),
	"channel_id" bigint,
	"product_id" bigint,
	"rule_type" "rule_type" NOT NULL,
	"lang" "lang" NOT NULL,
	"content" text NOT NULL,
	"detect_pattern" text,
	"alternative" text,
	"reason" text,
	"legal_basis" text,
	"severity" "severity",
	"status" "rule_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" bigint,
	"approved_by" bigint,
	"effective_from" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"content_id" bigint NOT NULL,
	"version_no" integer NOT NULL,
	"reason" "history_reason" NOT NULL,
	"title" text,
	"body" text,
	"sent_prompt" text,
	"detected_terms" jsonb,
	"changed_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_performance" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"content_id" bigint NOT NULL,
	"import_id" bigint,
	"source" "performance_source" NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"orders" integer,
	"revenue" numeric(14, 4),
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_performance_uk" UNIQUE("content_id","source","period_start","period_end")
);
--> statement-breakpoint
CREATE TABLE "contents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publish_plan_id" bigint,
	"source_content_id" bigint,
	"product_id" bigint,
	"channel_id" bigint NOT NULL,
	"template_id" bigint,
	"author_id" bigint,
	"reviewer_id" bigint,
	"publisher_id" bigint,
	"lang" "lang" NOT NULL,
	"target_persona" text,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"title_candidates" jsonb,
	"body" text,
	"regen_count" integer DEFAULT 0 NOT NULL,
	"rule_snapshot" jsonb,
	"detected_terms" jsonb,
	"sent_prompt" text,
	"model" text,
	"reject_reason" text,
	"published_url" text,
	"url_check" "url_check",
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contents_publish_plan_id_unique" UNIQUE("publish_plan_id")
);
--> statement-breakpoint
CREATE TABLE "cost_calc_results" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cost_sheet_id" bigint NOT NULL,
	"channel_id" bigint NOT NULL,
	"fx_php" numeric(18, 8) NOT NULL,
	"fx_usd" numeric(18, 8) NOT NULL,
	"unit_cost_krw" numeric(14, 4) NOT NULL,
	"price_krw" numeric(14, 4) NOT NULL,
	"margin_rate" numeric(14, 4),
	"fixed_cost_krw" numeric(14, 4),
	"bep_qty" integer,
	"kind" "calc_kind" NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cost_sheet_id" bigint NOT NULL,
	"stage" "cost_stage" NOT NULL,
	"cost_kind" text NOT NULL,
	"amount" numeric(14, 4) NOT NULL,
	"currency" char(3) NOT NULL,
	"basis" "cost_basis" DEFAULT 'per_unit' NOT NULL,
	"batch_qty" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_sheets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" bigint NOT NULL,
	"distribution_route" "distribution_route" NOT NULL,
	"name" text NOT NULL,
	"effective_from" date,
	"status" "cost_sheet_status" DEFAULT 'draft' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rate_date" date NOT NULL,
	"base" char(3) NOT NULL,
	"quote" char(3) NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"source" "fx_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_uk" UNIQUE("rate_date","base","quote")
);
--> statement-breakpoint
CREATE TABLE "import_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"executed_by" bigint,
	"target" "import_target" NOT NULL,
	"input_source" "input_source" NOT NULL,
	"source_ref" text,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"ok_rows" integer DEFAULT 0 NOT NULL,
	"failed_rows" integer DEFAULT 0 NOT NULL,
	"errors" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_code" text NOT NULL,
	"name" text NOT NULL,
	"weight_g" integer,
	"price_krw" numeric(14, 4),
	"price_usd" numeric(14, 4),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_product_code_unique" UNIQUE("product_code")
);
--> statement-breakpoint
CREATE TABLE "prompt_templates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"channel_id" bigint,
	"name" text NOT NULL,
	"lang" "lang" NOT NULL,
	"body" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publish_plans" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"import_id" bigint,
	"sheet_row_key" text NOT NULL,
	"scheduled_date" date NOT NULL,
	"channel_id" bigint NOT NULL,
	"product_id" bigint,
	"lang" "lang" NOT NULL,
	"post_type" "post_type" NOT NULL,
	"topic_memo" text DEFAULT '' NOT NULL,
	"owner_id" bigint,
	"on_hold" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publish_plans_sheet_row_key_unique" UNIQUE("sheet_row_key")
);
--> statement-breakpoint
CREATE TABLE "sales_channels" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"channel_code" text NOT NULL,
	"name" text NOT NULL,
	"country" char(2) NOT NULL,
	"currency" char(3) NOT NULL,
	"lang" "lang" NOT NULL,
	"distribution_route" "distribution_route" NOT NULL,
	"fee_rate" numeric(14, 4),
	"publish_method" "publish_method" DEFAULT 'manual' NOT NULL,
	"tracking_method" "tracking_method",
	"kind" "channel_kind" NOT NULL,
	"utm_source" text,
	"utm_medium" text,
	"link_policy" "link_policy" DEFAULT 'inline' NOT NULL,
	"write_url" text,
	"persona" text,
	"tone" text,
	"format" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_channels_channel_code_unique" UNIQUE("channel_code")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "ad_performance" ADD CONSTRAINT "ad_performance_channel_id_sales_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."sales_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_performance" ADD CONSTRAINT "ad_performance_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_performance" ADD CONSTRAINT "ad_performance_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_performance" ADD CONSTRAINT "ad_performance_import_id_import_logs_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."import_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_examples" ADD CONSTRAINT "brand_examples_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_examples" ADD CONSTRAINT "brand_examples_channel_id_sales_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."sales_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_rule_history" ADD CONSTRAINT "brand_rule_history_rule_id_brand_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."brand_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_rule_history" ADD CONSTRAINT "brand_rule_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_rules" ADD CONSTRAINT "brand_rules_channel_id_sales_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."sales_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_rules" ADD CONSTRAINT "brand_rules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_rules" ADD CONSTRAINT "brand_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_rules" ADD CONSTRAINT "brand_rules_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_history" ADD CONSTRAINT "content_history_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_history" ADD CONSTRAINT "content_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_performance" ADD CONSTRAINT "content_performance_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_performance" ADD CONSTRAINT "content_performance_import_id_import_logs_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."import_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_publish_plan_id_publish_plans_id_fk" FOREIGN KEY ("publish_plan_id") REFERENCES "public"."publish_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_source_content_id_contents_id_fk" FOREIGN KEY ("source_content_id") REFERENCES "public"."contents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_channel_id_sales_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."sales_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_template_id_prompt_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."prompt_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_publisher_id_users_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_calc_results" ADD CONSTRAINT "cost_calc_results_cost_sheet_id_cost_sheets_id_fk" FOREIGN KEY ("cost_sheet_id") REFERENCES "public"."cost_sheets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_calc_results" ADD CONSTRAINT "cost_calc_results_channel_id_sales_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."sales_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_items" ADD CONSTRAINT "cost_items_cost_sheet_id_cost_sheets_id_fk" FOREIGN KEY ("cost_sheet_id") REFERENCES "public"."cost_sheets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_sheets" ADD CONSTRAINT "cost_sheets_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_logs" ADD CONSTRAINT "import_logs_executed_by_users_id_fk" FOREIGN KEY ("executed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_channel_id_sales_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."sales_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_plans" ADD CONSTRAINT "publish_plans_import_id_import_logs_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."import_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_plans" ADD CONSTRAINT "publish_plans_channel_id_sales_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."sales_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_plans" ADD CONSTRAINT "publish_plans_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_plans" ADD CONSTRAINT "publish_plans_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_examples_channel_lang_active_idx" ON "brand_examples" USING btree ("channel_id","lang","is_active");--> statement-breakpoint
CREATE INDEX "brand_rules_status_scope_lang_idx" ON "brand_rules" USING btree ("status","scope","lang");--> statement-breakpoint
CREATE INDEX "content_history_content_version_idx" ON "content_history" USING btree ("content_id","version_no");--> statement-breakpoint
CREATE INDEX "contents_status_updated_idx" ON "contents" USING btree ("status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "contents_author_idx" ON "contents" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "cost_sheets_product_route_status_idx" ON "cost_sheets" USING btree ("product_id","distribution_route","status");--> statement-breakpoint
CREATE INDEX "import_logs_target_created_idx" ON "import_logs" USING btree ("target","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "prompt_templates_channel_lang_active_idx" ON "prompt_templates" USING btree ("channel_id","lang","is_active");--> statement-breakpoint
CREATE INDEX "publish_plans_scheduled_date_idx" ON "publish_plans" USING btree ("scheduled_date");