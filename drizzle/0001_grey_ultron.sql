CREATE TABLE `packaging_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`marketplace` text NOT NULL,
	`source_sheet` text NOT NULL,
	`format_sheet` text NOT NULL,
	`source_file` text NOT NULL,
	`label_count` integer NOT NULL,
	`payload` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_packaging_runs_created` ON `packaging_runs` (`created_at`);