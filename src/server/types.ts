export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  lastOpened: number;
  isGit: boolean;
  branch?: string;
}

export interface FileEntry {
  name: string;
  path: string; // relative to project root
  isDirectory: boolean;
  size?: number;
  updatedAt?: number;
}

export interface GitFileStatus {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'copied' | 'unknown';
  staged: boolean;
}

export interface GitSummary {
  branch: string;
  isClean: boolean;
  files: GitFileStatus[];
  ahead: number;
  behind: number;
  lastCommit?: {
    hash: string;
    message: string;
    author: string;
    date: string;
  };
}

export interface RunCommandRequest {
  command: string;
  args?: string[];
  cwd?: string; // relative to project root
  timeoutMs?: number;
}

export interface RunCommandResult {
  id: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface AIAssistantMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface ServerConfig {
  port: number;
  host: string;
  workspaceDir: string;
  authToken: string;
  activeProjectId?: string;
}
