ALTER TABLE `courses` ADD `moderation_status` text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE `courses` ADD `rejection_reason` text;