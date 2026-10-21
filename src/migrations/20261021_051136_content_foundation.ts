import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "community"."enum_contents_kind" AS ENUM('article', 'post');
  CREATE TABLE "community"."drafts_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"media_id" integer
  );
  
  CREATE TABLE "community"."_drafts_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"media_id" integer
  );
  
  CREATE TABLE "community"."submissions_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"media_id" integer
  );
  
  CREATE TABLE "community"."snapshots_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"media_id" integer
  );
  
  CREATE TABLE "community"."quotes" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"stable_id" varchar NOT NULL,
  	"text" varchar NOT NULL,
  	"attribution" varchar NOT NULL,
  	"content_id" integer,
  	"snapshot_id" integer,
  	"source_url" varchar,
  	"demo" boolean DEFAULT true,
  	"order" numeric NOT NULL,
  	"enabled" boolean DEFAULT true,
  	"import_state" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "community"."home" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar NOT NULL,
  	"introduction" varchar NOT NULL,
  	"import_state" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "community"."home_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"contents_id" integer
  );
  
  ALTER TABLE "community"."contents" ADD COLUMN "stable_id" varchar;
  UPDATE "community"."contents" SET "stable_id" = gen_random_uuid()::text;
  ALTER TABLE "community"."contents" ALTER COLUMN "stable_id" SET NOT NULL;
  ALTER TABLE "community"."contents" ADD COLUMN "kind" "community"."enum_contents_kind" DEFAULT 'post' NOT NULL;
  ALTER TABLE "community"."contents" ADD COLUMN "import_state" jsonb;
  ALTER TABLE "community"."drafts" ADD COLUMN "metadata" jsonb DEFAULT '{"category":"","demo":true,"sourceUrl":"","originalVideoDate":"","legacyDate":""}'::jsonb;
  ALTER TABLE "community"."_drafts_v" ADD COLUMN "version_metadata" jsonb DEFAULT '{"category":"","demo":true,"sourceUrl":"","originalVideoDate":"","legacyDate":""}'::jsonb;
  ALTER TABLE "community"."submissions" ADD COLUMN "metadata" jsonb DEFAULT '{"category":"","demo":true,"sourceUrl":"","originalVideoDate":"","legacyDate":""}'::jsonb;
  ALTER TABLE "community"."snapshots" ADD COLUMN "stable_id" varchar;
  UPDATE "community"."snapshots" SET "stable_id" = gen_random_uuid()::text;
  ALTER TABLE "community"."snapshots" ALTER COLUMN "stable_id" SET NOT NULL;
  ALTER TABLE "community"."snapshots" ADD COLUMN "published_at" timestamp(3) with time zone;
  UPDATE "community"."snapshots" SET "published_at" = "created_at";
  ALTER TABLE "community"."snapshots" ALTER COLUMN "published_at" SET NOT NULL;
  ALTER TABLE "community"."snapshots" ADD COLUMN "summary" varchar;
  ALTER TABLE "community"."snapshots" ADD COLUMN "metadata" jsonb DEFAULT '{"category":"","demo":true,"sourceUrl":"","originalVideoDate":"","legacyDate":""}'::jsonb;
  ALTER TABLE "community"."media" ADD COLUMN "stable_id" varchar;
  UPDATE "community"."media" SET "stable_id" = gen_random_uuid()::text;
  ALTER TABLE "community"."media" ALTER COLUMN "stable_id" SET NOT NULL;
  ALTER TABLE "community"."payload_locked_documents_rels" ADD COLUMN "quotes_id" integer;
  ALTER TABLE "community"."payload_locked_documents_rels" ADD COLUMN "home_id" integer;
  ALTER TABLE "community"."drafts_rels" ADD CONSTRAINT "drafts_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "community"."drafts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."drafts_rels" ADD CONSTRAINT "drafts_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "community"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."_drafts_v_rels" ADD CONSTRAINT "_drafts_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "community"."_drafts_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."_drafts_v_rels" ADD CONSTRAINT "_drafts_v_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "community"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."submissions_rels" ADD CONSTRAINT "submissions_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "community"."submissions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."submissions_rels" ADD CONSTRAINT "submissions_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "community"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."snapshots_rels" ADD CONSTRAINT "snapshots_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "community"."snapshots"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."snapshots_rels" ADD CONSTRAINT "snapshots_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "community"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."quotes" ADD CONSTRAINT "quotes_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "community"."contents"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."quotes" ADD CONSTRAINT "quotes_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "community"."snapshots"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."home_rels" ADD CONSTRAINT "home_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "community"."home"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."home_rels" ADD CONSTRAINT "home_rels_contents_fk" FOREIGN KEY ("contents_id") REFERENCES "community"."contents"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "drafts_rels_order_idx" ON "community"."drafts_rels" USING btree ("order");
  CREATE INDEX "drafts_rels_parent_idx" ON "community"."drafts_rels" USING btree ("parent_id");
  CREATE INDEX "drafts_rels_path_idx" ON "community"."drafts_rels" USING btree ("path");
  CREATE INDEX "drafts_rels_media_id_idx" ON "community"."drafts_rels" USING btree ("media_id");
  CREATE INDEX "_drafts_v_rels_order_idx" ON "community"."_drafts_v_rels" USING btree ("order");
  CREATE INDEX "_drafts_v_rels_parent_idx" ON "community"."_drafts_v_rels" USING btree ("parent_id");
  CREATE INDEX "_drafts_v_rels_path_idx" ON "community"."_drafts_v_rels" USING btree ("path");
  CREATE INDEX "_drafts_v_rels_media_id_idx" ON "community"."_drafts_v_rels" USING btree ("media_id");
  CREATE INDEX "submissions_rels_order_idx" ON "community"."submissions_rels" USING btree ("order");
  CREATE INDEX "submissions_rels_parent_idx" ON "community"."submissions_rels" USING btree ("parent_id");
  CREATE INDEX "submissions_rels_path_idx" ON "community"."submissions_rels" USING btree ("path");
  CREATE INDEX "submissions_rels_media_id_idx" ON "community"."submissions_rels" USING btree ("media_id");
  CREATE INDEX "snapshots_rels_order_idx" ON "community"."snapshots_rels" USING btree ("order");
  CREATE INDEX "snapshots_rels_parent_idx" ON "community"."snapshots_rels" USING btree ("parent_id");
  CREATE INDEX "snapshots_rels_path_idx" ON "community"."snapshots_rels" USING btree ("path");
  CREATE INDEX "snapshots_rels_media_id_idx" ON "community"."snapshots_rels" USING btree ("media_id");
  CREATE UNIQUE INDEX "quotes_stable_id_idx" ON "community"."quotes" USING btree ("stable_id");
  CREATE INDEX "quotes_content_idx" ON "community"."quotes" USING btree ("content_id");
  CREATE INDEX "quotes_snapshot_idx" ON "community"."quotes" USING btree ("snapshot_id");
  CREATE INDEX "quotes_updated_at_idx" ON "community"."quotes" USING btree ("updated_at");
  CREATE INDEX "quotes_created_at_idx" ON "community"."quotes" USING btree ("created_at");
  CREATE UNIQUE INDEX "home_key_idx" ON "community"."home" USING btree ("key");
  CREATE INDEX "home_updated_at_idx" ON "community"."home" USING btree ("updated_at");
  CREATE INDEX "home_created_at_idx" ON "community"."home" USING btree ("created_at");
  CREATE INDEX "home_rels_order_idx" ON "community"."home_rels" USING btree ("order");
  CREATE INDEX "home_rels_parent_idx" ON "community"."home_rels" USING btree ("parent_id");
  CREATE INDEX "home_rels_path_idx" ON "community"."home_rels" USING btree ("path");
  CREATE INDEX "home_rels_contents_id_idx" ON "community"."home_rels" USING btree ("contents_id");
  ALTER TABLE "community"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_quotes_fk" FOREIGN KEY ("quotes_id") REFERENCES "community"."quotes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_home_fk" FOREIGN KEY ("home_id") REFERENCES "community"."home"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "contents_stable_id_idx" ON "community"."contents" USING btree ("stable_id");
  CREATE INDEX "contents_kind_idx" ON "community"."contents" USING btree ("kind");
  CREATE UNIQUE INDEX "snapshots_stable_id_idx" ON "community"."snapshots" USING btree ("stable_id");
  CREATE INDEX "snapshots_published_at_idx" ON "community"."snapshots" USING btree ("published_at");
  CREATE UNIQUE INDEX "media_stable_id_idx" ON "community"."media" USING btree ("stable_id");
  CREATE INDEX "payload_locked_documents_rels_quotes_id_idx" ON "community"."payload_locked_documents_rels" USING btree ("quotes_id");
  CREATE INDEX "payload_locked_documents_rels_home_id_idx" ON "community"."payload_locked_documents_rels" USING btree ("home_id");
  INSERT INTO "community"."snapshots_rels" ("parent_id", "path", "order", "media_id")
    SELECT s.id, 'mediaRefs', a.ordinality, m.id FROM "community"."snapshots" s
    CROSS JOIN LATERAL jsonb_array_elements_text(s.media_ids) WITH ORDINALITY a(value, ordinality)
    JOIN "community"."media" m ON m.id = a.value::integer;
  INSERT INTO "community"."drafts_rels" ("parent_id", "path", "order", "media_id")
    SELECT s.id, 'mediaRefs', a.ordinality, m.id FROM "community"."drafts" s
    CROSS JOIN LATERAL jsonb_array_elements_text(s.media_ids) WITH ORDINALITY a(value, ordinality)
    JOIN "community"."media" m ON m.id = a.value::integer;
  INSERT INTO "community"."submissions_rels" ("parent_id", "path", "order", "media_id")
    SELECT s.id, 'mediaRefs', a.ordinality, m.id FROM "community"."submissions" s
    CROSS JOIN LATERAL jsonb_array_elements_text(s.media_ids) WITH ORDINALITY a(value, ordinality)
    JOIN "community"."media" m ON m.id = a.value::integer;
  INSERT INTO "community"."_drafts_v_rels" ("parent_id", "path", "order", "media_id")
    SELECT s.id, 'version.mediaRefs', a.ordinality, m.id FROM "community"."_drafts_v" s
    CROSS JOIN LATERAL jsonb_array_elements_text(s.version_media_ids) WITH ORDINALITY a(value, ordinality)
    JOIN "community"."media" m ON m.id = a.value::integer;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "community"."drafts_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "community"."_drafts_v_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "community"."submissions_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "community"."snapshots_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "community"."quotes" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "community"."home" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "community"."home_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "community"."drafts_rels" CASCADE;
  DROP TABLE "community"."_drafts_v_rels" CASCADE;
  DROP TABLE "community"."submissions_rels" CASCADE;
  DROP TABLE "community"."snapshots_rels" CASCADE;
  DROP TABLE "community"."quotes" CASCADE;
  DROP TABLE "community"."home" CASCADE;
  DROP TABLE "community"."home_rels" CASCADE;
  ALTER TABLE "community"."payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_quotes_fk";
  
  ALTER TABLE "community"."payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_home_fk";
  
  DROP INDEX "community"."contents_stable_id_idx";
  DROP INDEX "community"."contents_kind_idx";
  DROP INDEX "community"."snapshots_stable_id_idx";
  DROP INDEX "community"."snapshots_published_at_idx";
  DROP INDEX "community"."media_stable_id_idx";
  DROP INDEX "community"."payload_locked_documents_rels_quotes_id_idx";
  DROP INDEX "community"."payload_locked_documents_rels_home_id_idx";
  ALTER TABLE "community"."contents" DROP COLUMN "stable_id";
  ALTER TABLE "community"."contents" DROP COLUMN "kind";
  ALTER TABLE "community"."contents" DROP COLUMN "import_state";
  ALTER TABLE "community"."drafts" DROP COLUMN "metadata";
  ALTER TABLE "community"."_drafts_v" DROP COLUMN "version_metadata";
  ALTER TABLE "community"."submissions" DROP COLUMN "metadata";
  ALTER TABLE "community"."snapshots" DROP COLUMN "stable_id";
  ALTER TABLE "community"."snapshots" DROP COLUMN "published_at";
  ALTER TABLE "community"."snapshots" DROP COLUMN "summary";
  ALTER TABLE "community"."snapshots" DROP COLUMN "metadata";
  ALTER TABLE "community"."media" DROP COLUMN "stable_id";
  ALTER TABLE "community"."payload_locked_documents_rels" DROP COLUMN "quotes_id";
  ALTER TABLE "community"."payload_locked_documents_rels" DROP COLUMN "home_id";
  DROP TYPE "community"."enum_contents_kind";`)
}
