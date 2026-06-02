import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import './index.css';

interface LogEntry {
  id: string;
  time: string;
  type: 'info' | 'success' | 'warn' | 'error' | 'gemini';
  message: string;
}

// Detect if running inside the Tauri WebView environment
const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'compiler' | 'vectors' | 'config'>('overview');
  const [kernelStatus, setKernelStatus] = useState<'connecting' | 'active' | 'disconnected'>('connecting');
  const [geminiStatus, setGeminiStatus] = useState<'idle' | 'streaming' | 'success' | 'error'>('idle');
  const [workspaceRoot, setWorkspaceRoot] = useState<string>('D:\\Project\\Antigravity SDK');
  const [apiToken, setApiToken] = useState<string>('••••••••••••••••••••••••');
  const [commandInput, setCommandInput] = useState<string>('cargo build --release');
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const logEndRef = useRef<HTMLDivElement>(null);

  // Helper to append a log line locally
  const addLog = (type: LogEntry['type'], message: string) => {
    const time = new Date().toTimeString().split(' ')[0] || '';
    setLogs((prev) => [...prev, { id: Math.random().toString(), time, type, message }]);
  };

  // Helper to load logs from the Rust backend state
  const loadBackendLogs = async () => {
    if (!isTauri) {
      // Fallback default logs for browser view
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
        type: msg.includes('failed') || msg.includes('error') 
          ? 'error' 
          : msg.includes('passed') || msg.includes('established') || msg.includes('loaded') || msg.includes('populated')
          ? 'success' 
          : msg.includes('Gemini') || msg.includes('Inference')
          ? 'gemini'
          : 'info' as LogEntry['type'],
        message: msg
      }));
      setLogs(mapped);
      setKernelStatus('active');
    } catch (err) {
      addLog('error', `Failed to load logs from backend: ${err}`);
      setKernelStatus('disconnected');
    }
  };

  useEffect(() => {
    loadBackendLogs();

    // Verify Tauri Connection Bridge via Ping
    if (isTauri) {
      invoke<string>('ping')
        .then((res) => {
          addLog('success', `Tauri Bridge Ping: Received "${res}" from Rust backend.`);
        })
        .catch((err) => {
          addLog('error', `Tauri Bridge Ping Failed: ${err}`);
        });
    }
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleTestCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim()) return;

    addLog('info', `Executing: "${commandInput}" inside sandboxed process container...`);
    setGeminiStatus('streaming');

    if (isTauri) {
      try {
        await invoke<string>('execute_command', { command: commandInput });
        setGeminiStatus('success');
        // Reload logs from backend to capture compiler output stream details
        await loadBackendLogs();
      } catch (err) {
        addLog('error', `Command execution failed: ${err}`);
        setGeminiStatus('error');
      }
    } else {
      // Browser Mock Timeout Simulation
      setTimeout(() => {
        addLog('error', `Command failed with exit code: 1. Captured stderr: "error[E0308]: mismatched types in src/backend/main.rs:24"`);
        addLog('gemini', 'Inference dispatch: Requesting Gemini 1.5 Pro to analyze mismatch and rewrite AST...');
        
        setTimeout(() => {
          addLog('gemini', 'Gemini synthesized patch: Resolved mismatched type signature in src/backend/main.rs:L24.');
          addLog('success', 'Self-Healing Engine: Modified src/backend/main.rs and applied zero-copy code mutation.');
          addLog('info', 'Re-executing sandboxed compilation check...');
          
          setTimeout(() => {
            addLog('success', 'Compilation passed cleanly! Self-healing loop completed in 1.84s.');
            setGeminiStatus('success');
          }, 800);
        }, 1200);
      }, 1000);
    }
  };

  const handleSaveConfig = async () => {
    if (isTauri) {
      try {
        const res = await invoke<string>('save_config', { 
          workspaceRoot: workspaceRoot, 
          apiToken: apiToken 
        });
        addLog('success', `Save Config Response: ${res}`);
        await loadBackendLogs();
      } catch (err) {
        addLog('error', `Failed to save configuration: ${err}`);
      }
    } else {
      addLog('success', 'Configuration options updated (Browser Mock).');
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden select-none">
      {/* Background decoration */}
      <div className="absolute top-1/4 left-1/4 w-[350px] h-[350px] rounded-full glowing-core glowing-bg -z-10" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full glowing-core glowing-bg -z-10" />

      {/* Main Container */}
      <div className="flex w-full h-full glass-panel">
        
        {/* Left Sidebar */}
        <div className="w-[280px] border-r border-white/5 flex flex-col justify-between bg-black/25">
          <div>
            {/* Header Brand */}
            <div className="p-6 flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                <span className="font-bold text-sm tracking-wider">AG</span>
              </div>
              <div>
                <h1 className="font-extrabold text-base tracking-tight text-white">Antigravity</h1>
                <p className="text-[10px] text-white/40 tracking-widest font-mono uppercase">Workspace v0.1.0</p>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="px-4 py-2 space-y-1">
              {[
                { id: 'overview', label: 'Dashboard Overview', icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6z M14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z M4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4z M14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z' },
                { id: 'compiler', label: 'Self-Healing Engine', icon: 'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z' },
                { id: 'vectors', label: 'sqlite-vec Indexer', icon: 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z' },
                { id: 'config', label: 'System Configuration', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm transition-all duration-200 outline-none ${
                    activeTab === tab.id
                      ? 'bg-white/10 text-white font-medium shadow-inner'
                      : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <svg className="w-5 h-5 opacity-80" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
                  </svg>
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* System Kernel Health */}
          <div className="p-6 border-t border-white/5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/50">Rust Async Kernel</span>
              <div className="flex items-center space-x-2">
                <span className={`w-2.5 h-2.5 rounded-full ${
                  kernelStatus === 'active' 
                    ? 'bg-emerald-500 status-active animate-pulse' 
                    : kernelStatus === 'connecting' 
                    ? 'bg-amber-500 status-connecting animate-pulse' 
                    : 'bg-red-500 status-error'
                }`} />
                <span className="text-xs font-mono font-medium capitalize text-white">{kernelStatus}</span>
              </div>
            </div>
            <button
              onClick={() => {
                setKernelStatus(prev => prev === 'active' ? 'disconnected' : 'active');
                addLog('warn', `Kernel status updated manually.`);
              }}
              className="w-full text-center py-2 border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 active:scale-95 rounded-lg text-xs font-medium text-white transition-all cursor-pointer"
            >
              Toggle Connection
            </button>
          </div>
        </div>

        {/* Middle Main Panel */}
        <div className="flex-1 flex flex-col overflow-hidden bg-black/5">
          {/* Header Panel */}
          <div className="h-20 border-b border-white/5 flex items-center justify-between px-8 bg-black/10">
            <div>
              <h2 className="text-lg font-bold text-white capitalize">
                {activeTab === 'overview' ? 'Dashboard Overview' : activeTab === 'compiler' ? 'Self-Healing Loop' : activeTab === 'vectors' ? 'sqlite-vec Index' : 'System Configuration'}
              </h2>
              <p className="text-xs text-white/40">Real-time status monitor and diagnostics control panel</p>
            </div>
            
            {/* Quick Metrics */}
            <div className="flex items-center space-x-8 font-mono">
              <div className="text-right">
                <span className="text-[10px] text-white/40 uppercase block">AST Mapped</span>
                <span className="text-sm font-semibold text-white">42 Files</span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-white/40 uppercase block">Local DB</span>
                <span className="text-sm font-semibold text-white">287 Nodes</span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-white/40 uppercase block">Embeddings</span>
                <span className="text-sm font-semibold text-emerald-400">768 Dim</span>
              </div>
            </div>
          </div>

          {/* Tab Content Panels */}
          <div className="flex-1 overflow-y-auto p-8 space-y-6">
            
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* Intro Cards */}
                <div className="grid grid-cols-3 gap-6">
                  <div className="glass-card p-6 rounded-xl space-y-3">
                    <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 009 11.5V9m1.277-3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <h3 className="font-semibold text-white">OS Keyring Integration</h3>
                    <p className="text-xs text-white/50 leading-relaxed">Gemini API credentials are pulled on-demand directly from the secure platform keychain Manager without writing to disk.</p>
                  </div>
                  <div className="glass-card p-6 rounded-xl space-y-3">
                    <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center text-violet-400">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12a7.5 7.5 0 0015 0m-15 0a7.5 7.5 0 1115 0m-15 0H3m16.5 0H21m-1.5 0H12m-8.457 3.077l1.41-.513m14.095-5.13l1.41-.513M5.106 17.785l1.15-.827m11.379-8.16l1.15-.827" />
                      </svg>
                    </div>
                    <h3 className="font-semibold text-white">Tree-Sitter Parser</h3>
                    <p className="text-xs text-white/50 leading-relaxed">Computes concrete syntax trees instantly to detect functions, classes, and scopes for highly granular coding adjustments.</p>
                  </div>
                  <div className="glass-card p-6 rounded-xl space-y-3">
                    <div className="w-10 h-10 rounded-lg bg-pink-500/10 flex items-center justify-center text-pink-400">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                    <h3 className="font-semibold text-white">Self-Healing compiler</h3>
                    <p className="text-xs text-white/50 leading-relaxed">Monitors compilation logs in an isolated thread sandbox. Triggers dynamic AI code modifications on compiler failures.</p>
                  </div>
                </div>

                {/* System Process Diagram */}
                <div className="glass-panel p-6 rounded-xl space-y-4">
                  <h3 className="text-sm font-semibold text-white">System Architecture Control Loop</h3>
                  <div className="w-full flex items-center justify-between py-8 px-12 border border-white/5 bg-black/10 rounded-lg">
                    {/* Node 1 */}
                    <div className="flex flex-col items-center space-y-2">
                      <div className="w-12 h-12 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <span className="text-xs font-semibold text-white">Code Editor</span>
                    </div>

                    <div className="flex-1 border-t-2 border-dashed border-white/10 mx-4 relative">
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] font-mono text-white/30">Edit</span>
                    </div>

                    {/* Node 2 */}
                    <div className="flex flex-col items-center space-y-2">
                      <div className="w-12 h-12 rounded-full bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                      </div>
                      <span className="text-xs font-semibold text-white">Compilation Fail</span>
                    </div>

                    <div className="flex-1 border-t-2 border-dashed border-white/10 mx-4 relative">
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] font-mono text-white/30">Stderr</span>
                    </div>

                    {/* Node 3 */}
                    <div className="flex flex-col items-center space-y-2">
                      <div className="w-12 h-12 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 01-2 2h0a2 2 0 01-2-2v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                      </div>
                      <span className="text-xs font-semibold text-white">Gemini API</span>
                    </div>

                    <div className="flex-1 border-t-2 border-dashed border-white/10 mx-4 relative">
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] font-mono text-white/30">Patch</span>
                    </div>

                    {/* Node 4 */}
                    <div className="flex flex-col items-center space-y-2">
                      <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 animate-pulse">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <span className="text-xs font-semibold text-white">Auto Repair</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'compiler' && (
              <div className="space-y-6">
                <div className="glass-panel p-6 rounded-xl space-y-4">
                  <h3 className="text-sm font-semibold text-white">Trigger Self-Healing Loop Test</h3>
                  <p className="text-xs text-white/50 leading-relaxed">
                    Input a command to execute within the isolated build container. If the compiler fails, 
                    Antigravity will intercept the compilation log streams, prompt Gemini to analyze the error, and automatically patch the source file on disk.
                  </p>
                  
                  <form onSubmit={handleTestCommand} className="flex space-x-3 items-center pt-2">
                    <input
                      type="text"
                      value={commandInput}
                      onChange={(e) => setCommandInput(e.target.value)}
                      className="flex-1 px-4 py-3 bg-black/40 border border-white/10 focus:border-violet-500/50 outline-none rounded-lg text-sm text-white font-mono"
                      placeholder="Enter compiler shell execution command..."
                    />
                    <button
                      type="submit"
                      disabled={geminiStatus === 'streaming'}
                      className="px-6 py-3 bg-gradient-to-tr from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 active:scale-95 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-all shadow-lg shadow-violet-500/20 cursor-pointer"
                    >
                      {geminiStatus === 'streaming' ? 'Applying Self-Healing...' : 'Execute Loop'}
                    </button>
                  </form>
                </div>

                <div className="glass-panel p-6 rounded-xl space-y-4">
                  <h3 className="text-sm font-semibold text-white">How the Healing Engine Functions</h3>
                  <div className="grid grid-cols-2 gap-6 text-xs text-white/50">
                    <div className="space-y-2 border-r border-white/5 pr-6">
                      <h4 className="font-semibold text-white">1. Stream Capture</h4>
                      <p>The Rust kernel uses standard multi-threaded processes to capture execution pipelines. Standard output and standard error are mapped in real-time onto asynchronous tokio streams to prevent process locks.</p>
                    </div>
                    <div className="space-y-2">
                      <h4 className="font-semibold text-white">2. AST Analysis</h4>
                      <p>Tree-sitter structures the code into concrete nodes. By aligning line numbers from stderr output to code bounds, we isolate the exact scope (function, interface, or struct) and send only relevant fragments to the LLM.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'vectors' && (
              <div className="space-y-6">
                <div className="glass-panel p-6 rounded-xl space-y-4">
                  <h3 className="text-sm font-semibold text-white">`sqlite-vec` Local Index Details</h3>
                  <div className="w-full border border-white/5 rounded-lg overflow-hidden bg-black/10">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-white/5 bg-white/5 font-mono uppercase text-white/40">
                          <th className="p-4">Table Name</th>
                          <th className="p-4">Type</th>
                          <th className="p-4">Dimensions</th>
                          <th className="p-4">Indexed Nodes</th>
                          <th className="p-4">Status</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono text-white/70">
                        <tr className="border-b border-white/5 hover:bg-white/5">
                          <td className="p-4 font-semibold text-white">workspace_vectors</td>
                          <td className="p-4">Virtual vec0</td>
                          <td className="p-4">768</td>
                          <td className="p-4">287</td>
                          <td className="p-4 text-emerald-400">Synced</td>
                        </tr>
                        <tr className="border-b border-white/5 hover:bg-white/5">
                          <td className="p-4 font-semibold text-white">ast_symbol_index</td>
                          <td className="p-4">FTS5 SQLite</td>
                          <td className="p-4">Text Indices</td>
                          <td className="p-4">582</td>
                          <td className="p-4 text-emerald-400">Synced</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="glass-card p-6 rounded-xl space-y-3">
                  <h3 className="font-semibold text-white">Semantic Similarity Searches</h3>
                  <p className="text-xs text-white/50">
                    When you request context, Antigravity generates an embedding for your query and matches it locally using cosine similarity
                    against the `workspace_vectors` table. This allows the system to instantly find relevant functions across your files even if they don't match the search terms exactly.
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'config' && (
              <div className="space-y-6">
                <div className="glass-panel p-6 rounded-xl space-y-4">
                  <h3 className="text-sm font-semibold text-white">Workspace Configuration</h3>
                  
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs text-white/40 block">Workspace Directory Path</label>
                      <input
                        type="text"
                        value={workspaceRoot}
                        onChange={(e) => setWorkspaceRoot(e.target.value)}
                        className="w-full px-4 py-3 bg-black/40 border border-white/10 focus:border-violet-500/50 outline-none rounded-lg text-sm text-white font-mono"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs text-white/40 block">Gemini API Key (OS Keyring Proxy)</label>
                      <input
                        type="password"
                        value={apiToken}
                        onChange={(e) => setApiToken(e.target.value)}
                        className="w-full px-4 py-3 bg-black/40 border border-white/10 focus:border-violet-500/50 outline-none rounded-lg text-sm text-white font-mono"
                      />
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleSaveConfig}
                  className="px-6 py-3 bg-gradient-to-tr from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 active:scale-95 text-white rounded-lg text-sm font-medium transition-all cursor-pointer"
                >
                  Save Settings
                </button>
              </div>
            )}

          </div>
        </div>

        {/* Right Log Stream Panel */}
        <div className="w-[380px] border-l border-white/5 flex flex-col justify-between bg-black/35 font-mono">
          <div className="h-20 border-b border-white/5 flex items-center justify-between px-6 bg-black/10 flex-shrink-0">
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Kernel Event Stream</h3>
              <p className="text-[9px] text-white/30">Live telemetry data {isTauri ? '(Tauri IPC Active)' : '(Browser Mock)'}</p>
            </div>
            <button
              onClick={() => setLogs([])}
              className="text-[9px] text-white/40 hover:text-white px-2 py-1 border border-white/10 hover:border-white/20 rounded cursor-pointer"
            >
              Clear Logs
            </button>
          </div>

          <div className="flex-1 p-6 overflow-y-auto space-y-3 text-[10px] leading-relaxed">
            {logs.map((log) => (
              <div key={log.id} className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="text-white/20">{log.time}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                    log.type === 'success' 
                      ? 'bg-emerald-500/10 text-emerald-400' 
                      : log.type === 'error' 
                      ? 'bg-rose-500/10 text-rose-400 font-bold' 
                      : log.type === 'warn'
                      ? 'bg-amber-500/10 text-amber-400'
                      : log.type === 'gemini'
                      ? 'bg-violet-500/10 text-violet-400'
                      : 'bg-white/5 text-white/50'
                  }`}>
                    {log.type}
                  </span>
                </div>
                <div className="text-white/80 whitespace-pre-wrap">{log.message}</div>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>

          <div className="p-4 border-t border-white/5 flex-shrink-0 bg-black/10">
            <div className="flex justify-between items-center text-[10px] text-white/30">
              <span>Telemetry: Socket Bound</span>
              <span>Rate: debounced 500ms</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
