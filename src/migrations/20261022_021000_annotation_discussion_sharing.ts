import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-postgres';

/** Existing annotations remain in their original discussion, not the main comment feed. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE community.annotations ADD COLUMN share_to_discussion boolean NOT NULL DEFAULT false;`);
}
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE community.annotations DROP COLUMN share_to_discussion;`);
}
