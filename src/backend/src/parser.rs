use serde::{Deserialize, Serialize};
use std::path::Path;
use tree_sitter::{Language, Parser};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ASTSymbol {
    pub name: String,
    pub kind: String,
    pub start_line: usize,
    pub end_line: usize,
    pub signature: Option<String>,
}

pub fn get_language(path: &Path) -> Option<Language> {
    let ext = path.extension()?.to_str()?;
    match ext {
        "rs" => Some(tree_sitter_rust::language()),
        "ts" => Some(tree_sitter_typescript::language_typescript()),
        "tsx" => Some(tree_sitter_typescript::language_tsx()),
        _ => None,
    }
}

pub fn parse_file(path: &Path, content: &str) -> Result<Vec<ASTSymbol>, String> {
    let language = match get_language(path) {
        Some(lang) => lang,
        None => return Ok(vec![]), // Unsupported language, return empty list
    };

    let mut parser = Parser::new();
    parser.set_language(&language).map_err(|e| e.to_string())?;

    let tree = parser
        .parse(content, None)
        .ok_or_else(|| "Failed to parse content".to_string())?;
    let mut symbols = Vec::new();

    // Simple tree traversal for symbols (we'll expand this)
    let root_node = tree.root_node();
    traverse_node(root_node, content, &mut symbols, path);

    Ok(symbols)
}

fn traverse_node(node: tree_sitter::Node, source: &str, symbols: &mut Vec<ASTSymbol>, path: &Path) {
    let kind = node.kind();
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

    match (ext, kind) {
        // Rust parser rules
        ("rs", "function_item") => {
            if let Some(name_node) = node.child_by_field_name("name") {
                if let Ok(name) = name_node.utf8_text(source.as_bytes()) {
                    let start = node.start_position().row + 1;
                    let end = node.end_position().row + 1;
                    let signature = get_node_signature(node, source);
                    symbols.push(ASTSymbol {
                        name: name.to_string(),
                        kind: "function".to_string(),
                        start_line: start,
                        end_line: end,
                        signature: Some(signature),
                    });
                }
            }
        }
        ("rs", "struct_item") => {
            if let Some(name_node) = node.child_by_field_name("name") {
                if let Ok(name) = name_node.utf8_text(source.as_bytes()) {
                    let start = node.start_position().row + 1;
                    let end = node.end_position().row + 1;
                    symbols.push(ASTSymbol {
                        name: name.to_string(),
                        kind: "struct".to_string(),
                        start_line: start,
                        end_line: end,
                        signature: None,
                    });
                }
            }
        }
        ("rs", "impl_item") => {
            // Impl blocks can contain methods
            if let Some(type_node) = node.child_by_field_name("type") {
                if let Ok(name) = type_node.utf8_text(source.as_bytes()) {
                    let start = node.start_position().row + 1;
                    let end = node.end_position().row + 1;
                    symbols.push(ASTSymbol {
                        name: format!("impl {}", name),
                        kind: "impl".to_string(),
                        start_line: start,
                        end_line: end,
                        signature: None,
                    });
                }
            }
        }
        // TypeScript / TSX parser rules
        (_, "function_declaration") => {
            if let Some(name_node) = node.child_by_field_name("name") {
                if let Ok(name) = name_node.utf8_text(source.as_bytes()) {
                    let start = node.start_position().row + 1;
                    let end = node.end_position().row + 1;
                    symbols.push(ASTSymbol {
                        name: name.to_string(),
                        kind: "function".to_string(),
                        start_line: start,
                        end_line: end,
                        signature: Some(get_node_signature(node, source)),
                    });
                }
            }
        }
        (_, "class_declaration") => {
            if let Some(name_node) = node.child_by_field_name("name") {
                if let Ok(name) = name_node.utf8_text(source.as_bytes()) {
                    let start = node.start_position().row + 1;
                    let end = node.end_position().row + 1;
                    symbols.push(ASTSymbol {
                        name: name.to_string(),
                        kind: "class".to_string(),
                        start_line: start,
                        end_line: end,
                        signature: None,
                    });
                }
            }
        }
        (_, "interface_declaration") => {
            if let Some(name_node) = node.child_by_field_name("name") {
                if let Ok(name) = name_node.utf8_text(source.as_bytes()) {
                    let start = node.start_position().row + 1;
                    let end = node.end_position().row + 1;
                    symbols.push(ASTSymbol {
                        name: name.to_string(),
                        kind: "interface".to_string(),
                        start_line: start,
                        end_line: end,
                        signature: None,
                    });
                }
            }
        }
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        traverse_node(child, source, symbols, path);
    }
}

fn get_node_signature(node: tree_sitter::Node, source: &str) -> String {
    let start_byte = node.start_byte();
    let end_byte = node.end_byte();

    let bytes = source.as_bytes();
    if start_byte < bytes.len() && end_byte <= bytes.len() {
        let node_bytes = &bytes[start_byte..end_byte];
        let node_text = String::from_utf8_lossy(node_bytes);
        if let Some(brace_pos) = node_text.find('{') {
            node_text[..brace_pos].trim().to_string()
        } else {
            node_text.trim().to_string()
        }
    } else {
        "".to_string()
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IsolatedScope {
    pub start_byte: usize,
    pub end_byte: usize,
    pub start_line: usize,
    pub end_line: usize,
    pub kind: String,
    pub name: String,
    pub content: String,
}

pub fn isolate_ast_scope(
    path: &Path,
    content: &str,
    line: usize,
    col: usize,
) -> Option<IsolatedScope> {
    let language = get_language(path)?;
    let mut parser = Parser::new();
    parser.set_language(&language).ok()?;
    let tree = parser.parse(content, None)?;
    let root = tree.root_node();

    let row = line.saturating_sub(1);
    let char_col = col.saturating_sub(1);

    // Find innermost leaf node containing row and column
    let node = find_innermost_node(root, row, char_col);

    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

    // Walk up the parent chain until we find a structural scope
    let mut target_node = None;
    let mut current = Some(node);
    while let Some(n) = current {
        if is_structural_scope(n.kind(), ext) {
            target_node = Some(n);
            break;
        }
        current = n.parent();
    }

    // Fallback: if no structural scope was found, try to use root node or return None (to fall back to entire file)
    let final_node = target_node.or_else(|| {
        if content.lines().count() > 150 {
            Some(root)
        } else {
            None
        }
    })?;

    let start_byte = final_node.start_byte();
    let end_byte = final_node.end_byte();
    let start_line = final_node.start_position().row + 1;
    let end_line = final_node.end_position().row + 1;
    let kind = final_node.kind().to_string();

    let name = if let Some(name_node) = final_node.child_by_field_name("name") {
        name_node
            .utf8_text(content.as_bytes())
            .unwrap_or("")
            .to_string()
    } else {
        "".to_string()
    };

    let bytes = content.as_bytes();
    let scope_content = if start_byte < bytes.len() && end_byte <= bytes.len() {
        String::from_utf8_lossy(&bytes[start_byte..end_byte]).to_string()
    } else {
        content.to_string()
    };

    Some(IsolatedScope {
        start_byte,
        end_byte,
        start_line,
        end_line,
        kind,
        name,
        content: scope_content,
    })
}

fn find_innermost_node(node: tree_sitter::Node, row: usize, col: usize) -> tree_sitter::Node {
    let mut current = node;
    let mut found_child = true;
    while found_child {
        found_child = false;
        let mut cursor = current.walk();
        for child in current.children(&mut cursor) {
            let start = child.start_position();
            let end = child.end_position();
            if (row > start.row || (row == start.row && col >= start.column))
                && (row < end.row || (row == end.row && col <= end.column))
            {
                current = child;
                found_child = true;
                break;
            }
        }
    }
    current
}

fn is_structural_scope(kind: &str, ext: &str) -> bool {
    match ext {
        "rs" => {
            matches!(
                kind,
                "function_item"
                    | "struct_item"
                    | "impl_item"
                    | "enum_item"
                    | "trait_item"
                    | "const_item"
                    | "static_item"
                    | "macro_definition"
                    | "mod_item"
            )
        }
        "ts" | "tsx" | "js" | "jsx" => {
            matches!(
                kind,
                "function_declaration"
                    | "method_definition"
                    | "class_declaration"
                    | "interface_declaration"
                    | "arrow_function"
            )
        }
        _ => false,
    }
}
