import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try {
    const { rows: [counts] } = await client.query(`SELECT
      (SELECT count(*)::int FROM (SELECT content_id FROM community.submissions WHERE status='pending' GROUP BY content_id HAVING count(*)>1) d) AS duplicate_pending,
      (SELECT count(*)::int FROM community.snapshots s JOIN community.contents c ON c.id=s.content_id JOIN community.snapshots_rels r ON r.parent_id=s.id AND r.path='mediaRefs' JOIN community.media m ON m.id=r.media_id WHERE m.owner_id<>c.author_id) AS cross_owner_snapshot_refs`);
    const { rows } = await client.query('SELECT filename,body_hash,sizes_thumb_filename FROM community.media WHERE purged IS NOT TRUE');
    const root = path.resolve(process.env.MEDIA_ROOT || 'storage/media'); let missing = 0, mismatched = 0;
    for (const row of rows) {
      for (const filename of [row.filename, row.sizes_thumb_filename].filter(Boolean)) { const target = path.resolve(root, filename); if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) missing++; }
      const target = path.resolve(root, row.filename); if (target.startsWith(root + path.sep) && fs.existsSync(target) && createHash('sha256').update(fs.readFileSync(target)).digest('hex') !== row.body_hash) mismatched++;
    }
    const report = { ...counts, mediaChecked: rows.length, missingFiles: missing, mismatchedHashes: mismatched }; console.log(JSON.stringify(report));
    if (Object.values(counts).some(Number) || missing || mismatched) process.exitCode = 1;
  } finally { await client.end(); }
}
main().catch(() => { console.error('Publication audit failed; check database access without exposing credentials.'); process.exitCode = 1; });
