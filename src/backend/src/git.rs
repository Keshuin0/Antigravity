use git2::{Repository, ResetType, StatusOptions};
use std::path::Path;

#[derive(serde::Serialize, Debug, Clone)]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
}

/// Checks if a directory is a valid Git repository.
pub fn is_git_repo(path: &str) -> bool {
    Repository::open(path).is_ok()
}

/// Initializes a new Git repository at the specified path.
pub fn git_init(path: &str) -> Result<(), String> {
    Repository::init(path)
        .map(|_| ())
        .map_err(|e| format!("Failed to initialize Git repository: {}", e))
}

/// Retrieves the name of the current active branch.
pub fn git_current_branch(path: &str) -> Result<String, String> {
    let repo = Repository::open(path).map_err(|e| e.to_string())?;
    if repo.head_detached().unwrap_or(false) {
        return Ok("DETACHED".to_string());
    }
    let head = repo.head().map_err(|e| format!("Failed to get HEAD: {}", e))?;
    let name = head
        .shorthand()
        .unwrap_or("unknown")
        .to_string();
    Ok(name)
}

/// Gets the status of files in the workspace (staged, modified, untracked).
pub fn git_status(path: &str) -> Result<Vec<GitFileStatus>, String> {
    let repo = Repository::open(path).map_err(|e| e.to_string())?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);

    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| format!("Failed to get repository status: {}", e))?;

    let mut results = Vec::new();
    for entry in statuses.iter() {
        let file_path = entry.path().unwrap_or("").to_string();
        let status_flags = entry.status();

        let status_str = if status_flags.is_index_new()
            || status_flags.is_index_modified()
            || status_flags.is_index_deleted()
            || status_flags.is_index_renamed()
            || status_flags.is_index_typechange()
        {
            "Staged"
        } else if status_flags.is_wt_new() {
            "Untracked"
        } else if status_flags.is_wt_modified()
            || status_flags.is_wt_deleted()
            || status_flags.is_wt_typechange()
            || status_flags.is_wt_renamed()
        {
            "Modified"
        } else {
            "Unknown"
        };

        results.push(GitFileStatus {
            path: file_path,
            status: status_str.to_string(),
        });
    }

    Ok(results)
}

/// Stages specific files in the index.
pub fn git_stage_files(path: &str, files: Vec<String>) -> Result<(), String> {
    let repo = Repository::open(path).map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    
    for file in files {
        let file_path = Path::new(&file);
        index
            .add_path(file_path)
            .map_err(|e| format!("Failed to stage file '{}': {}", file, e))?;
    }
    
    index
        .write()
        .map_err(|e| format!("Failed to write index: {}", e))
}

/// Creates a new commit with staged changes and returns the commit hash.
pub fn git_create_commit(path: &str, message: &str) -> Result<String, String> {
    let repo = Repository::open(path).map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    let tree_id = index
        .write_tree()
        .map_err(|e| format!("Failed to write index tree: {}", e))?;
    let tree = repo
        .find_tree(tree_id)
        .map_err(|e| format!("Failed to find index tree: {}", e))?;

    let sig = repo.signature().or_else(|_| {
        git2::Signature::now("Antigravity Engine", "agent@antigravity.ai")
    }).map_err(|e| format!("Failed to resolve signature: {}", e))?;

    let head_commit = match repo.head() {
        Ok(head) => Some(head.peel_to_commit().map_err(|e| e.to_string())?),
        Err(_) => None,
    };

    let parents = match &head_commit {
        Some(c) => vec![c],
        None => vec![],
    };

    let commit_id = repo
        .commit(
            Some("HEAD"),
            &sig,
            &sig,
            message,
            &tree,
            &parents,
        )
        .map_err(|e| format!("Failed to create commit: {}", e))?;

    Ok(commit_id.to_string())
}

/// Creates a new branch from the current HEAD commit.
pub fn git_create_branch(path: &str, name: &str) -> Result<(), String> {
    let repo = Repository::open(path).map_err(|e| e.to_string())?;
    let head_commit = repo
        .head()
        .and_then(|h| h.peel_to_commit())
        .map_err(|e| format!("Failed to peel HEAD to commit: {}", e))?;

    repo.branch(name, &head_commit, false)
        .map(|_| ())
        .map_err(|e| format!("Failed to create branch '{}': {}", name, e))
}

/// Safely switches checkout references to a specified branch.
pub fn git_checkout_branch(path: &str, name: &str) -> Result<(), String> {
    let repo = Repository::open(path).map_err(|e| e.to_string())?;
    
    let obj = repo
        .revparse_single(&format!("refs/heads/{}", name))
        .or_else(|_| repo.revparse_single(name))
        .map_err(|e| format!("Branch or commit '{}' not found: {}", name, e))?;

    let mut opts = git2::build::CheckoutBuilder::new();
    opts.force();

    repo.checkout_tree(&obj, Some(&mut opts))
        .map_err(|e| format!("Failed to checkout tree: {}", e))?;

    repo.set_head(&format!("refs/heads/{}", name))
        .or_else(|_| repo.set_head_detached(obj.id()))
        .map_err(|e| format!("Failed to set HEAD reference: {}", e))
}

/// Reverts the working index and directory hard to a specific commit.
pub fn git_rollback_to_commit(path: &str, commit_hash: &str) -> Result<(), String> {
    let repo = Repository::open(path).map_err(|e| e.to_string())?;
    let oid = git2::Oid::from_str(commit_hash)
        .map_err(|e| format!("Invalid commit hash format: {}", e))?;
    let target = repo
        .find_commit(oid)
        .map_err(|e| format!("Failed to find target commit: {}", e))?;

    repo.reset(target.as_object(), ResetType::Hard, None)
        .map_err(|e| format!("Failed hard reset rollback: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{File, create_dir_all, remove_dir_all};
    use std::io::Write;
    use std::time::SystemTime;

    fn get_temp_git_dir() -> std::path::PathBuf {
        let mut path = std::env::temp_dir();
        let duration = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        path.push(format!("antigravity_git_test_{}", duration));
        create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn test_git_workflow() {
        let temp_dir = get_temp_git_dir();
        let temp_dir_str = temp_dir.to_str().unwrap();

        // 1. Test init
        assert!(!is_git_repo(temp_dir_str));
        assert!(git_init(temp_dir_str).is_ok());
        assert!(is_git_repo(temp_dir_str));

        // 2. Test status is empty initially
        let status = git_status(temp_dir_str).unwrap();
        assert!(status.is_empty());

        // 3. Test untracked file
        let file_path = temp_dir.join("test_file.txt");
        {
            let mut file = File::create(&file_path).unwrap();
            writeln!(file, "Hello, Git FFI!").unwrap();
        }
        let status = git_status(temp_dir_str).unwrap();
        assert_eq!(status.len(), 1);
        assert_eq!(status[0].path, "test_file.txt");
        assert_eq!(status[0].status, "Untracked");

        // 4. Test stage file
        assert!(git_stage_files(temp_dir_str, vec!["test_file.txt".to_string()]).is_ok());
        let status = git_status(temp_dir_str).unwrap();
        assert_eq!(status.len(), 1);
        assert_eq!(status[0].status, "Staged");

        // 5. Test commit
        let commit_hash = git_create_commit(temp_dir_str, "initial commit").unwrap();
        assert!(!commit_hash.is_empty());
        let status = git_status(temp_dir_str).unwrap();
        assert!(status.is_empty());

        // 6. Test branch creation and checkout
        let current_branch = git_current_branch(temp_dir_str).unwrap();
        assert!(current_branch == "master" || current_branch == "main");
        
        assert!(git_create_branch(temp_dir_str, "sandbox").is_ok());
        assert!(git_checkout_branch(temp_dir_str, "sandbox").is_ok());
        assert_eq!(git_current_branch(temp_dir_str).unwrap(), "sandbox");

        // 7. Modify file on sandbox branch
        {
            let mut file = File::create(&file_path).unwrap();
            writeln!(file, "Modified content in sandbox").unwrap();
        }
        let status = git_status(temp_dir_str).unwrap();
        assert_eq!(status.len(), 1);
        assert_eq!(status[0].status, "Modified");

        // 8. Stage and commit on sandbox branch
        assert!(git_stage_files(temp_dir_str, vec!["test_file.txt".to_string()]).is_ok());
        let _sandbox_commit = git_create_commit(temp_dir_str, "sandbox commit").unwrap();

        // 9. Test rollback to initial commit on sandbox branch
        assert!(git_rollback_to_commit(temp_dir_str, &commit_hash).is_ok());
        let content = std::fs::read_to_string(&file_path).unwrap();
        // Normalize CRLF to LF for tests stability
        let content_lf = content.replace("\r\n", "\n");
        assert_eq!(content_lf, "Hello, Git FFI!\n");

        // 10. Switch back to master and verify
        assert!(git_checkout_branch(temp_dir_str, &current_branch).is_ok());
        assert_eq!(git_current_branch(temp_dir_str).unwrap(), current_branch);

        // Cleanup
        let _ = remove_dir_all(&temp_dir);
    }
}
