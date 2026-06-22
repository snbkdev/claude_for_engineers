CREATE TABLE `gifts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_id` integer NOT NULL,
	`course_id` integer NOT NULL,
	`sender_id` integer NOT NULL,
	`recipient_email` text NOT NULL,
	`message` text,
	`code` text NOT NULL,
	`claimed_by_user_id` integer,
	`claimed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`claimed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gifts_code_unique` ON `gifts` (`code`);