import { test } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'path';
import { SecurityGuard } from '../src/server/security.js';

test('SecurityGuard: Path containment', () => {
  const allowedBase = path.resolve('./test-workspace');
  const guard = new SecurityGuard('test-token-123', allowedBase);

  // Valid internal paths
  const validPath = guard.assertPathContained('src/index.js');
  assert.strictEqual(validPath, path.join(allowedBase, 'src', 'index.js'));

  const validNested = guard.assertPathContained('a/b/c/file.txt');
  assert.strictEqual(validNested, path.join(allowedBase, 'a', 'b', 'c', 'file.txt'));

  // Invalid path escaping allowed base
  assert.throws(() => {
    guard.assertPathContained('../../etc/passwd');
  }, /Security Violation/);

  assert.throws(() => {
    guard.assertPathContained('../outside.txt');
  }, /Security Violation/);
});

test('SecurityGuard: Host and Origin verification', () => {
  const guard = new SecurityGuard('test-token-123', './test-workspace');

  // Allowed local hosts
  const reqLocal = { headers: { host: 'localhost:3800' } } as any;
  assert.strictEqual(guard.isHostAllowed(reqLocal), true);

  const reqIp = { headers: { host: '127.0.0.1:3800' } } as any;
  assert.strictEqual(guard.isHostAllowed(reqIp), true);

  // Blocked external hosts
  const reqExternal = { headers: { host: 'malicious-site.com' } } as any;
  assert.strictEqual(guard.isHostAllowed(reqExternal), false);

  // Origin check
  const reqOriginLocal = {
    headers: { host: 'localhost:3800', origin: 'http://localhost:3800' },
  } as any;
  assert.strictEqual(guard.isHostAllowed(reqOriginLocal), true);

  const reqOriginEvil = {
    headers: { host: 'localhost:3800', origin: 'http://attacker-site.com' },
  } as any;
  assert.strictEqual(guard.isHostAllowed(reqOriginEvil), false);
});

test('SecurityGuard: Token authorization', () => {
  const guard = new SecurityGuard('secret-token-xyz', './test-workspace');

  // Bearer auth header
  const reqBearer = { headers: { authorization: 'Bearer secret-token-xyz' } } as any;
  const url = new URL('http://localhost:3800/api/files');
  assert.strictEqual(guard.isAuthorized(reqBearer, url), true);

  // Wrong token in header
  const reqWrongBearer = { headers: { authorization: 'Bearer wrong-token' } } as any;
  assert.strictEqual(guard.isAuthorized(reqWrongBearer, url), false);

  // Query parameter token
  const reqNoHeader = { headers: {} } as any;
  const urlWithToken = new URL('http://localhost:3800/api/files?token=secret-token-xyz');
  assert.strictEqual(guard.isAuthorized(reqNoHeader, urlWithToken), true);

  const urlWithWrongToken = new URL('http://localhost:3800/api/files?token=wrong');
  assert.strictEqual(guard.isAuthorized(reqNoHeader, urlWithWrongToken), false);
});
