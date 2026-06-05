import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke, Channel } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './index.css';
import { FileExplorer } from './components/FileExplorer';
import { MonacoEditor } from './components/MonacoEditor';

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
            'text-cyan-400', // 36: cyan
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

type SidebarTab = 'explorer' | 'search' | 'settings';
type ConsoleTab = 'healer' | 'logs';

const App: React.FC = () => {
  // Navigation & UI Layout Tabs
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>('explorer');
  const [activeConsoleTab, setActiveConsoleTab] = useState<ConsoleTab>('healer');
  const [consoleCollapsed, setConsoleCollapsed] = useState<boolean>(false);

  // Core App States
  const [kernelStatus, setKernelStatus] = useState<'connecting' | 'active' | 'disconnected'>(
    'connecting'
  );
  const [geminiStatus, setGeminiStatus] = useState<'idle' | 'streaming' | 'success' | 'error'>(
    'idle'
  );
  const [workspaceRoot, setWorkspaceRoot] = useState<string>('D:\\Project\\Antigravity SDK');
  const [apiToken, setApiToken] = useState<string>('••••••••••••••••••••••••');
  const [commandInput, setCommandInput] = useState<string>('cargo build --release');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [fileChanges, setFileChanges] = useState<FileChangeEvent[]>([]);
  const [symbolIndex, setSymbolIndex] = useState<FileSymbols[]>([]);
  const [watcherActive, setWatcherActive] = useState(false);
  
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
        { id: '1', time: '16:12:02', type: 'info', message: 'Antigravity workspace kernel booting (Browser Mock)...' },
        { id: '2', time: '16:12:03', type: 'success', message: 'Tauri v2 IPC communication channel established.' },
        { id: '3', time: '16:12:03', type: 'info', message: 'Windows ReadDirectoryChangesW watcher hooked to workspace root.' },
        { id: '4', time: '16:12:04', type: 'success', message: 'sqlite-vec v0.1.9 database loaded with 768-dimension configuration.' },
        { id: '5', time: '16:12:04', type: 'info', message: 'Tree-sitter scanning active. Found 42 source files.' },
        { id: '6', time: '16:12:05', type: 'success', message: 'Workspace index populated (287 nodes, 72 functions, 14 structs).' },
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
      const payload = await invoke<{ workspace_root: string; has_key: boolean }>('get_config');
      setWorkspaceRoot(payload.workspace_root);
      if (payload.has_key) {
        setApiToken('••••••••••••••••••••••••');
      } else {
        setApiToken('');
      }
    } catch (e) {
      console.error('Failed to load configuration:', e);
    }
  }, []);

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
  }, [loadBackendLogs, loadConfig, loadSymbols]);

  // IPC Event Listeners
  useEffect(() => {
    let unlistenWatcher: (() => void) | null = null;
    let unlistenLogs: (() => void) | null = null;
    let unlistenIndex: (() => void) | null = null;

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
    };

    setupListeners();

    return () => {
      if (unlistenWatcher) unlistenWatcher();
      if (unlistenLogs) unlistenLogs();
      if (unlistenIndex) unlistenIndex();
    };
  }, [loadSymbols]);

  // File loading FFI
  const handleOpenFile = async (filePath: string) => {
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
      addLog('watcher', `VFS: Loaded code buffer for ${filePath.split('\\').pop() || filePath.split('/').pop()}`);
    } catch (err: any) {
      addLog('error', `VFS Error: Failed to open file: ${err}`);
    }
  };

  // File save FFI
  const handleSaveActiveFile = async () => {
    if (!activeFilePath) return;
    try {
      await invoke('write_workspace_file_cmd', { path: activeFilePath, content: activeFileContent });
      setOriginalFileContent(activeFileContent);
      addLog('success', `VFS: Saved modifications to disk for ${activeFilePath.split('\\').pop() || activeFilePath.split('/').pop()}`);
    } catch (err: any) {
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

  // Trigger self-healing compiler loop
  const handleTestCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim()) return;

    setGeminiStatus('streaming');
    isStreamingGeminiRef.current = true;
    
    // Clear console logs of previous build attempts
    addLog('info', `Self-Healing: Spawning recursive builder for [${commandInput}]...`);

    if (!isTauri) {
      setTimeout(() => {
        addLog('success', 'Self-Healing Loop (Browser Mock) successfully compiled after 1 healing iteration.');
        setGeminiStatus('success');
        isStreamingGeminiRef.current = false;
      }, 2000);
      return;
    }

    const channel = new Channel<string>();
    channel.onmessage = (message) => {
      // Print build stream directly to our logs panel
      const type = message.includes('failed') || message.includes('Error')
        ? 'error'
        : message.includes('passed') || message.includes('Auto-committed')
          ? 'success'
          : 'gemini';
      addLog(type, message);
    };

    try {
      const res = await invoke<string>('execute_command_stream', {
        command: commandInput,
        channel,
      });
      addLog('success', `Self-Healing Loop Result: ${res}`);
      setGeminiStatus('success');
    } catch (err: any) {
      addLog('error', `Self-Healing Loop Aborted: ${err}`);
      setGeminiStatus('error');
    } finally {
      isStreamingGeminiRef.current = false;
      loadSymbols();
    }
  };

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
    } catch (e: any) {
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
    } catch (e: any) {
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
        apiToken,
      });
      addLog('success', `Configuration: ${res}`);
      loadConfig();
    } catch (e: any) {
      addLog('error', `Configuration Error: Save settings failed: ${e}`);
    }
  };

  const hasUnsavedChanges = activeFilePath && activeFileContent !== originalFileContent;

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden bg-[#07090e] text-white select-none">
      {/* 1. Header Navigation Bar */}
      <header className="h-14 flex items-center justify-between px-6 bg-[#0c0f16]/90 border-b border-white/5 backdrop-blur-md z-10 flex-shrink-0 select-none">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-violet-600 flex items-center justify-center font-bold text-white tracking-widest text-sm shadow-md shadow-cyan-500/20">
            AG
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-wider bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-violet-400">
              ANTIGRAVITY WORKSPACE
            </h1>
            <p className="text-[10px] font-mono text-white/40">v2.0.0 Stable Kernel (Bleeding Edge)</p>
          </div>
        </div>

        {/* Workspace state and connection status */}
        <div className="flex items-center space-x-6">
          {activeFilePath && (
            <div className="hidden md:flex items-center space-x-2 bg-white/5 border border-white/5 px-3 py-1 rounded-md text-xs font-mono text-cyan-400">
              <span className={`w-2 h-2 rounded-full ${hasUnsavedChanges ? 'bg-amber-400 animate-pulse' : 'bg-cyan-400'}`} />
              <span className="max-w-[200px] truncate">
                {activeFilePath.split('\\').pop() || activeFilePath.split('/').pop()}
              </span>
              {hasUnsavedChanges && <span className="text-[9px] text-amber-400">(unsaved)</span>}
            </div>
          )}

          <div className="flex items-center space-x-4 text-xs font-mono">
            <div className="flex items-center space-x-1.5">
              <span className="text-white/30">VFS:</span>
              <span className="text-white/60">{workspaceRoot}</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className={`w-2 h-2 rounded-full ${kernelStatus === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
              <span className="text-white/70 uppercase text-[10px] tracking-wider">
                {kernelStatus === 'active' ? 'Active' : 'Offline'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* 2. Main Workbench Body */}
      <div className="flex-1 flex overflow-hidden w-full relative">
        
        {/* Activity Toolbar (Left Icons) */}
        <div className="w-[50px] border-r border-white/5 bg-[#090d13]/85 flex flex-col items-center py-4 space-y-4 flex-shrink-0">
          <button
            onClick={() => setActiveSidebarTab('explorer')}
            className={`p-2.5 rounded-lg transition-all duration-300 relative group ${
              activeSidebarTab === 'explorer'
                ? 'text-cyan-400 bg-cyan-500/10'
                : 'text-neutral-400 hover:text-white hover:bg-white/5'
            }`}
            title="Workspace File Explorer"
          >
            <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
              <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
            </svg>
            <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-black/80 px-2.5 py-1 text-[10px] font-semibold text-white rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-30">
              File Explorer
            </div>
          </button>

          <button
            onClick={() => setActiveSidebarTab('search')}
            className={`p-2.5 rounded-lg transition-all duration-300 relative group ${
              activeSidebarTab === 'search'
                ? 'text-cyan-400 bg-cyan-500/10'
                : 'text-neutral-400 hover:text-white hover:bg-white/5'
            }`}
            title="Semantic Code Search"
          >
            <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
              <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
            </svg>
            <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-black/80 px-2.5 py-1 text-[10px] font-semibold text-white rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-30">
              Semantic Search
            </div>
          </button>

          <button
            onClick={() => setActiveSidebarTab('settings')}
            className={`p-2.5 rounded-lg transition-all duration-300 relative group ${
              activeSidebarTab === 'settings'
                ? 'text-cyan-400 bg-cyan-500/10'
                : 'text-neutral-400 hover:text-white hover:bg-white/5'
            }`}
            title="IDE Configuration Settings"
          >
            <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
            </svg>
            <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-black/80 px-2.5 py-1 text-[10px] font-semibold text-white rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-30">
              IDE Settings
            </div>
          </button>
        </div>

        {/* Sidebar Expansion Pane */}
        <aside className="w-[280px] border-r border-white/5 bg-[#090d13]/40 flex flex-col flex-shrink-0 z-0">
          {activeSidebarTab === 'explorer' && (
            <FileExplorer
              workspaceRoot={workspaceRoot}
              onFileSelect={handleOpenFile}
              activeFilePath={activeFilePath}
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
                      className="w-full px-3 py-2 bg-black/40 border border-white/10 focus:border-cyan-500/50 outline-none rounded-lg text-xs text-white font-mono"
                      placeholder="e.g. 'watcher config'..."
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSearching || !searchQuery.trim()}
                    className="w-full py-2 bg-gradient-to-tr from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold active:scale-95 transition-all cursor-pointer shadow-md shadow-cyan-500/10"
                  >
                    {isSearching ? 'Searching...' : 'Execute Vector Search'}
                  </button>

                  <div className="space-y-3 pt-2 text-[11px] text-white/50 border-t border-white/5">
                    <div className="flex justify-between">
                      <span>Threshold:</span>
                      <span className="font-semibold text-cyan-400 font-mono">
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
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400"
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
                          className="p-2.5 bg-white/3 border border-white/5 hover:border-cyan-500/30 rounded-lg flex flex-col space-y-1 hover:bg-cyan-500/5 transition-all duration-200 cursor-pointer"
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
                      className="w-full px-3 py-2 bg-black/40 border border-white/10 focus:border-cyan-500/50 outline-none rounded-lg text-xs text-white font-mono"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold text-white/40 uppercase tracking-wider block">
                      Gemini API Key
                    </label>
                    <input
                      type="password"
                      value={apiToken}
                      onChange={(e) => setApiToken(e.target.value)}
                      className="w-full px-3 py-2 bg-black/40 border border-white/10 focus:border-cyan-500/50 outline-none rounded-lg text-xs text-white font-mono"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-white/5">
                  <button
                    onClick={handleSaveConfig}
                    className="w-full py-2.5 bg-gradient-to-tr from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-lg text-xs font-semibold active:scale-95 transition-all cursor-pointer shadow-md shadow-cyan-500/10"
                  >
                    Save Settings
                  </button>
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
                      const tabName = tabPath.split('\\').pop() || tabPath.split('/').pop() || 'File';
                      const isUnsaved = tabPath === activeFilePath && hasUnsavedChanges;
                      
                      return (
                        <div
                          key={tabPath}
                          onClick={() => handleOpenFile(tabPath)}
                          className={`group h-full flex items-center px-4 border-r border-white/5 cursor-pointer transition-all duration-200 select-none relative ${
                            isActive
                              ? 'bg-[#090d13] text-cyan-400 font-semibold'
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
                            <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-cyan-400 to-blue-500 shadow-md shadow-cyan-400" />
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
                    />
                  </div>
                </div>
              ) : (
                /* IDE Backdrop Dashboard (When no file is open) */
                <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar bg-radial-gradient">
                  <div className="max-w-4xl mx-auto space-y-8">
                    {/* Welcome Telemetry Banner */}
                    <div className="glass-panel p-8 rounded-2xl flex flex-col md:flex-row md:items-center justify-between relative overflow-hidden border border-white/5">
                      <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-cyan-500/5 rounded-full blur-[100px] pointer-events-none" />
                      <div className="space-y-2 relative">
                        <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-[9px] font-bold uppercase tracking-wider font-mono">
                          IDE Workspace Active
                        </span>
                        <h2 className="text-xl font-bold tracking-tight text-white">
                          Double-compile Self-Healing Engine
                        </h2>
                        <p className="text-xs text-white/50 max-w-md leading-relaxed">
                          Select any file in the Sidebar File Explorer to initialize Monaco workspace compiler contexts. Write code and compile natively in real-time.
                        </p>
                      </div>
                      
                      <div className="mt-4 md:mt-0 flex space-x-3 flex-shrink-0">
                        <button
                          onClick={handleReindex}
                          disabled={isIndexing}
                          className="px-5 py-2.5 bg-gradient-to-tr from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-xl text-xs font-semibold active:scale-95 transition-all shadow-md shadow-cyan-500/20 cursor-pointer"
                        >
                          {isIndexing ? 'Indexing...' : 'Index Workspace'}
                        </button>
                      </div>
                    </div>

                    {/* Flowchart Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Self healing flowchart */}
                      <div className="glass-panel p-6 rounded-xl space-y-4">
                        <h3 className="text-sm font-semibold text-white">Compiler Self-Healing Flowchart</h3>
                        
                        <div className="flex items-center justify-between py-2 font-mono text-[10px]">
                          {/* Node 1 */}
                          <div className="flex flex-col items-center space-y-2">
                            <div className="w-11 h-11 rounded-full bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                              <svg className="w-5.5 h-5.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                              </svg>
                            </div>
                            <span className="text-[10px] text-white">Dev Workspace</span>
                          </div>

                          <div className="flex-1 border-t border-dashed border-white/10 mx-2" />

                          {/* Node 2 */}
                          <div className="flex flex-col items-center space-y-2">
                            <div className="w-11 h-11 rounded-full bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400">
                              <svg className="w-5.5 h-5.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                            </div>
                            <span className="text-[10px] text-white">Compile Fail</span>
                          </div>

                          <div className="flex-1 border-t border-dashed border-white/10 mx-2" />

                          {/* Node 3 */}
                          <div className="flex flex-col items-center space-y-2">
                            <div className="w-11 h-11 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                              <svg className="w-5.5 h-5.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 01-2 2h0a2 2 0 01-2 2h-2.5" />
                              </svg>
                            </div>
                            <span className="text-[10px] text-white">Gemini API</span>
                          </div>

                          <div className="flex-1 border-t border-dashed border-white/10 mx-2" />

                          {/* Node 4 */}
                          <div className="flex flex-col items-center space-y-2">
                            <div className="w-11 h-11 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                              <svg className="w-5.5 h-5.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </div>
                            <span className="text-[10px] text-white">Auto Commit</span>
                          </div>
                        </div>
                      </div>

                      {/* File watcher activity stream */}
                      <div className="glass-panel p-6 rounded-xl space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold text-white">VFS File Watcher Monitor</h3>
                          <div className="flex items-center space-x-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${watcherActive ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                            <span className="text-[9px] font-mono text-white/40">
                              {watcherActive ? 'Crawl Active' : 'Idle'}
                            </span>
                          </div>
                        </div>
                        {fileChanges.length === 0 ? (
                          <p className="text-xs text-white/30 text-center py-6">
                            No file watch changes recorded.
                          </p>
                        ) : (
                          <div className="max-h-[160px] overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                            {fileChanges.slice(0, 10).map((fc, i) => (
                              <div key={i} className="flex items-center justify-between px-2.5 py-1.5 bg-black/20 border border-white/5 rounded-md">
                                <span className="text-[10px] text-white/70 font-mono truncate max-w-[200px]">
                                  {fc.path.split('\\').pop() || fc.path.split('/').pop()}
                                </span>
                                <span className="text-[9px] text-cyan-400 font-mono uppercase font-bold">
                                  {fc.kind}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Symbol list table */}
                    {symbolIndex.length > 0 && (
                      <div className="glass-panel p-6 rounded-xl space-y-4">
                        <h3 className="text-sm font-semibold text-white">AST Code Symbol cache (sqlite-vec)</h3>
                        <div className="max-h-[300px] overflow-y-auto custom-scrollbar border border-white/5 rounded-lg">
                          <table className="w-full text-left border-collapse text-[11px]">
                            <thead>
                              <tr className="border-b border-white/5 bg-white/3 font-mono uppercase text-white/40 sticky top-0">
                                <th className="p-3">File path</th>
                                <th className="p-3">Symbol</th>
                                <th className="p-3">Kind</th>
                                <th className="p-3 text-right">Scope Lines</th>
                              </tr>
                            </thead>
                            <tbody className="font-mono text-white/70">
                              {symbolIndex.slice(0, 50).flatMap((file) =>
                                file.symbols.slice(0, 5).map((sym, j) => (
                                  <tr key={`${file.path}-${j}`} className="border-b border-white/3 hover:bg-white/3">
                                    <td className="p-3 text-white/40 truncate max-w-[150px]">
                                      {file.path.split('\\').pop() || file.path.split('/').pop()}
                                    </td>
                                    <td className="p-3 text-white font-semibold">{sym.name}</td>
                                    <td className="p-3">
                                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${
                                        sym.kind === 'function'
                                          ? 'bg-violet-500/15 text-violet-400'
                                          : sym.kind === 'struct' || sym.kind === 'class'
                                            ? 'bg-amber-500/15 text-amber-400'
                                            : 'bg-white/10 text-white/50'
                                      }`}>
                                        {sym.kind}
                                      </span>
                                    </td>
                                    <td className="p-3 text-right text-white/30">
                                      L{sym.start_line}–{sym.end_line}
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Panel (Console & Terminal) */}
            <div className={`border-t border-white/5 bg-[#080b11] transition-all duration-300 flex flex-col flex-shrink-0 ${
              consoleCollapsed ? 'h-10' : 'h-[250px]'
            }`}>
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
                        ? 'text-cyan-400 border-b-2 border-cyan-400'
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
                        ? 'text-cyan-400 border-b-2 border-cyan-400'
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
                      {/* Form input */}
                      <form onSubmit={handleTestCommand} className="flex space-x-3 items-center flex-shrink-0">
                        <span className="text-xs text-cyan-400 font-bold">$</span>
                        <input
                          type="text"
                          value={commandInput}
                          onChange={(e) => setCommandInput(e.target.value)}
                          className="flex-1 px-3 py-1.5 bg-black/40 border border-white/5 focus:border-cyan-500/30 outline-none rounded-md text-xs text-white font-mono"
                          placeholder="e.g. 'cargo build'"
                        />
                        <button
                          type="submit"
                          disabled={geminiStatus === 'streaming'}
                          className="px-4 py-1.5 bg-gradient-to-tr from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 text-white rounded-md text-xs font-semibold active:scale-95 transition-all cursor-pointer shadow-md shadow-cyan-500/10"
                        >
                          {geminiStatus === 'streaming' ? 'Healing Loop Running...' : 'Trigger Build'}
                        </button>
                      </form>
                      
                      {/* Log Console Output */}
                      <div className="flex-1 overflow-y-auto px-4 py-2 bg-black/30 border border-white/5 rounded-md text-[10px] leading-relaxed custom-scrollbar text-neutral-300">
                        <div className="text-white/40">// Self-Healing compiler loop outputs stream here...</div>
                        {logs.filter(l => l.message.includes('[Self-Healing Engine]')).map((log) => (
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
                            <span className={`px-1.5 py-0.2 rounded text-[8px] font-bold uppercase tracking-wider ${
                              log.type === 'success'
                                ? 'bg-emerald-500/10 text-emerald-400'
                                : log.type === 'error'
                                  ? 'bg-rose-500/10 text-rose-400 font-bold'
                                  : log.type === 'watcher'
                                    ? 'bg-cyan-500/10 text-cyan-400'
                                    : 'bg-white/5 text-white/55'
                            }`}>
                              {log.type}
                            </span>
                          </div>
                          <div className="text-white/80 pl-2 whitespace-pre-wrap">{parseAnsi(log.message)}</div>
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
