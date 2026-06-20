CREATE TABLE `lesson_resources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lesson_id` integer NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`type` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action
);
