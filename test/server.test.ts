import { test } from 'node:test';
import * as assert from 'node:assert';
import { DevHubServer } from '../src/server/server.js';
import { loadConfig } from '../src/server/config.js';

test('DevHubServer: Full server lifecycle, static asset delivery, and API routing', async () => {
  const config = loadConfig(3899, '127.0.0.1');
  const server = new DevHubServer(config);

  const serverUrl = await server.start();
  assert.ok(serverUrl.includes('3899'));

  // 1. Fetch static index.html and verify security headers
  const fetchIndex = await fetch(`http://127.0.0.1:3899/`);
  assert.strictEqual(fetchIndex.status, 200);
  assert.strictEqual(fetchIndex.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(fetchIndex.headers.get('x-frame-options'), 'DENY');
  assert.ok(fetchIndex.headers.get('content-security-policy'));
  const indexHtml = await fetchIndex.text();
  assert.ok(indexHtml.includes('Android Dev Hub'));

  // 2. Fetch static style.css
  const fetchCss = await fetch(`http://127.0.0.1:3899/style.css`);
  assert.strictEqual(fetchCss.status, 200);
  const css = await fetchCss.text();
  assert.ok(css.includes('--bg-primary'));

  // 3. Test API endpoint with Auth Token
  const fetchSystem = await fetch(`http://127.0.0.1:3899/api/system?token=${config.authToken}`);
  assert.strictEqual(fetchSystem.status, 200);
  const systemInfo = await fetchSystem.json();
  assert.ok(systemInfo.platform);
  assert.ok(systemInfo.nodeVersion);

  // 4. Test API endpoint without Auth Token (should return 401 Unauthorized)
  const fetchUnauthorized = await fetch(`http://127.0.0.1:3899/api/system`);
  assert.strictEqual(fetchUnauthorized.status, 401);

  // 5. Test Malicious Origin rejection (CSRF protection)
  const fetchEvilOrigin = await fetch(`http://127.0.0.1:3899/api/system?token=${config.authToken}`, {
    headers: { Origin: 'http://malicious-site.com' },
  });
  assert.strictEqual(fetchEvilOrigin.status, 403);

  // 6. Test opening project outside allowed workspace directory is rejected
  const fetchEvilOpen = await fetch(`http://127.0.0.1:3899/api/projects/open?token=${config.authToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: process.platform === 'win32' ? 'C:\\Windows' : '/etc' }),
  });
  assert.notStrictEqual(fetchEvilOpen.status, 200);

  // Stop server
  await server.stop();
});
