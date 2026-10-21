import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayLabel } from '../src/modules/display-labels';

test('system tags are translated only for display', () => {
  const record = { status: 'pending', visibility: 'public', action: 'discussion:lock' };
  assert.equal(displayLabel(record.status), '待审核');
  assert.equal(displayLabel(record.visibility), '已公开');
  assert.equal(displayLabel(record.action), '锁定讨论');
  assert.deepEqual(record, { status: 'pending', visibility: 'public', action: 'discussion:lock' });
  for (const key of ['unpublished', 'approved', 'returned', 'withdrawn', 'hidden', 'open', 'locked', 'purged', 'sourceUrl', 'sharedReferences']) {
    assert.notEqual(displayLabel(key), key);
  }
  assert.equal(displayLabel('自定义栏目'), '自定义栏目');
  assert.equal(displayLabel('unknown-future-tag'), 'unknown-future-tag');
  assert.equal(displayLabel(null), '—');
});
