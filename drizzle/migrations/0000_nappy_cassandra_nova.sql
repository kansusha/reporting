CREATE TABLE "jira_issues" (
	"key" text PRIMARY KEY NOT NULL,
	"sprint_id" text NOT NULL,
	"project_key" text DEFAULT '' NOT NULL,
	"issue_type" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"status_category" text DEFAULT 'new' NOT NULL,
	"assignee_account_id" text,
	"assignee_name" text,
	"story_points" double precision,
	"priority" text DEFAULT '' NOT NULL,
	"created_at" text,
	"updated_at" text,
	"resolved_at" text,
	"synced_at" text DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jira_sprints" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"board_name" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"state" text NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"start_date" text,
	"end_date" text,
	"complete_date" text,
	"synced_at" text DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "jira_issues_sprint_id_idx" ON "jira_issues" USING btree ("sprint_id");--> statement-breakpoint
CREATE INDEX "jira_issues_status_category_idx" ON "jira_issues" USING btree ("status_category");--> statement-breakpoint
CREATE INDEX "jira_issues_assignee_account_id_idx" ON "jira_issues" USING btree ("assignee_account_id");