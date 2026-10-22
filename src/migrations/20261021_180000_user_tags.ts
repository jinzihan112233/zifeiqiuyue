import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-postgres';
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE community.users ADD COLUMN tag varchar DEFAULT 'regular' NOT NULL;
    ALTER TABLE community.invitations ADD COLUMN tag varchar DEFAULT 'regular' NOT NULL;
    UPDATE community.users SET tag = CASE WHEN role = 'admin' THEN 'owner' WHEN role = 'editor' THEN 'admin' ELSE 'regular' END;
    UPDATE community.users SET role = 'admin' WHERE role = 'editor';
    ALTER TABLE community.users ADD CONSTRAINT users_tag_choices CHECK (tag IN ('regular', 'moon', 'admin', 'owner'));
    ALTER TABLE community.invitations ADD CONSTRAINT invitations_tag_choices CHECK (tag IN ('regular', 'moon', 'admin'));
  `);
}
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE community.invitations DROP COLUMN tag;
    ALTER TABLE community.users DROP COLUMN tag;
  `);
}
