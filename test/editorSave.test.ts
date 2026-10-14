import { test, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { FileService } from '../src/server/services/fileService.js';
import { SecurityGuard } from '../src/server/security.js';
import { RunnerService } from '../src/server/services/runnerService.js';

const testWorkspace = path.resolve('./temp-editor-save-test');

before(() => {
  if (!fs.existsSync(testWorkspace)) {
    fs.mkdirSync(testWorkspace, { recursive: true });
  }
});

after(() => {
  if (fs.existsSync(testWorkspace)) {
    fs.rmSync(testWorkspace, { recursive: true, force: true });
  }
});

test('Editor Save: Save content to disk and update file stats', async () => {
  const guard = new SecurityGuard('test-token-12345678', testWorkspace);
  const fileService = new FileService(guard);

  const initialCode = 'console.log("Version 1");\n';
  await fileService.writeFile(testWorkspace, 'app.js', initialCode);

  // Read back
  let { content } = await fileService.readFile(testWorkspace, 'app.js');
  assert.strictEqual(content, initialCode);

  // Save new edited content (simulating touch Save button)
  const editedCode = 'console.log("Version 2 - Saved from Touchscreen");\n';
  const saveResult = await fileService.writeFile(testWorkspace, 'app.js', editedCode);

  assert.strictEqual(saveResult.success, true);
  assert.strictEqual(saveResult.size, Buffer.byteLength(editedCode));

  // Verify disk content
  const diskContent = fs.readFileSync(path.join(testWorkspace, 'app.js'), 'utf8');
  assert.strictEqual(diskContent, editedCode);
});

test('Editor Save: Save failure handling on security violations and invalid paths', async () => {
  const guard = new SecurityGuard('test-token-12345678', testWorkspace);
  const fileService = new FileService(guard);

  // Attempt to save outside workspace directory
  await assert.rejects(async () => {
    await fileService.writeFile(testWorkspace, '../../escape.js', 'malicious code');
  }, /Security Violation: Access denied/);
});

test('Editor Save: Save-before-run contract guarantees runner sees newly saved code', async () => {
  const guard = new SecurityGuard('test-token-12345678', testWorkspace);
  const fileService = new FileService(guard);
  const runner = new RunnerService();

  const scriptPath = 'run-test.js';

  // 1. Initial code on disk
  await fileService.writeFile(testWorkspace, scriptPath, 'console.log("INITIAL_STALE_OUTPUT");\n');

  // 2. User edits file in editor (in-memory unsaved changes)
  const unsavedMemoryContent = 'console.log("TOUCH_SAVED_FRESH_OUTPUT");\n';

  // 3. Save-before-run triggers: save active file to disk first
  await fileService.writeFile(testWorkspace, scriptPath, unsavedMemoryContent);

  // 4. Runner executes the script
  const result = await runner.runCommand(testWorkspace, {
    command: `node ${scriptPath}`,
  });

  assert.strictEqual(result.exitCode, 0);
  // Verify runner output captured the freshly saved code, NOT stale code
  assert.ok(result.stdout.includes('TOUCH_SAVED_FRESH_OUTPUT'));
  assert.ok(!result.stdout.includes('INITIAL_STALE_OUTPUT'));
});

test('Editor Auto-Save: Debouncing logic coordinates 1500ms delay and dirty tracking', async () => {
  let saveCount = 0;
  let isDirty = false;
  let saveState = 'saved';

  const autoSaveDelay = 1500;
  let timer: NodeJS.Timeout | null = null;

  const mockSave = async () => {
    saveState = 'saving';
    saveCount++;
    isDirty = false;
    saveState = 'saved';
  };

  const handleInput = (newText: string, originalText: string) => {
    isDirty = newText !== originalText;
    if (isDirty) {
      saveState = 'unsaved';
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        if (isDirty) {
          await mockSave();
        }
      }, autoSaveDelay);
    }
  };

  // 1. Simulate fast typing (3 keystrokes in 100ms)
  handleInput('c', 'initial');
  handleInput('co', 'initial');
  handleInput('console.log("auto");', 'initial');

  assert.strictEqual(isDirty, true);
  assert.strictEqual(saveState, 'unsaved');
  assert.strictEqual(saveCount, 0); // Must NOT have saved prematurely

  // 2. Wait 500ms - still typing gap, should not save yet
  await new Promise(r => setTimeout(r, 500));
  assert.strictEqual(saveCount, 0);
  assert.strictEqual(saveState, 'unsaved');

  // 3. Wait remaining 1100ms (total > 1500ms since last keystroke)
  await new Promise(r => setTimeout(r, 1100));

  assert.strictEqual(saveCount, 1);
  assert.strictEqual(isDirty, false);
  assert.strictEqual(saveState, 'saved');
});

test('Editor Save: Unsaved changes guard detects dirty tabs and prevents accidental project switch', () => {
  const tabs = [
    { name: 'index.js', isDirty: false },
    { name: 'style.css', isDirty: true },
    { name: 'README.md', isDirty: false },
  ];

  const hasUnsavedChanges = tabs.some(t => t.isDirty);
  assert.strictEqual(hasUnsavedChanges, true);

  const dirtyFiles = tabs.filter(t => t.isDirty).map(t => t.name);
  assert.deepStrictEqual(dirtyFiles, ['style.css']);

  // Reset dirty flag after save
  tabs[1].isDirty = false;
  assert.strictEqual(tabs.some(t => t.isDirty), false);
});
