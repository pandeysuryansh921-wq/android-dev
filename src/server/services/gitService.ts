import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GitSummary, GitFileStatus } from '../types.js';

const execFileAsync = promisify(execFile);

export class GitService {
  private async runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  }

  public isGitRepo(projectPath: string): boolean {
    return fs.existsSync(path.join(projectPath, '.git'));
  }

  public async getSummary(projectPath: string): Promise<GitSummary> {
    if (!this.isGitRepo(projectPath)) {
      return {
        branch: 'none',
        isClean: true,
        files: [],
        ahead: 0,
        behind: 0,
      };
    }

    // 1. Get branch name
    let branch = 'unknown';
    try {
      const { stdout } = await this.runGit(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
      branch = stdout.trim();
    } catch {
      branch = 'HEAD (no commits)';
    }

    // 2. Get status --porcelain
    const files: GitFileStatus[] = [];
    try {
      const { stdout } = await this.runGit(projectPath, ['status', '--porcelain=v1']);
      const lines = stdout.split('\n').filter(l => l.trim().length > 0);

      for (const line of lines) {
        const indexStatus = line[0];
        const worktreeStatus = line[1];
        const filePath = line.substring(3).trim();

        if (indexStatus !== ' ' && indexStatus !== '?') {
          // Staged file
          files.push({
            path: filePath,
            status: this.mapStatusCode(indexStatus),
            staged: true,
          });
        }

        if (worktreeStatus !== ' ' || indexStatus === '?') {
          // Unstaged or untracked file
          files.push({
            path: filePath,
            status: indexStatus === '?' ? 'untracked' : this.mapStatusCode(worktreeStatus),
            staged: false,
          });
        }
      }
    } catch {
      // Failed to get status
    }

    // 3. Get last commit info
    let lastCommit = undefined;
    try {
      const { stdout } = await this.runGit(projectPath, ['log', '-1', '--format=%H%n%s%n%an%n%cr']);
      const parts = stdout.trim().split('\n');
      if (parts.length >= 4) {
        lastCommit = {
          hash: parts[0].slice(0, 7),
          message: parts[1],
          author: parts[2],
          date: parts[3],
        };
      }
    } catch {
      // No commits yet
    }

    return {
      branch,
      isClean: files.length === 0,
      files,
      ahead: 0,
      behind: 0,
      lastCommit,
    };
  }

  private mapStatusCode(code: string): GitFileStatus['status'] {
    switch (code) {
      case 'M': return 'modified';
      case 'A': return 'added';
      case 'D': return 'deleted';
      case 'R': return 'renamed';
      case 'C': return 'copied';
      case '?': return 'untracked';
      default: return 'unknown';
    }
  }

  public async getDiff(projectPath: string, filePath?: string, staged = false): Promise<string> {
    if (!this.isGitRepo(projectPath)) return '';

    const args = ['diff'];
    if (staged) {
      args.push('--cached');
    }
    if (filePath) {
      args.push('--', filePath);
    }

    try {
      const { stdout } = await this.runGit(projectPath, args);
      return stdout;
    } catch {
      return '';
    }
  }

  public async stage(projectPath: string, files: string[]): Promise<void> {
    if (files.length === 0) return;
    await this.runGit(projectPath, ['add', '--', ...files]);
  }

  public async unstage(projectPath: string, files: string[]): Promise<void> {
    if (files.length === 0) return;
    await this.runGit(projectPath, ['reset', 'HEAD', '--', ...files]);
  }

  public async commit(projectPath: string, message: string): Promise<string> {
    const trimmed = message.trim();
    if (!trimmed) {
      throw new Error('Commit message cannot be empty.');
    }

    const { stdout } = await this.runGit(projectPath, ['commit', '-m', trimmed]);
    return stdout;
  }

  public async push(projectPath: string, remote = 'origin', branch?: string): Promise<string> {
    const args = ['push'];
    if (remote) args.push(remote);
    if (branch) args.push(branch);

    const { stdout, stderr } = await this.runGit(projectPath, args);
    return stdout || stderr;
  }

  public async pull(projectPath: string, remote = 'origin'): Promise<string> {
    const { stdout, stderr } = await this.runGit(projectPath, ['pull', remote]);
    return stdout || stderr;
  }

  public async checkoutBranch(projectPath: string, branchName: string, createNew = false): Promise<string> {
    const args = ['checkout'];
    if (createNew) {
      args.push('-b');
    }
    args.push(branchName);

    const { stdout, stderr } = await this.runGit(projectPath, args);
    return stdout || stderr;
  }

  public async getLog(projectPath: string, limit = 15): Promise<any[]> {
    if (!this.isGitRepo(projectPath)) return [];

    try {
      const { stdout } = await this.runGit(projectPath, [
        'log',
        `-${limit}`,
        '--pretty=format:%H||%s||%an||%cr',
      ]);

      return stdout.split('\n').filter(Boolean).map(line => {
        const [hash, message, author, date] = line.split('||');
        return { hash: hash?.slice(0, 7), fullHash: hash, message, author, date };
      });
    } catch {
      return [];
    }
  }
}
