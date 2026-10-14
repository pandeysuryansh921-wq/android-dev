import { test } from 'node:test';
import * as assert from 'node:assert';
import { AIService } from '../src/server/services/aiService.js';

test('AIService: Adapters listing and smart fallback response', async () => {
  const aiService = new AIService();

  const adapters = await aiService.getAvailableAdapters();
  assert.ok(adapters.length > 0);
  assert.strictEqual(adapters[0].id, 'antigravity');

  const { response, adapterUsed } = await aiService.sendMessage('Explain what this code does', 'antigravity', {
    activeFile: 'src/index.js',
    fileContent: 'function add(a, b) { return a + b; }',
  });

  assert.ok(response.length > 0);
  assert.ok(response.includes('Code Explanation'));
  assert.ok(adapterUsed.includes('Antigravity'));

  const history = aiService.getHistory();
  assert.strictEqual(history.length, 2);
  assert.strictEqual(history[0].role, 'user');
  assert.strictEqual(history[1].role, 'assistant');
});
