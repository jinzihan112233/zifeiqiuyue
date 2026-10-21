import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "community"."invitations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"code_hash" varchar NOT NULL,
  	"max_uses" numeric NOT NULL,
  	"used" numeric DEFAULT 0 NOT NULL,
  	"expires_at" timestamp(3) with time zone NOT NULL,
  	"revoked" boolean DEFAULT false,
  	"creator_id" integer NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "community"."invitation_uses" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"invitation_id" integer NOT NULL,
  	"user_id" integer NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "community"."auth_limits" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"bucket" varchar NOT NULL,
  	"count" numeric NOT NULL,
  	"expires_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "community"."users" ADD COLUMN "recovery_hash" varchar;
  ALTER TABLE "community"."users" ADD COLUMN "recovery_confirmed" boolean DEFAULT false;
  ALTER TABLE "community"."payload_locked_documents_rels" ADD COLUMN "invitations_id" integer;
  ALTER TABLE "community"."payload_locked_documents_rels" ADD COLUMN "invitation_uses_id" integer;
  ALTER TABLE "community"."payload_locked_documents_rels" ADD COLUMN "auth_limits_id" integer;
  ALTER TABLE "community"."invitations" ADD CONSTRAINT "invitations_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "community"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."invitation_uses" ADD CONSTRAINT "invitation_uses_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "community"."invitations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "community"."invitation_uses" ADD CONSTRAINT "invitation_uses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "community"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "invitations_code_hash_idx" ON "community"."invitations" USING btree ("code_hash");
  CREATE INDEX "invitations_creator_idx" ON "community"."invitations" USING btree ("creator_id");
  CREATE INDEX "invitations_updated_at_idx" ON "community"."invitations" USING btree ("updated_at");
  CREATE INDEX "invitations_created_at_idx" ON "community"."invitations" USING btree ("created_at");
  CREATE INDEX "invitation_uses_invitation_idx" ON "community"."invitation_uses" USING btree ("invitation_id");
  CREATE UNIQUE INDEX "invitation_uses_user_idx" ON "community"."invitation_uses" USING btree ("user_id");
  CREATE INDEX "invitation_uses_updated_at_idx" ON "community"."invitation_uses" USING btree ("updated_at");
  CREATE INDEX "invitation_uses_created_at_idx" ON "community"."invitation_uses" USING btree ("created_at");
  CREATE UNIQUE INDEX "auth_limits_bucket_idx" ON "community"."auth_limits" USING btree ("bucket");
  CREATE INDEX "auth_limits_expires_at_idx" ON "community"."auth_limits" USING btree ("expires_at");
  CREATE INDEX "auth_limits_updated_at_idx" ON "community"."auth_limits" USING btree ("updated_at");
  CREATE INDEX "auth_limits_created_at_idx" ON "community"."auth_limits" USING btree ("created_at");
  ALTER TABLE "community"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_invitations_fk" FOREIGN KEY ("invitations_id") REFERENCES "community"."invitations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_invitation_uses_fk" FOREIGN KEY ("invitation_uses_id") REFERENCES "community"."invitation_uses"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "community"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_auth_limits_fk" FOREIGN KEY ("auth_limits_id") REFERENCES "community"."auth_limits"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_invitations_id_idx" ON "community"."payload_locked_documents_rels" USING btree ("invitations_id");
  CREATE INDEX "payload_locked_documents_rels_invitation_uses_id_idx" ON "community"."payload_locked_documents_rels" USING btree ("invitation_uses_id");
  CREATE INDEX "payload_locked_documents_rels_auth_limits_id_idx" ON "community"."payload_locked_documents_rels" USING btree ("auth_limits_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "community"."invitations" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "community"."invitation_uses" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "community"."auth_limits" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "community"."invitations" CASCADE;
  DROP TABLE "community"."invitation_uses" CASCADE;
  DROP TABLE "community"."auth_limits" CASCADE;
  ALTER TABLE "community"."payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_invitations_fk";
  
  ALTER TABLE "community"."payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_invitation_uses_fk";
  
  ALTER TABLE "community"."payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_auth_limits_fk";
  
  DROP INDEX "community"."payload_locked_documents_rels_invitations_id_idx";
  DROP INDEX "community"."payload_locked_documents_rels_invitation_uses_id_idx";
  DROP INDEX "community"."payload_locked_documents_rels_auth_limits_id_idx";
  ALTER TABLE "community"."users" DROP COLUMN "recovery_hash";
  ALTER TABLE "community"."users" DROP COLUMN "recovery_confirmed";
  ALTER TABLE "community"."payload_locked_documents_rels" DROP COLUMN "invitations_id";
  ALTER TABLE "community"."payload_locked_documents_rels" DROP COLUMN "invitation_uses_id";
  ALTER TABLE "community"."payload_locked_documents_rels" DROP COLUMN "auth_limits_id";`)
}
