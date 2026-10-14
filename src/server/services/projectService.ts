import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ProjectInfo } from '../types.js';
import { SecurityGuard } from '../security.js';

const execFileAsync = promisify(execFile);

export class ProjectService {
  private workspaceDir: string;
  private security: SecurityGuard;
  private activeProject: ProjectInfo | null = null;
  private recentProjectsFile: string;

  constructor(workspaceDir: string, security: SecurityGuard, configDir: string) {
    this.workspaceDir = path.resolve(workspaceDir);
    this.security = security;
    this.recentProjectsFile = path.join(configDir, 'recent_projects.json');
  }

  public getWorkspaceDir(): string {
    return this.workspaceDir;
  }

  public setWorkspaceDir(newDir: string): void {
    const resolved = path.resolve(newDir);
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }
    this.workspaceDir = resolved;
    this.security.updateWorkspaceRoot(resolved);
  }

  public async listProjects(): Promise<ProjectInfo[]> {
    if (!fs.existsSync(this.workspaceDir)) {
      return [];
    }

    const entries = await fs.promises.readdir(this.workspaceDir, { withFileTypes: true });
    const projects: ProjectInfo[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(this.workspaceDir, entry.name);
        // Exclude hidden directories like .git or .android-dev-hub
        if (entry.name.startsWith('.')) continue;

        const isGit = fs.existsSync(path.join(fullPath, '.git'));
        let branch: string | undefined = undefined;

        if (isGit) {
          try {
            const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: fullPath });
            branch = stdout.trim();
          } catch {
            branch = 'unknown';
          }
        }

        const stat = await fs.promises.stat(fullPath);
        projects.push({
          id: Buffer.from(fullPath).toString('base64url'),
          name: entry.name,
          path: fullPath,
          lastOpened: stat.mtimeMs,
          isGit,
          branch,
        });
      }
    }

    return projects.sort((a, b) => b.lastOpened - a.lastOpened);
  }

  public async getRecentProjects(): Promise<ProjectInfo[]> {
    if (!fs.existsSync(this.recentProjectsFile)) {
      return [];
    }
    try {
      const data = JSON.parse(await fs.promises.readFile(this.recentProjectsFile, 'utf8'));
      // Filter out non-existent folders
      const valid: ProjectInfo[] = [];
      for (const p of data) {
        if (fs.existsSync(p.path)) {
          valid.push(p);
        }
      }
      return valid;
    } catch {
      return [];
    }
  }

  private async addToRecent(project: ProjectInfo): Promise<void> {
    try {
      let recents = await this.getRecentProjects();
      recents = recents.filter(p => p.path !== project.path);
      recents.unshift(project);
      if (recents.length > 10) {
        recents = recents.slice(0, 10);
      }
      await fs.promises.writeFile(this.recentProjectsFile, JSON.stringify(recents, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to update recent projects:', err);
    }
  }

  public async openProject(projectPath: string): Promise<ProjectInfo> {
    const resolvedPath = path.resolve(projectPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Project directory does not exist: ${projectPath}`);
    }

    const stat = await fs.promises.stat(resolvedPath);
    if (!stat.isDirectory()) {
      throw new Error(`Specified path is not a directory: ${projectPath}`);
    }

    if (!this.security.isSafeProjectDir(resolvedPath)) {
      throw new Error(`Cannot open system-level directory as project: ${projectPath}`);
    }

    const isGit = fs.existsSync(path.join(resolvedPath, '.git'));
    let branch: string | undefined = undefined;

    if (isGit) {
      try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: resolvedPath });
        branch = stdout.trim();
      } catch {
        branch = 'unknown';
      }
    }

    const name = path.basename(resolvedPath);
    const projectInfo: ProjectInfo = {
      id: Buffer.from(resolvedPath).toString('base64url'),
      name,
      path: resolvedPath,
      lastOpened: Date.now(),
      isGit,
      branch,
    };

    this.activeProject = projectInfo;
    await this.addToRecent(projectInfo);

    return projectInfo;
  }

  public getActiveProject(): ProjectInfo | null {
    return this.activeProject;
  }

  public async createProject(name: string, initGit = true, template: 'empty' | 'node' | 'web' = 'node'): Promise<ProjectInfo> {
    const sanitizedName = name.replace(/[^a-zA-Z0-9_\-\.]/g, '-');
    const projectPath = path.join(this.workspaceDir, sanitizedName);

    if (fs.existsSync(projectPath)) {
      throw new Error(`A project or directory named '${sanitizedName}' already exists.`);
    }

    await fs.promises.mkdir(projectPath, { recursive: true });

    // Initialize template files
    if (template === 'node') {
      const packageJson = {
        name: sanitizedName,
        version: '1.0.0',
        description: 'Created with Android Dev Hub',
        main: 'index.js',
        scripts: {
          start: 'node index.js',
          test: 'node --test'
        },
        type: 'module'
      };
      await fs.promises.writeFile(path.join(projectPath, 'package.json'), JSON.stringify(packageJson, null, 2), 'utf8');
      await fs.promises.writeFile(
        path.join(projectPath, 'index.js'),
        `// Welcome to ${sanitizedName} on Android Dev Hub!\nconsole.log('Running on Android ARM64 / Termux! Hello World');\n`,
        'utf8'
      );
      await fs.promises.writeFile(
        path.join(projectPath, 'README.md'),
        `# ${sanitizedName}\n\nDeveloped on Android using Android Dev Hub.\n`,
        'utf8'
      );
      await fs.promises.writeFile(
        path.join(projectPath, '.gitignore'),
        `node_modules/\n.DS_Store\n*.log\n`,
        'utf8'
      );
    } else if (template === 'web') {
      const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${sanitizedName}</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #1e293b; padding: 2rem; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; }
    h1 { color: #38bdf8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🚀 ${sanitizedName}</h1>
    <p>Built directly on Android with Android Dev Hub!</p>
  </div>
</body>
</html>`;
      await fs.promises.writeFile(path.join(projectPath, 'index.html'), htmlContent, 'utf8');
      await fs.promises.writeFile(path.join(projectPath, 'README.md'), `# ${sanitizedName}\n\nWeb app created on Android Dev Hub.\n`, 'utf8');
    } else {
      await fs.promises.writeFile(path.join(projectPath, 'README.md'), `# ${sanitizedName}\n`, 'utf8');
    }

    if (initGit) {
      try {
        await execFileAsync('git', ['init'], { cwd: projectPath });
        await execFileAsync('git', ['add', '.'], { cwd: projectPath });
        await execFileAsync('git', ['commit', '-m', 'Initial commit from Android Dev Hub'], { cwd: projectPath });
      } catch (err) {
        console.warn('Git init failed or git not configured:', err);
      }
    }

    return this.openProject(projectPath);
  }

  public async cloneRepository(repoUrl: string, customName?: string): Promise<ProjectInfo> {
    // Validate repository URL
    const trimmedUrl = repoUrl.trim();
    if (!trimmedUrl.startsWith('https://') && !trimmedUrl.startsWith('git@') && !trimmedUrl.startsWith('http://')) {
      throw new Error('Invalid repository URL. Must start with https://, git@, or http://');
    }

    let folderName = customName;
    if (!folderName) {
      const match = trimmedUrl.match(/\/([^\/]+?)(\.git)?$/);
      if (match && match[1]) {
        folderName = match[1];
      } else {
        folderName = 'cloned-repo-' + Date.now();
      }
    }

    const sanitizedName = folderName.replace(/[^a-zA-Z0-9_\-\.]/g, '-');
    const targetDir = path.join(this.workspaceDir, sanitizedName);

    if (fs.existsSync(targetDir)) {
      throw new Error(`Directory '${sanitizedName}' already exists in workspace.`);
    }

    // Execute git clone
    try {
      await execFileAsync('git', ['clone', trimmedUrl, targetDir], { timeout: 120000 });
    } catch (err: any) {
      throw new Error(`Failed to clone repository: ${err.message || err}`);
    }

    return this.openProject(targetDir);
  }
}
