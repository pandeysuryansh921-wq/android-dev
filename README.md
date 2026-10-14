# 🤖 Android Dev Hub (ADH)

**An AI-Powered, Android-First Development Ecosystem**

Android Dev Hub turns Android tablets (such as the Lenovo Idea Tab Pro) and smartphones running Termux into complete, self-sufficient developer workstations. Build, edit, test, run, and commit software locally without requiring a PC.

---

## ✨ Features (v0.1 MVP)

- 📱 **Android & ARM64 Native:** Runs directly inside Termux on Android ARM64 with zero root required.
- 📁 **Project Dashboard & Explorer:** Create new Node/Web projects, open existing directories, or clone repositories directly from GitHub.
- 📝 **Code Editor:** Tabbed editing with syntax highlighting, line numbers, dirty state tracking, and <kbd>Ctrl+S</kbd> / touch-saving.
- 🌿 **Git Integration:** Inspect modified/untracked files, preview diffs, stage files, and commit directly from your tablet.
- ⚡ **Local Command Runner:** Execute commands (e.g. `npm test`, `node index.js`, scripts) with real-time streaming output over WebSockets.
- ✨ **AI Coding Assistant Bridge:** Extensible adapter architecture with native bridge for **Antigravity CLI** (`antigravity` / `agy`), with contextual diff reviews and code explanations.
- 🔒 **Localhost Security Guard:** Strictly bound to `127.0.0.1`, protected with cryptographically secure session tokens, Host/Origin header verification, and directory traversal containment guards.

---

## 🚀 Quick Start on Android (Termux)

On your Lenovo Idea Tab Pro (or any Android device running Termux):

```bash
# 1. Update Termux and install Node.js + Git
pkg update -y
pkg install -y nodejs-lts git

# 2. Clone or transfer android-dev-hub
git clone https://github.com/your-username/android-dev-hub.git
cd android-dev-hub

# 3. Run the automated setup script
chmod +x setup-termux.sh
./setup-termux.sh

# 4. Start Android Dev Hub
adh start
```

Termux will display your secure dashboard link:
```
✅ Server running locally!
📍 Web Dashboard:  http://127.0.0.1:3800/?token=...
📁 Workspace Root:  /data/data/com.termux/files/home/projects
```

Open that link in Chrome or any browser on your Android tablet!

---

## 💻 Running on Laptop (Windows / macOS / Linux)

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run build

# Run automated tests
npm test

# Start the development server
npm start
```

---

## 🏗 Architecture & Modules

```
android-dev-hub/
├── bin/
│   └── adh.ts                 # CLI launcher executable (`adh start`, `adh status`)
├── src/
│   ├── server/
│   │   ├── config.ts          # Environment detector, tokens, workspace resolver
│   │   ├── security.ts        # Path jail, CSRF/Host guards, Bearer auth
│   │   ├── types.ts           # Shared TypeScript interfaces
│   │   ├── server.ts          # HTTP & WebSocket API server
│   │   └── services/
│   │       ├── projectService.ts  # Project manager & GitHub cloner
│   │       ├── fileService.ts     # Safe file tree, CRUD, search
│   │       ├── gitService.ts      # Pure Git CLI wrapper (zero native C++ dependencies)
│   │       ├── runnerService.ts   # Process execution & streaming terminal
│   │       └── aiService.ts       # Antigravity CLI adapter & extensible AI bridge
│   └── web/
│       ├── index.html         # Responsive tablet-optimized layout
│       ├── app.js             # Client SPA controller & WebSocket stream
│       └── style.css          # Dark developer theme with touch targets
├── test/                      # Automated unit test suite (node:test)
├── setup-termux.sh            # Automated Termux ARM64 installer
└── LICENSE                    # MIT License
```

---

## 🔒 Security Model

1. **Loopback Only:** Server defaults strictly to `127.0.0.1`, inaccessible to external network devices.
2. **Token Authentication:** Requests require `Authorization: Bearer <token>` or `?token=<token>`.
3. **Path Traversal Protection:** File operations are asserted using canonical path checks; attempts to escape the project directory (e.g. `../../etc/passwd`) are immediately aborted.
4. **Host Header Validation:** Protects against DNS rebinding and cross-origin attacks from malicious browser tabs.

---

## 🗺 Roadmap

- **Phase 1 (Done):** Research, license audit, architecture, security model.
- **Phase 2 (v0.1 MVP - Done):** Complete working prototype with project manager, file tree, tabbed editor, Git operations, command runner, and Antigravity adapter.
- **Phase 3:** Verification on Lenovo Idea Tab Pro in Termux ARM64.
- **Phase 4:** Module C (on-device Android APK builds via AAPT2/D8), Module D (Reverse engineering with REA MCP server & JADX), Module E (GitHub Actions integration), Module F (Plugin system).

---

## 📜 License

MIT License. Free and open source for everyone.
