#!/usr/bin/env node
import { DevHubServer } from '../src/server/server.js';
import { loadConfig, getSystemInfo, getConfigDir } from '../src/server/config.js';
import * as path from 'path';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'start';

  if (command === '--help' || command === '-h' || command === 'help') {
    console.log(`
📱 Android Dev Hub (v0.1.0)
An AI-powered Android-first development ecosystem

Usage:
  adh [start] [options]    Start the Android Dev Hub server
  adh status               Show system and environment info
  adh token                Display current authentication token
  adh help                 Show this help message

Options:
  --port <number>          Port to listen on (default: 3800)
  --host <string>          Host interface (default: 127.0.0.1)
  --workspace <path>       Custom workspace directory (default: ~/projects)
`);
    process.exit(0);
  }

  if (command === 'status') {
    const info = getSystemInfo();
    console.log('--- Android Dev Hub Environment ---');
    console.log(`Platform:     ${info.platform} (${info.arch})`);
    console.log(`Node Version: ${info.nodeVersion}`);
    console.log(`Termux:       ${info.isTermux ? '✅ Detected (Native Android)' : '❌ Not in Termux (Desktop/Host)'}`);
    console.log(`Config Dir:   ${getConfigDir()}`);
    console.log(`Memory:       ${info.freeMemMB} MB free / ${info.totalMemMB} MB total`);
    process.exit(0);
  }

  if (command === 'token') {
    const config = loadConfig();
    console.log(`Auth Token: ${config.authToken}`);
    process.exit(0);
  }

  // Parse start options
  let port: number | undefined;
  let host: string | undefined;
  let workspace: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
    }
    if (args[i] === '--host' && args[i + 1]) {
      host = args[i + 1];
    }
    if (args[i] === '--workspace' && args[i + 1]) {
      workspace = path.resolve(args[i + 1]);
    }
  }

  const config = loadConfig(port, host);
  if (workspace) {
    config.workspaceDir = workspace;
  }

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║              🚀 Starting Android Dev Hub v0.1.0              ║
╚══════════════════════════════════════════════════════════════╝
`);

  const server = new DevHubServer(config);

  try {
    const url = await server.start();
    console.log(`✅ Server running locally!`);
    console.log(`📍 Web Dashboard:  \x1b[36m${url}\x1b[0m`);
    console.log(`📁 Workspace Root:  \x1b[33m${config.workspaceDir}\x1b[0m`);
    console.log(`🔑 Auth Token:      ${config.authToken}`);
    console.log(`\nOpen the link above in Chrome on your Android tablet or desktop.`);
    console.log(`Press Ctrl+C to stop the server.\n`);
  } catch (err: any) {
    console.error(`❌ Failed to start server:`, err.message || err);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
