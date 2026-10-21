import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-postgres';

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // Validation fails on legacy conflicts instead of renaming or merging accounts.
  await db.execute(sql`
    ALTER TABLE community.users ADD CONSTRAINT users_username_format CHECK (username ~ '^[a-z0-9_]{3,24}$');
    ALTER TABLE community.users ADD CONSTRAINT users_nickname_length CHECK (length(btrim(nickname)) BETWEEN 1 AND 30);
    ALTER TABLE community.invitations ADD CONSTRAINT invitations_quota CHECK (max_uses BETWEEN 1 AND 100 AND max_uses = trunc(max_uses) AND used BETWEEN 0 AND max_uses AND used = trunc(used));
    ALTER TABLE community.auth_limits ADD CONSTRAINT auth_limits_positive CHECK (count >= 1 AND count = trunc(count));
  `);
}
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE community.users DROP CONSTRAINT users_username_format;
    ALTER TABLE community.users DROP CONSTRAINT users_nickname_length;
    ALTER TABLE community.invitations DROP CONSTRAINT invitations_quota;
    ALTER TABLE community.auth_limits DROP CONSTRAINT auth_limits_positive;
  `);
}
