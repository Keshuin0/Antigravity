import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface VfsEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface FileExplorerProps {
  workspaceRoot: string;
  onFileSelect: (filePath: string) => void;
  activeFilePath: string | null;
}

interface TreeNodeProps {
  entry: VfsEntry;
  depth: number;
  onFileSelect: (filePath: string) => void;
  activeFilePath: string | null;
}

const TreeNode: React.FC<TreeNodeProps> = ({ entry, depth, onFileSelect, activeFilePath }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [children, setChildren] = useState<VfsEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!entry.is_dir) {
      onFileSelect(entry.path);
      return;
    }

    const nextOpen = !isOpen;
    setIsOpen(nextOpen);

    if (nextOpen && children.length === 0) {
      setIsLoading(true);
      try {
        const res = await invoke<VfsEntry[]>('read_workspace_dir_cmd', { path: entry.path });
        setChildren(res);
      } catch (err) {
        console.error('Failed to load dir:', err);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const isActive = activeFilePath === entry.path;

  return (
    <div className="select-none font-sans text-sm">
      {/* Node Row */}
      <div
        onClick={handleToggle}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        className={`flex items-center py-1.5 px-2.5 cursor-pointer rounded-md transition-all duration-200 group relative ${
          isActive
            ? 'bg-cyan-500/10 text-cyan-400 border-l-2 border-cyan-400 font-medium'
            : 'text-neutral-300 hover:bg-white/5 hover:text-white'
        }`}
      >
        {/* Glow effect on hover */}
        <div className="absolute inset-0 rounded-md bg-cyan-400/0 group-hover:bg-cyan-400/2 opacity-10 transition-all duration-300 pointer-events-none" />

        {/* Folder Arrow */}
        {entry.is_dir ? (
          <span className={`mr-1.5 transition-transform duration-200 ${isOpen ? 'rotate-90' : 'rotate-0'}`}>
            <svg className="w-3.5 h-3.5 fill-current text-neutral-400" viewBox="0 0 24 24">
              <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
            </svg>
          </span>
        ) : (
          <span className="w-5" />
        )}

        {/* Icon */}
        <span className="mr-2 flex items-center">
          {entry.is_dir ? (
            <svg className="w-4 h-4 text-amber-400 fill-current" viewBox="0 0 24 24">
              <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-cyan-400 fill-current" viewBox="0 0 24 24">
              <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
            </svg>
          )}
        </span>

        {/* Label */}
        <span className="truncate flex-1">{entry.name}</span>
      </div>

      {/* Children List */}
      {entry.is_dir && isOpen && (
        <div className="relative">
          {/* Vertical branch line */}
          <div
            style={{ left: `${depth * 12 + 13}px` }}
            className="absolute top-0 bottom-1.5 w-[1px] bg-white/5 pointer-events-none"
          />

          {isLoading ? (
            <div
              style={{ paddingLeft: `${(depth + 1) * 12 + 10}px` }}
              className="py-1 text-xs text-neutral-500 italic animate-pulse"
            >
              Loading...
            </div>
          ) : children.length === 0 ? (
            <div
              style={{ paddingLeft: `${(depth + 1) * 12 + 10}px` }}
              className="py-1 text-xs text-neutral-500 italic"
            >
              (empty)
            </div>
          ) : (
            children.map((child) => (
              <TreeNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                onFileSelect={onFileSelect}
                activeFilePath={activeFilePath}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

export const FileExplorer: React.FC<FileExplorerProps> = ({
  workspaceRoot,
  onFileSelect,
  activeFilePath,
}) => {
  const [rootEntries, setRootEntries] = useState<VfsEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;

    const loadRoot = async () => {
      if (!workspaceRoot) return;
      setLoading(true);
      setError(null);
      try {
        const res = await invoke<VfsEntry[]>('read_workspace_dir_cmd', { path: workspaceRoot });
        if (active) {
          setRootEntries(res);
        }
      } catch (err) {
        console.error('Failed to load workspace root:', err);
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadRoot();

    return () => {
      active = false;
    };
  }, [workspaceRoot]);

  return (
    <div className="w-full h-full flex flex-col select-none text-white bg-transparent">
      {/* Search/Filter Header */}
      <div className="p-3 border-b border-white/5 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-widest text-neutral-400">
          Workspace Explorer
        </span>
        <button
          onClick={async () => {
            setLoading(true);
            try {
              const res = await invoke<VfsEntry[]>('read_workspace_dir_cmd', { path: workspaceRoot });
              setRootEntries(res);
            } catch (err) {
              setError(String(err));
            } finally {
              setLoading(false);
            }
          }}
          className="p-1 hover:bg-white/5 rounded text-neutral-400 hover:text-cyan-400 transition-colors"
          title="Refresh Workspace"
        >
          <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
          </svg>
        </button>
      </div>

      {/* Directory Tree */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5 custom-scrollbar">
        {loading && rootEntries.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-neutral-500 text-sm italic animate-pulse">
            Crawling workspace...
          </div>
        ) : error ? (
          <div className="p-4 text-xs text-rose-400 bg-rose-500/5 border border-rose-500/10 rounded-md">
            <div className="font-semibold mb-1">Access Restricted:</div>
            {error}
          </div>
        ) : rootEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <svg className="w-8 h-8 text-neutral-600 mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span className="text-neutral-500 text-xs">Empty or invalid workspace directory</span>
          </div>
        ) : (
          rootEntries.map((entry) => (
            <TreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              onFileSelect={onFileSelect}
              activeFilePath={activeFilePath}
            />
          ))
        )}
      </div>
    </div>
  );
};
