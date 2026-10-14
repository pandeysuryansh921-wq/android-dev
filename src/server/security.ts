import * as path from 'path';
import * as http from 'http';

export class SecurityGuard {
  private validToken: string;
  private allowedWorkspaceRoot: string;

  constructor(token: string, allowedWorkspaceRoot: string) {
    this.validToken = token;
    this.allowedWorkspaceRoot = path.resolve(allowedWorkspaceRoot);
  }

  public updateWorkspaceRoot(newRoot: string): void {
    this.allowedWorkspaceRoot = path.resolve(newRoot);
  }

  public getWorkspaceRoot(): string {
    return this.allowedWorkspaceRoot;
  }

  /**
   * Validates authentication token from Authorization header or ?token= query param
   */
  public isAuthorized(req: http.IncomingMessage, parsedUrl: URL): boolean {
    // 1. Check Bearer token in Authorization header
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      if (token === this.validToken) {
        return true;
      }
    }

    // 2. Check X-Auth-Token header
    const xToken = req.headers['x-auth-token'];
    if (typeof xToken === 'string' && xToken.trim() === this.validToken) {
      return true;
    }

    // 3. Check query parameter ?token=
    const queryToken = parsedUrl.searchParams.get('token');
    if (queryToken && queryToken.trim() === this.validToken) {
      return true;
    }

    return false;
  }

  /**
   * Verifies Host and Origin headers to protect against DNS rebinding and cross-site requests
   */
  public isHostAllowed(req: http.IncomingMessage): boolean {
    const hostHeader = (req.headers['host'] || '').split(':')[0].toLowerCase();
    
    // Allowed hosts for local development
    const allowedHosts = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];
    if (!allowedHosts.includes(hostHeader)) {
      return false;
    }

    // If Origin is present (browser cross-origin request), verify it's from localhost
    const origin = req.headers['origin'];
    if (origin) {
      try {
        const originUrl = new URL(origin);
        if (!allowedHosts.includes(originUrl.hostname)) {
          return false;
        }
      } catch {
        return false;
      }
    }

    return true;
  }

  /**
   * Ensures a target path strictly resolves inside the authorized base directory.
   * Prevents directory traversal attacks like ../../etc/passwd
   */
  public assertPathContained(targetPath: string, basePath?: string): string {
    const base = path.resolve(basePath || this.allowedWorkspaceRoot);
    const resolved = path.resolve(base, targetPath);

    // Normalize with trailing separator check
    const normalizedBase = base.endsWith(path.sep) ? base : base + path.sep;
    const isInside = resolved === base || resolved.startsWith(normalizedBase);

    if (!isInside) {
      throw new Error(`Security Violation: Access denied. Path '${targetPath}' escapes allowed workspace '${base}'.`);
    }

    return resolved;
  }

  /**
   * Validates if a proposed directory path is safe to be a project folder
   */
  public isSafeProjectDir(dirPath: string): boolean {
    const resolved = path.resolve(dirPath);
    
    // Disallowed system root folders
    const dangerousRoots = [
      '/',
      '/system',
      '/etc',
      '/bin',
      '/sbin',
      '/usr',
      '/usr/bin',
      '/data',
      '/data/data',
      'C:\\',
      'C:\\Windows',
      'C:\\Program Files',
      'C:\\Program Files (x86)',
    ];

    for (const danger of dangerousRoots) {
      if (resolved.toLowerCase() === danger.toLowerCase()) {
        return false;
      }
    }

    return true;
  }
}
