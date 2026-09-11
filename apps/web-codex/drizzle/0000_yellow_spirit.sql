CREATE TABLE `advisor_students` (
	`id` text PRIMARY KEY NOT NULL,
	`advisor_id` text NOT NULL,
	`student_id` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_advisor_student` ON `advisor_students` (`advisor_id`,`student_id`);--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`source_type` text NOT NULL,
	`source_external_id` text,
	`location` text,
	`raw_metadata` text,
	`last_synced_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_events_source` ON `calendar_events` (`source_type`,`source_external_id`);--> statement-breakpoint
CREATE INDEX `idx_events_user_start` ON `calendar_events` (`user_id`,`start_at`);--> statement-breakpoint
CREATE TABLE `recurrence_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`frequency` text NOT NULL,
	`interval` integer DEFAULT 1 NOT NULL,
	`days_of_week` text,
	`day_of_month` integer,
	`start_at` text NOT NULL,
	`end_at` text,
	`next_occurrence_at` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`user_id` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`status` text NOT NULL,
	`items_created` integer DEFAULT 0 NOT NULL,
	`items_updated` integer DEFAULT 0 NOT NULL,
	`items_deleted` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text
);
--> statement-breakpoint
CREATE TABLE `task_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`event_type` text NOT NULL,
	`occurred_at` text NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `idx_activity_task` ON `task_activities` (`task_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`assigned_by_user_id` text,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'TODO' NOT NULL,
	`priority` text DEFAULT 'NORMAL' NOT NULL,
	`due_at` text,
	`scheduled_start_at` text,
	`scheduled_end_at` text,
	`completed_at` text,
	`estimated_minutes` integer,
	`source_type` text NOT NULL,
	`source_external_id` text,
	`source_metadata` text,
	`recurrence_rule_id` text,
	`parent_task_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_owner_status` ON `tasks` (`owner_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_tasks_due` ON `tasks` (`due_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tasks_source` ON `tasks` (`source_type`,`source_external_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`external_id` text,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`role` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
