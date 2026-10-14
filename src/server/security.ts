import * as path from 'path';
import * as http from 'http';
import * as fs from 'fs';
import * as crypto from 'crypto';

export class SecurityGuard {
  private validToken: string;
  private allowedWorkspaceRoot: string;

  constructor(token: string, allowedWorkspaceRoot: string) {
    if (!token || typeof token !== 'string' || token.trim().length < 16) {
      throw new Error('Security Error: Auth token must be a non-empty string with at least 16 characters.');
    }
    this.validToken = token.trim();
    this.allowedWorkspaceRoot = path.resolve(allowedWorkspaceRoot);
  }

  public updateWorkspaceRoot(newRoot: string): void {
    this.allowedWorkspaceRoot = path.resolve(newRoot);
  }

  public getWorkspaceRoot(): string {
    return this.allowedWorkspaceRoot;
  }

  /**
   * Timing-safe token comparison against this.validToken
   */
  private timingSafeTokenCheck(candidate: string | null | undefined): boolean {
    if (!candidate || typeof candidate !== 'string') return false;
    const trimmed = candidate.trim();
    if (!trimmed || trimmed.length !== this.validToken.length) return false;

    const bufCandidate = Buffer.from(trimmed);
    const bufValid = Buffer.from(this.validToken);

    try {
      return crypto.timingSafeEqual(bufCandidate, bufValid);
    } catch {
      return false;
    }
  }

  /**
   * Validates authentication token from Authorization header, X-Auth-Token, or ?token= query param
   */
  public isAuthorized(req: http.IncomingMessage, parsedUrl: URL): boolean {
    // 1. Check Bearer token in Authorization header
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      if (this.timingSafeTokenCheck(token)) {
        return true;
      }
    }

    // 2. Check X-Auth-Token header
    const xToken = req.headers['x-auth-token'];
    if (typeof xToken === 'string' && this.timingSafeTokenCheck(xToken)) {
      return true;
    }

    // 3. Check query parameter ?token=
    const queryToken = parsedUrl.searchParams.get('token');
    if (queryToken && this.timingSafeTokenCheck(queryToken)) {
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

    // If Origin is present (browser cross-origin request or WebSocket), verify it matches allowed host
    const origin = req.headers['origin'];
    if (origin) {
      try {
        const originUrl = new URL(origin);
        if (!allowedHosts.includes(originUrl.hostname.toLowerCase())) {
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
   * Prevents directory traversal attacks like ../../etc/passwd AND symbolic-link escapes.
   */
  public assertPathContained(targetPath: string, basePath?: string): string {
    const base = path.resolve(basePath || this.allowedWorkspaceRoot);
    const resolved = path.resolve(base, targetPath);

    // 1. Lexical containment check
    const normalizedBase = base.endsWith(path.sep) ? base : base + path.sep;
    const isLexicallyInside = resolved === base || resolved.startsWith(normalizedBase);

    if (!isLexicallyInside) {
      throw new Error(`Security Violation: Access denied. Path '${targetPath}' escapes allowed base '${base}'.`);
    }

    // 2. Canonical Realpath check (Symbolic-link escape verification)
    let canonicalBase = base;
    try {
      if (fs.existsSync(base)) {
        canonicalBase = fs.realpathSync(base);
      }
    } catch {
      canonicalBase = base;
    }
    const normalizedCanonicalBase = canonicalBase.endsWith(path.sep) ? canonicalBase : canonicalBase + path.sep;

    if (fs.existsSync(resolved)) {
      let canonicalResolved = resolved;
      try {
        canonicalResolved = fs.realpathSync(resolved);
      } catch {
        canonicalResolved = resolved;
      }

      const isCanonicalInside = canonicalResolved === canonicalBase || canonicalResolved.startsWith(normalizedCanonicalBase);
      if (!isCanonicalInside) {
        throw new Error(`Security Violation: Symbolic link escape detected. Path '${targetPath}' targets '${canonicalResolved}' which is outside '${canonicalBase}'.`);
      }
    } else {
      // Path does not exist yet (e.g. creating a new file or writing to new path)
      // Traverse up to find the closest existing ancestor directory and verify its canonical realpath
      let currentDir = path.dirname(resolved);
      while (currentDir !== path.dirname(currentDir)) {
        if (fs.existsSync(currentDir)) {
          let canonicalAncestor = currentDir;
          try {
            canonicalAncestor = fs.realpathSync(currentDir);
          } catch {
            canonicalAncestor = currentDir;
          }

          const isAncestorInside = canonicalAncestor === canonicalBase || canonicalAncestor.startsWith(normalizedCanonicalBase);
          if (!isAncestorInside) {
            throw new Error(`Security Violation: Symbolic link escape detected in parent hierarchy of '${targetPath}'.`);
          }
          break;
        }
        currentDir = path.dirname(currentDir);
      }
    }

    return resolved;
  }

  /**
   * Asserts that a directory path is strictly authorized to be opened as a project.
   * Protects against opening arbitrary sensitive host/Termux folders (e.g. ~/.ssh, /etc, /system).
   */
  public assertProjectAuthorized(dirPath: string): string {
    const resolved = path.resolve(dirPath);

    // 1. Check dangerous system root directories
    if (!this.isSafeProjectDir(resolved)) {
      throw new Error(`Security Violation: Cannot open system root or protected path as project: ${dirPath}`);
    }

    // 2. Assert path is contained within the authorized workspace directory
    return this.assertPathContained(resolved, this.allowedWorkspaceRoot);
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
