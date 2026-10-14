import { test } from 'node:test';
import * as assert from 'node:assert';
import { AIService, AntigravityAdapter, OfflineHelperAdapter } from '../src/server/services/aiService.js';

test('AntigravityAdapter: Verifies exact non-interactive invocation arguments', async () => {
  let capturedBin = '';
  let capturedArgs: string[] = [];

  const mockExecutor = async (file: string, args: string[]) => {
    if (args[0] === '--version') {
      return { stdout: 'agy version 1.2.0', stderr: '' };
    }
    capturedBin = file;
    capturedArgs = args;
    return { stdout: 'Generated AI response from Antigravity agent.', stderr: '' };
  };

  const adapter = new AntigravityAdapter(mockExecutor);
  const isAvailable = await adapter.isAvailable();
  assert.strictEqual(isAvailable, true);
  assert.strictEqual(adapter.getResolvedBinary(), 'agy');

  const response = await adapter.chat('Explain this architecture', {
    activeFile: 'server.ts',
    fileContent: 'export class Server {}',
  });

  assert.strictEqual(response, 'Generated AI response from Antigravity agent.');
  assert.strictEqual(capturedBin, 'agy');

  // Verify EXACT non-interactive CLI flags: ['-p', '<prompt>', '--output-format', 'text']
  assert.strictEqual(capturedArgs[0], '-p');
  assert.ok(capturedArgs[1].includes('[Context File: server.ts]'));
  assert.ok(capturedArgs[1].includes('export class Server {}'));
  assert.ok(capturedArgs[1].includes('Explain this architecture'));
  assert.strictEqual(capturedArgs[2], '--output-format');
  assert.strictEqual(capturedArgs[3], 'text');
});

test('AntigravityAdapter: Fails loudly when CLI is missing and does NOT return canned responses', async () => {
  const failingExecutor = async () => {
    throw new Error('Command not found');
  };

  const adapter = new AntigravityAdapter(failingExecutor);
  const isAvailable = await adapter.isAvailable();
  assert.strictEqual(isAvailable, false);

  // Must throw or fail loudly with clear error, NOT silently return canned fake text
  await assert.rejects(async () => {
    await adapter.chat('Hello');
  }, /Antigravity CLI \('agy' or 'antigravity'\) was not found in PATH/);
});

test('AntigravityAdapter: Surfaces CLI execution errors directly without silent substitution', async () => {
  const errorExecutor = async (_file: string, args: string[]) => {
    if (args[0] === '--version') {
      return { stdout: 'agy 1.0.0', stderr: '' };
    }
    const err: any = new Error('Process exited with 1');
    err.stderr = 'Quota exceeded: Please authenticate your account';
    throw err;
  };

  const adapter = new AntigravityAdapter(errorExecutor);
  await adapter.isAvailable();

  await assert.rejects(async () => {
    await adapter.chat('Write tests');
  }, /Antigravity CLI execution failed: Quota exceeded/);
});

test('AIService: Clean adapter routing and error propagation', async () => {
  const mockExecutor = async (_file: string, args: string[]) => {
    if (args[0] === '--version') {
      return { stdout: 'agy 1.0.0', stderr: '' };
    }
    return { stdout: 'Live completion from agy', stderr: '' };
  };

  const agy = new AntigravityAdapter(mockExecutor);
  const aiService = new AIService(agy);

  const adapters = await aiService.getAvailableAdapters();
  assert.ok(adapters.some(a => a.id === 'antigravity'));
  assert.ok(adapters.some(a => a.id === 'offline-helper'));

  const result = await aiService.sendMessage('Write a hello function', 'antigravity');
  assert.strictEqual(result.response, 'Live completion from agy');
  assert.strictEqual(result.adapterUsed, 'Antigravity CLI');

  // Verify offline helper is distinctly identified
  const offlineResult = await aiService.sendMessage('Explain code', 'offline-helper', {
    activeFile: 'index.js',
    fileContent: 'console.log(1);',
  });
  assert.ok(offlineResult.response.includes('[Offline Analysis]'));
});
