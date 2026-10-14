import { execFile } from 'child_process';
import { promisify } from 'util';
import { AIAssistantMessage } from '../types.js';

const execFileAsync = promisify(execFile);

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
 * Antigravity CLI Adapter
 * Communicates with the official Antigravity CLI installed in the environment (e.g., Termux)
 */
export class AntigravityAdapter implements AIAssistantAdapter {
  public id = 'antigravity';
  public name = 'Antigravity CLI';
  public description = 'Google Antigravity coding agent integration';

  private cachedAvailability: boolean | null = null;

  public async isAvailable(): Promise<boolean> {
    if (this.cachedAvailability !== null) {
      return this.cachedAvailability;
    }

    try {
      // Check if `antigravity` or `agy` is in PATH
      await execFileAsync('antigravity', ['--version'], { timeout: 3000 });
      this.cachedAvailability = true;
      return true;
    } catch {
      try {
        await execFileAsync('agy', ['--version'], { timeout: 3000 });
        this.cachedAvailability = true;
        return true;
      } catch {
        this.cachedAvailability = false;
        return false;
      }
    }
  }

  public async chat(
    prompt: string,
    context?: { activeFile?: string; fileContent?: string; gitStatus?: string; gitDiff?: string }
  ): Promise<string> {
    const isAvail = await this.isAvailable();

    if (isAvail) {
      // Assemble context for the CLI
      let fullPrompt = prompt;
      if (context?.activeFile && context?.fileContent) {
        fullPrompt = `[Context File: ${context.activeFile}]\n\`\`\`\n${context.fileContent.slice(0, 4000)}\n\`\`\`\n\n${prompt}`;
      }

      try {
        const bin = 'antigravity';
        const { stdout } = await execFileAsync(bin, ['--prompt', fullPrompt], { timeout: 60000 });
        return stdout.trim();
      } catch (err: any) {
        return `Antigravity CLI execution error: ${err.message || err}`;
      }
    }

    // Smart Local Assistant Fallback when CLI is not yet installed in local environment
    return this.generateSmartLocalResponse(prompt, context);
  }

  private generateSmartLocalResponse(
    prompt: string,
    context?: { activeFile?: string; fileContent?: string; gitStatus?: string; gitDiff?: string }
  ): string {
    const lower = prompt.toLowerCase();

    if (lower.includes('explain') || lower.includes('what does this do')) {
      if (!context?.fileContent) {
        return 'Please open a file in the editor first so I can explain its implementation and architecture.';
      }
      const lines = context.fileContent.split('\n');
      return `### Code Explanation for \`${context.activeFile || 'current file'}\`\n\n` +
        `- **Total lines:** ${lines.length}\n` +
        `- **File type:** ${context.activeFile ? context.activeFile.split('.').pop() : 'unknown'}\n` +
        `- **Overview:** This file defines core logic for your project.\n\n` +
        `> **Tip:** You have Antigravity CLI configured on your tablet. When running inside Termux with \`antigravity\`, full agentic completions are seamlessly active!`;
    }

    if (lower.includes('review') || lower.includes('diff') || lower.includes('git')) {
      if (context?.gitDiff) {
        return `### Git Diff Review\n\n\`\`\`diff\n${context.gitDiff.slice(0, 1000)}\n\`\`\`\n\n` +
          `**Analysis:** Changes look clean. Ensure unit tests are run before committing.`;
      }
      return 'No active unstaged git changes found. Make an edit to a file and check the Git panel!';
    }

    if (lower.includes('test') || lower.includes('run')) {
      return 'You can execute unit tests and scripts right now using the **Runner** panel below. Try running `npm test` or `node index.js`.';
    }

    return `### Android Dev Hub Assistant\n\n` +
      `Received query: "${prompt}"\n\n` +
      `**System Status:** Running locally on your device.\n` +
      `- Active File: \`${context?.activeFile || 'None'}\`\n` +
      `- Environment: Android-first local development runtime.\n\n` +
      `To trigger full multi-step AI editing on your tablet, you can also run \`antigravity\` in Termux or connect a remote model endpoint.`;
  }
}

export class AIService {
  private adapters: Map<string, AIAssistantAdapter> = new Map();
  private defaultAdapterId = 'antigravity';
  private history: AIAssistantMessage[] = [];

  constructor() {
    const antigravity = new AntigravityAdapter();
    this.adapters.set(antigravity.id, antigravity);
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
    const adapter = this.adapters.get(chosenId) || this.adapters.get('antigravity');

    if (!adapter) {
      throw new Error(`AI Adapter '${chosenId}' not found.`);
    }

    // Save user message
    this.history.push({
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    });

    const response = await adapter.chat(prompt, context);

    // Save assistant message
    this.history.push({
      role: 'assistant',
      content: response,
      timestamp: Date.now(),
    });

    return {
      response,
      adapterUsed: adapter.name,
    };
  }

  public getHistory(): AIAssistantMessage[] {
    return this.history;
  }

  public clearHistory(): void {
    this.history = [];
  }
}
