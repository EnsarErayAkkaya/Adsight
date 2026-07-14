CREATE TABLE `meta_ad` (
	`campaign_id` text NOT NULL,
	`ad_id` text NOT NULL,
	`name` text NOT NULL,
	`spend` real,
	`impressions` integer,
	`clicks` integer,
	`installs` integer,
	`creative_type` text NOT NULL,
	`thumbnail_url` text,
	`image_url` text,
	`video_url` text,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`campaign_id`, `ad_id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaign`(`id`) ON UPDATE no action ON DELETE cascade
);
