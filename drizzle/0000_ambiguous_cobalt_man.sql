CREATE TABLE `campaign` (
	`id` text PRIMARY KEY NOT NULL,
	`platform_id` text NOT NULL,
	`name` text NOT NULL,
	`meta_campaign_id` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	FOREIGN KEY (`platform_id`) REFERENCES `platform`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ga4_cohort` (
	`campaign_id` text NOT NULL,
	`install_date` text NOT NULL,
	`nth_day` integer NOT NULL,
	`active_users` integer,
	`total_users` integer,
	`avg_playtime_sec` real,
	PRIMARY KEY(`campaign_id`, `install_date`, `nth_day`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaign`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ga4_installs` (
	`campaign_id` text NOT NULL,
	`install_date` text NOT NULL,
	`installs` integer,
	PRIMARY KEY(`campaign_id`, `install_date`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaign`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `game` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`ga4_property_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meta_daily` (
	`campaign_id` text NOT NULL,
	`date` text NOT NULL,
	`spend` real,
	`impressions` integer,
	`clicks` integer,
	PRIMARY KEY(`campaign_id`, `date`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaign`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `platform` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`platform` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_game_unique` ON `platform` (`game_id`,`platform`);