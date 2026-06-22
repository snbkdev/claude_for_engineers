CREATE TABLE `email_outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipient_user_id` integer NOT NULL,
	`to_email` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`sent_at` text,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
