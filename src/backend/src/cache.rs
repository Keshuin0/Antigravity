use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::fs;
use crate::parser::{ASTSymbol, parse_file};

pub struct SymbolCache {
    capacity: usize,
    cache: HashMap<PathBuf, Vec<ASTSymbol>>,
    order: VecDeque<PathBuf>,
}

impl SymbolCache {
    pub fn new(capacity: usize) -> Self {
        SymbolCache {
            capacity,
            cache: HashMap::new(),
            order: VecDeque::new(),
        }
    }

    pub fn get(&mut self, path: &Path) -> Option<Vec<ASTSymbol>> {
        let path_buf = path.to_path_buf();
        if self.cache.contains_key(&path_buf) {
            // Update LRU order
            if let Some(pos) = self.order.iter().position(|p| p == &path_buf) {
                self.order.remove(pos);
            }
            self.order.push_back(path_buf.clone());
            self.cache.get(&path_buf).cloned()
        } else {
            // Lazy load and parse if file exists
            if let Ok(content) = fs::read_to_string(path) {
                if let Ok(symbols) = parse_file(path, &content) {
                    self.insert(path_buf, symbols.clone());
                    return Some(symbols);
                }
            }
            None
        }
    }

    pub fn insert(&mut self, path: PathBuf, symbols: Vec<ASTSymbol>) {
        if self.cache.contains_key(&path) {
            if let Some(pos) = self.order.iter().position(|p| p == &path) {
                self.order.remove(pos);
            }
        } else if self.order.len() >= self.capacity {
            // Evict LRU item
            if let Some(lru) = self.order.pop_front() {
                self.cache.remove(&lru);
            }
        }
        
        self.order.push_back(path.clone());
        self.cache.insert(path, symbols);
    }

    pub fn invalidate(&mut self, path: &Path) {
        let path_buf = path.to_path_buf();
        self.cache.remove(&path_buf);
        if let Some(pos) = self.order.iter().position(|p| p == &path_buf) {
            self.order.remove(pos);
        }
    }

    pub fn update_file(&mut self, path: &Path, content: &str) -> Result<Vec<ASTSymbol>, String> {
        let symbols = parse_file(path, content)?;
        self.insert(path.to_path_buf(), symbols.clone());
        Ok(symbols)
    }

    pub fn clear(&mut self) {
        self.cache.clear();
        self.order.clear();
    }

    pub fn get_all_cached_symbols(&self) -> Vec<(PathBuf, Vec<ASTSymbol>)> {
        self.cache.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }
}
