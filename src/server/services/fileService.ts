import * as fs from 'fs';
import * as path from 'path';
import { FileEntry } from '../types.js';
import { SecurityGuard } from '../security.js';

export class FileService {
  private security: SecurityGuard;

  constructor(security: SecurityGuard) {
    this.security = security;
  }

  /**
   * List files in a directory relative to project root
   */
  public async listFiles(projectRoot: string, subDir = ''): Promise<FileEntry[]> {
    const targetDir = this.security.assertPathContained(subDir, projectRoot);

    if (!fs.existsSync(targetDir)) {
      throw new Error(`Directory not found: ${subDir}`);
    }

    const stat = await fs.promises.stat(targetDir);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${subDir}`);
    }

    const dirEntries = await fs.promises.readdir(targetDir, { withFileTypes: true });
    const result: FileEntry[] = [];

    // Ignored noisy directories
    const ignoredDirs = new Set(['.git', 'node_modules', '.cache', 'dist', 'build', '.gradle']);

    for (const entry of dirEntries) {
      if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.gitignore') {
        // Skip hidden dotfiles except common dev configs
        continue;
      }

      const entryRelPath = path.posix.join(
        subDir.split(path.sep).join('/'),
        entry.name
      ).replace(/^\//, '');

      const fullEntryPath = path.join(targetDir, entry.name);

      try {
        const fileStat = await fs.promises.stat(fullEntryPath);
        result.push({
          name: entry.name,
          path: entryRelPath,
          isDirectory: entry.isDirectory(),
          size: entry.isDirectory() ? undefined : fileStat.size,
          updatedAt: fileStat.mtimeMs,
        });
      } catch {
        // Skip unreadable files
      }
    }

    // Sort directories first, then alphabetically
    return result.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Get recursive file tree (for tree-view in UI), limited to avoid memory blowup
   */
  public async getFileTree(projectRoot: string, maxDepth = 4, currentDepth = 0, subDir = ''): Promise<any[]> {
    if (currentDepth > maxDepth) return [];

    const entries = await this.listFiles(projectRoot, subDir);
    const tree: any[] = [];

    for (const entry of entries) {
      if (entry.isDirectory) {
        // Skip recursing into noisy large dirs
        if (['node_modules', '.git', 'dist', 'build', '.gradle', '.cache'].includes(entry.name)) {
          tree.push({
            ...entry,
            children: [],
          });
          continue;
        }

        const children = await this.getFileTree(projectRoot, maxDepth, currentDepth + 1, entry.path);
        tree.push({
          ...entry,
          children,
        });
      } else {
        tree.push(entry);
      }
    }

    return tree;
  }

  /**
   * Read file content
   */
  public async readFile(projectRoot: string, filePath: string): Promise<{ content: string; size: number }> {
    const fullPath = this.security.assertPathContained(filePath, projectRoot);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }

    const stat = await fs.promises.stat(fullPath);
    if (stat.isDirectory()) {
      throw new Error(`Cannot read directory as file: ${filePath}`);
    }

    // Prevent reading huge files (> 5MB) into memory
    if (stat.size > 5 * 1024 * 1024) {
      throw new Error(`File is too large to open (${Math.round(stat.size / 1024 / 1024)}MB). Maximum size is 5MB.`);
    }

    const content = await fs.promises.readFile(fullPath, 'utf8');
    return { content, size: stat.size };
  }

  /**
   * Write file content
   */
  public async writeFile(projectRoot: string, filePath: string, content: string): Promise<{ success: boolean; size: number }> {
    const fullPath = this.security.assertPathContained(filePath, projectRoot);

    // Ensure parent directory exists
    const dirName = path.dirname(fullPath);
    if (!fs.existsSync(dirName)) {
      await fs.promises.mkdir(dirName, { recursive: true });
    }

    await fs.promises.writeFile(fullPath, content, 'utf8');
    const stat = await fs.promises.stat(fullPath);

    return { success: true, size: stat.size };
  }

  /**
   * Create new file or directory
   */
  public async createEntry(projectRoot: string, targetPath: string, isDirectory: boolean): Promise<boolean> {
    const fullPath = this.security.assertPathContained(targetPath, projectRoot);

    if (fs.existsSync(fullPath)) {
      throw new Error(`Item already exists: ${targetPath}`);
    }

    if (isDirectory) {
      await fs.promises.mkdir(fullPath, { recursive: true });
    } else {
      const dirName = path.dirname(fullPath);
      if (!fs.existsSync(dirName)) {
        await fs.promises.mkdir(dirName, { recursive: true });
      }
      await fs.promises.writeFile(fullPath, '', 'utf8');
    }

    return true;
  }

  /**
   * Rename or move a file / directory
   */
  public async renameEntry(projectRoot: string, oldPath: string, newPath: string): Promise<boolean> {
    const sourceFull = this.security.assertPathContained(oldPath, projectRoot);
    const destFull = this.security.assertPathContained(newPath, projectRoot);

    if (!fs.existsSync(sourceFull)) {
      throw new Error(`Source does not exist: ${oldPath}`);
    }
    if (fs.existsSync(destFull)) {
      throw new Error(`Destination already exists: ${newPath}`);
    }

    const destDir = path.dirname(destFull);
    if (!fs.existsSync(destDir)) {
      await fs.promises.mkdir(destDir, { recursive: true });
    }

    await fs.promises.rename(sourceFull, destFull);
    return true;
  }

  /**
   * Delete file or directory (requires explicit confirm flag)
   */
  public async deleteEntry(projectRoot: string, targetPath: string, confirmed: boolean): Promise<boolean> {
    if (!confirmed) {
      throw new Error('Deletion must be explicitly confirmed with { confirmed: true }');
    }

    const fullPath = this.security.assertPathContained(targetPath, projectRoot);

    // Prevent deleting the project root itself
    if (fullPath === path.resolve(projectRoot)) {
      throw new Error('Cannot delete project root folder.');
    }

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File or directory does not exist: ${targetPath}`);
    }

    const stat = await fs.promises.stat(fullPath);
    if (stat.isDirectory()) {
      await fs.promises.rm(fullPath, { recursive: true, force: true });
    } else {
      await fs.promises.unlink(fullPath);
    }

    return true;
  }

  /**
   * Search for text across project files
   */
  public async searchFiles(projectRoot: string, query: string, maxResults = 50): Promise<Array<{ path: string; line: number; text: string }>> {
    if (!query || query.trim().length === 0) return [];

    const results: Array<{ path: string; line: number; text: string }> = [];
    const searchRecursive = async (currentDir: string, relPath: string) => {
      if (results.length >= maxResults) return;

      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults) break;

        const subRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (['node_modules', '.git', 'dist', 'build', '.gradle', '.cache'].includes(entry.name)) {
            continue;
          }
          await searchRecursive(fullPath, subRelPath);
        } else {
          try {
            const stat = await fs.promises.stat(fullPath);
            if (stat.size > 1024 * 1024) continue; // Skip files > 1MB

            const content = await fs.promises.readFile(fullPath, 'utf8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(query.toLowerCase())) {
                results.push({
                  path: subRelPath,
                  line: i + 1,
                  text: lines[i].trim().slice(0, 150),
                });
                if (results.length >= maxResults) break;
              }
            }
          } catch {
            // Skip binary / unreadable files
          }
        }
      }
    };

    await searchRecursive(projectRoot, '');
    return results;
  }
}
