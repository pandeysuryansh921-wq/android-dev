// Android Dev Hub Frontend Application
(function () {
  'use strict';

  // --- State ---
  const state = {
    token: '',
    systemInfo: null,
    activeProject: null,
    openTabs: [], // { path: string, name: string, content: string, originalContent: string, isDirty: boolean }
    activeTabPath: null,
    gitStatus: null,
    activeProcessId: null,
    ws: null,
  };

  // --- Auth & API Client ---
  function initAuth() {
    const urlParams = new URLSearchParams(window.location.search);
    const queryToken = urlParams.get('token');
    if (queryToken) {
      state.token = queryToken;
      localStorage.setItem('adh_token', queryToken);
    } else {
      state.token = localStorage.getItem('adh_token') || '';
    }
  }

  async function api(path, options = {}) {
    const headers = options.headers || {};
    if (state.token) {
      headers['Authorization'] = `Bearer ${state.token}`;
    }
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }

    const separator = path.includes('?') ? '&' : '?';
    const finalUrl = `${path}${separator}token=${encodeURIComponent(state.token)}`;

    const res = await fetch(finalUrl, { ...options, headers });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // --- WebSocket Setup ---
  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/?token=${encodeURIComponent(state.token)}`;
    
    try {
      state.ws = new WebSocket(wsUrl);

      state.ws.onopen = () => {
        document.getElementById('status-dot').className = 'status-indicator online';
      };

      state.ws.onclose = () => {
        document.getElementById('status-dot').className = 'status-indicator';
        setTimeout(connectWebSocket, 3000); // Auto-reconnect
      };

      state.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleWebSocketMessage(msg);
        } catch (e) {
          console.error('WS parse error:', e);
        }
      };
    } catch (err) {
      console.warn('WS connection failed:', err);
    }
  }

  function handleWebSocketMessage(msg) {
    if (msg.type === 'runner_event') {
      const { type, data, exitCode } = msg.payload;
      const term = document.getElementById('terminal-output');
      if (type === 'stdout' || type === 'stderr') {
        term.textContent += data;
        const panel = document.getElementById('runner-terminal');
        panel.scrollTop = panel.scrollHeight;
      } else if (type === 'exit') {
        term.textContent += `\n[Process exited with code ${exitCode}]\n`;
        document.getElementById('active-process-badge').classList.add('hidden');
        document.getElementById('btn-kill-cmd').classList.add('hidden');
        state.activeProcessId = null;
      }
    }
  }

  // --- Initial Data Loading ---
  async function loadInitialData() {
    try {
      state.systemInfo = await api('/api/system');
      document.getElementById('env-badge').textContent = state.systemInfo.isTermux ? 'TERMUX' : state.systemInfo.arch.toUpperCase();

      const { active } = await api('/api/projects/active');
      if (active) {
        state.activeProject = active;
        onProjectLoaded(active);
      } else {
        showTab('projects');
      }

      await loadProjectsList();
    } catch (err) {
      console.error('Failed to load initial data:', err);
    }
  }

  function onProjectLoaded(project) {
    document.getElementById('active-project-name').textContent = project.name;
    document.getElementById('active-project-name').title = project.path;
    document.getElementById('empty-state').classList.add('hidden');

    refreshFileTree();
    refreshGitStatus();
  }

  // --- Projects View ---
  async function loadProjectsList() {
    try {
      const data = await api('/api/projects');
      const listEl = document.getElementById('projects-list');
      listEl.innerHTML = '';

      if (!data.projects || data.projects.length === 0) {
        listEl.innerHTML = '<div class="empty-hint">No projects found. Create or clone one!</div>';
        return;
      }

      for (const p of data.projects) {
        const card = document.createElement('div');
        card.className = `project-card ${state.activeProject?.id === p.id ? 'active' : ''}`;
        card.innerHTML = `
          <div class="project-card-title">${escapeHtml(p.name)} ${p.isGit ? '🌿' : ''}</div>
          <div class="project-card-path">${escapeHtml(p.path)}</div>
        `;
        card.addEventListener('click', async () => {
          try {
            const opened = await api('/api/projects/open', { method: 'POST', body: { path: p.path } });
            state.activeProject = opened;
            state.openTabs = [];
            state.activeTabPath = null;
            renderTabs();
            onProjectLoaded(opened);
            showTab('explorer');
            await loadProjectsList();
          } catch (err) {
            alert('Failed to open project: ' + err.message);
          }
        });
        listEl.appendChild(card);
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  }

  // --- File Tree ---
  async function refreshFileTree() {
    if (!state.activeProject) return;
    try {
      const { tree } = await api('/api/files/tree');
      const treeEl = document.getElementById('file-tree');
      treeEl.innerHTML = '';

      if (!tree || tree.length === 0) {
        treeEl.innerHTML = '<div class="empty-hint">Project is empty. Create a new file!</div>';
        return;
      }

      renderTreeNodes(tree, treeEl, 0);
    } catch (err) {
      console.error('Failed to load file tree:', err);
    }
  }

  function renderTreeNodes(nodes, container, depth) {
    for (const node of nodes) {
      const row = document.createElement('div');
      row.className = 'tree-item';
      row.style.paddingLeft = `${depth * 14 + 8}px`;

      const icon = node.isDirectory ? '📁' : getFileIcon(node.name);
      row.innerHTML = `<span class="tree-icon">${icon}</span> <span>${escapeHtml(node.name)}</span>`;

      if (node.isDirectory) {
        const childContainer = document.createElement('div');
        let expanded = depth < 1; // Auto-expand first level

        row.addEventListener('click', () => {
          expanded = !expanded;
          childContainer.style.display = expanded ? 'block' : 'none';
          row.querySelector('.tree-icon').textContent = expanded ? '📂' : '📁';
        });

        container.appendChild(row);
        container.appendChild(childContainer);

        if (node.children && node.children.length > 0) {
          renderTreeNodes(node.children, childContainer, depth + 1);
        }
        childContainer.style.display = expanded ? 'block' : 'none';
      } else {
        row.addEventListener('click', () => openFile(node.path, node.name));
        container.appendChild(row);
      }
    }
  }

  function getFileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    switch (ext) {
      case 'js':
      case 'ts': return '📜';
      case 'json': return '⚙️';
      case 'html': return '🌐';
      case 'css': return '🎨';
      case 'md': return '📝';
      case 'sh': return '🐚';
      case 'py': return '🐍';
      default: return '📄';
    }
  }

  // --- Editor & Tabs Management ---
  async function openFile(filePath, fileName) {
    let tab = state.openTabs.find(t => t.path === filePath);

    if (!tab) {
      try {
        const { content } = await api(`/api/files/read?path=${encodeURIComponent(filePath)}`);
        tab = {
          path: filePath,
          name: fileName || filePath.split('/').pop(),
          content: content,
          originalContent: content,
          isDirty: false,
        };
        state.openTabs.push(tab);
      } catch (err) {
        alert('Could not open file: ' + err.message);
        return;
      }
    }

    state.activeTabPath = filePath;
    renderTabs();
    showEditorForTab(tab);
  }

  function renderTabs() {
    const container = document.getElementById('tabs-container');
    container.innerHTML = '';

    for (const tab of state.openTabs) {
      const tabEl = document.createElement('div');
      tabEl.className = `editor-tab ${tab.path === state.activeTabPath ? 'active' : ''}`;
      
      const dirtyDot = tab.isDirty ? '<span class="tab-dirty-dot"></span>' : '';
      tabEl.innerHTML = `
        ${dirtyDot}
        <span>${escapeHtml(tab.name)}</span>
        <span class="tab-close" title="Close">✕</span>
      `;

      tabEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-close')) {
          e.stopPropagation();
          closeTab(tab.path);
        } else {
          state.activeTabPath = tab.path;
          renderTabs();
          showEditorForTab(tab);
        }
      });

      container.appendChild(tabEl);
    }
  }

  function closeTab(filePath) {
    const idx = state.openTabs.findIndex(t => t.path === filePath);
    if (idx === -1) return;

    const tab = state.openTabs[idx];
    if (tab.isDirty && !confirm(`"${tab.name}" has unsaved changes. Close anyway?`)) {
      return;
    }

    state.openTabs.splice(idx, 1);
    if (state.activeTabPath === filePath) {
      const nextTab = state.openTabs[Math.max(0, idx - 1)];
      state.activeTabPath = nextTab ? nextTab.path : null;
    }

    renderTabs();
    const activeTab = state.openTabs.find(t => t.path === state.activeTabPath);
    if (activeTab) {
      showEditorForTab(activeTab);
    } else {
      document.getElementById('editor-wrapper').classList.add('hidden');
      document.getElementById('empty-state').classList.remove('hidden');
      document.getElementById('status-file-info').textContent = 'No file open';
    }
  }

  function showEditorForTab(tab) {
    document.getElementById('empty-state').classList.add('hidden');
    const wrapper = document.getElementById('editor-wrapper');
    wrapper.classList.remove('hidden');

    const textarea = document.getElementById('code-textarea');
    textarea.value = tab.content;
    updateLineNumbers(tab.content);

    document.getElementById('status-file-info').textContent = tab.path;
    updateSaveStatus(tab.isDirty);
  }

  function updateLineNumbers(code) {
    const gutter = document.getElementById('editor-gutter');
    const lines = code.split('\n').length;
    let numbers = '';
    for (let i = 1; i <= lines; i++) {
      numbers += `${i}\n`;
    }
    gutter.textContent = numbers;
  }

  function updateSaveStatus(isDirty) {
    const indicator = document.getElementById('save-status-indicator');
    if (isDirty) {
      indicator.textContent = '● Unsaved';
      indicator.className = 'unsaved';
    } else {
      indicator.textContent = 'Saved';
      indicator.className = 'saved';
    }
  }

  async function saveActiveFile() {
    const tab = state.openTabs.find(t => t.path === state.activeTabPath);
    if (!tab) return;

    try {
      await api('/api/files/write', {
        method: 'POST',
        body: { path: tab.path, content: tab.content }
      });
      tab.originalContent = tab.content;
      tab.isDirty = false;
      renderTabs();
      updateSaveStatus(false);
      refreshGitStatus();
    } catch (err) {
      alert('Failed to save file: ' + err.message);
    }
  }

  // --- Git Operations ---
  async function refreshGitStatus() {
    if (!state.activeProject) return;
    try {
      const summary = await api('/api/git/status');
      state.gitStatus = summary;

      const pill = document.getElementById('git-status-bar');
      pill.classList.remove('hidden');
      document.getElementById('git-branch').textContent = summary.branch;
      document.getElementById('git-changes-count').textContent = summary.files.length;
      document.getElementById('git-changes-num').textContent = summary.files.length;

      const listEl = document.getElementById('git-changes-list');
      listEl.innerHTML = '';

      if (summary.files.length === 0) {
        listEl.innerHTML = '<div class="empty-hint">Working tree clean ✨</div>';
        return;
      }

      for (const f of summary.files) {
        const row = document.createElement('div');
        row.className = 'git-file-row';
        row.innerHTML = `
          <span>${escapeHtml(f.path)}</span>
          <span class="git-status-badge ${f.status}">${f.status.toUpperCase()}</span>
        `;
        row.addEventListener('click', () => showDiff(f.path, f.staged));
        listEl.appendChild(row);
      }
    } catch (err) {
      console.warn('Git status error:', err);
    }
  }

  async function showDiff(filePath, staged) {
    try {
      const { diff } = await api(`/api/git/diff?file=${encodeURIComponent(filePath)}&staged=${staged}`);
      const diffContainer = document.getElementById('git-diff-container');
      diffContainer.classList.remove('hidden');
      document.getElementById('diff-file-title').textContent = `Diff: ${filePath}`;
      document.getElementById('diff-code').textContent = diff || '(No differences)';
    } catch (err) {
      alert('Failed to load diff: ' + err.message);
    }
  }

  // --- Command Runner & Terminal ---
  async function executeCommand(cmd) {
    if (!state.activeProject) {
      alert('Please open a project first!');
      return;
    }

    const command = cmd || document.getElementById('runner-cmd-input').value.trim();
    if (!command) return;

    // Show bottom runner panel
    document.getElementById('bottom-panel').classList.remove('collapsed');
    const term = document.getElementById('terminal-output');
    term.textContent += `\n$ ${command}\n`;

    document.getElementById('active-process-badge').classList.remove('hidden');
    document.getElementById('btn-kill-cmd').classList.remove('hidden');

    try {
      const res = await api('/api/runner/run', {
        method: 'POST',
        body: { command }
      });
      state.activeProcessId = res.id;
      if (res.exitCode !== null) {
        document.getElementById('active-process-badge').classList.add('hidden');
        document.getElementById('btn-kill-cmd').classList.add('hidden');
      }
    } catch (err) {
      term.textContent += `\n[Command error: ${err.message}]\n`;
      document.getElementById('active-process-badge').classList.add('hidden');
      document.getElementById('btn-kill-cmd').classList.add('hidden');
    }
  }

  // --- AI Assistant ---
  async function sendAiMessage(prompt) {
    const text = prompt || document.getElementById('ai-input').value.trim();
    if (!text) return;

    document.getElementById('ai-input').value = '';
    const messagesContainer = document.getElementById('ai-chat-messages');

    // Add user message to UI
    const userMsg = document.createElement('div');
    userMsg.className = 'ai-msg user';
    userMsg.innerHTML = `<div class="msg-content">${escapeHtml(text)}</div>`;
    messagesContainer.appendChild(userMsg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Show thinking indicator
    const thinkingMsg = document.createElement('div');
    thinkingMsg.className = 'ai-msg assistant';
    thinkingMsg.innerHTML = `<div class="msg-author">Antigravity Assistant</div><div class="msg-content">Thinking...</div>`;
    messagesContainer.appendChild(thinkingMsg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Gather active project and file context
    const activeTab = state.openTabs.find(t => t.path === state.activeTabPath);
    const context = {
      activeFile: activeTab?.path,
      fileContent: activeTab?.content,
      gitDiff: document.getElementById('diff-code').textContent || undefined,
    };

    try {
      const result = await api('/api/ai/chat', {
        method: 'POST',
        body: { prompt: text, context }
      });

      thinkingMsg.querySelector('.msg-content').innerHTML = formatMarkdown(result.response);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } catch (err) {
      thinkingMsg.querySelector('.msg-content').textContent = `Error: ${err.message}`;
    }
  }

  // --- UI Helpers ---
  function showTab(tabName) {
    document.querySelectorAll('.nav-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });
    document.querySelectorAll('.panel-tab').forEach(p => {
      p.classList.toggle('active', p.id === `tab-${tabName}`);
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    // Simple inline formatting for code blocks
    html = html.replace(/```([\s\S]*?)```/g, '<pre class="diff-code">$1</pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\n/g, '<br/>');
    return html;
  }

  // --- Event Listeners Setup ---
  function setupEventListeners() {
    // Sidebar Tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => showTab(tab.dataset.tab));
    });

    // Sidebar Toggle
    document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('collapsed');
    });

    // Refresh Files
    document.getElementById('btn-refresh-files').addEventListener('click', refreshFileTree);

    // New File Dialog
    document.getElementById('btn-new-file').addEventListener('click', async () => {
      const name = prompt('Enter new file name:');
      if (name) {
        try {
          await api('/api/files/create', { method: 'POST', body: { path: name, isDirectory: false } });
          await refreshFileTree();
          await openFile(name);
        } catch (err) {
          alert(err.message);
        }
      }
    });

    // New Folder Dialog
    document.getElementById('btn-new-folder').addEventListener('click', async () => {
      const name = prompt('Enter new folder name:');
      if (name) {
        try {
          await api('/api/files/create', { method: 'POST', body: { path: name, isDirectory: true } });
          await refreshFileTree();
        } catch (err) {
          alert(err.message);
        }
      }
    });

    // Code Textarea input
    const textarea = document.getElementById('code-textarea');
    textarea.addEventListener('input', () => {
      const tab = state.openTabs.find(t => t.path === state.activeTabPath);
      if (tab) {
        tab.content = textarea.value;
        tab.isDirty = tab.content !== tab.originalContent;
        renderTabs();
        updateLineNumbers(textarea.value);
        updateSaveStatus(tab.isDirty);
      }
    });

    // Synchronize gutter scrolling with textarea
    textarea.addEventListener('scroll', () => {
      document.getElementById('editor-gutter').scrollTop = textarea.scrollTop;
    });

    // Cursor position tracking
    textarea.addEventListener('keyup', updateCursorPosition);
    textarea.addEventListener('click', updateCursorPosition);

    function updateCursorPosition() {
      const text = textarea.value.substring(0, textarea.selectionStart);
      const lines = text.split('\n');
      const line = lines.length;
      const col = lines[lines.length - 1].length + 1;
      document.getElementById('cursor-position').textContent = `Ln ${line}, Col ${col}`;
    }

    // Ctrl+S / Cmd+S Keyboard Shortcut
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveActiveFile();
      }
    });

    // Git Refresh
    document.getElementById('btn-refresh-git').addEventListener('click', refreshGitStatus);

    // Git Stage All
    document.getElementById('btn-git-stage-all').addEventListener('click', async () => {
      try {
        await api('/api/git/stage', { method: 'POST', body: { files: ['.'] } });
        await refreshGitStatus();
      } catch (err) {
        alert(err.message);
      }
    });

    // Git Commit
    document.getElementById('btn-git-commit').addEventListener('click', async () => {
      const msg = document.getElementById('git-commit-msg').value.trim();
      if (!msg) {
        alert('Please enter a commit message.');
        return;
      }
      try {
        // Automatically stage changes before commit if needed
        await api('/api/git/stage', { method: 'POST', body: { files: ['.'] } });
        const res = await api('/api/git/commit', { method: 'POST', body: { message: msg } });
        document.getElementById('git-commit-msg').value = '';
        await refreshGitStatus();
        alert('Commit successful!\n' + res.output);
      } catch (err) {
        alert('Commit failed: ' + err.message);
      }
    });

    // Close Diff
    document.getElementById('btn-close-diff').addEventListener('click', () => {
      document.getElementById('git-diff-container').classList.add('hidden');
    });

    // Search Execution
    document.getElementById('btn-do-search').addEventListener('click', async () => {
      const query = document.getElementById('search-input').value.trim();
      if (!query) return;

      try {
        const { results } = await api(`/api/files/search?query=${encodeURIComponent(query)}`);
        const resultsEl = document.getElementById('search-results');
        resultsEl.innerHTML = '';

        if (results.length === 0) {
          resultsEl.innerHTML = '<div class="empty-hint">No matches found</div>';
          return;
        }

        for (const r of results) {
          const item = document.createElement('div');
          item.className = 'search-result-item';
          item.innerHTML = `
            <div class="search-result-path">${escapeHtml(r.path)}:${r.line}</div>
            <div class="search-result-text">${escapeHtml(r.text)}</div>
          `;
          item.addEventListener('click', () => openFile(r.path));
          resultsEl.appendChild(item);
        }
      } catch (err) {
        alert('Search error: ' + err.message);
      }
    });

    // Runner Controls
    document.getElementById('btn-toggle-runner').addEventListener('click', () => {
      document.getElementById('bottom-panel').classList.toggle('collapsed');
    });

    document.getElementById('btn-close-runner').addEventListener('click', () => {
      document.getElementById('bottom-panel').classList.add('collapsed');
    });

    document.getElementById('btn-quick-run').addEventListener('click', () => {
      executeCommand();
    });

    document.getElementById('btn-execute-cmd').addEventListener('click', () => {
      executeCommand();
    });

    document.getElementById('runner-preset').addEventListener('change', (e) => {
      if (e.target.value !== 'custom') {
        document.getElementById('runner-cmd-input').value = e.target.value;
      }
    });

    document.getElementById('btn-clear-runner').addEventListener('click', () => {
      document.getElementById('terminal-output').textContent = '';
    });

    document.getElementById('btn-kill-cmd').addEventListener('click', async () => {
      if (state.activeProcessId) {
        await api('/api/runner/kill', { method: 'POST', body: { id: state.activeProcessId } });
      }
    });

    // AI Assistant Controls
    document.getElementById('btn-toggle-ai').addEventListener('click', () => {
      document.getElementById('ai-drawer').classList.toggle('hidden');
    });

    document.getElementById('btn-close-ai').addEventListener('click', () => {
      document.getElementById('ai-drawer').classList.add('hidden');
    });

    document.getElementById('btn-ai-send').addEventListener('click', () => {
      sendAiMessage();
    });

    document.getElementById('ai-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendAiMessage();
      }
    });

    // AI Chips
    document.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        sendAiMessage(chip.dataset.prompt);
      });
    });

    // Switch Project button
    document.getElementById('btn-switch-project').addEventListener('click', () => {
      showTab('projects');
      document.getElementById('sidebar').classList.remove('collapsed');
    });

    // Modals
    const modalNew = document.getElementById('modal-new-project');
    const modalClone = document.getElementById('modal-clone');

    document.getElementById('btn-modal-new-project').addEventListener('click', () => modalNew.classList.remove('hidden'));
    document.getElementById('btn-quick-new').addEventListener('click', () => modalNew.classList.remove('hidden'));
    document.getElementById('btn-cancel-new-proj').addEventListener('click', () => modalNew.classList.add('hidden'));

    document.getElementById('btn-modal-clone').addEventListener('click', () => modalClone.classList.remove('hidden'));
    document.getElementById('btn-quick-clone').addEventListener('click', () => modalClone.classList.remove('hidden'));
    document.getElementById('btn-cancel-clone').addEventListener('click', () => modalClone.classList.add('hidden'));

    // Confirm Create Project
    document.getElementById('btn-confirm-new-proj').addEventListener('click', async () => {
      const name = document.getElementById('new-proj-name').value.trim();
      const template = document.getElementById('new-proj-template').value;
      const initGit = document.getElementById('new-proj-git').checked;

      if (!name) {
        alert('Please provide a project name.');
        return;
      }

      try {
        const project = await api('/api/projects', {
          method: 'POST',
          body: { name, template, initGit }
        });
        modalNew.classList.add('hidden');
        state.activeProject = project;
        state.openTabs = [];
        state.activeTabPath = null;
        renderTabs();
        onProjectLoaded(project);
        showTab('explorer');
        await loadProjectsList();
      } catch (err) {
        alert('Failed to create project: ' + err.message);
      }
    });

    // Confirm Clone Repo
    document.getElementById('btn-confirm-clone').addEventListener('click', async () => {
      const url = document.getElementById('clone-repo-url').value.trim();
      const name = document.getElementById('clone-repo-name').value.trim();

      if (!url) {
        alert('Please enter a Git repository URL.');
        return;
      }

      modalClone.classList.add('hidden');
      alert('Cloning repository in background... this may take a moment.');

      try {
        const project = await api('/api/projects/clone', {
          method: 'POST',
          body: { url, name: name || undefined }
        });
        state.activeProject = project;
        state.openTabs = [];
        state.activeTabPath = null;
        renderTabs();
        onProjectLoaded(project);
        showTab('explorer');
        await loadProjectsList();
      } catch (err) {
        alert('Failed to clone repository: ' + err.message);
      }
    });
  }

  // --- Start App ---
  window.addEventListener('DOMContentLoaded', () => {
    initAuth();
    setupEventListeners();
    connectWebSocket();
    loadInitialData();
  });
})();
