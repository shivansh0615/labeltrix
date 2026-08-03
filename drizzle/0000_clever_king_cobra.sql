CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`marketplace` text NOT NULL,
	`ean` text NOT NULL,
	`fsn` text NOT NULL,
	`sku` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`brand` text DEFAULT '' NOT NULL,
	`payload` text NOT NULL,
	`source_file` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_products_marketplace_ean` ON `products` (`marketplace`,`ean`);--> statement-breakpoint
CREATE INDEX `idx_products_ean` ON `products` (`ean`);--> statement-breakpoint
CREATE INDEX `idx_products_fsn` ON `products` (`fsn`);--> statement-breakpoint
CREATE INDEX `idx_products_sku` ON `products` (`sku`);