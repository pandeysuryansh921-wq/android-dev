import { test } from 'node:test';
import * as assert from 'node:assert';
import { RunnerService } from '../src/server/services/runnerService.js';

test('RunnerService: Execute command and capture output', async () => {
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
