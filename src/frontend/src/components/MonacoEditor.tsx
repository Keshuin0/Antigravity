import React, { useEffect, useRef } from 'react';
import Editor, { DiffEditor, Monaco } from '@monaco-editor/react';
import { invoke } from '@tauri-apps/api/core';
import type { editor } from 'monaco-editor';

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

interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { value: string };
  insertText?: string;
  insertTextFormat?: number;
  textEdit?: {
    range: LspRange;
    newText: string;
  };
}

interface LspCompletionList {
  isIncomplete: boolean;
  items: LspCompletionItem[];
}

type LspCompletionResponse = LspCompletionItem[] | LspCompletionList;

interface LspMarkedString {
  language: string;
  value: string;
}

interface LspMarkupContent {
  kind: 'markdown' | 'plaintext';
  value: string;
}

type LspHoverContent = string | LspMarkedString | LspMarkupContent;

interface LspHover {
  contents: LspHoverContent | LspHoverContent[];
  range?: LspRange;
}

interface LspLocation {
  uri: string;
  range: LspRange;
}

interface LspLocationLink {
  originSelectionRange?: LspRange;
  targetUri: string;
  targetRange: LspRange;
  targetSelectionRange: LspRange;
}

type LspDefinitionResponse = LspLocation | LspLocation[] | LspLocationLink[];

interface LspLocationInfo {
  uri?: string;
  targetUri?: string;
  range?: LspRange;
  targetSelectionRange?: LspRange;
}

interface LspTextEdit {
  range: LspRange;
  newText: string;
}

interface LspTextDocumentIdentifier {
  uri: string;
}

interface LspTextDocumentEdit {
  textDocument: LspTextDocumentIdentifier;
  edits: LspTextEdit[];
}

interface LspWorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>;
  documentChanges?: LspTextDocumentEdit[];
}

type LspPrepareRenameResponse = LspRange | { range: LspRange; placeholder?: string };

interface LspCommand {
  title: string;
  command: string;
  arguments?: unknown[];
}

interface LspCodeAction {
  title: string;
  kind?: string;
  diagnostics?: unknown[];
  isPreferred?: boolean;
  edit?: LspWorkspaceEdit;
  command?: LspCommand;
}

interface MonacoEditorProps {
  filePath: string;
  content: string;
  onContentChange: (newContent: string) => void;
  onSave: () => void;
  diagnostics: Record<string, LspDiagnostic[]>;
  diffMode?: boolean;
  originalContent?: string;
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const getLanguageFromExtension = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'rs':
      return 'rust';
    case 'ts':
      return 'typescript';
    case 'tsx':
      return 'typescript';
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

type StandaloneCodeEditor = Parameters<
  NonNullable<React.ComponentProps<typeof Editor>['onMount']>
>[0];
type StandaloneDiffEditor = Parameters<
  NonNullable<React.ComponentProps<typeof DiffEditor>['onMount']>
>[0];

export const MonacoEditor: React.FC<MonacoEditorProps> = ({
  filePath,
  content,
  onContentChange,
  onSave,
  diagnostics,
  diffMode = false,
  originalContent = '',
}) => {
  const editorRef = useRef<StandaloneCodeEditor | null>(null);
  const diffEditorRef = useRef<StandaloneDiffEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const disposablesRef = useRef<{ dispose: () => void }[]>([]);

  const handleDiffEditorDidMount = (editor: StandaloneDiffEditor, monaco: Monaco) => {
    diffEditorRef.current = editor;
    monaco.editor.setTheme('antigravity-telemetry');
  };

  // Cleanup Monaco LSP Providers on Unmount
  const clearLspProviders = () => {
    disposablesRef.current.forEach((d) => d.dispose());
    disposablesRef.current = [];
  };

  useEffect(() => {
    return () => {
      clearLspProviders();
    };
  }, []);

  const handleEditorDidMount = (editor: StandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Define custom telemetry theme
    monaco.editor.defineTheme('antigravity-telemetry', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: '', foreground: 'E2E8F0', background: '0D1117' },
        { token: 'comment', foreground: '64748B', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'FF79C6', fontStyle: 'bold' },
        { token: 'string', foreground: '50FA7B' },
        { token: 'number', foreground: 'BD93F9' },
        { token: 'regexp', foreground: 'F1FA8C' },
        { token: 'type', foreground: '8BE9FD', fontStyle: 'italic' },
        { token: 'class', foreground: '8BE9FD' },
        { token: 'function', foreground: '50FA7B' },
        { token: 'variable', foreground: 'F8F8F2' },
      ],
      colors: {
        'editor.background': '#090d13',
        'editor.foreground': '#E2E8F0',
        'editor.lineHighlightBackground': '#1E293B33',
        'editorCursor.foreground': '#22D3EE',
        'editor.selectionBackground': '#33415566',
        'editorLineNumber.foreground': '#475569',
        'editorLineNumber.activeForeground': '#22D3EE',
        'editorWidget.background': '#0F172A',
        'editorWidget.border': '#334155',
        'minimap.background': '#090d1355',
      },
    });

    monaco.editor.setTheme('antigravity-telemetry');

    // Register Ctrl+S FFI Save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSave();
    });

    // Register Pinnacle LSP Monaco Providers
    if (isTauri) {
      clearLspProviders();

      const languagesToRegister = ['rust', 'typescript', 'javascript'];

      languagesToRegister.forEach((lang) => {
        // 1. Completion Provider
        const completionDisposable = monaco.languages.registerCompletionItemProvider(lang, {
          triggerCharacters: ['.', ':', '::', '(', ','],
          provideCompletionItems: async (model, position) => {
            try {
              const uri = model.uri.toString();
              const response = await invoke<LspCompletionResponse>('lsp_send_request', {
                language: lang === 'rust' ? 'rust' : 'typescript',
                method: 'textDocument/completion',
                params: {
                  textDocument: { uri },
                  position: { line: position.lineNumber - 1, character: position.column - 1 },
                },
              });

              if (!response) return { suggestions: [] };

              const items = Array.isArray(response) ? response : response.items || [];
              const suggestions = items.map((item: LspCompletionItem) => {
                let kind = monaco.languages.CompletionItemKind.Variable;
                if (item.kind) {
                  const lspToMonacoKind: Record<number, number> = {
                    1: monaco.languages.CompletionItemKind.Text,
                    2: monaco.languages.CompletionItemKind.Method,
                    3: monaco.languages.CompletionItemKind.Function,
                    4: monaco.languages.CompletionItemKind.Constructor,
                    5: monaco.languages.CompletionItemKind.Field,
                    6: monaco.languages.CompletionItemKind.Variable,
                    7: monaco.languages.CompletionItemKind.Class,
                    8: monaco.languages.CompletionItemKind.Interface,
                    9: monaco.languages.CompletionItemKind.Module,
                    10: monaco.languages.CompletionItemKind.Property,
                    11: monaco.languages.CompletionItemKind.Unit,
                    12: monaco.languages.CompletionItemKind.Value,
                    13: monaco.languages.CompletionItemKind.Enum,
                    14: monaco.languages.CompletionItemKind.Keyword,
                    15: monaco.languages.CompletionItemKind.Snippet,
                    16: monaco.languages.CompletionItemKind.Color,
                    17: monaco.languages.CompletionItemKind.File,
                    18: monaco.languages.CompletionItemKind.Reference,
                    19: monaco.languages.CompletionItemKind.Folder,
                    20: monaco.languages.CompletionItemKind.EnumMember,
                    21: monaco.languages.CompletionItemKind.Constant,
                    22: monaco.languages.CompletionItemKind.Struct,
                    23: monaco.languages.CompletionItemKind.Event,
                    24: monaco.languages.CompletionItemKind.Operator,
                    25: monaco.languages.CompletionItemKind.TypeParameter,
                  };
                  kind = lspToMonacoKind[item.kind] || monaco.languages.CompletionItemKind.Variable;
                }

                const range = item.textEdit
                  ? {
                      startLineNumber: item.textEdit.range.start.line + 1,
                      startColumn: item.textEdit.range.start.character + 1,
                      endLineNumber: item.textEdit.range.end.line + 1,
                      endColumn: item.textEdit.range.end.character + 1,
                    }
                  : {
                      startLineNumber: position.lineNumber,
                      startColumn: position.column,
                      endLineNumber: position.lineNumber,
                      endColumn: position.column,
                    };

                const suggestion: import('monaco-editor').languages.CompletionItem = {
                  label: item.label,
                  kind,
                  insertText: item.insertText || item.textEdit?.newText || item.label,
                  range,
                };

                if (item.detail !== undefined) {
                  suggestion.detail = item.detail;
                }

                if (item.documentation !== undefined) {
                  const doc =
                    typeof item.documentation === 'string'
                      ? item.documentation
                      : item.documentation?.value;
                  if (doc !== undefined) {
                    suggestion.documentation = doc;
                  }
                }

                if (item.insertTextFormat === 2) {
                  suggestion.insertTextRules =
                    monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
                }

                return suggestion;
              });

              return { suggestions };
            } catch (e) {
              console.warn(`LSP Completion failed for ${lang}:`, e);
              return { suggestions: [] };
            }
          },
        });
        disposablesRef.current.push(completionDisposable);

        // 2. Hover Provider
        const hoverDisposable = monaco.languages.registerHoverProvider(lang, {
          provideHover: async (model, position) => {
            try {
              const uri = model.uri.toString();
              const response = await invoke<LspHover | null>('lsp_send_request', {
                language: lang === 'rust' ? 'rust' : 'typescript',
                method: 'textDocument/hover',
                params: {
                  textDocument: { uri },
                  position: { line: position.lineNumber - 1, character: position.column - 1 },
                },
              });

              if (!response || !response.contents) return null;

              let value = '';
              if (typeof response.contents === 'string') {
                value = response.contents;
              } else if (Array.isArray(response.contents)) {
                value = response.contents
                  .map((c: LspHoverContent) => (typeof c === 'string' ? c : c.value))
                  .join('\n\n');
              } else if (response.contents && 'value' in response.contents) {
                value = response.contents.value;
              }

              const hoverResult: {
                contents: { value: string }[];
                range?: {
                  startLineNumber: number;
                  startColumn: number;
                  endLineNumber: number;
                  endColumn: number;
                };
              } = {
                contents: [{ value }],
              };
              if (response.range) {
                hoverResult.range = {
                  startLineNumber: response.range.start.line + 1,
                  startColumn: response.range.start.character + 1,
                  endLineNumber: response.range.end.line + 1,
                  endColumn: response.range.end.character + 1,
                };
              }
              return hoverResult;
            } catch (e) {
              console.warn(`LSP Hover failed for ${lang}:`, e);
              return null;
            }
          },
        });
        disposablesRef.current.push(hoverDisposable);

        // 3. Definition Provider
        const definitionDisposable = monaco.languages.registerDefinitionProvider(lang, {
          provideDefinition: async (model, position) => {
            try {
              const uri = model.uri.toString();
              const response = await invoke<LspDefinitionResponse | null>('lsp_send_request', {
                language: lang === 'rust' ? 'rust' : 'typescript',
                method: 'textDocument/definition',
                params: {
                  textDocument: { uri },
                  position: { line: position.lineNumber - 1, character: position.column - 1 },
                },
              });

              if (!response) return null;

              const locations = Array.isArray(response) ? response : [response];
              return locations
                .map((loc: LspLocationInfo) => {
                  const targetUri = loc.uri || loc.targetUri || '';
                  const range = loc.range || loc.targetSelectionRange;
                  if (!range) return null;
                  return {
                    uri: monaco.Uri.parse(targetUri),
                    range: {
                      startLineNumber: range.start.line + 1,
                      startColumn: range.start.character + 1,
                      endLineNumber: range.end.line + 1,
                      endColumn: range.end.character + 1,
                    },
                  };
                })
                .filter(Boolean) as import('monaco-editor').languages.Location[];
            } catch (e) {
              console.warn(`LSP Definition failed for ${lang}:`, e);
              return null;
            }
          },
        });
        disposablesRef.current.push(definitionDisposable);

        // 4. Formatting Provider
        const formattingDisposable = monaco.languages.registerDocumentFormattingEditProvider(lang, {
          provideDocumentFormattingEdits: async (model) => {
            try {
              const uri = model.uri.toString();
              const response = await invoke<LspTextEdit[]>('lsp_send_request', {
                language: lang === 'rust' ? 'rust' : 'typescript',
                method: 'textDocument/formatting',
                params: {
                  textDocument: { uri },
                  options: {
                    tabSize: model.getOptions().tabSize,
                    insertSpaces: model.getOptions().insertSpaces,
                  },
                },
              });

              if (!response || !Array.isArray(response)) return [];

              return response.map((edit: LspTextEdit) => ({
                range: {
                  startLineNumber: edit.range.start.line + 1,
                  startColumn: edit.range.start.character + 1,
                  endLineNumber: edit.range.end.line + 1,
                  endColumn: edit.range.end.character + 1,
                },
                text: edit.newText,
              }));
            } catch (e) {
              console.warn(`LSP Formatting failed for ${lang}:`, e);
              return [];
            }
          },
        });
        disposablesRef.current.push(formattingDisposable);

        // 5. Reference Provider
        const referenceDisposable = monaco.languages.registerReferenceProvider(lang, {
          provideReferences: async (model, position, context) => {
            try {
              const uri = model.uri.toString();
              const response = await invoke<LspLocation[]>('lsp_send_request', {
                language: lang === 'rust' ? 'rust' : 'typescript',
                method: 'textDocument/references',
                params: {
                  textDocument: { uri },
                  position: { line: position.lineNumber - 1, character: position.column - 1 },
                  context: {
                    includeDeclaration: context.includeDeclaration,
                  },
                },
              });

              if (!response || !Array.isArray(response)) return [];

              return response.map((loc: LspLocation) => ({
                uri: monaco.Uri.parse(loc.uri),
                range: {
                  startLineNumber: loc.range.start.line + 1,
                  startColumn: loc.range.start.character + 1,
                  endLineNumber: loc.range.end.line + 1,
                  endColumn: loc.range.end.character + 1,
                },
              }));
            } catch (e) {
              console.warn(`LSP References failed for ${lang}:`, e);
              return [];
            }
          },
        });
        disposablesRef.current.push(referenceDisposable);

        // 6. Rename Provider
        const renameDisposable = monaco.languages.registerRenameProvider(lang, {
          provideRenameEdits: async (model, position, newName) => {
            try {
              const uri = model.uri.toString();
              const response = await invoke<LspWorkspaceEdit | null>('lsp_send_request', {
                language: lang === 'rust' ? 'rust' : 'typescript',
                method: 'textDocument/rename',
                params: {
                  textDocument: { uri },
                  position: { line: position.lineNumber - 1, character: position.column - 1 },
                  newName,
                },
              });

              if (!response) return null;

              const edits: import('monaco-editor').languages.IWorkspaceTextEdit[] = [];

              if (response.changes) {
                for (const [fileUri, textEdits] of Object.entries(response.changes)) {
                  if (Array.isArray(textEdits)) {
                    textEdits.forEach((edit: LspTextEdit) => {
                      edits.push({
                        resource: monaco.Uri.parse(fileUri),
                        versionId: undefined,
                        textEdit: {
                          range: {
                            startLineNumber: edit.range.start.line + 1,
                            startColumn: edit.range.start.character + 1,
                            endLineNumber: edit.range.end.line + 1,
                            endColumn: edit.range.end.character + 1,
                          },
                          text: edit.newText,
                        },
                      });
                    });
                  }
                }
              }

              if (response.documentChanges && Array.isArray(response.documentChanges)) {
                response.documentChanges.forEach((change: LspTextDocumentEdit) => {
                  if (change.textDocument && Array.isArray(change.edits)) {
                    const docUri = change.textDocument.uri;
                    change.edits.forEach((edit: LspTextEdit) => {
                      edits.push({
                        resource: monaco.Uri.parse(docUri),
                        versionId: undefined,
                        textEdit: {
                          range: {
                            startLineNumber: edit.range.start.line + 1,
                            startColumn: edit.range.start.character + 1,
                            endLineNumber: edit.range.end.line + 1,
                            endColumn: edit.range.end.character + 1,
                          },
                          text: edit.newText,
                        },
                      });
                    });
                  }
                });
              }

              return { edits };
            } catch (e) {
              console.warn(`LSP Rename failed for ${lang}:`, e);
              return null;
            }
          },
          resolveRenameLocation: async (model, position) => {
            try {
              const uri = model.uri.toString();
              const response = await invoke<LspPrepareRenameResponse | null>('lsp_send_request', {
                language: lang === 'rust' ? 'rust' : 'typescript',
                method: 'textDocument/prepareRename',
                params: {
                  textDocument: { uri },
                  position: { line: position.lineNumber - 1, character: position.column - 1 },
                },
              });

              if (response === null) {
                throw new Error('Cannot rename this element');
              }

              let range: LspRange | undefined;
              let placeholder: string | undefined;
              if (response) {
                if ('range' in response) {
                  range = (response as { range: LspRange }).range;
                  placeholder = (response as { placeholder?: string }).placeholder;
                } else if ('start' in response) {
                  range = response as LspRange;
                }
              }

              if (range && range.start) {
                return {
                  range: {
                    startLineNumber: range.start.line + 1,
                    startColumn: range.start.character + 1,
                    endLineNumber: range.end.line + 1,
                    endColumn: range.end.character + 1,
                  },
                  text:
                    placeholder ||
                    model.getValueInRange({
                      startLineNumber: range.start.line + 1,
                      startColumn: range.start.character + 1,
                      endLineNumber: range.end.line + 1,
                      endColumn: range.end.character + 1,
                    }),
                };
              }
            } catch (e) {
              // fallback
            }

            return {
              range: new monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column
              ),
              text: '',
            };
          },
        });
        disposablesRef.current.push(renameDisposable);

        // 7. Code Action Provider
        const codeActionDisposable = monaco.languages.registerCodeActionProvider(lang, {
          provideCodeActions: async (model, range, context) => {
            try {
              const uri = model.uri.toString();
              const lspDiagnostics = context.markers.map((marker) => ({
                range: {
                  start: { line: marker.startLineNumber - 1, character: marker.startColumn - 1 },
                  end: { line: marker.endLineNumber - 1, character: marker.endColumn - 1 },
                },
                severity: marker.severity,
                message: marker.message,
                code: marker.code?.toString(),
                source: marker.source,
              }));

              const response = await invoke<LspCodeAction[]>('lsp_send_request', {
                language: lang === 'rust' ? 'rust' : 'typescript',
                method: 'textDocument/codeAction',
                params: {
                  textDocument: { uri },
                  range: {
                    start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
                    end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
                  },
                  context: {
                    diagnostics: lspDiagnostics,
                    only: context.only ? [context.only] : undefined,
                  },
                },
              });

              if (!response || !Array.isArray(response)) return { actions: [], dispose: () => {} };

              const actions: import('monaco-editor').languages.CodeAction[] = [];

              response.forEach((action: LspCodeAction) => {
                const edits: import('monaco-editor').languages.IWorkspaceTextEdit[] = [];

                if (action.edit) {
                  if (action.edit.changes) {
                    for (const [fileUri, textEdits] of Object.entries(action.edit.changes)) {
                      if (Array.isArray(textEdits)) {
                        textEdits.forEach((edit: LspTextEdit) => {
                          edits.push({
                            resource: monaco.Uri.parse(fileUri),
                            versionId: undefined,
                            textEdit: {
                              range: {
                                startLineNumber: edit.range.start.line + 1,
                                startColumn: edit.range.start.character + 1,
                                endLineNumber: edit.range.end.line + 1,
                                endColumn: edit.range.end.character + 1,
                              },
                              text: edit.newText,
                            },
                          });
                        });
                      }
                    }
                  }
                  if (action.edit.documentChanges && Array.isArray(action.edit.documentChanges)) {
                    action.edit.documentChanges.forEach((change: LspTextDocumentEdit) => {
                      if (change.textDocument && Array.isArray(change.edits)) {
                        const docUri = change.textDocument.uri;
                        change.edits.forEach((edit: LspTextEdit) => {
                          edits.push({
                            resource: monaco.Uri.parse(docUri),
                            versionId: undefined,
                            textEdit: {
                              range: {
                                startLineNumber: edit.range.start.line + 1,
                                startColumn: edit.range.start.character + 1,
                                endLineNumber: edit.range.end.line + 1,
                                endColumn: edit.range.end.character + 1,
                              },
                              text: edit.newText,
                            },
                          });
                        });
                      }
                    });
                  }
                }

                const actionObj: import('monaco-editor').languages.CodeAction = {
                  title: action.title,
                };

                if (action.kind !== undefined) {
                  actionObj.kind = action.kind;
                }
                if (context.markers !== undefined) {
                  actionObj.diagnostics = context.markers;
                }
                if (action.isPreferred !== undefined) {
                  actionObj.isPreferred = action.isPreferred;
                }
                if (edits.length > 0) {
                  actionObj.edit = { edits };
                }
                if (action.command) {
                  const cmdObj: import('monaco-editor').languages.Command = {
                    id: action.command.command,
                    title: action.command.title,
                  };
                  if (action.command.arguments !== undefined) {
                    cmdObj.arguments = action.command.arguments as unknown[];
                  }
                  actionObj.command = cmdObj;
                }

                actions.push(actionObj);
              });

              return {
                actions,
                dispose: () => {},
              };
            } catch (e) {
              console.warn(`LSP Code Actions failed for ${lang}:`, e);
              return { actions: [], dispose: () => {} };
            }
          },
        });
        disposablesRef.current.push(codeActionDisposable);
      });
    }
  };

  // Focus editor when file changes
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.focus();
    }
  }, [filePath]);

  // Apply Diagnostic Markers (squiggles)
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !isTauri) return;

    const model = editorRef.current.getModel();
    if (!model) return;

    const uri = model.uri.toString();
    const fileDiags = diagnostics[uri] || [];

    const markers = fileDiags.map((diag: LspDiagnostic) => {
      let severity = monacoRef.current!.MarkerSeverity.Info;
      if (diag.severity === 1) severity = monacoRef.current!.MarkerSeverity.Error;
      else if (diag.severity === 2) severity = monacoRef.current!.MarkerSeverity.Warning;
      else if (diag.severity === 3) severity = monacoRef.current!.MarkerSeverity.Info;
      else if (diag.severity === 4) severity = monacoRef.current!.MarkerSeverity.Hint;

      return {
        message: diag.message,
        severity,
        startLineNumber: diag.range.start.line + 1,
        startColumn: diag.range.start.character + 1,
        endLineNumber: diag.range.end.line + 1,
        endColumn: diag.range.end.character + 1,
        source: diag.source || 'LSP',
      };
    });

    monacoRef.current.editor.setModelMarkers(model, 'lsp', markers);
  }, [diagnostics, filePath]);

  const handleChange = (val: string | undefined, ev: editor.IModelContentChangedEvent) => {
    onContentChange(val || '');

    if (!isTauri || !ev || !ev.changes) return;

    const ext = filePath.split('.').pop()?.toLowerCase();
    const lang =
      ext === 'rs'
        ? 'rust'
        : ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx'
          ? 'typescript'
          : null;

    if (lang) {
      for (const change of ev.changes) {
        const lspRange = {
          start: {
            line: change.range.startLineNumber - 1,
            character: change.range.startColumn - 1,
          },
          end: { line: change.range.endLineNumber - 1, character: change.range.endColumn - 1 },
        };
        invoke('lsp_file_change', {
          language: lang,
          path: filePath,
          range: lspRange,
          text: change.text,
        }).catch((err) => console.warn('LSP file change failed:', err));
      }
    }
  };

  const language = getLanguageFromExtension(filePath);

  return (
    <div className="w-full h-full flex flex-col relative select-none">
      {/* Editor breadcrumb header */}
      <div className="flex items-center px-4 py-2 bg-[#090d13] border-b border-white/5 text-xs text-neutral-400 select-none font-mono">
        <svg className="w-3.5 h-3.5 mr-2 text-primary fill-current" viewBox="0 0 24 24">
          <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
        </svg>
        <span className="truncate">
          {filePath}{' '}
          {diffMode && (
            <span className="text-[10px] text-amber-400 ml-1.5">(side-by-side staged diff)</span>
          )}
        </span>
      </div>

      {/* Monaco Core */}
      <div className="flex-1 w-full relative">
        {diffMode ? (
          <DiffEditor
            height="100%"
            language={language}
            original={originalContent}
            modified={content}
            onMount={handleDiffEditorDidMount}
            options={{
              readOnly: true,
              fontSize: 14,
              fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
              fontLigatures: true,
              minimap: { enabled: true },
              scrollbar: {
                vertical: 'visible',
                horizontal: 'visible',
                useShadows: false,
                verticalScrollbarSize: 10,
                horizontalScrollbarSize: 10,
              },
              cursorBlinking: 'smooth',
              lineNumbers: 'on',
              automaticLayout: true,
              wordWrap: 'on',
              smoothScrolling: true,
            }}
            loading={
              <div className="absolute inset-0 flex items-center justify-center bg-[#090d13] text-primary/80 text-sm font-semibold tracking-wider animate-pulse">
                LOADING SIDE-BY-SIDE DIFF...
              </div>
            }
          />
        ) : (
          <Editor
            height="100%"
            language={language}
            value={content}
            onChange={handleChange}
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
              <div className="absolute inset-0 flex items-center justify-center bg-[#090d13] text-primary/80 text-sm font-semibold tracking-wider animate-pulse">
                BOOTING MONACO LANGUAGE CONTEXT...
              </div>
            }
          />
        )}
      </div>
    </div>
  );
};
