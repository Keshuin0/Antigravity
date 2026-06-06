use rusqlite::{Connection, OptionalExtension, Result};
use sha2::{Digest, Sha256};
use sqlite_vec::sqlite3_vec_init;
use std::path::{Path, PathBuf};
use zerocopy::IntoBytes;

#[allow(clippy::missing_transmute_annotations)]
pub fn initialize_sqlite_extensions() {
    unsafe {
        // Register the sqlite-vec extension globally with SQLite.
        // Transmuting to *const () allows passing to rusqlite's ffi handler.
        let _ = rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite3_vec_init as *const (),
        )));
    }
}

pub fn get_db_path(app_data_dir: &Path, workspace_root: &str) -> PathBuf {
    // Bleeding-Edge: Compute unique SHA-256 hash of the canonicalized workspace path
    let canonical_path = Path::new(workspace_root)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(workspace_root));

    let mut hasher = Sha256::new();
    hasher.update(canonical_path.to_string_lossy().as_bytes());
    let hash_result = hex::encode(hasher.finalize());

    // Target System App Data Directory/workspaces/{hash}.db
    let mut dir = app_data_dir.to_path_buf();
    dir.push("workspaces");
    let _ = std::fs::create_dir_all(&dir);

    dir.push(format!("{}.db", hash_result));
    dir
}

pub fn init_db(db_path: &Path) -> Result<Connection> {
    // Register the extension before opening connection
    initialize_sqlite_extensions();

    let conn = Connection::open(db_path)?;

    // Enable foreign keys
    conn.execute("PRAGMA foreign_keys = ON;", [])?;

    // Schema Migration 1: files table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL,
            content TEXT NOT NULL,
            last_modified INTEGER NOT NULL,
            hash TEXT NOT NULL
        );",
        [],
    )?;

    // Schema Migration 2: symbols table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS symbols (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            kind TEXT NOT NULL,
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            signature TEXT,
            content_hash TEXT NOT NULL,
            FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
        );",
        [],
    )?;

    // Schema Migration 3: vec_symbols virtual table using sqlite-vec vec0 engine (768 dimensions)
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS vec_symbols USING vec0(
            symbol_id INTEGER PRIMARY KEY,
            embedding float[768]
        );",
        [],
    )?;

    Ok(conn)
}

#[derive(Clone, Debug)]
pub struct SymbolToEmbed {
    pub symbol_id: i64,
    pub name: String,
    pub content: String,
}

pub fn f32_slice_to_u8_slice(slice: &[f32]) -> &[u8] {
    // Zero-Copy casting from f32 slice to u8 slice for binary BLOB binding
    slice.as_bytes()
}

pub fn upsert_file_and_symbols(
    conn: &Connection,
    file_path: &str,
    content: &str,
    last_modified: i64,
    symbols: &[crate::parser::ASTSymbol],
) -> Result<Vec<SymbolToEmbed>> {
    // Clean UNC prefix if present
    let file_path = if file_path.starts_with(r"\\?\") {
        &file_path[4..]
    } else {
        file_path
    };

    // 1. Calculate the file content hash
    let mut file_hasher = Sha256::new();
    file_hasher.update(content.as_bytes());
    let file_hash = hex::encode(file_hasher.finalize());

    // 2. Check if the file already exists and has the same hash
    let existing_file: Option<(i64, String)> = conn
        .query_row(
            "SELECT id, hash FROM files WHERE path = ?1;",
            [file_path],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    let file_id = match existing_file {
        Some((_id, existing_hash)) if existing_hash == file_hash => {
            // File is unmodified. Return empty list, skipping re-indexing.
            return Ok(vec![]);
        }
        Some((id, _)) => {
            // File changed. Update the file record and delete existing symbols (cascading deletes virtual vector table rows too)
            conn.execute(
                "UPDATE files SET content = ?1, last_modified = ?2, hash = ?3 WHERE id = ?4;",
                rusqlite::params![content, last_modified, file_hash, id],
            )?;

            // Delete matching vector entries first since SQLite foreign keys don't cascade automatically to virtual tables
            conn.execute(
                "DELETE FROM vec_symbols WHERE symbol_id IN (SELECT id FROM symbols WHERE file_id = ?1);",
                [id],
            )?;
            conn.execute("DELETE FROM symbols WHERE file_id = ?1;", [id])?;
            id
        }
        None => {
            // New file. Insert record.
            conn.execute(
                "INSERT INTO files (path, content, last_modified, hash) VALUES (?1, ?2, ?3, ?4);",
                rusqlite::params![file_path, content, last_modified, file_hash],
            )?;
            conn.last_insert_rowid()
        }
    };

    // 3. Process new symbols and extract their code snippets
    let content_lines: Vec<&str> = content.lines().collect();
    let mut symbols_to_embed = vec![];

    for sym in symbols {
        // Extract symbol content/scope text to hash and embed
        let start = sym.start_line.saturating_sub(1);
        let end = sym.end_line;

        let sym_content = if start < content_lines.len() {
            let limit = end.min(content_lines.len());
            content_lines[start..limit].join("\n")
        } else {
            sym.name.clone()
        };

        let mut sym_hasher = Sha256::new();
        sym_hasher.update(sym_content.as_bytes());
        let sym_hash = hex::encode(sym_hasher.finalize());

        conn.execute(
            "INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, content_hash) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);",
            rusqlite::params![
                file_id,
                sym.name,
                sym.kind,
                sym.start_line as i64,
                sym.end_line as i64,
                sym.signature,
                sym_hash
            ],
        )?;

        let symbol_id = conn.last_insert_rowid();
        symbols_to_embed.push(SymbolToEmbed {
            symbol_id,
            name: sym.name.clone(),
            content: sym_content,
        });
    }

    Ok(symbols_to_embed)
}

pub fn save_embedding(conn: &Connection, symbol_id: i64, embedding: &[f32]) -> Result<()> {
    // Zero-Copy cast to binary blob and insert into vec0 virtual table
    let blob = f32_slice_to_u8_slice(embedding);
    conn.execute(
        "INSERT OR REPLACE INTO vec_symbols (symbol_id, embedding) VALUES (?1, ?2);",
        rusqlite::params![symbol_id, blob],
    )?;
    Ok(())
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct SearchResult {
    pub symbol_name: String,
    pub symbol_kind: String,
    pub file_path: String,
    pub start_line: i32,
    pub end_line: i32,
    pub similarity: f32, // Similarity = 1.0 - distance
}

pub fn search_symbols(
    conn: &Connection,
    query_embedding: &[f32],
    threshold: f32,
    limit: i32,
) -> Result<Vec<SearchResult>> {
    let query_blob = f32_slice_to_u8_slice(query_embedding);

    // We query vec_symbols for L2 distance (knn), then filter by similarity
    let mut stmt = conn.prepare(
        "SELECT s.name, s.kind, f.path, s.start_line, s.end_line, v.distance
         FROM vec_symbols v
         JOIN symbols s ON s.id = v.symbol_id
         JOIN files f ON f.id = s.file_id
         WHERE embedding MATCH ?1 AND k = ?2
         ORDER BY distance ASC;",
    )?;

    let rows = stmt.query_map(rusqlite::params![query_blob, limit], |row| {
        let distance: f64 = row.get(5)?;
        // For normalized vectors, L2 distance is directly related to similarity.
        // sqlite-vec distance function returns L2 squared distance.
        // Cosine distance = distance / 2 (for unit normalized vectors).
        // Cosine similarity = 1.0 - (distance / 2.0).
        let similarity = 1.0 - (distance as f32 / 2.0);

        Ok(SearchResult {
            symbol_name: row.get(0)?,
            symbol_kind: row.get(1)?,
            file_path: row.get(2)?,
            start_line: row.get(3)?,
            end_line: row.get(4)?,
            similarity,
        })
    })?;

    let mut results = vec![];
    for r in rows {
        let res = r?;
        if res.similarity >= threshold {
            results.push(res);
        }
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sqlite_vec_init_and_search() {
        initialize_sqlite_extensions();
        let conn = Connection::open_in_memory().unwrap();

        conn.execute("PRAGMA foreign_keys = ON;", []).unwrap();
        conn.execute(
            "CREATE TABLE files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT UNIQUE NOT NULL,
                content TEXT NOT NULL,
                last_modified INTEGER NOT NULL,
                hash TEXT NOT NULL
            );",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE TABLE symbols (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                start_line INTEGER NOT NULL,
                end_line INTEGER NOT NULL,
                signature TEXT,
                content_hash TEXT NOT NULL,
                FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
            );",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE VIRTUAL TABLE vec_symbols USING vec0(
                symbol_id INTEGER PRIMARY KEY,
                embedding float[768]
            );",
            [],
        )
        .unwrap();

        let file_path = "src/main.rs";
        let content = "fn test() {\n    println!(\"hello\");\n}";
        let last_modified = 12345;
        let mock_symbol = crate::parser::ASTSymbol {
            name: "test".to_string(),
            kind: "function".to_string(),
            start_line: 1,
            end_line: 3,
            signature: Some("fn test()".to_string()),
        };

        let syms_to_embed =
            upsert_file_and_symbols(&conn, file_path, content, last_modified, &[mock_symbol])
                .unwrap();
        assert_eq!(syms_to_embed.len(), 1);
        let sym_id = syms_to_embed[0].symbol_id;

        let mut embedding = vec![0.0f32; 768];
        embedding[0] = 1.0f32;
        save_embedding(&conn, sym_id, &embedding).unwrap();

        let mut query = vec![0.0f32; 768];
        query[0] = 1.0f32;
        let results = search_symbols(&conn, &query, 0.5, 5).unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].symbol_name, "test");
        assert_eq!(results[0].symbol_kind, "function");
        assert_eq!(results[0].file_path, "src/main.rs");
        assert_eq!(results[0].start_line, 1);
        assert_eq!(results[0].end_line, 3);
        assert!((results[0].similarity - 1.0).abs() < 1e-5);
    }
}
