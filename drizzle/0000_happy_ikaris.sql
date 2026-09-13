CREATE TABLE `ai_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`usage_date` text NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`estimated_cost_cny` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ai_usage_user_date` ON `ai_usage` (`user_id`,`usage_date`);--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`ledger_type` text NOT NULL,
	`symbol` text NOT NULL,
	`asset_name` text NOT NULL,
	`side` text NOT NULL,
	`trade_date` text NOT NULL,
	`price` real DEFAULT 0 NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`fees` real DEFAULT 0 NOT NULL,
	`thesis` text DEFAULT '' NOT NULL,
	`invalidation` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `report_supplements` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`status` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`report_type` text NOT NULL,
	`trading_date` text NOT NULL,
	`generated_at` text NOT NULL,
	`data_cutoff` text NOT NULL,
	`profile_version` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`payload_json` text NOT NULL,
	`integrity_hash` text NOT NULL,
	`locked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `risk_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`version` integer NOT NULL,
	`capital_band` text NOT NULL,
	`monthly_contribution` real NOT NULL,
	`experience` text NOT NULL,
	`objective` text NOT NULL,
	`stock_horizon` text NOT NULL,
	`fund_horizon` text NOT NULL,
	`routine_risk_pct` real NOT NULL,
	`absolute_risk_pct` real NOT NULL,
	`max_drawdown_pct` real NOT NULL,
	`preferred_assets` text NOT NULL,
	`excluded_scope` text DEFAULT '' NOT NULL,
	`accepted_disclaimer` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_risk_profiles_user_version` ON `risk_profiles` (`user_id`,`version`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sessions_token_hash` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `task_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_key` text NOT NULL,
	`task_type` text NOT NULL,
	`scheduled_for` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_task_runs_task_key` ON `task_runs` (`task_key`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`must_change_password` integer DEFAULT true NOT NULL,
	`onboarding_complete` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_username` ON `users` (`username`);--> statement-breakpoint
CREATE TABLE `watchlist` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`symbol` text NOT NULL,
	`asset_type` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_watchlist_user_symbol` ON `watchlist` (`user_id`,`symbol`);