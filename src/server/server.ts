import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { ServerConfig } from './types.js';
import { loadConfig, getConfigDir, getSystemInfo, saveActiveProject } from './config.js';
import { SecurityGuard } from './security.js';
import { ProjectService } from './services/projectService.js';
import { FileService } from './services/fileService.js';
import { GitService } from './services/gitService.js';
import { RunnerService } from './services/runnerService.js';
import { AIService } from './services/aiService.js';

export class DevHubServer {
  private config: ServerConfig;
  private security: SecurityGuard;
  private projectService: ProjectService;
  private fileService: FileService;
  private gitService: GitService;
  private runnerService: RunnerService;
  private aiService: AIService;

  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private wsClients: Set<WebSocket> = new Set();
  private staticDir: string;

  constructor(config?: ServerConfig, staticDir?: string) {
    this.config = config || loadConfig();
    this.security = new SecurityGuard(this.config.authToken, this.config.workspaceDir);
    const configDir = getConfigDir();

    this.projectService = new ProjectService(this.config.workspaceDir, this.security, configDir);
    this.fileService = new FileService(this.security);
    this.gitService = new GitService();
    this.runnerService = new RunnerService();
    this.aiService = new AIService();

    // Default static directory (client assets)
    this.staticDir = staticDir || path.resolve(__dirname, '../../src/web');
    if (!fs.existsSync(this.staticDir)) {
      // Fallback for production compiled structure
      this.staticDir = path.resolve(__dirname, '../web');
    }

    // Forward runner events to WebSocket clients
    this.runnerService.on('output', (event) => {
      this.broadcastWs({
        type: 'runner_event',
        payload: event,
      });
    });
  }

  public getConfig(): ServerConfig {
    return this.config;
  }

  public getSecurity(): SecurityGuard {
    return this.security;
  }

  public getProjectService(): ProjectService {
    return this.projectService;
  }

  public getFileService(): FileService {
    return this.fileService;
  }

  public getGitService(): GitService {
    return this.gitService;
  }

  public getRunnerService(): RunnerService {
    return this.runnerService;
  }

  public getAIService(): AIService {
    return this.aiService;
  }

  private broadcastWs(message: any) {
    const data = JSON.stringify(message);
    for (const ws of this.wsClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  public async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer(async (req, res) => {
        await this.handleHttpRequest(req, res);
      });

      this.wss = new WebSocketServer({ noServer: true });

      // Handle HTTP Upgrade to WebSocket
      this.httpServer.on('upgrade', (req, socket, head) => {
        const parsedUrl = new URL(req.url || '/', `http://${this.config.host}:${this.config.port}`);

        // Security: Host and Token check
        if (!this.security.isHostAllowed(req) || !this.security.isAuthorized(req, parsedUrl)) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        this.wss!.handleUpgrade(req, socket, head, (ws) => {
          this.wsClients.add(ws);
          ws.on('close', () => this.wsClients.delete(ws));
          ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }));
        });
      });

      this.httpServer.listen(this.config.port, this.config.host, () => {
        const url = `http://${this.config.host}:${this.config.port}/?token=${this.config.authToken}`;
        resolve(url);
      });

      this.httpServer.on('error', (err) => {
        reject(err);
      });
    });
  }

  public async stop(): Promise<void> {
    for (const ws of this.wsClients) {
      ws.close();
    }
    this.wsClients.clear();

    if (this.wss) {
      this.wss.close();
    }

    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
    }
  }

  private async parseJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString('utf8');
        if (body.length > 5 * 1024 * 1024) {
          reject(new Error('Payload too large'));
        }
      });
      req.on('end', () => {
        if (!body) return resolve({});
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error('Invalid JSON format'));
        }
      });
      req.on('error', err => reject(err));
    });
  }

  private sendJson(res: http.ServerResponse, statusCode: number, data: any) {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(data));
  }

  private sendError(res: http.ServerResponse, statusCode: number, message: string) {
    this.sendJson(res, statusCode, { error: message });
  }

  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    // 1. Host and Origin verification
    if (!this.security.isHostAllowed(req)) {
      return this.sendError(res, 403, 'Forbidden: Invalid Host or Origin');
    }

    const parsedUrl = new URL(req.url || '/', `http://${this.config.host}:${this.config.port}`);
    const pathname = parsedUrl.pathname;

    // 2. Static files (served without auth token so browser can load initial login / UI)
    if (pathname === '/' || pathname.startsWith('/static/') || pathname.endsWith('.js') || pathname.endsWith('.css') || pathname.endsWith('.html') || pathname.endsWith('.ico') || pathname.endsWith('.svg')) {
      return this.serveStaticFile(pathname, res);
    }

    // 3. API Authentication check
    if (pathname.startsWith('/api/')) {
      if (!this.security.isAuthorized(req, parsedUrl)) {
        return this.sendError(res, 401, 'Unauthorized: Invalid or missing authentication token');
      }

      try {
        await this.routeApiRequest(req, res, pathname, parsedUrl);
      } catch (err: any) {
        console.error(`API Error on ${req.method} ${pathname}:`, err);
        return this.sendError(res, 500, err.message || 'Internal Server Error');
      }
      return;
    }

    // 404 for unknown endpoints
    this.sendError(res, 404, 'Endpoint not found');
  }

  private async routeApiRequest(req: http.IncomingMessage, res: http.ServerResponse, pathname: string, parsedUrl: URL) {
    const method = req.method;

    // --- System Info ---
    if (pathname === '/api/system' && method === 'GET') {
      return this.sendJson(res, 200, {
        ...getSystemInfo(),
        workspaceDir: this.projectService.getWorkspaceDir(),
      });
    }

    // --- Projects API ---
    if (pathname === '/api/projects' && method === 'GET') {
      const projects = await this.projectService.listProjects();
      const recents = await this.projectService.getRecentProjects();
      const active = this.projectService.getActiveProject();
      return this.sendJson(res, 200, { projects, recents, active });
    }

    if (pathname === '/api/projects' && method === 'POST') {
      const body = await this.parseJsonBody(req);
      if (!body.name) return this.sendError(res, 400, 'Project name is required');
      const project = await this.projectService.createProject(body.name, body.initGit !== false, body.template || 'node');
      saveActiveProject(project.id);
      return this.sendJson(res, 201, project);
    }

    if (pathname === '/api/projects/open' && method === 'POST') {
      const body = await this.parseJsonBody(req);
      if (!body.path) return this.sendError(res, 400, 'Project path is required');
      const project = await this.projectService.openProject(body.path);
      saveActiveProject(project.id);
      return this.sendJson(res, 200, project);
    }

    if (pathname === '/api/projects/clone' && method === 'POST') {
      const body = await this.parseJsonBody(req);
      if (!body.url) return this.sendError(res, 400, 'Repository URL is required');
      const project = await this.projectService.cloneRepository(body.url, body.name);
      saveActiveProject(project.id);
      return this.sendJson(res, 201, project);
    }

    if (pathname === '/api/projects/active' && method === 'GET') {
      return this.sendJson(res, 200, { active: this.projectService.getActiveProject() });
    }

    // Verify an active project is open for file, git, runner operations
    const activeProject = this.projectService.getActiveProject();
    if (!activeProject && (pathname.startsWith('/api/files') || pathname.startsWith('/api/git') || pathname.startsWith('/api/runner'))) {
      return this.sendError(res, 400, 'No active project selected. Please open or create a project first.');
    }

    const projectRoot = activeProject?.path || '';

    // --- Files API ---
    if (pathname === '/api/files/list' && method === 'GET') {
      const subDir = parsedUrl.searchParams.get('path') || '';
      const files = await this.fileService.listFiles(projectRoot, subDir);
      return this.sendJson(res, 200, { files });
    }

    if (pathname === '/api/files/tree' && method === 'GET') {
      const tree = await this.fileService.getFileTree(projectRoot);
      return this.sendJson(res, 200, { tree });
    }

    if (pathname === '/api/files/read' && method === 'GET') {
      const filePath = parsedUrl.searchParams.get('path');
      if (!filePath) return this.sendError(res, 400, 'File path query parameter is required');
      const fileData = await this.fileService.readFile(projectRoot, filePath);
      return this.sendJson(res, 200, fileData);
    }

    if (pathname === '/api/files/write' && method === 'POST') {
      const body = await this.parseJsonBody(req);
      if (!body.path || typeof body.content !== 'string') {
        return this.sendError(res, 400, 'path and content are required');
      }
      const result = await this.fileService.writeFile(projectRoot, body.path, body.content);
      return this.sendJson(res, 200, result);
    }

    if (pathname === '/api/files/create' && method === 'POST') {
      const body = await this.parseJsonBody(req);
      if (!body.path) return this.sendError(res, 400, 'path is required');
      await this.fileService.createEntry(projectRoot, body.path, !!body.isDirectory);
      return this.sendJson(res, 201, { success: true });
    }

    if (pathname === '/api/files/rename' && method === 'POST') {
      const body = await this.parseJsonBody(req);
      if (!body.oldPath || !body.newPath) return this.sendError(res, 400, 'oldPath and newPath are required');
      await this.fileService.renameEntry(projectRoot, body.oldPath, body.newPath);
      return this.sendJson(res, 200, { success: true });
    }

    if (pathname === '/api/files/delete' && method === 'POST') {
      const body = await this.parseJsonBody(req);
      if (!body.path) return this.sendError(res, 400, 'path is required');
      await this.fileService.deleteEntry(projectRoot, body.path, !!body.confirmed);
      return this.sendJson(res, 200, { success: true });
    }

    if (pathname === '/api/files/search' && method === 'GET') {
      const query = parsedUrl.searchParams.get('query') || '';
      const results = await this.fileService.searchFiles(projectRoot, query);
      return this.sendJson(res, 200, { results });
    }

    // --- Git API ---
    if (pathname === '/api/git/status' && method === 'GET') {
      const summary = await this.gitService.getSummary(projectRoot);
      return this.sendJson(res, 200, summary);
    }

    if (pathname === '/api/git/diff' && method === 'GET') {
      const file = parsedUrl.searchParams.get('file') || undefined;
      const staged = parsedUrl.searchParams.get('staged') === 'true';
      const diff = await this.gitService.getDiff(projectRoot, file, staged);
      return this.sendJson(res, 200, { diff });
    }

    if (pathname === '/api/git/stage' && method === 'POST') {
      const body = await this.parseJsonBody(req);
      const files = Array.isArray(body.files) ? body.files : (body.file ? [body.file] : ['.']);
      await this.gitService.stage(projectRoot, files);
      return this.sendJson(res, 200, { success: true });
    }

    if (pathname === '/api/git/unstage' && method === 'POST') {
      const body = await this.parseJsonBody(req);
      const files = Array.isArray(body.files) ? body.files : (body.file ? [body.file] : ['.']);
      await this.gitService.unstage(projectRoot, files);
      return this.sendJson(res, 200, { success: true });
    }

    if (pathname === '/api/git/commit' && method === 'POST') {
      const body = await this.parseJsonBody(req);
      if (!body.message) return this.sendError(res, 400, 'Commit message is required');
      const output = await this.gitService.commit(projectRoot, body.message);
      return this.sendJson(res, 200, { success: true, output });
    }

    if (pathname === '/api/git/push' && method === 'POST') {
      const body = await this.parseJsonBody(req);
      const output = await this.gitService.push(projectRoot, body.remote, body.branch);
      return this.sendJson(res, 200, { output });
    }

    if (pathname === '/api/git/pull' && method === 'POST') {
      const body = await this.parseJsonBody(req);
      const output = await this.gitService.pull(projectRoot, body.remote);
      return this.sendJson(res, 200, { output });
    }

    if (pathname === '/api/git/log' && method === 'GET') {
      const log = await this.gitService.getLog(projectRoot);
      return this.sendJson(res, 200, { log });
    }

    // --- Runner API ---
    if (pathname === '/api/runner/run' && method === 'POST') {
      const body = await this.parseJsonBody(req);
      if (!body.command) return this.sendError(res, 400, 'Command is required');
      const result = await this.runnerService.runCommand(projectRoot, {
        command: body.command,
        cwd: body.cwd,
        timeoutMs: body.timeoutMs,
      });
      return this.sendJson(res, 200, result);
    }

    if (pathname === '/api/runner/kill' && method === 'POST') {
      const body = await this.parseJsonBody(req);
      if (!body.id) return this.sendError(res, 400, 'Process id is required');
      const killed = this.runnerService.killProcess(body.id);
      return this.sendJson(res, 200, { killed });
    }

    if (pathname === '/api/runner/active' && method === 'GET') {
      return this.sendJson(res, 200, { active: this.runnerService.getActiveProcesses() });
    }

    // --- AI Assistant API ---
    if (pathname === '/api/ai/adapters' && method === 'GET') {
      const adapters = await this.aiService.getAvailableAdapters();
      return this.sendJson(res, 200, { adapters });
    }

    if (pathname === '/api/ai/chat' && method === 'POST') {
      const body = await this.parseJsonBody(req);
      if (!body.prompt) return this.sendError(res, 400, 'Prompt is required');
      const result = await this.aiService.sendMessage(body.prompt, body.adapterId, body.context);
      return this.sendJson(res, 200, result);
    }

    return this.sendError(res, 404, 'Endpoint not found');
  }

  private serveStaticFile(reqPath: string, res: http.ServerResponse) {
    let filePath = reqPath === '/' ? 'index.html' : reqPath.replace(/^\//, '');
    const fullPath = path.join(this.staticDir, filePath);

    // Path traversal safety check for static files
    if (!fullPath.startsWith(this.staticDir)) {
      return this.sendError(res, 403, 'Forbidden');
    }

    if (!fs.existsSync(fullPath)) {
      return this.sendError(res, 404, 'Not Found');
    }

    const ext = path.extname(fullPath).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    const content = fs.readFileSync(fullPath);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  }
}
