import React, { useEffect, useRef } from 'react';
import Editor, { Monaco } from '@monaco-editor/react';

interface MonacoEditorProps {
  filePath: string;
  content: string;
  onContentChange: (newContent: string) => void;
  onSave: () => void;
}

const getLanguageFromExtension = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'rs':
      return 'rust';
    case 'ts':
      return 'typescript';
    case 'tsx':
      return 'typescript'; // Monaco handles typescript language service for both ts and tsx
    case 'js':
      return 'javascript';
    case 'jsx':
      return 'javascript';
    case 'json':
      return 'json';
    case 'css':
      return 'css';
    case 'html':
      return 'html';
    case 'md':
      return 'markdown';
    case 'py':
      return 'python';
    case 'go':
      return 'go';
    case 'sh':
      return 'shell';
    case 'ps1':
      return 'powershell';
    default:
      return 'plaintext';
  }
};

export const MonacoEditor: React.FC<MonacoEditorProps> = ({
  filePath,
  content,
  onContentChange,
  onSave,
}) => {
  const editorRef = useRef<any>(null);

  const handleEditorDidMount = (editor: any, monaco: Monaco) => {
    editorRef.current = editor;

    // Define a custom, high-fidelity dark telemetry theme
    monaco.editor.defineTheme('antigravity-telemetry', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: '', foreground: 'E2E8F0', background: '0D1117' },
        { token: 'comment', foreground: '64748B', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'FF79C6', fontStyle: 'bold' }, // Pink
        { token: 'string', foreground: '50FA7B' }, // Green
        { token: 'number', foreground: 'BD93F9' }, // Purple
        { token: 'regexp', foreground: 'F1FA8C' }, // Yellow
        { token: 'type', foreground: '8BE9FD', fontStyle: 'italic' }, // Cyan
        { token: 'class', foreground: '8BE9FD' },
        { token: 'function', foreground: '50FA7B' },
        { token: 'variable', foreground: 'F8F8F2' },
      ],
      colors: {
        'editor.background': '#090d13', // Ultra-dark grey
        'editor.foreground': '#E2E8F0',
        'editor.lineHighlightBackground': '#1E293B33', // Subtle highlight
        'editorCursor.foreground': '#22D3EE', // Cyan caret
        'editor.selectionBackground': '#33415566',
        'editorLineNumber.foreground': '#475569',
        'editorLineNumber.activeForeground': '#22D3EE',
        'editorWidget.background': '#0F172A',
        'editorWidget.border': '#334155',
        'minimap.background': '#090d1355',
      },
    });

    monaco.editor.setTheme('antigravity-telemetry');

    // Register a custom command/action for Ctrl+S
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSave();
    });
  };

  // Focus editor when file changes
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.focus();
    }
  }, [filePath]);

  const language = getLanguageFromExtension(filePath);

  return (
    <div className="w-full h-full flex flex-col relative select-none">
      {/* Editor breadcrumb header */}
      <div className="flex items-center px-4 py-2 bg-[#090d13] border-b border-white/5 text-xs text-neutral-400 select-none font-mono">
        <svg className="w-3.5 h-3.5 mr-2 text-cyan-400 fill-current" viewBox="0 0 24 24">
          <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
        </svg>
        <span className="truncate">{filePath}</span>
      </div>

      {/* Monaco Core */}
      <div className="flex-1 w-full relative">
        <Editor
          height="100%"
          language={language}
          value={content}
          onChange={(val) => onContentChange(val || '')}
          onMount={handleEditorDidMount}
          options={{
            fontSize: 14,
            fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
            fontLigatures: true,
            minimap: { enabled: true, side: 'right' },
            scrollbar: {
              vertical: 'visible',
              horizontal: 'visible',
              useShadows: false,
              verticalHasArrows: false,
              horizontalHasArrows: false,
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10,
            },
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            lineNumbers: 'on',
            renderWhitespace: 'selection',
            tabSize: 4,
            insertSpaces: true,
            automaticLayout: true,
            padding: { top: 8, bottom: 8 },
            wordWrap: 'on',
            smoothScrolling: true,
            mouseWheelZoom: true,
            formatOnType: true,
            formatOnPaste: true,
          }}
          loading={
            <div className="absolute inset-0 flex items-center justify-center bg-[#090d13] text-cyan-400/80 text-sm font-semibold tracking-wider animate-pulse">
              BOOTING MONACO LANGUAGE CONTEXT...
            </div>
          }
        />
      </div>
    </div>
  );
};
