import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { RunCommandRequest, RunCommandResult } from '../types.js';

export interface ProcessEvent {
  id: string;
  type: 'stdout' | 'stderr' | 'exit' | 'error';
  data?: string;
  exitCode?: number | null;
}

/**
 * Resolves the appropriate shell and execution arguments for the target operating system.
 * Specifically handles Termux ARM64 on Android where /bin/sh does NOT exist at the system root.
 */
export function resolveShell(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  existsFn: (p: string) => boolean = fs.existsSync
): { shell: string; args: (command: string) => string[] } {
  // 1. Windows platforms
  if (platform === 'win32') {
    const comspec = env.COMSPEC || 'cmd.exe';
    return {
      shell: comspec,
      args: (command: string) => ['/d', '/s', '/c', command],
    };
  }

  // 2. Explicit SHELL environment variable if verified to exist
  if (env.SHELL && existsFn(env.SHELL)) {
    return {
      shell: env.SHELL,
      args: (command: string) => ['-c', command],
    };
  }

  // 3. Termux ARM64 environment with PREFIX defined ($PREFIX/bin/sh or $PREFIX/bin/bash)
  if (env.PREFIX) {
    const termuxSh = path.join(env.PREFIX, 'bin', 'sh');
    if (existsFn(termuxSh)) {
      return {
        shell: termuxSh,
        args: (command: string) => ['-c', command],
      };
    }
    const termuxBash = path.join(env.PREFIX, 'bin', 'bash');
    if (existsFn(termuxBash)) {
      return {
        shell: termuxBash,
        args: (command: string) => ['-c', command],
      };
    }
  }

  // 4. Standard Termux path (/data/data/com.termux/files/usr/bin/sh)
  const standardTermuxSh = '/data/data/com.termux/files/usr/bin/sh';
  if (existsFn(standardTermuxSh)) {
    return {
      shell: standardTermuxSh,
      args: (command: string) => ['-c', command],
    };
  }

  // 5. Android system shell (/system/bin/sh)
  if (existsFn('/system/bin/sh')) {
    return {
      shell: '/system/bin/sh',
      args: (command: string) => ['-c', command],
    };
  }

  // 6. Standard Unix / Linux / macOS shell
  if (existsFn('/bin/sh')) {
    return {
      shell: '/bin/sh',
      args: (command: string) => ['-c', command],
    };
  }

  // 7. General fallback
  return {
    shell: 'sh',
    args: (command: string) => ['-c', command],
  };
}

export class RunnerService extends EventEmitter {
  private activeProcesses = new Map<string, { process: ChildProcess; command: string; startedAt: number }>();

  /**
   * Run a command and stream output
   */
  public runCommand(
    projectRoot: string,
    req: RunCommandRequest,
    onData?: (event: ProcessEvent) => void
  ): Promise<RunCommandResult> {
    return new Promise((resolve) => {
      const id = crypto.randomBytes(6).toString('hex');
      const startTime = Date.now();
      const timeoutMs = req.timeoutMs || 300000; // 5 min default

      const cwd = req.cwd ? req.cwd : projectRoot;

      // Verify that cwd exists and is a directory
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        const result: RunCommandResult = {
          id,
          command: req.command,
          exitCode: 1,
          stdout: '',
          stderr: `Working directory does not exist or is not a directory: ${cwd}`,
          durationMs: 0,
        };
        return resolve(result);
      }

      let stdoutAccumulator = '';
      let stderrAccumulator = '';

      // Determine shell command based on platform and Termux environment
      const { shell, args } = resolveShell();
      const shellArgs = args(req.command);

      let child: ChildProcess;
      try {
        child = spawn(shell, shellArgs, {
          cwd,
          env: {
            ...process.env,
            FORCE_COLOR: '1',
            TERM: 'xterm-256color',
          },
        });
      } catch (err: any) {
        const result: RunCommandResult = {
          id,
          command: req.command,
          exitCode: 1,
          stdout: '',
          stderr: `Failed to spawn process with shell '${shell}': ${err.message}`,
          durationMs: 0,
        };
        return resolve(result);
      }

      this.activeProcesses.set(id, { process: child, command: req.command, startedAt: startTime });

      // Handle timeout
      const timer = setTimeout(() => {
        if (this.activeProcesses.has(id)) {
          child.kill('SIGTERM');
          const timeoutMsg = `\n[Android Dev Hub] Process killed: exceeded timeout of ${timeoutMs / 1000}s\n`;
          stderrAccumulator += timeoutMsg;
          if (onData) {
            onData({ id, type: 'stderr', data: timeoutMsg });
          }
        }
      }, timeoutMs);

      child.stdout?.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        stdoutAccumulator += text;
        const event: ProcessEvent = { id, type: 'stdout', data: text };
        this.emit('output', event);
        if (onData) onData(event);
      });

      child.stderr?.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        stderrAccumulator += text;
        const event: ProcessEvent = { id, type: 'stderr', data: text };
        this.emit('output', event);
        if (onData) onData(event);
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        this.activeProcesses.delete(id);
        const text = `Process error: ${err.message}\n`;
        stderrAccumulator += text;
        const event: ProcessEvent = { id, type: 'error', data: text };
        this.emit('output', event);
        if (onData) onData(event);

        resolve({
          id,
          command: req.command,
          exitCode: 1,
          stdout: stdoutAccumulator,
          stderr: stderrAccumulator,
          durationMs: Date.now() - startTime,
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        this.activeProcesses.delete(id);
        const durationMs = Date.now() - startTime;
        const event: ProcessEvent = { id, type: 'exit', exitCode: code };
        this.emit('output', event);
        if (onData) onData(event);

        resolve({
          id,
          command: req.command,
          exitCode: code,
          stdout: stdoutAccumulator,
          stderr: stderrAccumulator,
          durationMs,
        });
      });
    });
  }

  public killProcess(id: string): boolean {
    const entry = this.activeProcesses.get(id);
    if (entry) {
      entry.process.kill('SIGTERM');
      this.activeProcesses.delete(id);
      return true;
    }
    return false;
  }

  public getActiveProcesses(): Array<{ id: string; command: string; runningSeconds: number }> {
    const now = Date.now();
    const result: Array<{ id: string; command: string; runningSeconds: number }> = [];
    for (const [id, entry] of this.activeProcesses.entries()) {
      result.push({
        id,
        command: entry.command,
        runningSeconds: Math.floor((now - entry.startedAt) / 1000),
      });
    }
    return result;
  }
}
