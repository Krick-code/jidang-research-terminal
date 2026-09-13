CREATE TABLE `login_attempts` (
	`username` text PRIMARY KEY NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`window_started_at` text NOT NULL,
	`locked_until` text
);
--> statement-breakpoint
ALTER TABLE `risk_profiles` ADD `current_holdings` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `risk_profiles` ADD `fund_ledger_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `risk_profiles` ADD `stock_ledger_enabled` integer DEFAULT true NOT NULL;