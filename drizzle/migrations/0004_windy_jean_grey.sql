CREATE TABLE "jira_worklogs" (
	"id" text PRIMARY KEY NOT NULL,
	"sprint_id" text NOT NULL,
	"issue_key" text NOT NULL,
	"author_account_id" text,
	"author_name" text,
	"author_active" boolean,
	"time_spent_seconds" double precision DEFAULT 0 NOT NULL,
	"started" text NOT NULL,
	"synced_at" text DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "jira_worklogs_sprint_id_idx" ON "jira_worklogs" USING btree ("sprint_id");--> statement-breakpoint
CREATE INDEX "jira_worklogs_author_account_id_idx" ON "jira_worklogs" USING btree ("author_account_id");