CREATE TABLE `comment_reactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`comment_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`value` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`comment_id`) REFERENCES `lesson_comments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `lesson_comments` ADD `is_question` integer DEFAULT false NOT NULL;