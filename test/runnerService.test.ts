import { test } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'path';
import { RunnerService, resolveShell } from '../src/server/services/runnerService.js';

test('resolveShell: Windows platform resolution', () => {
  const result = resolveShell({ COMSPEC: 'C:\\Windows\\system32\\cmd.exe' }, 'win32');
  assert.strictEqual(result.shell, 'C:\\Windows\\system32\\cmd.exe');
  assert.deepStrictEqual(result.args('echo hi'), ['/d', '/s', '/c', 'echo hi']);
});

test('resolveShell: Termux ARM64 environment resolution with PREFIX', () => {
  const mockPrefix = '/data/data/com.termux/files/usr';
  const existsMock = (p: string) => {
    return p === path.join(mockPrefix, 'bin', 'sh');
  };

  const result = resolveShell({ PREFIX: mockPrefix }, 'linux', existsMock);
  assert.strictEqual(result.shell, path.join(mockPrefix, 'bin', 'sh'));
  assert.deepStrictEqual(result.args('ls -la'), ['-c', 'ls -la']);
});

test('resolveShell: Termux environment resolution with SHELL variable', () => {
  const mockShell = '/data/data/com.termux/files/usr/bin/bash';
  const existsMock = (p: string) => p === mockShell;

  const result = resolveShell({ SHELL: mockShell }, 'linux', existsMock);
  assert.strictEqual(result.shell, mockShell);
  assert.deepStrictEqual(result.args('node -v'), ['-c', 'node -v']);
});

test('resolveShell: Android /system/bin/sh fallback when Termux PREFIX not found', () => {
  const existsMock = (p: string) => p === '/system/bin/sh';

  const result = resolveShell({}, 'linux', existsMock);
  assert.strictEqual(result.shell, '/system/bin/sh');
  assert.deepStrictEqual(result.args('pwd'), ['-c', 'pwd']);
});

test('resolveShell: Standard Unix /bin/sh fallback on Linux/macOS', () => {
  const existsMock = (p: string) => p === '/bin/sh';

  const result = resolveShell({}, 'linux', existsMock);
  assert.strictEqual(result.shell, '/bin/sh');
  assert.deepStrictEqual(result.args('id'), ['-c', 'id']);
});

test('RunnerService: Execute command and capture output in current workspace', async () => {
  const runner = new RunnerService();

  const command = process.platform === 'win32' ? 'echo Hello Runner' : 'echo "Hello Runner"';
  const result = await runner.runCommand(process.cwd(), { command });

  assert.strictEqual(result.exitCode, 0);
  assert.ok(result.stdout.includes('Hello Runner'));
});

test('RunnerService: Handle non-zero exit code', async () => {
  const runner = new RunnerService();

  const command = process.platform === 'win32' ? 'exit 1' : 'exit 1';
  const result = await runner.runCommand(process.cwd(), { command });

  assert.notStrictEqual(result.exitCode, 0);
});

test('RunnerService: Reject invalid or non-existent working directory', async () => {
  const runner = new RunnerService();

  const result = await runner.runCommand(process.cwd(), {
    command: 'echo test',
    cwd: path.resolve('./non-existent-directory-xyz'),
  });

  assert.strictEqual(result.exitCode, 1);
  assert.ok(result.stderr.includes('Working directory does not exist'));
});
