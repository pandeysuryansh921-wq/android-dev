import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { ServerConfig } from './types.js';

export function getHomeDir(): string {
  return os.homedir() || process.env.HOME || process.env.USERPROFILE || '.';
}

export function getConfigDir(): string {
  const home = getHomeDir();
  const configDir = path.join(home, '.android-dev-hub');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }
  return configDir;
}

export function getOrCreateAuthToken(): string {
  const configDir = getConfigDir();
  const tokenFile = path.join(configDir, 'auth.token');
  
  if (fs.existsSync(tokenFile)) {
    const token = fs.readFileSync(tokenFile, 'utf8').trim();
    if (token.length >= 16) {
      return token;
    }
  }
  
  const newToken = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(tokenFile, newToken, { mode: 0o600 });
  return newToken;
}

export function getDefaultWorkspaceDir(): string {
  const home = getHomeDir();
  const projectsDir = path.join(home, 'projects');
  if (!fs.existsSync(projectsDir)) {
    try {
      fs.mkdirSync(projectsDir, { recursive: true });
    } catch {
      // Fallback to home if projects dir cannot be created
      return home;
    }
  }
  return projectsDir;
}

export function loadConfig(customPort?: number, customHost?: string): ServerConfig {
  const configDir = getConfigDir();
  const configFile = path.join(configDir, 'config.json');
  const token = getOrCreateAuthToken();
  const defaultWorkspace = getDefaultWorkspaceDir();
  
  let config: Partial<ServerConfig> = {};
  if (fs.existsSync(configFile)) {
    try {
      config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    } catch {
      config = {};
    }
  }
  
  const finalConfig: ServerConfig = {
    port: customPort || Number(process.env.ADH_PORT) || config.port || 3800,
    host: customHost || process.env.ADH_HOST || config.host || '127.0.0.1',
    workspaceDir: process.env.ADH_WORKSPACE || config.workspaceDir || defaultWorkspace,
    authToken: token,
    activeProjectId: config.activeProjectId,
  };
  
  // Persist merged config
  try {
    fs.writeFileSync(configFile, JSON.stringify(finalConfig, null, 2), { mode: 0o600 });
  } catch {
    // Ignore error if writing config fails
  }
  
  return finalConfig;
}

export function saveActiveProject(projectId: string): void {
  const configDir = getConfigDir();
  const configFile = path.join(configDir, 'config.json');
  try {
    let config: any = {};
    if (fs.existsSync(configFile)) {
      config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    }
    config.activeProjectId = projectId;
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error('Failed to save active project:', err);
  }
}

export function isTermux(): boolean {
  return !!(process.env.TERMUX_VERSION || (process.env.PREFIX && process.env.PREFIX.includes('com.termux')));
}

export function getSystemInfo() {
  return {
    platform: os.platform(),
    arch: os.arch(),
    nodeVersion: process.version,
    isTermux: isTermux(),
    homeDir: getHomeDir(),
    uptimeSeconds: Math.floor(os.uptime()),
    freeMemMB: Math.floor(os.freemem() / 1024 / 1024),
    totalMemMB: Math.floor(os.totalmem() / 1024 / 1024),
  };
}
