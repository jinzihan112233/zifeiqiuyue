import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "community"."media" ADD COLUMN "origin" jsonb;
  CREATE INDEX "kind_visibility_idx" ON "community"."contents" USING btree ("kind","visibility");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "community"."kind_visibility_idx";
  ALTER TABLE "community"."media" DROP COLUMN "origin";`)
}
