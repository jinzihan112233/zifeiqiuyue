import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "community"."enum_users_role" AS ENUM('member', 'editor', 'admin');
  CREATE TYPE "community"."enum_users_status" AS ENUM('active', 'banned');
  CREATE TYPE "community"."enum_contents_visibility" AS ENUM('unpublished', 'public', 'hidden');
  CREATE TYPE "community"."enum_submissions_status" AS ENUM('pending', 'approved', 'returned', 'withdrawn');
  CREATE TABLE "community"."users_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "community"."users" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"nickname" varchar NOT NULL,
  	"role" "community"."enum_users_role" DEFAULT 'member' NOT NULL,
  	"status" "community"."enum_users_status" DEFAULT 'active' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"email" varchar,
  	"username" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"reset_password_requested_at" timestamp(3) with time zone,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  CREATE TABLE "community"."contents" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"author_id" integer NOT NULL,
  	"slug" varchar NOT NULL,
  	"visibility" "community"."enum_contents_visibility" DEFAULT 'unpublished' NOT NULL,
  	"current_snapshot_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "community"."drafts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"author_id" integer NOT NULL,
  	"content_id" integer NOT NULL,
  	"title" varchar NOT NULL,
  	"markdown" varchar NOT NULL,
  	"media_ids" jsonb DEFAULT '[]'::jsonb,
  	"revision" numeric DEFAULT 1 NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "community"."_drafts_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_author_id" integer NOT NULL,
  	"version_content_id" integer NOT NULL,
  	"version_title" varchar NOT NULL,
  	"version_markdown" varchar NOT NULL,
  	"version_media_ids" jsonb DEFAULT '[]'::jsonb,
  	"version_revision" numeric DEFAULT 1 NOT NULL,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "community"."submissions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"author_id" integer NOT NULL,
  	"content_id" integer NOT NULL,
  	"title" varchar NOT NULL,
  	"markdown" varchar NOT NULL,
  	"media_ids" jsonb DEFAULT '[]'::jsonb,
  	"revision" numeric NOT NULL,
  	"status" "community"."enum_submissions_status" DEFAULT 'pending' NOT NULL,
  	"reviewer_id" integer,
  	"reason" varchar,
  	"reviewed_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "community"."snapshots" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"content_id" integer NOT NULL,
  	"submission_id" integer NOT NULL,
  	"title" varchar NOT NULL,
  	"markdown" varchar NOT NULL,
  	"media_ids" jsonb DEFAULT '[]'::jsonb,
  	"html" varchar NOT NULL,
  	"plain_text" varchar NOT NULL,
  	"renderer_version" varchar NOT NULL,
  	"body_hash" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "community"."media" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"owner_id" integer NOT NULL,
  	"alt" varchar NOT NULL,
  	"body_hash" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric,
  	"sizes_thumb_url" varchar,
  	"sizes_thumb_width" numeric,
  	"sizes_thumb_height" numeric,
  	"sizes_thumb_mime_type" varchar,
  	"sizes_thumb_filesize" numeric,
  	"sizes_thumb_filename" varchar
  );
  
  CREATE TABLE "community"."annotations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"author_id" integer NOT NULL,
  	"content_id" integer NOT NULL,
  	"snapshot_id" integer NOT NULL,
  	"start" numeric NOT NULL,
  	"end" numeric NOT NULL,
  	"quote" varchar NOT NULL,
  	"prefix" varchar,
  	"suffix" varchar,
  	"body" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "community"."payload_kv" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar NOT NULL,
  	"data" jsonb NOT NULL
  );
  
  CREATE TABLE "community"."payload_locked_documents" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"global_slug" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "community"."payload_locked_documents_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"contents_id" integer,
  	"drafts_id" integer,
  	"submissions_id" integer,
  	"snapshots_id" integer,
  	"media_id" integer,
  	"annotations_id" integer
  );
  
  CREATE TABLE "community"."payload_preferences" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar,
  	"value" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "community"."payload_preferences_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );
  
  CREATE TABLE "community"."payload_migrations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"batch" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "community"."users_sessions" ADD CONSTRAINT "users_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "community"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."contents" ADD CONSTRAINT "contents_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "community"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."contents" ADD CONSTRAINT "contents_current_snapshot_id_snapshots_id_fk" FOREIGN KEY ("current_snapshot_id") REFERENCES "community"."snapshots"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."drafts" ADD CONSTRAINT "drafts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "community"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."drafts" ADD CONSTRAINT "drafts_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "community"."contents"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."_drafts_v" ADD CONSTRAINT "_drafts_v_parent_id_drafts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "community"."drafts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."_drafts_v" ADD CONSTRAINT "_drafts_v_version_author_id_users_id_fk" FOREIGN KEY ("version_author_id") REFERENCES "community"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."_drafts_v" ADD CONSTRAINT "_drafts_v_version_content_id_contents_id_fk" FOREIGN KEY ("version_content_id") REFERENCES "community"."contents"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."submissions" ADD CONSTRAINT "submissions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "community"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."submissions" ADD CONSTRAINT "submissions_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "community"."contents"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."submissions" ADD CONSTRAINT "submissions_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "community"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."snapshots" ADD CONSTRAINT "snapshots_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "community"."contents"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."snapshots" ADD CONSTRAINT "snapshots_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "community"."submissions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."media" ADD CONSTRAINT "media_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "community"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."annotations" ADD CONSTRAINT "annotations_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "community"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."annotations" ADD CONSTRAINT "annotations_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "community"."contents"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."annotations" ADD CONSTRAINT "annotations_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "community"."snapshots"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "community"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "community"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_contents_fk" FOREIGN KEY ("contents_id") REFERENCES "community"."contents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_drafts_fk" FOREIGN KEY ("drafts_id") REFERENCES "community"."drafts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_submissions_fk" FOREIGN KEY ("submissions_id") REFERENCES "community"."submissions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_snapshots_fk" FOREIGN KEY ("snapshots_id") REFERENCES "community"."snapshots"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "community"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_annotations_fk" FOREIGN KEY ("annotations_id") REFERENCES "community"."annotations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "community"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "community"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "users_sessions_order_idx" ON "community"."users_sessions" USING btree ("_order");
  CREATE INDEX "users_sessions_parent_id_idx" ON "community"."users_sessions" USING btree ("_parent_id");
  CREATE INDEX "users_updated_at_idx" ON "community"."users" USING btree ("updated_at");
  CREATE INDEX "users_created_at_idx" ON "community"."users" USING btree ("created_at");
  CREATE UNIQUE INDEX "users_username_idx" ON "community"."users" USING btree ("username");
  CREATE INDEX "contents_author_idx" ON "community"."contents" USING btree ("author_id");
  CREATE UNIQUE INDEX "contents_slug_idx" ON "community"."contents" USING btree ("slug");
  CREATE INDEX "contents_visibility_idx" ON "community"."contents" USING btree ("visibility");
  CREATE INDEX "contents_current_snapshot_idx" ON "community"."contents" USING btree ("current_snapshot_id");
  CREATE INDEX "contents_updated_at_idx" ON "community"."contents" USING btree ("updated_at");
  CREATE INDEX "contents_created_at_idx" ON "community"."contents" USING btree ("created_at");
  CREATE INDEX "drafts_author_idx" ON "community"."drafts" USING btree ("author_id");
  CREATE UNIQUE INDEX "drafts_content_idx" ON "community"."drafts" USING btree ("content_id");
  CREATE INDEX "drafts_updated_at_idx" ON "community"."drafts" USING btree ("updated_at");
  CREATE INDEX "drafts_created_at_idx" ON "community"."drafts" USING btree ("created_at");
  CREATE INDEX "_drafts_v_parent_idx" ON "community"."_drafts_v" USING btree ("parent_id");
  CREATE INDEX "_drafts_v_version_version_author_idx" ON "community"."_drafts_v" USING btree ("version_author_id");
  CREATE INDEX "_drafts_v_version_version_content_idx" ON "community"."_drafts_v" USING btree ("version_content_id");
  CREATE INDEX "_drafts_v_version_version_updated_at_idx" ON "community"."_drafts_v" USING btree ("version_updated_at");
  CREATE INDEX "_drafts_v_version_version_created_at_idx" ON "community"."_drafts_v" USING btree ("version_created_at");
  CREATE INDEX "_drafts_v_created_at_idx" ON "community"."_drafts_v" USING btree ("created_at");
  CREATE INDEX "_drafts_v_updated_at_idx" ON "community"."_drafts_v" USING btree ("updated_at");
  CREATE INDEX "submissions_author_idx" ON "community"."submissions" USING btree ("author_id");
  CREATE INDEX "submissions_content_idx" ON "community"."submissions" USING btree ("content_id");
  CREATE INDEX "submissions_status_idx" ON "community"."submissions" USING btree ("status");
  CREATE INDEX "submissions_reviewer_idx" ON "community"."submissions" USING btree ("reviewer_id");
  CREATE INDEX "submissions_updated_at_idx" ON "community"."submissions" USING btree ("updated_at");
  CREATE INDEX "submissions_created_at_idx" ON "community"."submissions" USING btree ("created_at");
  CREATE INDEX "snapshots_content_idx" ON "community"."snapshots" USING btree ("content_id");
  CREATE UNIQUE INDEX "snapshots_submission_idx" ON "community"."snapshots" USING btree ("submission_id");
  CREATE INDEX "snapshots_updated_at_idx" ON "community"."snapshots" USING btree ("updated_at");
  CREATE INDEX "snapshots_created_at_idx" ON "community"."snapshots" USING btree ("created_at");
  CREATE INDEX "media_owner_idx" ON "community"."media" USING btree ("owner_id");
  CREATE INDEX "media_updated_at_idx" ON "community"."media" USING btree ("updated_at");
  CREATE INDEX "media_created_at_idx" ON "community"."media" USING btree ("created_at");
  CREATE UNIQUE INDEX "media_filename_idx" ON "community"."media" USING btree ("filename");
  CREATE INDEX "media_sizes_thumb_sizes_thumb_filename_idx" ON "community"."media" USING btree ("sizes_thumb_filename");
  CREATE INDEX "annotations_author_idx" ON "community"."annotations" USING btree ("author_id");
  CREATE INDEX "annotations_content_idx" ON "community"."annotations" USING btree ("content_id");
  CREATE INDEX "annotations_snapshot_idx" ON "community"."annotations" USING btree ("snapshot_id");
  CREATE INDEX "annotations_updated_at_idx" ON "community"."annotations" USING btree ("updated_at");
  CREATE INDEX "annotations_created_at_idx" ON "community"."annotations" USING btree ("created_at");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "community"."payload_kv" USING btree ("key");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "community"."payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "community"."payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "community"."payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "community"."payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "community"."payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "community"."payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_users_id_idx" ON "community"."payload_locked_documents_rels" USING btree ("users_id");
  CREATE INDEX "payload_locked_documents_rels_contents_id_idx" ON "community"."payload_locked_documents_rels" USING btree ("contents_id");
  CREATE INDEX "payload_locked_documents_rels_drafts_id_idx" ON "community"."payload_locked_documents_rels" USING btree ("drafts_id");
  CREATE INDEX "payload_locked_documents_rels_submissions_id_idx" ON "community"."payload_locked_documents_rels" USING btree ("submissions_id");
  CREATE INDEX "payload_locked_documents_rels_snapshots_id_idx" ON "community"."payload_locked_documents_rels" USING btree ("snapshots_id");
  CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "community"."payload_locked_documents_rels" USING btree ("media_id");
  CREATE INDEX "payload_locked_documents_rels_annotations_id_idx" ON "community"."payload_locked_documents_rels" USING btree ("annotations_id");
  CREATE INDEX "payload_preferences_key_idx" ON "community"."payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "community"."payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "community"."payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "community"."payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "community"."payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "community"."payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_users_id_idx" ON "community"."payload_preferences_rels" USING btree ("users_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "community"."payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "community"."payload_migrations" USING btree ("created_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "community"."users_sessions" CASCADE;
  DROP TABLE "community"."users" CASCADE;
  DROP TABLE "community"."contents" CASCADE;
  DROP TABLE "community"."drafts" CASCADE;
  DROP TABLE "community"."_drafts_v" CASCADE;
  DROP TABLE "community"."submissions" CASCADE;
  DROP TABLE "community"."snapshots" CASCADE;
  DROP TABLE "community"."media" CASCADE;
  DROP TABLE "community"."annotations" CASCADE;
  DROP TABLE "community"."payload_kv" CASCADE;
  DROP TABLE "community"."payload_locked_documents" CASCADE;
  DROP TABLE "community"."payload_locked_documents_rels" CASCADE;
  DROP TABLE "community"."payload_preferences" CASCADE;
  DROP TABLE "community"."payload_preferences_rels" CASCADE;
  DROP TABLE "community"."payload_migrations" CASCADE;
  DROP TYPE "community"."enum_users_role";
  DROP TYPE "community"."enum_users_status";
  DROP TYPE "community"."enum_contents_visibility";
  DROP TYPE "community"."enum_submissions_status";`)
}
