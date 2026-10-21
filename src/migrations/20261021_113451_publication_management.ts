import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "community"."enum_media_cleanup_status" AS ENUM('pending', 'done');
  ALTER TYPE "community"."enum_contents_visibility" ADD VALUE 'purged';
  CREATE TABLE "community"."content_events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"content_id" integer NOT NULL,
  	"actor_id" integer NOT NULL,
  	"action" varchar NOT NULL,
  	"target" numeric,
  	"reason" varchar,
  	"internal_note" varchar,
  	"self_published" boolean,
  	"delegated" boolean,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "community"."media_cleanup" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"media_id" integer NOT NULL,
  	"files" jsonb NOT NULL,
  	"status" "community"."enum_media_cleanup_status" DEFAULT 'pending' NOT NULL,
  	"error" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "community"."drafts" ADD COLUMN "media_manifest" jsonb DEFAULT '[]'::jsonb;
  ALTER TABLE "community"."_drafts_v" ADD COLUMN "version_media_manifest" jsonb DEFAULT '[]'::jsonb;
  ALTER TABLE "community"."submissions" ADD COLUMN "media_manifest" jsonb DEFAULT '[]'::jsonb;
  ALTER TABLE "community"."submissions" ADD COLUMN "request_key" varchar;
  ALTER TABLE "community"."submissions" ADD COLUMN "decision_key" varchar;
  ALTER TABLE "community"."snapshots" ADD COLUMN "media_manifest" jsonb DEFAULT '[]'::jsonb;
  ALTER TABLE "community"."media" ADD COLUMN "purged" boolean DEFAULT false;
  ALTER TABLE "community"."payload_locked_documents_rels" ADD COLUMN "content_events_id" integer;
  ALTER TABLE "community"."payload_locked_documents_rels" ADD COLUMN "media_cleanup_id" integer;
  ALTER TABLE "community"."content_events" ADD CONSTRAINT "content_events_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "community"."contents"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."content_events" ADD CONSTRAINT "content_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "community"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."media_cleanup" ADD CONSTRAINT "media_cleanup_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "community"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "content_events_content_idx" ON "community"."content_events" USING btree ("content_id");
  CREATE INDEX "content_events_actor_idx" ON "community"."content_events" USING btree ("actor_id");
  CREATE INDEX "content_events_updated_at_idx" ON "community"."content_events" USING btree ("updated_at");
  CREATE INDEX "content_events_created_at_idx" ON "community"."content_events" USING btree ("created_at");
  CREATE INDEX "content_createdAt_idx" ON "community"."content_events" USING btree ("content_id","created_at");
  CREATE UNIQUE INDEX "media_cleanup_media_idx" ON "community"."media_cleanup" USING btree ("media_id");
  CREATE INDEX "media_cleanup_updated_at_idx" ON "community"."media_cleanup" USING btree ("updated_at");
  CREATE INDEX "media_cleanup_created_at_idx" ON "community"."media_cleanup" USING btree ("created_at");
  ALTER TABLE "community"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_content_events_fk" FOREIGN KEY ("content_events_id") REFERENCES "community"."content_events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_cleanup_fk" FOREIGN KEY ("media_cleanup_id") REFERENCES "community"."media_cleanup"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "submissions_request_key_idx" ON "community"."submissions" USING btree ("request_key");
  CREATE INDEX "payload_locked_documents_rels_content_events_id_idx" ON "community"."payload_locked_documents_rels" USING btree ("content_events_id");
  CREATE INDEX "payload_locked_documents_rels_media_cleanup_id_idx" ON "community"."payload_locked_documents_rels" USING btree ("media_cleanup_id");
  CREATE UNIQUE INDEX submissions_one_pending ON community.submissions (content_id) WHERE status='pending';
  CREATE INDEX submissions_queue ON community.submissions (status, created_at DESC, id DESC);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  throw new Error('P5 stores purge tombstones and audit history; use a verified full backup instead of a destructive down migration.');
  await db.execute(sql`
   ALTER TABLE "community"."content_events" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "community"."media_cleanup" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "community"."content_events" CASCADE;
  DROP TABLE "community"."media_cleanup" CASCADE;
  ALTER TABLE "community"."payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_content_events_fk";
  
  ALTER TABLE "community"."payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_media_cleanup_fk";
  
  ALTER TABLE "community"."contents" ALTER COLUMN "visibility" SET DATA TYPE text;
  ALTER TABLE "community"."contents" ALTER COLUMN "visibility" SET DEFAULT 'unpublished'::text;
  DROP TYPE "community"."enum_contents_visibility";
  CREATE TYPE "community"."enum_contents_visibility" AS ENUM('unpublished', 'public', 'hidden');
  ALTER TABLE "community"."contents" ALTER COLUMN "visibility" SET DEFAULT 'unpublished'::"community"."enum_contents_visibility";
  ALTER TABLE "community"."contents" ALTER COLUMN "visibility" SET DATA TYPE "community"."enum_contents_visibility" USING "visibility"::"community"."enum_contents_visibility";
  DROP INDEX "community"."submissions_request_key_idx";
  DROP INDEX "community"."payload_locked_documents_rels_content_events_id_idx";
  DROP INDEX "community"."payload_locked_documents_rels_media_cleanup_id_idx";
  ALTER TABLE "community"."drafts" DROP COLUMN "media_manifest";
  ALTER TABLE "community"."_drafts_v" DROP COLUMN "version_media_manifest";
  ALTER TABLE "community"."submissions" DROP COLUMN "media_manifest";
  ALTER TABLE "community"."submissions" DROP COLUMN "request_key";
  ALTER TABLE "community"."submissions" DROP COLUMN "decision_key";
  ALTER TABLE "community"."snapshots" DROP COLUMN "media_manifest";
  ALTER TABLE "community"."media" DROP COLUMN "purged";
  ALTER TABLE "community"."payload_locked_documents_rels" DROP COLUMN "content_events_id";
  ALTER TABLE "community"."payload_locked_documents_rels" DROP COLUMN "media_cleanup_id";
  DROP TYPE "community"."enum_media_cleanup_status";`)
}
