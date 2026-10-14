import { test, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectService } from '../src/server/services/projectService.js';
import { SecurityGuard } from '../src/server/security.js';

const testWorkspace = path.resolve('./temp-test-workspace');
const testConfigDir = path.resolve('./temp-test-config');

before(() => {
  if (!fs.existsSync(testWorkspace)) {
    fs.mkdirSync(testWorkspace, { recursive: true });
  }
  if (!fs.existsSync(testConfigDir)) {
    fs.mkdirSync(testConfigDir, { recursive: true });
  }
});

after(() => {
  if (fs.existsSync(testWorkspace)) {
    fs.rmSync(testWorkspace, { recursive: true, force: true });
  }
  if (fs.existsSync(testConfigDir)) {
    fs.rmSync(testConfigDir, { recursive: true, force: true });
  }
});

test('ProjectService: Create and list projects', async () => {
  const guard = new SecurityGuard('token', testWorkspace);
  const projectService = new ProjectService(testWorkspace, guard, testConfigDir);

  const project = await projectService.createProject('sample-node-app', false, 'node');
  assert.strictEqual(project.name, 'sample-node-app');
  assert.ok(fs.existsSync(path.join(project.path, 'package.json')));
  assert.ok(fs.existsSync(path.join(project.path, 'index.js')));

  const list = await projectService.listProjects();
  assert.ok(list.some(p => p.name === 'sample-node-app'));

  const opened = await projectService.openProject(project.path);
  assert.strictEqual(opened.name, 'sample-node-app');
  assert.strictEqual(projectService.getActiveProject()?.path, project.path);
});
