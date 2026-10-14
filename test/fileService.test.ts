import { test, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { FileService } from '../src/server/services/fileService.js';
import { SecurityGuard } from '../src/server/security.js';

const testDir = path.resolve('./temp-test-files');

before(() => {
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
});

after(() => {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});

test('FileService: Write and read file', async () => {
  const guard = new SecurityGuard('test-token-12345678', testDir);
  const fileService = new FileService(guard);

  const testContent = 'console.log("Hello from Android Dev Hub");\n';
  await fileService.writeFile(testDir, 'src/test.js', testContent);

  const { content, size } = await fileService.readFile(testDir, 'src/test.js');
  assert.strictEqual(content, testContent);
  assert.strictEqual(size, Buffer.byteLength(testContent));
});

test('FileService: List files and search', async () => {
  const guard = new SecurityGuard('test-token-12345678', testDir);
  const fileService = new FileService(guard);

  await fileService.writeFile(testDir, 'README.md', '# Hello World\nSearchable text here.\n');
  await fileService.writeFile(testDir, 'other.txt', 'Nothing special');

  const files = await fileService.listFiles(testDir);
  const fileNames = files.map(f => f.name);
  assert.ok(fileNames.includes('README.md'));
  assert.ok(fileNames.includes('other.txt'));

  const searchResults = await fileService.searchFiles(testDir, 'Searchable');
  assert.strictEqual(searchResults.length, 1);
  assert.strictEqual(searchResults[0].path, 'README.md');
  assert.ok(searchResults[0].text.includes('Searchable text here'));
});

test('FileService: Delete file', async () => {
  const guard = new SecurityGuard('test-token-12345678', testDir);
  const fileService = new FileService(guard);

  await fileService.writeFile(testDir, 'to-delete.txt', 'temporary');
  assert.ok(fs.existsSync(path.join(testDir, 'to-delete.txt')));

  // Deletion without confirmation should throw
  await assert.rejects(async () => {
    await fileService.deleteEntry(testDir, 'to-delete.txt', false);
  }, /explicitly confirmed/);

  // Deletion with confirmation should succeed
  await fileService.deleteEntry(testDir, 'to-delete.txt', true);
  assert.ok(!fs.existsSync(path.join(testDir, 'to-delete.txt')));
});
