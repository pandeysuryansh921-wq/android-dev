import { test, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { SecurityGuard } from '../src/server/security.js';

const tempBaseDir = path.resolve('./temp-security-test');
const tempInsideDir = path.join(tempBaseDir, 'inside');
const tempOutsideDir = path.resolve('./temp-security-outside');

before(() => {
  fs.mkdirSync(tempInsideDir, { recursive: true });
  fs.mkdirSync(tempOutsideDir, { recursive: true });
  fs.writeFileSync(path.join(tempOutsideDir, 'secret.txt'), 'SUPER_SECRET', 'utf8');

  // Try creating a symlink inside pointing to outside
  try {
    const symlinkPath = path.join(tempInsideDir, 'escape_link');
    if (!fs.existsSync(symlinkPath)) {
      fs.symlinkSync(tempOutsideDir, symlinkPath, 'junction');
    }
  } catch (err) {
    // Some Windows environments without Developer Mode may disallow non-admin symlinks
  }
});

after(() => {
  if (fs.existsSync(tempBaseDir)) {
    fs.rmSync(tempBaseDir, { recursive: true, force: true });
  }
  if (fs.existsSync(tempOutsideDir)) {
    fs.rmSync(tempOutsideDir, { recursive: true, force: true });
  }
});

test('SecurityGuard: Path containment lexical traversal checks', () => {
  const guard = new SecurityGuard('test-token-12345678', tempBaseDir);

  // Valid internal paths
  const validPath = guard.assertPathContained('inside/file.txt');
  assert.strictEqual(validPath, path.join(tempBaseDir, 'inside', 'file.txt'));

  // Invalid path escaping allowed base
  assert.throws(() => {
    guard.assertPathContained('../../etc/passwd');
  }, /Security Violation/);

  assert.throws(() => {
    guard.assertPathContained('../outside.txt');
  }, /Security Violation/);
});

test('SecurityGuard: Symbolic link escape detection', () => {
  const guard = new SecurityGuard('test-token-12345678', tempInsideDir);
  const symlinkPath = path.join(tempInsideDir, 'escape_link');

  // If symlink was successfully created on this OS
  if (fs.existsSync(symlinkPath)) {
    assert.throws(() => {
      guard.assertPathContained('escape_link/secret.txt');
    }, /Symbolic link escape detected/);
  }
});

test('SecurityGuard: Project directory authorization', () => {
  const guard = new SecurityGuard('test-token-12345678', tempBaseDir);

  // Authorized project inside workspace root
  const authorizedPath = guard.assertProjectAuthorized(tempInsideDir);
  assert.strictEqual(authorizedPath, tempInsideDir);

  // Unauthorized project outside workspace root
  assert.throws(() => {
    guard.assertProjectAuthorized(tempOutsideDir);
  }, /Security Violation/);

  // Protected system directory
  assert.throws(() => {
    guard.assertProjectAuthorized(process.platform === 'win32' ? 'C:\\Windows' : '/etc');
  }, /Security Violation/);
});

test('SecurityGuard: Host and Origin verification', () => {
  const guard = new SecurityGuard('test-token-12345678', tempBaseDir);

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

test('SecurityGuard: Token authorization and timing-safe checks', () => {
  const guard = new SecurityGuard('secret-token-12345678', tempBaseDir);

  // Valid Bearer auth header
  const reqBearer = { headers: { authorization: 'Bearer secret-token-12345678' } } as any;
  const url = new URL('http://localhost:3800/api/files');
  assert.strictEqual(guard.isAuthorized(reqBearer, url), true);

  // Wrong token in header
  const reqWrongBearer = { headers: { authorization: 'Bearer wrong-token-12345678' } } as any;
  assert.strictEqual(guard.isAuthorized(reqWrongBearer, url), false);

  // Empty token
  const reqEmptyBearer = { headers: { authorization: 'Bearer ' } } as any;
  assert.strictEqual(guard.isAuthorized(reqEmptyBearer, url), false);

  // Query parameter token
  const reqNoHeader = { headers: {} } as any;
  const urlWithToken = new URL('http://localhost:3800/api/files?token=secret-token-12345678');
  assert.strictEqual(guard.isAuthorized(reqNoHeader, urlWithToken), true);

  const urlWithWrongToken = new URL('http://localhost:3800/api/files?token=wrong-token');
  assert.strictEqual(guard.isAuthorized(reqNoHeader, urlWithWrongToken), false);

  // Constructor rejects insecure tokens
  assert.throws(() => {
    new SecurityGuard('short', tempBaseDir);
  }, /at least 16 characters/);
});
