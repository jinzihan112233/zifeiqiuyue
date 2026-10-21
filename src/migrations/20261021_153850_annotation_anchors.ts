import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE INDEX "snapshot_createdAt_idx" ON "community"."annotations" USING btree ("snapshot_id","created_at");
   CREATE FUNCTION community.check_annotation_anchor() RETURNS trigger LANGUAGE plpgsql AS $anchor$
   BEGIN
     IF TG_OP='UPDATE' AND (NEW.content_id IS DISTINCT FROM OLD.content_id OR NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id
       OR NEW.author_id IS DISTINCT FROM OLD.author_id OR NEW.comment_id IS DISTINCT FROM OLD.comment_id
       OR NEW.start IS DISTINCT FROM OLD.start OR NEW."end" IS DISTINCT FROM OLD."end") THEN
       RAISE EXCEPTION 'Annotation anchors are immutable';
     END IF;
     IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM community.snapshots s JOIN community.comments m ON m.id=NEW.comment_id
       WHERE s.id=NEW.snapshot_id AND s.content_id=NEW.content_id AND m.content_id=NEW.content_id AND m.author_id=NEW.author_id AND m.parent_id IS NULL) THEN
       RAISE EXCEPTION 'Annotation snapshot/comment mismatch';
     END IF;
     IF TG_OP='UPDATE' AND (NEW.quote IS DISTINCT FROM OLD.quote OR NEW.prefix IS DISTINCT FROM OLD.prefix OR NEW.suffix IS DISTINCT FROM OLD.suffix)
       AND NOT (NEW.quote='[已删除]' AND NEW.prefix IS NULL AND NEW.suffix IS NULL AND EXISTS(SELECT 1 FROM community.comments WHERE id=NEW.comment_id AND deleted=true)) THEN
       RAISE EXCEPTION 'Annotation quote is immutable except author deletion';
     END IF;
     RETURN NEW;
   END $anchor$;
   CREATE TRIGGER annotation_anchor BEFORE INSERT OR UPDATE ON community.annotations FOR EACH ROW EXECUTE FUNCTION community.check_annotation_anchor();`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TRIGGER annotation_anchor ON community.annotations;
   DROP FUNCTION community.check_annotation_anchor();
   DROP INDEX "community"."snapshot_createdAt_idx";`)
}
