import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { checkDeployment, clientAddress } from '../src/modules/deployment';

const saved = { ...process.env };
afterEach(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });

test('local operation ignores spoofed forwarding headers', () => {
  delete process.env.TRUSTED_PROXY;
  assert.equal(clientAddress(new Headers({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '192.0.2.1' })), 'local');
});
test('trusted tunnel validates and normalizes IPv4 and IPv6 without accepting a forwarded chain', () => {
  process.env.TRUSTED_PROXY = 'cloudflare';
  assert.equal(clientAddress(new Headers({ 'cf-connecting-ip': '203.0.113.7' })), '203.0.113.7');
  assert.equal(clientAddress(new Headers({ 'cf-connecting-ip': '2001:0db8:0000::1' })), '2001:db8::1');
  for (const value of ['', '203.0.113.7, 192.0.2.1', 'not-an-ip', '127.1']) assert.throws(() => clientAddress(new Headers({ 'cf-connecting-ip': value })));
  assert.throws(() => clientAddress(new Headers({ 'x-forwarded-for': '203.0.113.7' })));
  assert.equal(clientAddress(), 'local');
});
test('production fails closed on an insecure origin, wrong database or missing tunnel', () => {
  Object.assign(process.env, { APP_ENV: 'production', APP_ORIGIN: 'https://reading.example.com', DATABASE_URL: 'postgresql://app:unused@127.0.0.1:55432/zifeiqiuyue_prod', TRUSTED_PROXY: 'cloudflare', MEDIA_ROOT: 'storage/production-media', PURGE_LEDGER_DIR: '.local/production-purge-ledger' });
  assert.doesNotThrow(checkDeployment);
  for (const origin of ['http://reading.example.com', 'https://reading.example.com/', 'https://user:pass@reading.example.com', 'https://reading.example.com/path']) { process.env.APP_ORIGIN = origin; assert.throws(checkDeployment); }
  process.env.APP_ORIGIN = 'https://reading.example.com';
  process.env.DATABASE_URL = 'postgresql://app:unused@127.0.0.1:55432/zifeiqiuyue_test'; assert.throws(checkDeployment);
  process.env.DATABASE_URL = 'postgresql://app:unused@127.0.0.1:55432/zifeiqiuyue_prod';
  delete process.env.TRUSTED_PROXY; assert.throws(checkDeployment);
});
