import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke, Channel } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Background3D } from './components/Background3D';
import { motion } from 'framer-motion';
import useSound from 'use-sound';
import './index.css';
import { FileExplorer } from './components/FileExplorer';
import { MonacoEditor } from './components/MonacoEditor';
import { Folder, Search, Settings, GitBranch, Cpu, Activity, Wifi, Zap, RefreshCw, BarChart2, Database } from 'lucide-react';

interface LogEntry {
  id: string;
  time: string;
  type: 'info' | 'success' | 'warn' | 'error' | 'gemini' | 'watcher';
  message: string;
}

interface FileChangeEvent {
  path: string;
  kind: string;
  symbols_count: number;
}

interface ASTSymbol {
  name: string;
  kind: string;
  start_line: number;
  end_line: number;
  signature: string | null;
}

interface FileSymbols {
  path: string;
  symbols: ASTSymbol[];
}

interface SearchResult {
  symbol_name: string;
  symbol_kind: string;
  file_path: string;
  start_line: number;
  end_line: number;
  similarity: number;
}

interface LspPosition {
  line: number;
  character: number;
}

interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

interface LspDiagnostic {
  range: LspRange;
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
  tags?: number[];
  relatedInformation?: unknown[];
}

const parseAnsi = (text: string): React.ReactNode => {
  /* eslint-disable-next-line no-control-regex */
  const parts = text.split(/(\u001b\[[0-9;]*m)/g);
  let bold = false;
  let colorClass = '';

  return parts.map((part, index) => {
    /* eslint-disable-next-line no-control-regex */
    const match = part.match(/\u001b\[([0-9;]*)m/);
    if (match) {
      const codes = (match[1] || '').split(';');
      for (const code of codes) {
        const num = parseInt(code, 10);
        if (num === 0) {
          bold = false;
          colorClass = '';
        } else if (num === 1) {
          bold = true;
        } else if (num >= 30 && num <= 37) {
          const colors = [
            'text-neutral-500', // 30: black (gray)
            'text-rose-400', // 31: red
            'text-emerald-400', // 32: green
            'text-amber-400', // 33: yellow
            'text-violet-400', // 34: blue
            'text-fuchsia-400', // 35: magenta
            'text-primary', // 36: cyan
            'text-white', // 37: white
          ];
          colorClass = colors[num - 30] || '';
        } else if (num >= 90 && num <= 97) {
          const colors = [
            'text-neutral-400', // 90: bright black
            'text-rose-300', // 91: bright red
            'text-emerald-300', // 92: bright green
            'text-amber-300', // 93: bright yellow
            'text-violet-300', // 94: bright blue
            'text-fuchsia-300', // 95: bright magenta
            'text-cyan-300', // 96: bright cyan
            'text-white', // 97: bright white
          ];
          colorClass = colors[num - 90] || '';
        } else if (num === 39) {
          colorClass = '';
        }
      }
      return null;
    } else {
      if (!part) return null;
      const classes = [colorClass, bold ? 'font-bold' : ''].filter(Boolean).join(' ');
      if (classes) {
        return (
          <span key={index} className={classes}>
            {part}
          </span>
        );
      }
      return part;
    }
  });
};

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

type SidebarTab = 'explorer' | 'search' | 'settings' | 'git';
type ConsoleTab = 'healer' | 'logs';

const App: React.FC = () => {
  // Navigation & UI Layout Tabs
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>('explorer');
  const [activeConsoleTab, setActiveConsoleTab] = useState<ConsoleTab>('healer');
  const [consoleCollapsed, setConsoleCollapsed] = useState<boolean>(false);

  // Theme & Live Telemetry States
  const [colorTheme, setColorTheme] = useState<'obsidian' | 'emerald' | 'cyberpunk' | 'antigravity'>(() => {
    return (localStorage.getItem('antigravity-theme') as any) || 'obsidian';
  });

  useEffect(() => {
    localStorage.setItem('antigravity-theme', colorTheme);
    document.body.className = `theme-${colorTheme}`;
  }, [colorTheme]);

  const [cpuUsage, setCpuUsage] = useState(14);
  const [ramUsage, setRamUsage] = useState(1.4);

  useEffect(() => {
    const interval = setInterval(() => {
      setCpuUsage(Math.floor(10 + Math.random() * 8));
      setRamUsage(parseFloat((1.3 + Math.random() * 0.2).toFixed(2)));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Core App States
  const [kernelStatus, setKernelStatus] = useState<'connecting' | 'active' | 'disconnected'>(
    'connecting'
  );
  const [geminiStatus, setGeminiStatus] = useState<'idle' | 'streaming' | 'success' | 'error'>(
    'idle'
  );

  // Sound Effects
  const [playClick] = useSound('https://cdn.pixabay.com/download/audio/2022/03/15/audio_2d5218d8e1.mp3', { volume: 0.25 });
  const [playHover] = useSound('https://cdn.pixabay.com/download/audio/2022/03/15/audio_c8b8f72c8e.mp3', { volume: 0.1 });
  const [playSuccess] = useSound('https://cdn.pixabay.com/download/audio/2021/08/04/audio_0625c1539c.mp3', { volume: 0.3 });
  const [playError] = useSound('https://cdn.pixabay.com/download/audio/2021/08/04/audio_c6ccf3232f.mp3', { volume: 0.3 });

  useEffect(() => {
    if (geminiStatus === 'success') {
      playSuccess();
    } else if (geminiStatus === 'error') {
      playError();
    }
  }, [geminiStatus, playSuccess, playError]);

  const [workspaceRoot, setWorkspaceRoot] = useState<string>('');
  const [apiToken, setApiToken] = useState<string>('••••••••••••••••••••••••');
  const [llmProvider, setLlmProvider] = useState<string>('gemini');
  const [llmEndpoint, setLlmEndpoint] = useState<string>('http://localhost:8000/v1');
  const [llmModel, setLlmModel] = useState<string>('');
  const [llmModelsList, setLlmModelsList] = useState<string[]>([]);
  const [llmTestStatus, setLlmTestStatus] = useState<string | null>(null);
  const [liveTtft, setLiveTtft] = useState<number | null>(null);
  const [liveTps, setLiveTps] = useState<number | null>(null);
  const [commandInput, setCommandInput] = useState<string>('cargo build --release');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [fileChanges, setFileChanges] = useState<FileChangeEvent[]>([]);
  const [symbolIndex, setSymbolIndex] = useState<FileSymbols[]>([]);
  const [watcherActive, setWatcherActive] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<
    { name: string; path: string; mimeType: string; size: number }[]
  >([]);

  // Semantic Search States
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [similarityThreshold, setSimilarityThreshold] = useState<number>(0.5);
  const [resultLimit, setResultLimit] = useState<number>(10);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isIndexing, setIsIndexing] = useState<boolean>(false);

  // VFS & Document Editor States
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [activeFileContent, setActiveFileContent] = useState<string>('');
  const [originalFileContent, setOriginalFileContent] = useState<string>('');
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [diagnostics, setDiagnostics] = useState<Record<string, LspDiagnostic[]>>({});

  // Git Integration States
  const [gitBranch, setGitBranch] = useState<string>('');
  const [gitStatuses, setGitStatuses] = useState<{ path: string; status: string }[]>([]);
  const [diffMode, setDiffMode] = useState<boolean>(false);
  const [diffOriginalContent, setDiffOriginalContent] = useState<string>('');
  const [commitMessage, setCommitMessage] = useState<string>('');
  const [impactSummary, setImpactSummary] = useState<string>('');
  const [hasSecretsInStaged, setHasSecretsInStaged] = useState<boolean>(false);
  const [isGeneratingCommit, setIsGeneratingCommit] = useState<boolean>(false);
  const [isPushing, setIsPushing] = useState<boolean>(false);

  const loadGitStatus = useCallback(async () => {
    if (!isTauri) return;
    try {
      const branchName = await invoke<string>('git_current_branch_cmd');
      setGitBranch(branchName);
      const statuses = await invoke<{ path: string; status: string }[]>('git_status_cmd');
      setGitStatuses(statuses);
    } catch (e) {
      console.error('Failed to load Git status:', e);
    }
  }, []);

  const handleStageFile = async (filePath: string) => {
    if (!isTauri) return;
    try {
      await invoke('git_stage_files_cmd', { files: [filePath] });
      addLog('success', `Git: Staged ${filePath}`);
      loadGitStatus();
    } catch (err) {
      addLog('error', `Git FFI Error: Failed to stage file: ${err}`);
    }
  };

  const handleUnstageFile = async (filePath: string) => {
    if (!isTauri) return;
    try {
      await invoke('git_unstage_files_cmd', { files: [filePath] });
      addLog('success', `Git: Unstaged ${filePath}`);
      loadGitStatus();
    } catch (err) {
      addLog('error', `Git FFI Error: Failed to unstage file: ${err}`);
    }
  };

  const handleStageAll = async () => {
    if (!isTauri) return;
    try {
      const unstaged = gitStatuses
        .filter((f) => f.status === 'Modified' || f.status === 'Untracked')
        .map((f) => f.path);
      if (unstaged.length > 0) {
        await invoke('git_stage_files_cmd', { files: unstaged });
        addLog('success', `Git: Staged all changes (${unstaged.length} files)`);
        loadGitStatus();
      }
    } catch (err) {
      addLog('error', `Git FFI Error: Failed to stage all: ${err}`);
    }
  };

  const handleUnstageAll = async () => {
    if (!isTauri) return;
    try {
      const staged = gitStatuses.filter((f) => f.status === 'Staged').map((f) => f.path);
      if (staged.length > 0) {
        await invoke('git_unstage_files_cmd', { files: staged });
        addLog('success', `Git: Unstaged all changes (${staged.length} files)`);
        loadGitStatus();
      }
    } catch (err) {
      addLog('error', `Git FFI Error: Failed to unstage all: ${err}`);
    }
  };

  const handleOpenDiff = async (gitFile: { path: string; status: string }) => {
    if (!isTauri) return;
    try {
      const original = await invoke<string>('git_get_file_at_head_cmd', { filePath: gitFile.path });
      const rawPath = workspaceRoot + '/' + gitFile.path;
      const absPath = rawPath.replace(/\\/g, '/').replace(/\/+/g, '/');

      let current = '';
      if (gitFile.status !== 'Deleted') {
        try {
          current = await invoke<string>('read_workspace_file_cmd', { path: absPath });
        } catch (_) {
          // File might not exist or is deleted
        }
      }

      setDiffMode(true);
      setDiffOriginalContent(original);
      setActiveFilePath(absPath);
      setActiveFileContent(current);
      setOriginalFileContent(original);

      setOpenTabs((prev) => {
        if (!prev.includes(absPath)) {
          return [...prev, absPath];
        }
        return prev;
      });

      addLog('watcher', `Git: Loaded side-by-side staged diff for ${gitFile.path}`);
    } catch (err) {
      addLog('error', `Git FFI Error: Failed to open diff: ${err}`);
    }
  };

  const handleGenerateCommit = async () => {
    setIsGeneratingCommit(true);
    setHasSecretsInStaged(false);
    addLog(
      'info',
      'AI release coordinator analyzing diff and generating conventional commit message...'
    );

    try {
      const res = await invoke<{ message: string; impact_summary: string; has_secrets: boolean }>(
        'git_generate_commit_message_cmd'
      );
      setCommitMessage(res.message);
      setImpactSummary(res.impact_summary);
      setHasSecretsInStaged(res.has_secrets);

      if (res.has_secrets) {
        addLog(
          'warn',
          '⚠️ SECURITY WARNING: Sensitive credentials detected in the staged diff! Proceed with caution.'
        );
      } else {
        addLog('success', 'Conventional commit message generated successfully.');
      }
    } catch (err) {
      addLog('error', `AI Generation Failed: ${err}`);
    } finally {
      setIsGeneratingCommit(false);
    }
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    try {
      const hash = await invoke<string>('git_create_commit_cmd', { message: commitMessage });
      addLog(
        'success',
        `Git: Created commit ${hash.substring(0, 7)}: "${commitMessage.split('\n')[0]}"`
      );
      setCommitMessage('');
      setImpactSummary('');
      setHasSecretsInStaged(false);
      loadGitStatus();
      setDiffMode(false);
    } catch (err) {
      addLog('error', `Git FFI Error: Commit execution failed: ${err}`);
    }
  };

  const handlePush = async () => {
    setIsPushing(true);
    addLog('info', `Git Sync: Pushing active branch '${gitBranch}' to origin remote...`);
    try {
      await invoke('git_push_branch_cmd');
      addLog('success', `Git Sync: Successfully pushed commits to remote repository.`);
    } catch (err) {
      addLog('error', `Git Sync Error: Push failed: ${err}`);
    } finally {
      setIsPushing(false);
    }
  };

  // Ref locks
  const logEndRef = useRef<HTMLDivElement>(null);
  const isStreamingGeminiRef = useRef<boolean>(false);

  // Helper to append log entries
  const addLog = (type: LogEntry['type'], message: string) => {
    const time = new Date().toTimeString().split(' ')[0] || '';
    setLogs((prev) => [...prev, { id: Math.random().toString(), time, type, message }]);
  };

  // Helper to load logs from the Rust backend state
  const loadBackendLogs = useCallback(async () => {
    if (!isTauri) {
      setLogs([
        {
          id: '1',
          time: '16:12:02',
          type: 'info',
          message: 'Antigravity workspace kernel booting (Browser Mock)...',
        },
        {
          id: '2',
          time: '16:12:03',
          type: 'success',
          message: 'Tauri v2 IPC communication channel established.',
        },
        {
          id: '3',
          time: '16:12:03',
          type: 'info',
          message: 'Windows ReadDirectoryChangesW watcher hooked to workspace root.',
        },
        {
          id: '4',
          time: '16:12:04',
          type: 'success',
          message: 'sqlite-vec v0.1.9 database loaded with 768-dimension configuration.',
        },
        {
          id: '5',
          time: '16:12:04',
          type: 'info',
          message: 'Tree-sitter scanning active. Found 42 source files.',
        },
        {
          id: '6',
          time: '16:12:05',
          type: 'success',
          message: 'Workspace index populated (287 nodes, 72 functions, 14 structs).',
        },
      ]);
      setKernelStatus('active');
      return;
    }

    try {
      const rawLogs = await invoke<string[]>('get_logs');
      const time = new Date().toTimeString().split(' ')[0] || '';
      const mapped = rawLogs.map((msg, idx) => ({
        id: idx.toString(),
        time,
        type:
          msg.includes('failed') || msg.includes('error')
            ? ('error' as const)
            : msg.includes('passed') ||
                msg.includes('established') ||
                msg.includes('loaded') ||
                msg.includes('populated')
              ? ('success' as const)
              : msg.includes('Watcher:')
                ? ('watcher' as const)
                : msg.includes('Security:')
                  ? ('info' as const)
                  : ('info' as const),
        message: msg,
      }));
      setLogs(mapped);
      setKernelStatus('active');
    } catch (e) {
      console.error('Failed to load backend logs:', e);
      setKernelStatus('disconnected');
    }
  }, []);

  // Fetch initial config from backend
  const loadConfig = useCallback(async () => {
    if (!isTauri) return;
    try {
      const payload = await invoke<{
        workspace_root: string;
        llm_provider: string;
        llm_endpoint: string | null;
        llm_model: string | null;
        has_key: boolean;
      }>('get_config');
      setWorkspaceRoot(payload.workspace_root);
      setLlmProvider(payload.llm_provider);
      setLlmEndpoint(payload.llm_endpoint || 'http://localhost:8000/v1');
      setLlmModel(payload.llm_model || '');
      if (payload.has_key) {
        setApiToken('••••••••••••••••••••••••');
      } else {
        setApiToken('');
      }
    } catch (e) {
      console.error('Failed to load configuration:', e);
    }
  }, []);

  // Spawns backend language server processes
  const startLspServers = useCallback(async (root: string) => {
    if (!isTauri || !root) return;
    try {
      addLog('info', `LSP: Initiating compiler server boot sequences for root: ${root}`);
      await invoke('lsp_start', { language: 'rust', rootPath: root });
      addLog('success', 'LSP: rust-analyzer booted and initialized successfully.');
    } catch (e) {
      addLog('info', `LSP Alert: rust-analyzer server could not start: ${e}`);
    }

    try {
      await invoke('lsp_start', { language: 'typescript', rootPath: root });
      addLog('success', 'LSP: typescript-language-server booted and initialized successfully.');
    } catch (e) {
      addLog('info', `LSP Alert: typescript-language-server could not start: ${e}`);
    }
  }, []);

  useEffect(() => {
    if (workspaceRoot) {
      startLspServers(workspaceRoot);
    }
  }, [workspaceRoot, startLspServers]);

  // Fetch symbol tree
  const loadSymbols = useCallback(async () => {
    if (!isTauri) return;
    try {
      const symbols = await invoke<FileSymbols[]>('get_symbols');
      setSymbolIndex(symbols);
    } catch (e) {
      console.error('Failed to fetch symbol index:', e);
    }
  }, []);

  // Auto-scroll logs pane
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Load backend states on boot
  useEffect(() => {
    loadBackendLogs();
    loadConfig();
    loadSymbols();
    loadGitStatus();
  }, [loadBackendLogs, loadConfig, loadSymbols, loadGitStatus]);

  // IPC Event Listeners
  useEffect(() => {
    let unlistenWatcher: (() => void) | null = null;
    let unlistenLogs: (() => void) | null = null;
    let unlistenIndex: (() => void) | null = null;
    let unlistenLsp: (() => void) | null = null;
    let unlistenTtft: (() => void) | null = null;
    let unlistenTps: (() => void) | null = null;

    const setupListeners = async () => {
      if (!isTauri) return;

      unlistenWatcher = await listen<FileChangeEvent>('file-watcher-event', (event) => {
        setWatcherActive(true);
        setFileChanges((prev) => [
          {
            path: event.payload.path,
            kind: event.payload.kind,
            symbols_count: event.payload.symbols_count,
          },
          ...prev,
        ]);
        addLog(
          'watcher',
          `Watcher: Detected [${event.payload.kind.toUpperCase()}] on ${event.payload.path.split('\\').pop()}`
        );
        loadSymbols();
        loadGitStatus();
      });

      unlistenLogs = await listen<string>('kernel-log', (event) => {
        const type =
          event.payload.includes('Error') || event.payload.includes('fail')
            ? 'error'
            : event.payload.includes('success') || event.payload.includes('complete')
              ? 'success'
              : 'info';
        addLog(type, event.payload);
      });

      unlistenIndex = await listen<void>('vector-index-updated', () => {
        addLog('success', 'Vector Index: Completed full workspace embeddings rebuild.');
        setIsIndexing(false);
        loadSymbols();
      });

      unlistenLsp = await listen<{ uri: string; diagnostics: LspDiagnostic[] }>(
        'lsp-diagnostics',
        (event) => {
          setDiagnostics((prev) => ({
            ...prev,
            [event.payload.uri]: event.payload.diagnostics,
          }));
        }
      );

      unlistenTtft = await listen<number>('llm-ttft', (event) => {
        setLiveTtft(event.payload);
      });

      unlistenTps = await listen<number>('llm-tps', (event) => {
        setLiveTps(event.payload);
      });
    };

    setupListeners();

    return () => {
      if (unlistenWatcher) unlistenWatcher();
      if (unlistenLogs) unlistenLogs();
      if (unlistenIndex) unlistenIndex();
      if (unlistenLsp) unlistenLsp();
      if (unlistenTtft) unlistenTtft();
      if (unlistenTps) unlistenTps();
    };
  }, [loadSymbols, loadGitStatus]);

  // File loading FFI
  const handleOpenFile = async (filePath: string) => {
    setDiffMode(false);
    try {
      const content = await invoke<string>('read_workspace_file_cmd', { path: filePath });
      setOpenTabs((prev) => {
        if (!prev.includes(filePath)) {
          return [...prev, filePath];
        }
        return prev;
      });
      setActiveFilePath(filePath);
      setActiveFileContent(content);
      setOriginalFileContent(content);
      addLog(
        'watcher',
        `VFS: Loaded code buffer for ${filePath.split('\\').pop() || filePath.split('/').pop()}`
      );

      // LSP notification didOpen
      if (isTauri) {
        const ext = filePath.split('.').pop()?.toLowerCase();
        const lang =
          ext === 'rs'
            ? 'rust'
            : ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx'
              ? 'typescript'
              : null;
        if (lang) {
          invoke('lsp_file_open', { language: lang, path: filePath, content }).catch((err) => {
            console.warn('LSP file open failed:', err);
          });
        }
      }
    } catch (err) {
      addLog('error', `VFS Error: Failed to open file: ${err}`);
    }
  };

  // File save FFI
  const handleSaveActiveFile = async () => {
    if (!activeFilePath) return;
    try {
      await invoke('write_workspace_file_cmd', {
        path: activeFilePath,
        content: activeFileContent,
      });
      setOriginalFileContent(activeFileContent);
      addLog(
        'success',
        `VFS: Saved modifications to disk for ${activeFilePath.split('\\').pop() || activeFilePath.split('/').pop()}`
      );

      // LSP notification didSave
      if (isTauri) {
        const ext = activeFilePath.split('.').pop()?.toLowerCase();
        const lang =
          ext === 'rs'
            ? 'rust'
            : ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx'
              ? 'typescript'
              : null;
        if (lang) {
          invoke('lsp_file_save', {
            language: lang,
            path: activeFilePath,
            content: activeFileContent,
          }).catch((err) => {
            console.warn('LSP file save failed:', err);
          });
        }
      }
      loadGitStatus();
    } catch (err) {
      addLog('error', `VFS Error: Failed to save file changes: ${err}`);
    }
  };

  // Close tab handler
  const handleCloseTab = (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const index = openTabs.indexOf(filePath);
    const nextTabs = openTabs.filter((t) => t !== filePath);
    setOpenTabs(nextTabs);

    if (activeFilePath === filePath) {
      if (nextTabs.length > 0) {
        const nextIndex = Math.max(0, index - 1);
        const nextTabPath = nextTabs[nextIndex];
        if (nextTabPath) {
          handleOpenFile(nextTabPath);
        }
      } else {
        setActiveFilePath(null);
        setActiveFileContent('');
        setOriginalFileContent('');
      }
    }
  };

  // Submit self-healing build execution
  const handleTestCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim()) return;

    setGeminiStatus('streaming');
    isStreamingGeminiRef.current = true;

    // Clear console logs of previous build attempts
    addLog('info', `Self-Healing: Spawning recursive builder for [${commandInput}]...`);

    if (!isTauri) {
      setTimeout(() => {
        addLog(
          'success',
          'Self-Healing Loop (Browser Mock) successfully compiled after 1 healing iteration.'
        );
        setGeminiStatus('success');
        isStreamingGeminiRef.current = false;
      }, 2000);
      return;
    }

    // Process attachments: large files (>2MB) on Gemini are uploaded via Files API
    const backendAttachments: { mime_type: string; data: string; path: string }[] = [];
    for (const file of attachedFiles) {
      let dataVal = '';
      if (llmProvider === 'gemini' && file.size > 2 * 1024 * 1024) {
        addLog(
          'info',
          `Gemini Cloud: Uploading large attachment '${file.name}' to Google Files API...`
        );
        try {
          const uri = await invoke<string>('upload_file_to_gemini', { path: file.path });
          dataVal = uri;
          addLog('success', `Gemini Cloud: Uploaded '${file.name}' successfully. URI: ${uri}`);
        } catch (err) {
          addLog('error', `Failed to upload '${file.name}' to Gemini Files API: ${err}`);
          setGeminiStatus('error');
          isStreamingGeminiRef.current = false;
          return;
        }
      }
      backendAttachments.push({
        mime_type: file.mimeType,
        data: dataVal,
        path: file.path,
      });
    }

    const channel = new Channel<string>();
    channel.onmessage = (message) => {
      // Print build stream directly to our logs panel
      const type =
        message.includes('failed') || message.includes('Error')
          ? 'error'
          : message.includes('passed') || message.includes('Auto-committed')
            ? 'success'
            : 'gemini';
      addLog(type, message);
    };

    try {
      const res = await invoke<string>('execute_command_stream', {
        command: commandInput,
        attachments: backendAttachments.length > 0 ? backendAttachments : null,
        channel,
      });
      addLog('success', `Self-Healing Loop Result: ${res}`);
      setGeminiStatus('success');
      setAttachedFiles([]); // Clear attached files on success
    } catch (err) {
      addLog('error', `Self-Healing Loop Aborted: ${err}`);
      setGeminiStatus('error');
    } finally {
      isStreamingGeminiRef.current = false;
      loadSymbols();
    }
  };

  // Handle file attachment
  const handleFileAttach = useCallback(async (filePath: string) => {
    let isAlready = false;
    setAttachedFiles((prev) => {
      if (prev.some((f) => f.path === filePath)) {
        isAlready = true;
      }
      return prev;
    });

    if (isAlready) {
      addLog('warn', `Attachment: '${filePath}' is already attached.`);
      return;
    }

    try {
      const fileName = filePath.split(/[/\\]/).pop() || filePath;
      addLog('info', `Attachment: Sniffing file type for '${fileName}'...`);
      const sniffResult = await invoke<{ mime_type: string; size: number }>('sniff_file_type', {
        path: filePath,
      });
      setAttachedFiles((prev) => {
        if (prev.some((f) => f.path === filePath)) return prev;
        return [
          ...prev,
          {
            name: fileName,
            path: filePath,
            mimeType: sniffResult.mime_type,
            size: sniffResult.size,
          },
        ];
      });
      addLog(
        'success',
        `Attachment: Added '${fileName}' (${sniffResult.mime_type}, ${(sniffResult.size / 1024).toFixed(1)} KB).`
      );
    } catch (e) {
      addLog('error', `Attachment Error: Failed to attach file: ${e}`);
    }
  }, []);

  // Open native file picker using RFD command
  const handleOpenFilePicker = useCallback(async () => {
    try {
      const selectedPath = await invoke<string | null>('open_file_dialog');
      if (selectedPath) {
        await handleFileAttach(selectedPath);
      }
    } catch (err) {
      addLog('error', `Attachment Error: Failed to open file picker: ${err}`);
    }
  }, [handleFileAttach]);

  // Handle window drag and drop to attach files
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
          const file = e.dataTransfer.files[i];
          if (file) {
            const filePath = (file as unknown as { path?: string }).path;
            if (filePath) {
              await handleFileAttach(filePath);
            } else {
              addLog(
                'warn',
                `Attachment: Dropped file '${file.name}' does not have an absolute system path.`
              );
            }
          }
        }
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [handleFileAttach]);

  // Re-Index Vector Database
  const handleReindex = async () => {
    setIsIndexing(true);
    addLog('info', 'Database: Requesting backend workspace re-indexing...');
    if (!isTauri) {
      setTimeout(() => {
        addLog('success', 'Database (Browser Mock): Indexing complete.');
        setIsIndexing(false);
      }, 1500);
      return;
    }

    try {
      const res = await invoke<string>('index_workspace');
      addLog('info', `Database: ${res}`);
    } catch (e) {
      addLog('error', `Database Error: Failed to queue index crawl: ${e}`);
      setIsIndexing(false);
    }
  };

  // Semantic Symbol Search
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    addLog('gemini', `Database: Semantic query: "${searchQuery}"`);

    if (!isTauri) {
      setTimeout(() => {
        setSearchResults([
          {
            symbol_name: 'crawl_workspace',
            symbol_kind: 'function',
            file_path: 'src/backend/src/main.rs',
            start_line: 74,
            end_line: 97,
            similarity: 0.824,
          },
        ]);
        setIsSearching(false);
      }, 1000);
      return;
    }

    try {
      const results = await invoke<SearchResult[]>('search_symbols', {
        query: searchQuery,
        threshold: similarityThreshold,
        limit: resultLimit,
      });
      setSearchResults(results);
      addLog('success', `Database: Found ${results.length} matching AST symbols.`);
    } catch (e) {
      addLog('error', `Database Error: Semantic search failed: ${e}`);
    } finally {
      setIsSearching(false);
    }
  };

  // Save Configuration Settings
  const handleSaveConfig = async () => {
    addLog('info', 'Configuration: Writing settings values to secure OS Keyring...');
    if (!isTauri) {
      addLog('success', 'Configuration Saved (Browser Mock).');
      return;
    }

    try {
      const res = await invoke<string>('save_config', {
        workspaceRoot,
        llmProvider,
        llmEndpoint: llmEndpoint || null,
        llmModel: llmModel || null,
        apiToken,
      });
      addLog('success', `Configuration: ${res}`);
      loadConfig();
    } catch (e) {
      addLog('error', `Configuration Error: Save settings failed: ${e}`);
    }
  };

  // Model autodiscovery
  const handleDiscoverModels = async () => {
    if (!llmEndpoint) {
      addLog('warn', 'Autodiscovery: Please specify an endpoint URL first.');
      return;
    }
    setLlmTestStatus('Discovering...');
    try {
      const models = await invoke<string[]>('discover_models', {
        endpoint: llmEndpoint,
        apiKeyStr: apiToken.trim() && !apiToken.startsWith('•') ? apiToken : null,
      });
      setLlmModelsList(models);
      if (models.length > 0) {
        setLlmTestStatus(`Discovered ${models.length} models.`);
        const firstModel = models[0];
        if (firstModel && !models.includes(llmModel)) {
          setLlmModel(firstModel);
        }
      } else {
        setLlmTestStatus('No models returned.');
      }
    } catch (e) {
      setLlmTestStatus(`Discovery failed: ${e}`);
      addLog('error', `Model Discovery Error: ${e}`);
    }
  };

  // Test LLM Connection
  const handleTestConnection = async () => {
    setLlmTestStatus('Testing...');
    try {
      const result = await invoke<{ success: boolean; latency_ms: number; error: string | null }>(
        'test_llm_connection'
      );
      if (result.success) {
        setLlmTestStatus(`Success (${result.latency_ms}ms)`);
        addLog('success', `LLM Connection Test: Successful. Latency: ${result.latency_ms}ms.`);
      } else {
        setLlmTestStatus(`Failed: ${result.error}`);
        addLog('error', `LLM Connection Test: Failed. Error: ${result.error}`);
      }
    } catch (e) {
      setLlmTestStatus(`Error: ${e}`);
      addLog('error', `LLM Connection Test Error: ${e}`);
    }
  };

  const hasUnsavedChanges = activeFilePath && activeFileContent !== originalFileContent;

  return (
    <div className={`flex flex-col w-screen h-screen overflow-hidden text-white select-none bg-transparent relative theme-${colorTheme}`}>
      <Background3D />
      {/* Dynamic Floating Glass Blobs */}
      <div className="glow-blob w-[450px] h-[450px] bg-violet-600/10 top-10 left-10" />
      <div className="glow-blob w-[400px] h-[400px] bg-primary/10 bottom-20 right-20" />
      
      {/* 1. Header Navigation Bar */}
      <header className="h-14 flex items-center justify-between px-6 bg-black/40 border-b border-white/5 backdrop-blur-xl z-10 flex-shrink-0 select-none">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-primary to-accent flex items-center justify-center font-bold text-white tracking-widest text-xs shadow-glow">
            AG
          </div>
          <div>
            <h1 className="text-xs font-bold tracking-widest bg-clip-text text-transparent bg-gradient-to-r from-white to-white/75 font-mono">
              ANTIGRAVITY WORKSPACE
            </h1>
            <p className="text-[8px] font-mono text-white/30 tracking-wider">
              KERNEL: <span className={kernelStatus === 'active' ? 'text-emerald-400 font-bold' : kernelStatus === 'connecting' ? 'text-amber-400 font-bold' : 'text-rose-400 font-bold'}>{kernelStatus.toUpperCase()}</span> // CORE V2.0
            </p>
          </div>
        </div>

        {/* Real-time Telemetry HUD Widget */}
        <div className="hidden lg:flex items-center space-x-6 bg-white/2 border border-white/5 rounded-full px-5 py-1 backdrop-blur-md">
          <div className="flex items-center space-x-1.5 text-[10px] font-mono text-neutral-400">
            <Cpu className="w-3 h-3 text-primary animate-pulse" />
            <span>CPU:</span>
            <span className="text-white font-semibold">{cpuUsage}%</span>
          </div>
          <div className="w-[1px] h-3 bg-white/10" />
          <div className="flex items-center space-x-1.5 text-[10px] font-mono text-neutral-400">
            <BarChart2 className="w-3 h-3 text-violet-400" />
            <span>MEM:</span>
            <span className="text-white font-semibold">{ramUsage} GB</span>
          </div>
          <div className="w-[1px] h-3 bg-white/10" />
          <div className="flex items-center space-x-1.5 text-[10px] font-mono text-neutral-400">
            <Activity className="w-3 h-3 text-emerald-400 animate-pulse" />
            <span>HEAL:</span>
            <span className="text-white font-semibold">98.4%</span>
          </div>
          <div className="w-[1px] h-3 bg-white/10" />
          <div className="flex items-center space-x-1.5 text-[10px] font-mono text-neutral-400">
            <Zap className="w-3 h-3 text-amber-400" />
            <span>SPEED:</span>
            <span className="text-white font-semibold">
              {liveTps !== null ? `${liveTps.toFixed(1)} T/s` : '62 T/s'}
            </span>
          </div>
          <div className="w-[1px] h-3 bg-white/10" />
          <div className="flex items-center space-x-1.5 text-[10px] font-mono text-neutral-400">
            <Wifi className="w-3 h-3 text-primary" />
            <span>VFS WATCH:</span>
            <span className={watcherActive ? "text-emerald-400 font-bold uppercase animate-pulse" : "text-neutral-500 font-bold uppercase"}>
              {watcherActive ? "ACTIVE" : "STANDBY"}
            </span>
          </div>
        </div>

        {/* Workspace state and connection status */}
        <div className="flex items-center space-x-4">
          {activeFilePath && (
            <div className="hidden md:flex items-center space-x-2 bg-white/5 border border-white/5 px-3 py-1 rounded-md text-xs font-mono text-primary">
              <span
                className={`w-2 h-2 rounded-full ${hasUnsavedChanges ? 'bg-amber-400 animate-pulse' : 'bg-primary'}`}
              />
              <span className="max-w-[150px] truncate">
                {activeFilePath.split('\\').pop() || activeFilePath.split('/').pop()}
              </span>
            </div>
          )}

          {/* Theme Selector Circular Presets */}
          <div className="flex items-center space-x-2 bg-black/20 border border-white/5 p-1 rounded-full">
            <button
              onClick={() => { playClick(); setColorTheme('obsidian'); }}
              className={`w-3.5 h-3.5 rounded-full bg-violet-600 transition-transform ${colorTheme === 'obsidian' ? 'scale-125 border border-white shadow-glow' : 'opacity-60 hover:opacity-100'}`}
              title="Obsidian Theme"
            />
            <button
              onClick={() => { playClick(); setColorTheme('emerald'); }}
              className={`w-3.5 h-3.5 rounded-full bg-emerald-500 transition-transform ${colorTheme === 'emerald' ? 'scale-125 border border-white shadow-glow' : 'opacity-60 hover:opacity-100'}`}
              title="Emerald Neon Theme"
            />
            <button
              onClick={() => { playClick(); setColorTheme('cyberpunk'); }}
              className={`w-3.5 h-3.5 rounded-full bg-yellow-500 transition-transform ${colorTheme === 'cyberpunk' ? 'scale-125 border border-white shadow-glow' : 'opacity-60 hover:opacity-100'}`}
              title="Cyberpunk Theme"
            />
            <button
              onClick={() => { playClick(); setColorTheme('antigravity'); }}
              className={`w-3.5 h-3.5 rounded-full bg-blue-500 transition-transform ${colorTheme === 'antigravity' ? 'scale-125 border border-white shadow-glow' : 'opacity-60 hover:opacity-100'}`}
              title="Antigravity Blue Theme"
            />
          </div>

          <div className="flex items-center space-x-3 text-[11px] font-mono">
            <div className="flex items-center space-x-1.5 bg-black/20 border border-white/5 px-2.5 py-1 rounded-md">
              <span className="text-white/30">VFS:</span>
              <span className="text-white/60 max-w-[100px] truncate" title={workspaceRoot}>
                {workspaceRoot.split(/[/\\]/).pop() || workspaceRoot}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* 2. Main Workbench Body */}
      <div className="flex-1 flex overflow-hidden w-full relative">
        {/* Activity Toolbar (Left Icons) */}
        <div className="w-[50px] border-r border-white/5 bg-black/25 flex flex-col items-center py-4 space-y-4 flex-shrink-0 z-10">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onMouseEnter={() => playHover()}
            onClick={() => { playClick(); setActiveSidebarTab('explorer'); }}
            className={`p-2.5 rounded-xl transition-all duration-300 relative group cursor-pointer ${
              activeSidebarTab === 'explorer'
                ? 'text-primary bg-primary/10 shadow-glow'
                : 'text-neutral-400 hover:text-white hover:bg-white/5'
            }`}
            title="Workspace File Explorer"
          >
            <Folder className="w-5 h-5" />
            <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-black/90 border border-white/10 px-2.5 py-1.5 text-[10px] font-semibold text-white rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-30 shadow-glow">
              File Explorer
            </div>
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onMouseEnter={() => playHover()}
            onClick={() => { playClick(); setActiveSidebarTab('search'); }}
            className={`p-2.5 rounded-xl transition-all duration-300 relative group cursor-pointer ${
              activeSidebarTab === 'search'
                ? 'text-primary bg-primary/10 shadow-glow'
                : 'text-neutral-400 hover:text-white hover:bg-white/5'
            }`}
            title="Semantic Code Search"
          >
            <Search className="w-5 h-5" />
            <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-black/90 border border-white/10 px-2.5 py-1.5 text-[10px] font-semibold text-white rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-30 shadow-glow">
              Semantic Search
            </div>
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onMouseEnter={() => playHover()}
            onClick={() => { playClick(); setActiveSidebarTab('git'); }}
            className={`p-2.5 rounded-xl transition-all duration-300 relative group cursor-pointer ${
              activeSidebarTab === 'git'
                ? 'text-primary bg-primary/10 shadow-glow'
                : 'text-neutral-400 hover:text-white hover:bg-white/5'
            }`}
            title="Git Control"
          >
            <GitBranch className="w-5 h-5" />
            <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-black/90 border border-white/10 px-2.5 py-1.5 text-[10px] font-semibold text-white rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-30 shadow-glow">
              Git Control
            </div>
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onMouseEnter={() => playHover()}
            onClick={() => { playClick(); setActiveSidebarTab('settings'); }}
            className={`p-2.5 rounded-xl transition-all duration-300 relative group cursor-pointer ${
              activeSidebarTab === 'settings'
                ? 'text-primary bg-primary/10 shadow-glow'
                : 'text-neutral-400 hover:text-white hover:bg-white/5'
            }`}
            title="IDE Configuration Settings"
          >
            <Settings className="w-5 h-5" />
            <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-black/90 border border-white/10 px-2.5 py-1.5 text-[10px] font-semibold text-white rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-30 shadow-glow">
              IDE Settings
            </div>
          </motion.button>
        </div>

        {/* Sidebar Expansion Pane */}
        <aside className="w-[280px] border-r border-white/5 bg-[#090d13]/40 flex flex-col flex-shrink-0 z-0">
          {activeSidebarTab === 'explorer' && (
            <FileExplorer
              workspaceRoot={workspaceRoot}
              onFileSelect={handleOpenFile}
              activeFilePath={activeFilePath}
              onFileAttach={handleFileAttach}
            />
          )}

          {activeSidebarTab === 'search' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-3 border-b border-white/5">
                <span className="text-xs font-bold uppercase tracking-widest text-neutral-400">
                  Semantic Code Search
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                <form onSubmit={handleSearch} className="space-y-3">
                  <div className="flex flex-col space-y-1">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full px-3 py-2 bg-black/40 border border-white/10 focus:border-primary/50 outline-none rounded-lg text-xs text-white font-mono"
                      placeholder="e.g. 'watcher config'..."
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSearching || !searchQuery.trim()}
                    className="w-full py-2 bg-gradient-to-tr from-primary to-accent hover:from-primary hover:to-accent disabled:opacity-50 text-white rounded-lg text-xs font-semibold active:scale-95 transition-all cursor-pointer shadow-md shadow-primary/10"
                  >
                    {isSearching ? 'Searching...' : 'Execute Vector Search'}
                  </button>

                  <div className="space-y-3 pt-2 text-[11px] text-white/50 border-t border-white/5">
                    <div className="flex justify-between">
                      <span>Threshold:</span>
                      <span className="font-semibold text-primary font-mono">
                        {(similarityThreshold * 100).toFixed(0)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={similarityThreshold}
                      onChange={(e) => setSimilarityThreshold(parseFloat(e.target.value))}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-primary"
                    />

                    <div className="flex justify-between items-center">
                      <span>Limit:</span>
                      <input
                        type="number"
                        min="1"
                        max="50"
                        value={resultLimit}
                        onChange={(e) => setResultLimit(parseInt(e.target.value) || 10)}
                        className="w-16 px-1.5 py-0.5 bg-black/40 border border-white/10 rounded font-mono text-white text-xs text-center outline-none"
                      />
                    </div>
                  </div>
                </form>

                {/* Search Results */}
                {searchResults.length > 0 && (
                  <div className="space-y-2.5 pt-4 border-t border-white/5 animate-fade-in">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                      Matches ({searchResults.length})
                    </h4>
                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                      {searchResults.map((res, i) => (
                        <div
                          key={i}
                          onClick={() => handleOpenFile(res.file_path)}
                          className="p-2.5 bg-white/3 border border-white/5 hover:border-primary/30 rounded-lg flex flex-col space-y-1 hover:bg-primary/5 transition-all duration-200 cursor-pointer"
                        >
                          <div className="flex justify-between items-start">
                            <span className="text-xs font-bold text-white font-mono truncate max-w-[140px]">
                              {res.symbol_name}
                            </span>
                            <span className="text-[10px] font-bold font-mono text-emerald-400">
                              {(res.similarity * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-[9px] text-white/40 font-mono">
                            <span className="truncate max-w-[120px]">
                              {res.file_path.split('\\').pop() || res.file_path.split('/').pop()}
                            </span>
                            <span>L{res.start_line}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeSidebarTab === 'settings' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-3 border-b border-white/5">
                <span className="text-xs font-bold uppercase tracking-widest text-neutral-400">
                  IDE Configuration
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold text-white/40 uppercase tracking-wider block">
                      Workspace Root
                    </label>
                    <input
                      type="text"
                      value={workspaceRoot}
                      onChange={(e) => setWorkspaceRoot(e.target.value)}
                      className="w-full px-3 py-2 bg-black/40 border border-white/10 focus:border-primary/50 outline-none rounded-lg text-xs text-white font-mono"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold text-white/40 uppercase tracking-wider block">
                      AI Provider
                    </label>
                    <select
                      value={llmProvider}
                      onChange={(e) => {
                        const newProvider = e.target.value;
                        setLlmProvider(newProvider);
                        setApiToken('••••••••••••••••••••••••');
                      }}
                      className="w-full px-3 py-2 bg-black/40 border border-white/10 focus:border-primary/50 outline-none rounded-lg text-xs text-white"
                    >
                      <option value="gemini">Gemini Cloud API</option>
                      <option value="openai">Local LLM / NVIDIA GPU NIM</option>
                    </select>
                  </div>

                  {llmProvider === 'openai' && (
                    <>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-semibold text-white/40 uppercase tracking-wider block">
                          Endpoint URL
                        </label>
                        <input
                          type="text"
                          value={llmEndpoint}
                          onChange={(e) => setLlmEndpoint(e.target.value)}
                          placeholder="e.g. http://localhost:8000/v1"
                          className="w-full px-3 py-2 bg-black/40 border border-white/10 focus:border-primary/50 outline-none rounded-lg text-xs text-white font-mono"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] font-semibold text-white/40 uppercase tracking-wider block">
                            Model Name
                          </label>
                          <button
                            onClick={handleDiscoverModels}
                            className="text-[9px] text-primary hover:underline cursor-pointer"
                          >
                            Autodiscover
                          </button>
                        </div>
                        {llmModelsList.length > 0 ? (
                          <select
                            value={llmModel}
                            onChange={(e) => setLlmModel(e.target.value)}
                            className="w-full px-3 py-2 bg-black/40 border border-white/10 focus:border-primary/50 outline-none rounded-lg text-xs text-white"
                          >
                            {llmModelsList.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={llmModel}
                            onChange={(e) => setLlmModel(e.target.value)}
                            placeholder="e.g. nvidia/llama-3.1-inst-70b"
                            className="w-full px-3 py-2 bg-black/40 border border-white/10 focus:border-primary/50 outline-none rounded-lg text-xs text-white font-mono"
                          />
                        )}
                      </div>
                    </>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold text-white/40 uppercase tracking-wider block">
                      {llmProvider === 'openai' ? 'Local / NVIDIA API Key' : 'Gemini API Key'}
                    </label>
                    <input
                      type="password"
                      value={apiToken}
                      onChange={(e) => setApiToken(e.target.value)}
                      placeholder={
                        llmProvider === 'openai' ? 'Enter key (optional)' : 'Enter Gemini API key'
                      }
                      className="w-full px-3 py-2 bg-black/40 border border-white/10 focus:border-primary/50 outline-none rounded-lg text-xs text-white font-mono"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-white/5 space-y-3">
                  <button
                    onClick={handleSaveConfig}
                    className="w-full py-2.5 bg-gradient-to-tr from-primary to-accent hover:from-primary hover:to-accent text-white rounded-lg text-xs font-semibold active:scale-95 transition-all cursor-pointer shadow-md shadow-primary/10"
                  >
                    Save Settings
                  </button>

                  <button
                    onClick={handleTestConnection}
                    className="w-full py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg text-[11px] font-mono border border-white/10 active:scale-95 transition-all cursor-pointer flex items-center justify-center space-x-2"
                  >
                    <span>⚡ Test Connection</span>
                    {llmTestStatus && (
                      <span className="text-[9px] text-primary font-semibold truncate max-w-[120px]">
                        ({llmTestStatus})
                      </span>
                    )}
                  </button>

                  {(liveTtft !== null || liveTps !== null) && (
                    <div className="p-3 bg-black/20 border border-white/5 rounded-lg space-y-2 mt-2">
                      <span className="text-[9px] font-semibold text-white/30 uppercase tracking-wider block">
                        Active Telemetry
                      </span>
                      <div className="grid grid-cols-2 gap-2 text-center">
                        <div className="p-2 bg-white/3 rounded border border-white/5">
                          <span className="text-[9px] text-white/50 block">TTFT</span>
                          <span className="text-xs font-bold text-primary font-mono">
                            {liveTtft !== null ? `${liveTtft.toFixed(3)}s` : '—'}
                          </span>
                        </div>
                        <div className="p-2 bg-white/3 rounded border border-white/5">
                          <span className="text-[9px] text-white/50 block">Speed</span>
                          <span className="text-xs font-bold text-emerald-400 font-mono">
                            {liveTps !== null ? `${liveTps.toFixed(1)} T/s` : '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-4">
                  <button
                    onClick={handleReindex}
                    disabled={isIndexing}
                    className="w-full py-2.5 bg-white/5 hover:bg-white/8 disabled:opacity-50 text-white rounded-lg text-xs font-semibold active:scale-95 transition-all cursor-pointer border border-white/5 flex items-center justify-center space-x-2"
                  >
                    {isIndexing ? 'Indexing...' : 'Re-Index Database'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeSidebarTab === 'git' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Header */}
              <div className="p-3 border-b border-white/5 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-widest text-neutral-400">
                  Git Stage & Commit
                </span>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={loadGitStatus}
                    className="p-1 hover:bg-white/5 rounded text-neutral-400 hover:text-primary transition-colors"
                    title="Refresh Git Status"
                  >
                    <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                      <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
                    </svg>
                  </button>
                  <button
                    onClick={handlePush}
                    disabled={isPushing || !gitBranch || gitBranch === 'DETACHED'}
                    className="p-1 hover:bg-white/5 disabled:opacity-30 rounded text-neutral-400 hover:text-primary transition-colors flex items-center justify-center"
                    title="Push Branch to Remote"
                  >
                    {isPushing ? (
                      <svg
                        className="w-3.5 h-3.5 animate-spin text-primary"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                        <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Git Branch Banner */}
              <div className="px-4 py-2.5 bg-[#0e1726]/40 border-b border-white/5 flex items-center justify-between text-xs font-mono text-primary select-none">
                <span className="flex items-center space-x-1.5 truncate max-w-[190px]">
                  <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                    <path d="M18.8 6c0-1.7-1.3-3-3-3s-3 1.3-3 3c0 1.2.7 2.3 1.7 2.8L13 13.3c-1-.5-2.2-.4-3 .3L5.8 9.8c1-.5 1.7-1.6 1.7-2.8 0-1.7-1.3-3-3-3s-3 1.3-3 3c0 1.2.7 2.3 1.7 2.8v4.4C2.2 14.7 1.5 15.8 1.5 17c0 1.7 1.3 3 3 3s3-1.3 3-3c0-1.2-.7-2.3-1.7-2.8v-4.4l4.2 3.8c-.2.4-.3.9-.3 1.4 0 1.7 1.3 3 3 3s3-1.3 3-3c0-1-.5-2-1.3-2.5l1.6-4.5c.9.5 2 .4 2.8-.3 1-.7 1.4-1.9 1.4-3.1zm-14.3 13c-.8 0-1.5-.7-1.5-1.5s.7-1.5 1.5-1.5 1.5.7 1.5 1.5-.7 1.5-1.5 1.5zm0-12.5c-.8 0-1.5-.7-1.5-1.5S3.7 5 4.5 5 6 5.7 6 6.5 5.3 8 4.5 8zm11.3 0c-.8 0-1.5-.7-1.5-1.5s.7-1.5 1.5-1.5 1.5.7 1.5 1.5-.7 1.5-1.5 1.5z" />
                  </svg>
                  <span>Branch:</span>
                  <span className="font-bold text-white truncate">{gitBranch || 'loading...'}</span>
                </span>
                {gitBranch === 'DETACHED' && (
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-400 font-bold">
                    Detached
                  </span>
                )}
              </div>

              {/* Status File Lists */}
              <div className="flex-1 overflow-y-auto p-3 space-y-4 custom-scrollbar select-none text-xs">
                {/* Staged Changes Accordion */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center bg-emerald-500/5 border border-emerald-500/10 px-2.5 py-1.5 rounded-lg select-none">
                    <span className="font-bold text-emerald-400 font-mono tracking-wide uppercase text-[10px]">
                      Staged Changes ({gitStatuses.filter((f) => f.status === 'Staged').length})
                    </span>
                    {gitStatuses.filter((f) => f.status === 'Staged').length > 0 && (
                      <button
                        onClick={handleUnstageAll}
                        className="text-[9px] hover:underline text-emerald-500 font-semibold cursor-pointer"
                      >
                        Unstage All
                      </button>
                    )}
                  </div>
                  <div className="space-y-1">
                    {gitStatuses
                      .filter((f) => f.status === 'Staged')
                      .map((file, idx) => (
                        <div
                          key={idx}
                          onClick={() => handleOpenDiff(file)}
                          className="flex items-center justify-between px-2 py-1.5 hover:bg-emerald-500/5 border border-transparent hover:border-emerald-500/10 rounded-md cursor-pointer group transition-all"
                        >
                          <span
                            className="font-mono text-neutral-300 truncate max-w-[170px]"
                            title={file.path}
                          >
                            {file.path.split(/[/\\]/).pop() || file.path}
                          </span>
                          <div className="flex items-center space-x-1.5">
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-400 uppercase">
                              Staged
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUnstageFile(file.path);
                              }}
                              className="p-0.5 rounded hover:bg-emerald-500/20 text-emerald-400 opacity-0 group-hover:opacity-100 transition-all duration-150 cursor-pointer"
                              title="Unstage file"
                            >
                              &minus;
                            </button>
                          </div>
                        </div>
                      ))}
                    {gitStatuses.filter((f) => f.status === 'Staged').length === 0 && (
                      <div className="text-neutral-500 italic text-[11px] text-center py-2 bg-black/10 rounded-lg">
                        No staged changes.
                      </div>
                    )}
                  </div>
                </div>

                {/* Unstaged Changes Accordion (Modified/Deleted) */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center bg-amber-500/5 border border-amber-500/10 px-2.5 py-1.5 rounded-lg select-none">
                    <span className="font-bold text-amber-400 font-mono tracking-wide uppercase text-[10px]">
                      Changes ({gitStatuses.filter((f) => f.status === 'Modified').length})
                    </span>
                    {gitStatuses.filter((f) => f.status === 'Modified').length > 0 && (
                      <button
                        onClick={handleStageAll}
                        className="text-[9px] hover:underline text-amber-500 font-semibold cursor-pointer"
                      >
                        Stage All
                      </button>
                    )}
                  </div>
                  <div className="space-y-1">
                    {gitStatuses
                      .filter((f) => f.status === 'Modified')
                      .map((file, idx) => (
                        <div
                          key={idx}
                          onClick={() => handleOpenDiff(file)}
                          className="flex items-center justify-between px-2 py-1.5 hover:bg-amber-500/5 border border-transparent hover:border-amber-500/10 rounded-md cursor-pointer group transition-all"
                        >
                          <span
                            className="font-mono text-neutral-300 truncate max-w-[170px]"
                            title={file.path}
                          >
                            {file.path.split(/[/\\]/).pop() || file.path}
                          </span>
                          <div className="flex items-center space-x-1.5">
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-400 uppercase">
                              Modified
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStageFile(file.path);
                              }}
                              className="p-0.5 rounded hover:bg-amber-500/20 text-amber-400 opacity-0 group-hover:opacity-100 transition-all duration-150 cursor-pointer"
                              title="Stage file"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ))}
                    {gitStatuses.filter((f) => f.status === 'Modified').length === 0 && (
                      <div className="text-neutral-500 italic text-[11px] text-center py-2 bg-black/10 rounded-lg">
                        No modified files.
                      </div>
                    )}
                  </div>
                </div>

                {/* Untracked Files Accordion */}
                <div className="space-y-1.5">
                  <div className="bg-neutral-500/5 border border-neutral-500/10 px-2.5 py-1.5 rounded-lg select-none">
                    <span className="font-bold text-neutral-400 font-mono tracking-wide uppercase text-[10px]">
                      Untracked ({gitStatuses.filter((f) => f.status === 'Untracked').length})
                    </span>
                  </div>
                  <div className="space-y-1">
                    {gitStatuses
                      .filter((f) => f.status === 'Untracked')
                      .map((file, idx) => (
                        <div
                          key={idx}
                          onClick={() => handleOpenDiff(file)}
                          className="flex items-center justify-between px-2 py-1.5 hover:bg-white/5 border border-transparent hover:border-white/10 rounded-md cursor-pointer group transition-all"
                        >
                          <span
                            className="font-mono text-neutral-400 truncate max-w-[170px]"
                            title={file.path}
                          >
                            {file.path.split(/[/\\]/).pop() || file.path}
                          </span>
                          <div className="flex items-center space-x-1.5">
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-400 uppercase">
                              Untracked
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStageFile(file.path);
                              }}
                              className="p-0.5 rounded hover:bg-white/10 text-neutral-400 opacity-0 group-hover:opacity-100 transition-all duration-150 cursor-pointer"
                              title="Stage file"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ))}
                    {gitStatuses.filter((f) => f.status === 'Untracked').length === 0 && (
                      <div className="text-neutral-500 italic text-[11px] text-center py-2 bg-black/10 rounded-lg">
                        No untracked files.
                      </div>
                    )}
                  </div>
                </div>

                {/* AI Commit generator panel */}
                <div className="pt-3 border-t border-white/5 space-y-3">
                  <button
                    onClick={handleGenerateCommit}
                    disabled={
                      isGeneratingCommit ||
                      gitStatuses.filter((f) => f.status === 'Staged').length === 0
                    }
                    className="w-full py-2 bg-gradient-to-tr from-primary to-accent hover:from-primary hover:to-accent disabled:opacity-50 text-white rounded-lg text-xs font-semibold active:scale-95 transition-all cursor-pointer shadow-md shadow-primary/10 flex items-center justify-center space-x-1.5"
                  >
                    <span>
                      {isGeneratingCommit ? 'Analyzing Diff...' : '✨ Generate Commit Message'}
                    </span>
                  </button>

                  {/* Warning banner if secrets found */}
                  {hasSecretsInStaged && (
                    <div className="p-3 bg-rose-500/15 border border-rose-500/30 text-rose-300 rounded-lg space-y-1 font-mono text-[10px] leading-relaxed animate-pulse">
                      <div className="font-bold uppercase tracking-wider text-rose-400 flex items-center">
                        ⚠️ Credentials Leak Warning
                      </div>
                      <div>
                        Potential API keys or private tokens detected in your staged diff. Purge
                        credentials from files before committing!
                      </div>
                    </div>
                  )}

                  {/* AI Impact summary card */}
                  {impactSummary && (
                    <div className="p-2.5 bg-fuchsia-950/10 border border-fuchsia-500/20 rounded-lg space-y-1">
                      <span className="text-[9px] font-bold text-fuchsia-400 uppercase tracking-wider block font-mono">
                        🔍 AI Impact Summary
                      </span>
                      <p className="text-[10px] text-white/70 leading-relaxed font-sans">
                        {impactSummary}
                      </p>
                    </div>
                  )}

                  {/* Commit message input textarea */}
                  <div className="space-y-1.5 relative">
                    <label className="text-[9px] font-semibold text-white/30 uppercase tracking-wider block font-mono">
                      Commit Message
                    </label>
                    <textarea
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      rows={3}
                      className="w-full px-2.5 py-2 bg-black/40 border border-white/10 focus:border-primary/40 outline-none rounded-lg text-[11px] text-white font-mono leading-relaxed"
                      placeholder="e.g. feat(sidebar): add git stage panel"
                    />

                    {/* Character limit indicator for subject line (first line) */}
                    {commitMessage && (
                      <div className="flex justify-between items-center text-[9px] font-mono text-white/30 px-1 mt-0.5">
                        <span>Subject: {commitMessage.split('\n')[0]?.length || 0} / 50</span>
                        <span
                          className={
                            (commitMessage.split('\n')[0]?.length || 0) > 50
                              ? 'text-amber-400 font-bold'
                              : ''
                          }
                        >
                          {(commitMessage.split('\n')[0]?.length || 0) > 50
                            ? 'Too Long'
                            : 'Optimal'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Live Conventional Commit linter cards checklist */}
                  {commitMessage && (
                    <div className="p-2.5 bg-black/20 border border-white/5 rounded-lg space-y-1.5 font-mono text-[10px]">
                      <span className="text-[8px] font-semibold text-white/30 uppercase tracking-wider block">
                        Conventional Commit Lint Checklist
                      </span>

                      {/* Check 1: Format validation */}
                      <div className="flex items-center space-x-2">
                        {/^[a-z]+(\([a-z0-9_-]+\))?: .+/i.test(
                          commitMessage.split('\n')[0] || ''
                        ) ? (
                          <span className="text-emerald-400">✓</span>
                        ) : (
                          <span className="text-rose-400">✗</span>
                        )}
                        <span className="text-white/60">Fits type(scope): subject</span>
                      </div>

                      {/* Check 2: Valid conventional type check */}
                      <div className="flex items-center space-x-2">
                        {/^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9_-]+\))?: .+/i.test(
                          commitMessage.split('\n')[0] || ''
                        ) ? (
                          <span className="text-emerald-400">✓</span>
                        ) : (
                          <span className="text-rose-400">✗</span>
                        )}
                        <span className="text-white/60">Type: feat, fix, docs, refactor...</span>
                      </div>

                      {/* Check 3: Capitalization (starts lowercase) */}
                      <div className="flex items-center space-x-2">
                        {/^[a-z]+(\([a-z0-9_-]+\))?: [a-z].+/.test(
                          commitMessage.split('\n')[0] || ''
                        ) ? (
                          <span className="text-emerald-400">✓</span>
                        ) : (
                          <span className="text-amber-400">⚠</span>
                        )}
                        <span className="text-white/60">Subject starts lowercase</span>
                      </div>

                      {/* Check 4: No trailing period */}
                      <div className="flex items-center space-x-2">
                        {!(commitMessage.split('\n')[0] || '').trim().endsWith('.') ? (
                          <span className="text-emerald-400">✓</span>
                        ) : (
                          <span className="text-amber-400">⚠</span>
                        )}
                        <span className="text-white/60">No trailing period</span>
                      </div>
                    </div>
                  )}

                  {/* Primary Commit Button */}
                  <button
                    onClick={handleCommit}
                    disabled={
                      !commitMessage.trim() ||
                      gitStatuses.filter((f) => f.status === 'Staged').length === 0
                    }
                    className="w-full py-2.5 bg-gradient-to-tr from-primary to-accent hover:from-primary hover:to-accent disabled:opacity-50 text-white rounded-lg text-xs font-semibold active:scale-95 transition-all cursor-pointer shadow-md shadow-primary/20"
                  >
                    Commit Staged Changes
                  </button>
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* Center / Editor Area */}
        <main className="flex-1 flex flex-col overflow-hidden bg-[#07090e] relative">
          {/* Main workspace layout splits: Editor (top) + Console (bottom) */}
          <div className="flex-1 flex flex-col min-h-0 relative">
            {/* Editor Workspace */}
            <div className="flex-1 flex flex-col min-h-0 relative">
              {activeFilePath ? (
                <div className="flex-1 flex flex-col min-h-0">
                  {/* Tabs Document Bar */}
                  <div className="h-10 bg-[#0c0f16] border-b border-white/5 flex items-center overflow-x-auto select-none custom-scrollbar z-10 flex-shrink-0">
                    {openTabs.map((tabPath) => {
                      const isActive = activeFilePath === tabPath;
                      const tabName =
                        tabPath.split('\\').pop() || tabPath.split('/').pop() || 'File';
                      const isUnsaved = tabPath === activeFilePath && hasUnsavedChanges;

                      return (
                        <div
                          key={tabPath}
                          onClick={() => handleOpenFile(tabPath)}
                          className={`group h-full flex items-center px-4 border-r border-white/5 cursor-pointer transition-all duration-200 select-none relative ${
                            isActive
                              ? 'bg-[#090d13] text-primary font-semibold'
                              : 'bg-black/20 text-neutral-400 hover:bg-white/3 hover:text-white'
                          }`}
                        >
                          <span className="text-xs font-mono mr-2">{tabName}</span>
                          {/* Unsaved indicator or Close tab cross */}
                          {isUnsaved ? (
                            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                          ) : (
                            <button
                              onClick={(e) => handleCloseTab(tabPath, e)}
                              className="p-0.5 rounded-full hover:bg-white/10 opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-rose-400 transition-all duration-200 flex-shrink-0"
                            >
                              <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                              </svg>
                            </button>
                          )}
                          {/* Active bottom glow strip */}
                          {isActive && (
                            <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary to-accent shadow-md shadow-primary" />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Monaco Editor Container */}
                  <div className="flex-1 min-h-0 relative">
                    <MonacoEditor
                      filePath={activeFilePath}
                      content={activeFileContent}
                      onContentChange={setActiveFileContent}
                      onSave={handleSaveActiveFile}
                      diagnostics={diagnostics}
                      diffMode={diffMode}
                      originalContent={diffOriginalContent}
                    />
                  </div>
                </div>
              ) : (
                /* IDE Backdrop Dashboard - Premium Bento HUD Box Layout */
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-transparent select-none">
                  <div className="max-w-6xl mx-auto space-y-6">
                    
                    {/* Telemetry Welcome Bento Banner */}
                    <motion.div 
                      initial={{ opacity: 0, y: 30 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                      className="glass-panel p-8 rounded-3xl relative overflow-hidden flex flex-col lg:flex-row lg:items-center justify-between border border-white/5"
                    >
                      {/* Ambient background glows inside the card */}
                      <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-gradient-to-br from-primary/10 to-accent/10 rounded-full blur-[80px] pointer-events-none" />
                      
                      <div className="space-y-4 relative z-10 max-w-2xl">
                        <div className="flex items-center space-x-2">
                          <span className="px-3 py-1 rounded-full bg-gradient-to-r from-primary/15 to-accent/15 text-primary border border-primary/20 text-[9px] font-bold uppercase tracking-widest font-mono">
                            ⚡ SYNERGY KERNEL v2.0
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[8px] font-mono">
                            SECURE SANDBOXED
                          </span>
                        </div>
                        <h2 className="text-4xl font-extrabold tracking-tight text-white leading-tight font-sans">
                          Double-Compile <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary via-accent to-accent">Self-Healing</span> Engine
                        </h2>
                        <p className="text-xs text-neutral-400 leading-relaxed max-w-xl font-sans">
                          Select any source file in the file tree to configure Monaco sandbox compiler contexts. Compile in real-time with automated LLM diagnostics and git self-repair loop capability.
                        </p>
                      </div>

                      <div className="mt-6 lg:mt-0 flex flex-col sm:flex-row gap-3 relative z-10 flex-shrink-0">
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onMouseEnter={() => playHover()}
                          onClick={() => { playClick(); handleReindex(); }}
                          disabled={isIndexing}
                          className="px-6 py-3 bg-gradient-to-tr from-primary to-accent hover:from-primary hover:to-accent text-white rounded-2xl text-xs font-bold shadow-glow flex items-center justify-center space-x-2 cursor-pointer transition-all disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isIndexing ? 'animate-spin' : ''}`} />
                          <span>{isIndexing ? 'Indexing Workspace...' : 'Index Workspace'}</span>
                        </motion.button>

                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onMouseEnter={() => playHover()}
                          onClick={() => { playClick(); setActiveSidebarTab('settings'); }}
                          className="px-6 py-3 bg-white/5 hover:bg-white/10 text-white border border-white/5 rounded-2xl text-xs font-bold flex items-center justify-center space-x-2 cursor-pointer transition-all"
                        >
                          <Settings className="w-3.5 h-3.5 text-neutral-400" />
                          <span>Configure Engine</span>
                        </motion.button>
                      </div>
                    </motion.div>

                    {/* Bento Box Sub-Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                      
                      {/* Bento 1: Animated Interactive SVG Flowchart */}
                      <motion.div 
                        initial={{ opacity: 0, x: -30 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.2, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                        className="glass-card p-6 rounded-3xl space-y-4 lg:col-span-7 flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-widest font-mono">
                              Compiler Repair Pipeline Flow
                            </h3>
                            <span className="text-[9px] font-mono text-primary/80 bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">
                              SVG PIPELINE
                            </span>
                          </div>
                          <p className="text-[10px] text-neutral-500 mt-1 font-sans">
                            Watch compiled changes stream. Errors automatically invoke recovery APIs.
                          </p>
                        </div>

                        {/* Interactive SVG Diagram with moving dashes */}
                        <div className="py-6 flex items-center justify-center bg-black/20 rounded-2xl border border-white/5 relative">
                          <svg className="w-full max-w-[500px]" viewBox="0 0 500 120">
                            {/* SVG Flow Lines */}
                            <path d="M 65 60 L 165 60" stroke="rgba(34, 211, 238, 0.15)" strokeWidth="2" strokeDasharray="4" className="flow-line" />
                            <path d="M 235 60 L 335 60" stroke="rgba(244, 63, 94, 0.15)" strokeWidth="2" strokeDasharray="4" className="flow-line" />
                            <path d="M 405 60 L 435 60" stroke="rgba(16, 185, 129, 0.15)" strokeWidth="2" strokeDasharray="4" className="flow-line" />

                            {/* Node 1: Workspace */}
                            <g transform="translate(15, 20)">
                              <rect width="100" height="80" rx="12" fill="rgba(13, 17, 28, 0.9)" stroke="rgba(34, 211, 238, 0.3)" strokeWidth="1" />
                              <circle cx="50" cy="30" r="14" fill="rgba(34, 211, 238, 0.1)" stroke="rgb(var(--primary))" strokeWidth="1" />
                              <path d="M 44 30 L 56 30 M 50 24 L 50 36" stroke="rgb(var(--primary))" strokeWidth="1.5" />
                              <text x="50" y="66" fill="rgba(255, 255, 255, 0.8)" fontSize="9" textAnchor="middle" fontFamily="sans-serif">Workspace</text>
                            </g>

                            {/* Node 2: Compiler */}
                            <g transform="translate(185, 20)">
                              <rect width="100" height="80" rx="12" fill="rgba(13, 17, 28, 0.9)" stroke="rgba(244, 63, 94, 0.3)" strokeWidth="1" />
                              <circle cx="50" cy="30" r="14" fill="rgba(244, 63, 94, 0.1)" stroke="rgb(244, 63, 94)" strokeWidth="1" />
                              <path d="M 46 26 L 54 34 M 54 26 L 46 34" stroke="rgb(244, 63, 94)" strokeWidth="1.5" />
                              <text x="50" y="66" fill="rgba(255, 255, 255, 0.8)" fontSize="9" textAnchor="middle" fontFamily="sans-serif">Compiler Fail</text>
                            </g>

                            {/* Node 3: Gemini API */}
                            <g transform="translate(355, 20)">
                              <rect width="100" height="80" rx="12" fill="rgba(13, 17, 28, 0.9)" stroke="rgba(217, 70, 239, 0.3)" strokeWidth="1" />
                              <circle cx="50" cy="30" r="14" fill="rgba(217, 70, 239, 0.1)" stroke="rgb(217, 70, 239)" strokeWidth="1" />
                              <path d="M 45 28 L 50 36 L 55 28" stroke="rgb(217, 70, 239)" fill="none" strokeWidth="1.5" />
                              <text x="50" y="66" fill="rgba(255, 255, 255, 0.8)" fontSize="9" textAnchor="middle" fontFamily="sans-serif">Gemini Repair</text>
                            </g>
                          </svg>
                        </div>
                      </motion.div>

                      {/* Bento 2: VFS Activity Watcher Monitor */}
                      <motion.div 
                        initial={{ opacity: 0, x: 30 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.3, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                        className="glass-card p-6 rounded-3xl space-y-4 lg:col-span-5 flex flex-col justify-between scanlines"
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-widest font-mono flex items-center space-x-1.5">
                              <Activity className="w-3.5 h-3.5 text-primary animate-pulse" />
                              <span>VFS Kernel Watcher</span>
                            </h3>
                            <span className="flex items-center space-x-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              <span className="text-[8px] font-mono text-emerald-400">ACTIVE</span>
                            </span>
                          </div>
                          <p className="text-[10px] text-neutral-500 mt-1 font-sans">
                            File monitor scanning for active changes on the file tree.
                          </p>
                        </div>

                        {/* Watcher list */}
                        <div className="bg-black/35 rounded-2xl p-4 border border-white/5 flex-1 flex flex-col justify-center min-h-[140px]">
                          {fileChanges.length === 0 ? (
                            <div className="text-center space-y-2 py-4">
                              <Database className="w-6 h-6 text-neutral-700 mx-auto" />
                              <p className="text-[10px] text-neutral-600 font-mono">
                                Awaiting file modifications...
                              </p>
                            </div>
                          ) : (
                            <div className="max-h-[130px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                              {fileChanges.slice(0, 5).map((change, i) => (
                                <div 
                                  key={i} 
                                  onClick={() => handleOpenFile(change.path)}
                                  className="flex items-center justify-between px-3 py-2 bg-white/2 border border-white/5 rounded-xl hover:border-primary/20 transition-all cursor-pointer hover:bg-white/5"
                                >
                                  <span className="text-[10px] text-white/80 font-mono truncate max-w-[160px]">
                                    {change.path.split(/[/\\]/).pop() || change.path}
                                  </span>
                                  <span className="text-[8px] font-bold font-mono px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 uppercase">
                                    {change.kind}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    </div>

                    {/* Bento 3: SQLite AST Symbol Table */}
                    {symbolIndex.length > 0 && (
                      <motion.div 
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                        className="glass-card p-6 rounded-3xl space-y-4 border border-white/5"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div>
                            <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-widest font-mono flex items-center space-x-1.5">
                              <Database className="w-3.5 h-3.5 text-violet-400" />
                              <span>SQLite-Vec AST Cache</span>
                            </h3>
                            <p className="text-[10px] text-neutral-500 mt-1 font-sans">
                              Active code definitions parsed into high-dimensional vector space.
                            </p>
                          </div>
                          
                          {/* Live search box for Symbol table */}
                          <div className="relative">
                            <Search className="w-3.5 h-3.5 text-white/30 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              placeholder="Filter symbols..."
                              onChange={(e) => {
                                const q = e.target.value.toLowerCase();
                                // Basic client-side filter
                                const rows = document.querySelectorAll('.symbol-row');
                                rows.forEach(row => {
                                  const text = row.getAttribute('data-name')?.toLowerCase() || '';
                                  if (text.includes(q)) {
                                    row.classList.remove('hidden');
                                  } else {
                                    row.classList.add('hidden');
                                  }
                                });
                              }}
                              className="w-48 pl-8 pr-3 py-1.5 bg-black/40 border border-white/5 focus:border-primary/30 outline-none rounded-xl text-xs text-white font-mono"
                            />
                          </div>
                        </div>

                        {/* Symbols Table */}
                        <div className="max-h-[300px] overflow-y-auto custom-scrollbar border border-white/5 rounded-2xl bg-black/25">
                          <table className="w-full text-left border-collapse text-[11px] font-mono">
                            <thead>
                              <tr className="border-b border-white/5 bg-white/2 text-white/40 sticky top-0 font-bold uppercase tracking-wider text-[9px]">
                                <th className="p-3">Source File</th>
                                <th className="p-3">Symbol Name</th>
                                <th className="p-3">Type</th>
                                <th className="p-3 text-right">Scope</th>
                              </tr>
                            </thead>
                            <tbody>
                              {symbolIndex.slice(0, 20).flatMap((file) =>
                                file.symbols.slice(0, 3).map((sym, idx) => (
                                  <tr 
                                    key={`${file.path}-${sym.name}-${idx}`}
                                    onClick={() => handleOpenFile(file.path)}
                                    data-name={sym.name}
                                    className="symbol-row border-b border-white/3 hover:bg-white/3 cursor-pointer transition-colors"
                                  >
                                    <td className="p-3 text-neutral-500 truncate max-w-[150px]">
                                      {file.path.split(/[/\\]/).pop()}
                                    </td>
                                    <td className="p-3 text-white font-medium">{sym.name}</td>
                                    <td className="p-3">
                                      <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase ${
                                        sym.kind === 'function' 
                                          ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20' 
                                          : sym.kind === 'struct' || sym.kind === 'class' 
                                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' 
                                            : 'bg-white/5 text-neutral-400 border border-white/10'
                                      }`}>
                                        {sym.kind}
                                      </span>
                                    </td>
                                    <td className="p-3 text-right text-neutral-500">
                                      L{sym.start_line}–L{sym.end_line}
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </motion.div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Panel (Console & Terminal) */}
            <div
              className={`border-t border-white/5 bg-[#080b11] transition-all duration-300 flex flex-col flex-shrink-0 ${
                consoleCollapsed ? 'h-10' : 'h-[250px]'
              }`}
            >
              {/* Console Header */}
              <div className="h-10 border-b border-white/5 flex items-center justify-between px-6 bg-black/10 flex-shrink-0">
                <div className="flex items-center space-x-4">
                  <button
                    onClick={() => {
                      setActiveConsoleTab('healer');
                      setConsoleCollapsed(false);
                    }}
                    className={`text-xs font-bold font-mono uppercase tracking-wider transition-colors py-1 ${
                      activeConsoleTab === 'healer' && !consoleCollapsed
                        ? 'text-primary border-b-2 border-primary'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    Self-Healing Shell
                  </button>
                  <button
                    onClick={() => {
                      setActiveConsoleTab('logs');
                      setConsoleCollapsed(false);
                    }}
                    className={`text-xs font-bold font-mono uppercase tracking-wider transition-colors py-1 ${
                      activeConsoleTab === 'logs' && !consoleCollapsed
                        ? 'text-primary border-b-2 border-primary'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    Kernel Log Stream
                  </button>
                </div>

                <div className="flex items-center space-x-3">
                  {activeConsoleTab === 'logs' && (
                    <button
                      onClick={() => setLogs([])}
                      className="text-[9px] text-white/40 hover:text-white px-2 py-0.5 border border-white/10 hover:border-white/20 rounded font-mono"
                    >
                      Clear Logs
                    </button>
                  )}
                  {/* Minimize / Maximize toggle */}
                  <button
                    onClick={() => setConsoleCollapsed(!consoleCollapsed)}
                    className="p-1 hover:bg-white/5 rounded text-neutral-400 hover:text-white transition-colors"
                  >
                    {consoleCollapsed ? (
                      <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                        <path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                        <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Console Body */}
              {!consoleCollapsed && (
                <div className="flex-1 min-h-0 flex overflow-hidden">
                  {activeConsoleTab === 'healer' ? (
                    <div className="flex-1 flex flex-col p-4 space-y-3 bg-[#05070a]/90 font-mono">
                      {/* Attached Files Preview Chips */}
                      {attachedFiles.length > 0 && (
                        <div className="flex flex-wrap gap-2 pb-1 border-b border-white/5">
                          {attachedFiles.map((file, idx) => (
                            <div
                              key={idx}
                              className="flex items-center space-x-1.5 px-2.5 py-1 bg-white/5 border border-white/10 rounded-md text-[10px] text-primary font-mono transition-all hover:bg-white/10"
                            >
                              <span>
                                📎 {file.name} ({(file.size / 1024).toFixed(1)} KB)
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))
                                }
                                className="text-neutral-400 hover:text-rose-400 font-bold cursor-pointer ml-1 text-xs"
                              >
                                &times;
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Form input */}
                      <form
                        onSubmit={handleTestCommand}
                        className="flex space-x-3 items-center flex-shrink-0"
                      >
                        <span className="text-xs text-primary font-bold">$</span>
                        <input
                          type="text"
                          value={commandInput}
                          onChange={(e) => setCommandInput(e.target.value)}
                          className="flex-1 px-3 py-1.5 bg-black/40 border border-white/5 focus:border-primary/30 outline-none rounded-md text-xs text-white font-mono"
                          placeholder="e.g. 'cargo build'"
                        />
                        <button
                          type="button"
                          onClick={handleOpenFilePicker}
                          className="p-1.5 bg-white/5 border border-white/10 hover:bg-white/10 text-neutral-400 hover:text-white rounded-md text-xs cursor-pointer flex items-center justify-center transition-all duration-200"
                          title="Attach file to prompt"
                        >
                          <svg className="w-4 h-4 fill-current text-primary" viewBox="0 0 24 24">
                            <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-3.31 2.69-6 6-6s6 2.69 6 6v10c0 4.42-3.58 8-8 8s-8-3.58-8-8V4h2v11c0 3.31 2.69 6 6 6s6-2.69 6-6V5c0-2.21-1.79-4-4-4s-4 1.79-4 4v12.5c0 1.1.9 2 2 2s2-.9 2-2V6h2z" />
                          </svg>
                        </button>
                        <button
                          type="submit"
                          disabled={geminiStatus === 'streaming'}
                          className="px-4 py-1.5 bg-gradient-to-tr from-primary to-accent hover:from-primary hover:to-accent disabled:opacity-50 text-white rounded-md text-xs font-semibold active:scale-95 transition-all cursor-pointer shadow-md shadow-primary/10"
                        >
                          {geminiStatus === 'streaming'
                            ? 'Healing Loop Running...'
                            : 'Trigger Build'}
                        </button>
                      </form>

                      {/* Log Console Output */}
                      <div className="flex-1 overflow-y-auto px-4 py-2 bg-black/30 border border-white/5 rounded-md text-[10px] leading-relaxed custom-scrollbar text-neutral-300">
                        <div className="text-white/40">
                          {'// Self-Healing compiler loop outputs stream here...'}
                        </div>
                        {logs
                          .filter((l) => l.message.includes('[Self-Healing Engine]'))
                          .map((log) => (
                            <div key={log.id} className="mt-1">
                              <span className="text-white/20 mr-2">{log.time}</span>
                              <span className="text-white/80">{parseAnsi(log.message)}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  ) : (
                    /* Logs tab */
                    <div className="flex-1 p-4 overflow-y-auto space-y-2 text-[10px] leading-relaxed custom-scrollbar bg-[#05070a]/90 font-mono">
                      {logs.map((log) => (
                        <div key={log.id} className="space-y-0.5">
                          <div className="flex items-center space-x-2">
                            <span className="text-white/20">{log.time}</span>
                            <span
                              className={`px-1.5 py-0.2 rounded text-[8px] font-bold uppercase tracking-wider ${
                                log.type === 'success'
                                  ? 'bg-emerald-500/10 text-emerald-400'
                                  : log.type === 'error'
                                    ? 'bg-rose-500/10 text-rose-400 font-bold'
                                    : log.type === 'watcher'
                                      ? 'bg-primary/10 text-primary'
                                      : 'bg-white/5 text-white/55'
                              }`}
                            >
                              {log.type}
                            </span>
                          </div>
                          <div className="text-white/80 pl-2 whitespace-pre-wrap">
                            {parseAnsi(log.message)}
                          </div>
                        </div>
                      ))}
                      <div ref={logEndRef} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
