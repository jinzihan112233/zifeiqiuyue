import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "community"."enum_contents_discussion" AS ENUM('open', 'locked');
  CREATE TYPE "community"."enum_comments_moderation" AS ENUM('visible', 'hidden');
  CREATE TYPE "community"."enum_reports_status" AS ENUM('pending', 'resolved', 'dismissed');
  CREATE TABLE "community"."comments" (
    "id" serial PRIMARY KEY NOT NULL,
    "author_id" integer NOT NULL,
    "content_id" integer NOT NULL,
    "parent_id" integer,
    "root_id" integer,
    "body" varchar NOT NULL,
    "revision" numeric DEFAULT 1 NOT NULL,
    "edited_at" timestamp(3) with time zone,
    "deleted" boolean DEFAULT false NOT NULL,
    "moderation" "community"."enum_comments_moderation" DEFAULT 'visible' NOT NULL,
    "request_key" varchar,
    "request_hash" varchar,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "community"."reports" (
    "id" serial PRIMARY KEY NOT NULL,
    "content_id" integer NOT NULL,
    "comment_id" integer,
    "reporter_id" integer NOT NULL,
    "reason" varchar NOT NULL,
    "status" "community"."enum_reports_status" DEFAULT 'pending' NOT NULL,
    "revision" numeric DEFAULT 1 NOT NULL,
    "resolver_id" integer,
    "resolution" varchar,
    "resolved_at" timestamp(3) with time zone,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "community"."contents" ADD COLUMN "discussion" "community"."enum_contents_discussion" DEFAULT 'open' NOT NULL;
  ALTER TABLE "community"."annotations" ADD COLUMN "comment_id" integer;
  DO $backfill$
  DECLARE note record; new_comment integer;
  BEGIN
    FOR note IN SELECT * FROM community.annotations ORDER BY id LOOP
      INSERT INTO community.comments(author_id,content_id,body,created_at,updated_at)
        VALUES(note.author_id,note.content_id,note.body,note.created_at,note.updated_at) RETURNING id INTO new_comment;
      UPDATE community.annotations SET comment_id=new_comment WHERE id=note.id;
    END LOOP;
    IF EXISTS(SELECT 1 FROM community.annotations a JOIN community.comments m ON m.id=a.comment_id
      WHERE a.body IS DISTINCT FROM m.body OR a.author_id<>m.author_id OR a.content_id<>m.content_id) THEN
      RAISE EXCEPTION 'Annotation backfill verification failed';
    END IF;
  END $backfill$;
  ALTER TABLE community.annotations ALTER COLUMN comment_id SET NOT NULL;
  ALTER TABLE "community"."payload_locked_documents_rels" ADD COLUMN "comments_id" integer;
  ALTER TABLE "community"."payload_locked_documents_rels" ADD COLUMN "reports_id" integer;
  ALTER TABLE "community"."comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "community"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."comments" ADD CONSTRAINT "comments_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "community"."contents"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."comments" ADD CONSTRAINT "comments_parent_id_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "community"."comments"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."comments" ADD CONSTRAINT "comments_root_id_comments_id_fk" FOREIGN KEY ("root_id") REFERENCES "community"."comments"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."reports" ADD CONSTRAINT "reports_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "community"."contents"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."reports" ADD CONSTRAINT "reports_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "community"."comments"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "community"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."reports" ADD CONSTRAINT "reports_resolver_id_users_id_fk" FOREIGN KEY ("resolver_id") REFERENCES "community"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "comments_author_idx" ON "community"."comments" USING btree ("author_id");
  CREATE INDEX "comments_content_idx" ON "community"."comments" USING btree ("content_id");
  CREATE INDEX "comments_parent_idx" ON "community"."comments" USING btree ("parent_id");
  CREATE INDEX "comments_root_idx" ON "community"."comments" USING btree ("root_id");
  CREATE UNIQUE INDEX "comments_request_key_idx" ON "community"."comments" USING btree ("request_key");
  CREATE INDEX "comments_updated_at_idx" ON "community"."comments" USING btree ("updated_at");
  CREATE INDEX "comments_created_at_idx" ON "community"."comments" USING btree ("created_at");
  CREATE INDEX "content_root_createdAt_idx" ON "community"."comments" USING btree ("content_id","root_id","created_at");
  CREATE INDEX "reports_content_idx" ON "community"."reports" USING btree ("content_id");
  CREATE INDEX "reports_comment_idx" ON "community"."reports" USING btree ("comment_id");
  CREATE INDEX "reports_reporter_idx" ON "community"."reports" USING btree ("reporter_id");
  CREATE INDEX "reports_resolver_idx" ON "community"."reports" USING btree ("resolver_id");
  CREATE INDEX "reports_updated_at_idx" ON "community"."reports" USING btree ("updated_at");
  CREATE INDEX "reports_created_at_idx" ON "community"."reports" USING btree ("created_at");
  CREATE INDEX "status_createdAt_idx" ON "community"."reports" USING btree ("status","created_at");
  ALTER TABLE "community"."annotations" ADD CONSTRAINT "annotations_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "community"."comments"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_comments_fk" FOREIGN KEY ("comments_id") REFERENCES "community"."comments"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_reports_fk" FOREIGN KEY ("reports_id") REFERENCES "community"."reports"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "annotations_comment_idx" ON "community"."annotations" USING btree ("comment_id");
  CREATE INDEX "payload_locked_documents_rels_comments_id_idx" ON "community"."payload_locked_documents_rels" USING btree ("comments_id");
  CREATE INDEX "payload_locked_documents_rels_reports_id_idx" ON "community"."payload_locked_documents_rels" USING btree ("reports_id");
  ALTER TABLE "community"."annotations" DROP COLUMN "body";
  CREATE UNIQUE INDEX reports_pending_target_idx ON community.reports(reporter_id,content_id,COALESCE(comment_id,0)) WHERE status='pending';
  CREATE INDEX comments_roots_page_idx ON community.comments(content_id,created_at,id) WHERE parent_id IS NULL;
  CREATE INDEX comments_replies_page_idx ON community.comments(content_id,root_id,created_at,id);
  CREATE FUNCTION community.check_comment_relationship() RETURNS trigger LANGUAGE plpgsql AS $relation$
  DECLARE p record;
  BEGIN
    IF TG_OP='UPDATE' AND (NEW.author_id IS DISTINCT FROM OLD.author_id OR NEW.content_id IS DISTINCT FROM OLD.content_id
      OR NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.root_id IS DISTINCT FROM OLD.root_id) THEN
      RAISE EXCEPTION 'Comment relationships are immutable';
    END IF;
    IF TG_OP='INSERT' THEN
      IF NEW.parent_id IS NULL THEN
        IF NEW.root_id IS NOT NULL THEN RAISE EXCEPTION 'Root comments have no root pointer'; END IF;
      ELSE
        SELECT * INTO p FROM community.comments WHERE id=NEW.parent_id;
        IF NOT FOUND OR p.content_id<>NEW.content_id OR NEW.id=NEW.parent_id OR NEW.root_id IS DISTINCT FROM COALESCE(p.root_id,p.id) THEN
          RAISE EXCEPTION 'Invalid comment parent/root';
        END IF;
      END IF;
    END IF;
    RETURN NEW;
  END $relation$;
  CREATE TRIGGER comment_relationship BEFORE INSERT OR UPDATE ON community.comments FOR EACH ROW EXECUTE FUNCTION community.check_comment_relationship();`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  throw new Error('P6 preserves discussion relationships and deleted-body tombstones; use a verified backup rather than a destructive down migration.');
}
