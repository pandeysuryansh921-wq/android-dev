import { execFile } from 'child_process';
import { promisify } from 'util';
import { AIAssistantMessage } from '../types.js';

const execFileAsync = promisify(execFile);

export type CLIExecutor = (file: string, args: string[], options: any) => Promise<{ stdout: string; stderr: string }>;

export interface AIAssistantAdapter {
  id: string;
  name: string;
  description: string;
  isAvailable(): Promise<boolean>;
  chat(
    prompt: string,
    context?: { activeFile?: string; fileContent?: string; gitStatus?: string; gitDiff?: string }
  ): Promise<string>;
}

/**
 * Real Antigravity CLI Adapter
 * Communicates directly with the official Google Antigravity CLI (`agy` or `antigravity`)
 * using non-interactive print mode: `agy -p "<prompt>" --output-format text`.
 *
 * NOTE: Does NOT silently substitute canned fallback responses when the CLI fails or is missing.
 */
export class AntigravityAdapter implements AIAssistantAdapter {
  public id = 'antigravity';
  public name = 'Antigravity CLI';
  public description = 'Official Google Antigravity coding agent integration';

  private executor: CLIExecutor;
  private resolvedBin: string | null = null;

  constructor(customExecutor?: CLIExecutor) {
    this.executor = customExecutor || (execFileAsync as unknown as CLIExecutor);
  }

  public async isAvailable(): Promise<boolean> {
    if (this.resolvedBin !== null) {
      return true;
    }

    // Check for official 'agy' first, then 'antigravity'
    for (const bin of ['agy', 'antigravity']) {
      try {
        await this.executor(bin, ['--version'], { timeout: 3000 });
        this.resolvedBin = bin;
        return true;
      } catch {
        // Try next binary
      }
    }

    return false;
  }

  public getResolvedBinary(): string | null {
    return this.resolvedBin;
  }

  public async chat(
    prompt: string,
    context?: { activeFile?: string; fileContent?: string; gitStatus?: string; gitDiff?: string }
  ): Promise<string> {
    const isAvail = await this.isAvailable();

    if (!isAvail) {
      throw new Error(
        "Antigravity CLI ('agy' or 'antigravity') was not found in PATH. " +
        "Please ensure the Antigravity CLI is installed and configured in your Termux or system environment."
      );
    }

    const bin = this.resolvedBin || 'agy';

    // Assemble structured prompt context for the agent
    let fullPrompt = prompt;
    if (context?.activeFile && context?.fileContent) {
      fullPrompt = `[Context File: ${context.activeFile}]\n\`\`\`\n${context.fileContent.slice(0, 8000)}\n\`\`\`\n\n${prompt}`;
    }
    if (context?.gitDiff) {
      fullPrompt = `[Unstaged Git Diff]\n\`\`\`diff\n${context.gitDiff.slice(0, 4000)}\n\`\`\`\n\n${fullPrompt}`;
    }

    // Exact invocation arguments for Antigravity CLI non-interactive mode:
    // agy -p "<prompt>" --output-format text
    const cliArgs = ['-p', fullPrompt, '--output-format', 'text'];

    try {
      const { stdout, stderr } = await this.executor(bin, cliArgs, {
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
      });

      const trimmedStdout = stdout ? stdout.trim() : '';
      if (trimmedStdout) {
        return trimmedStdout;
      }

      // If stdout was empty but stderr had output, return stderr diagnostics
      if (stderr && stderr.trim()) {
        return stderr.trim();
      }

      throw new Error('Antigravity CLI completed without output.');
    } catch (err: any) {
      const errorDetail = err.stderr ? err.stderr.trim() : (err.message || String(err));
      throw new Error(`Antigravity CLI execution failed: ${errorDetail}`);
    }
  }
}

/**
 * Explicit Offline Helper Adapter (Clearly distinguished from live Antigravity CLI)
 * Only used if explicitly chosen by user for offline template generation.
 */
export class OfflineHelperAdapter implements AIAssistantAdapter {
  public id = 'offline-helper';
  public name = 'Offline Template Helper';
  public description = 'Local rule-based templates for offline review and structure inspection';

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async chat(
    prompt: string,
    context?: { activeFile?: string; fileContent?: string; gitStatus?: string; gitDiff?: string }
  ): Promise<string> {
    const lower = prompt.toLowerCase();

    if (lower.includes('explain')) {
      if (!context?.fileContent) {
        return 'Offline Template Helper: Please open a file in the editor first.';
      }
      const lines = context.fileContent.split('\n');
      return `### [Offline Analysis] Structure for \`${context.activeFile || 'current file'}\`\n\n` +
        `- **Total lines:** ${lines.length}\n` +
        `- **File type:** ${context.activeFile ? context.activeFile.split('.').pop() : 'unknown'}\n` +
        `- **Mode:** Offline Template Helper (Connect Antigravity CLI for full generative AI analysis).`;
    }

    if (lower.includes('diff') || lower.includes('review')) {
      if (context?.gitDiff) {
        return `### [Offline Analysis] Git Diff Review\n\n\`\`\`diff\n${context.gitDiff.slice(0, 1000)}\n\`\`\`\n\n` +
          `**Note:** Unstaged changes detected. Verify automated tests pass before committing.`;
      }
      return 'Offline Template Helper: No unstaged git diff provided.';
    }

    return `### Offline Template Helper\n\nPrompt: "${prompt}"\n\n` +
      `You are currently using the Offline Template Helper. To run real AI reasoning, switch to the Antigravity CLI adapter with 'agy' active in Termux.`;
  }
}

export class AIService {
  private adapters: Map<string, AIAssistantAdapter> = new Map();
  private defaultAdapterId = 'antigravity';
  private history: AIAssistantMessage[] = [];

  constructor(antigravityAdapter?: AntigravityAdapter) {
    const antigravity = antigravityAdapter || new AntigravityAdapter();
    const offlineHelper = new OfflineHelperAdapter();

    this.adapters.set(antigravity.id, antigravity);
    this.adapters.set(offlineHelper.id, offlineHelper);
  }

  public registerAdapter(adapter: AIAssistantAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  public async getAvailableAdapters(): Promise<Array<{ id: string; name: string; description: string; available: boolean }>> {
    const result = [];
    for (const [id, adapter] of this.adapters.entries()) {
      const available = await adapter.isAvailable();
      result.push({
        id,
        name: adapter.name,
        description: adapter.description,
        available,
      });
    }
    return result;
  }

  public async sendMessage(
    prompt: string,
    adapterId?: string,
    context?: { activeFile?: string; fileContent?: string; gitStatus?: string; gitDiff?: string }
  ): Promise<{ response: string; adapterUsed: string }> {
    const chosenId = adapterId || this.defaultAdapterId;
    const adapter = this.adapters.get(chosenId);

    if (!adapter) {
      throw new Error(`AI Adapter '${chosenId}' not found.`);
    }

    // Save user message to history
    this.history.push({
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    });

    try {
      const response = await adapter.chat(prompt, context);

      // Save assistant message to history
      this.history.push({
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
      });

      return {
        response,
        adapterUsed: adapter.name,
      };
    } catch (err: any) {
      const errorMessage = err.message || String(err);

      this.history.push({
        role: 'assistant',
        content: `⚠️ ${errorMessage}`,
        timestamp: Date.now(),
      });

      return {
        response: `⚠️ ${errorMessage}`,
        adapterUsed: adapter.name,
      };
    }
  }

  public getHistory(): AIAssistantMessage[] {
    return this.history;
  }

  public clearHistory(): void {
    this.history = [];
  }
}
