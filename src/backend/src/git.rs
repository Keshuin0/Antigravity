use git2::{Repository, ResetType, StatusOptions};
use std::path::Path;

#[derive(serde::Serialize, Debug, Clone)]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
}

/// Checks if a directory is a valid Git repository.
pub fn is_git_repo(path: &str) -> bool {
    Repository::discover(path).is_ok()
}

fn open_repo(path: &str) -> Result<Repository, String> {
    Repository::discover(path)
        .map_err(|e| format!("Failed to discover repository for path '{}': {}", path, e))
}

/// Initializes a new Git repository at the specified path.
pub fn git_init(path: &str) -> Result<(), String> {
    Repository::init(path)
        .map(|_| ())
        .map_err(|e| format!("Failed to initialize Git repository: {}", e))
}

/// Retrieves the name of the current active branch.
pub fn git_current_branch(path: &str) -> Result<String, String> {
    let repo = open_repo(path)?;
    if repo.head_detached().unwrap_or(false) {
        return Ok("DETACHED".to_string());
    }
    let head = repo
        .head()
        .map_err(|e| format!("Failed to get HEAD: {}", e))?;
    let name = head.shorthand().unwrap_or("unknown").to_string();
    Ok(name)
}

/// Gets the status of files in the workspace (staged, modified, untracked).
pub fn git_status(path: &str) -> Result<Vec<GitFileStatus>, String> {
    let repo = open_repo(path)?;
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
    let repo = open_repo(path)?;
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

/// Unstages specific files in the index.
pub fn git_unstage_files(path: &str, files: Vec<String>) -> Result<(), String> {
    let repo = open_repo(path)?;

    // Find HEAD commit target. If HEAD is unborn, we reset default to empty tree.
    let head_commit = match repo.head() {
        Ok(head) => {
            let commit = head.peel_to_commit().map_err(|e| e.to_string())?;
            Some(commit.into_object())
        }
        Err(_) => None,
    };

    repo.reset_default(head_commit.as_ref(), files.iter().map(Path::new))
        .map_err(|e| format!("Failed to unstage files: {}", e))
}

/// Creates a new commit with staged changes and returns the commit hash.
pub fn git_create_commit(path: &str, message: &str) -> Result<String, String> {
    let repo = open_repo(path)?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    let tree_id = index
        .write_tree()
        .map_err(|e| format!("Failed to write index tree: {}", e))?;
    let tree = repo
        .find_tree(tree_id)
        .map_err(|e| format!("Failed to find index tree: {}", e))?;

    let sig = repo
        .signature()
        .or_else(|_| git2::Signature::now("Antigravity Engine", "agent@antigravity.ai"))
        .map_err(|e| format!("Failed to resolve signature: {}", e))?;

    let head_commit = match repo.head() {
        Ok(head) => Some(head.peel_to_commit().map_err(|e| e.to_string())?),
        Err(_) => None,
    };

    let parents = match &head_commit {
        Some(c) => vec![c],
        None => vec![],
    };

    let commit_id = repo
        .commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
        .map_err(|e| format!("Failed to create commit: {}", e))?;

    Ok(commit_id.to_string())
}

/// Creates a new branch from the current HEAD commit.
pub fn git_create_branch(path: &str, name: &str) -> Result<(), String> {
    let repo = open_repo(path)?;
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
    let repo = open_repo(path)?;

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
    let repo = open_repo(path)?;
    let oid = git2::Oid::from_str(commit_hash)
        .map_err(|e| format!("Invalid commit hash format: {}", e))?;
    let target = repo
        .find_commit(oid)
        .map_err(|e| format!("Failed to find target commit: {}", e))?;

    repo.reset(target.as_object(), ResetType::Hard, None)
        .map_err(|e| format!("Failed hard reset rollback: {}", e))
}

/// Generates a unified diff of staged changes.
pub fn git_diff_staged(path: &str) -> Result<String, String> {
    let repo = open_repo(path)?;
    let index = repo.index().map_err(|e| e.to_string())?;

    // Get HEAD tree. If HEAD does not exist, compare against an empty tree.
    let head_tree = match repo.head() {
        Ok(head) => {
            let commit = head.peel_to_commit().map_err(|e| e.to_string())?;
            Some(commit.tree().map_err(|e| e.to_string())?)
        }
        Err(_) => None,
    };

    let mut diff_opts = git2::DiffOptions::new();
    let diff = repo
        .diff_tree_to_index(head_tree.as_ref(), Some(&index), Some(&mut diff_opts))
        .map_err(|e| e.to_string())?;

    let mut diff_str = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        if let Ok(s) = std::str::from_utf8(line.content()) {
            match line.origin() {
                '+' | '-' | ' ' => {
                    diff_str.push(line.origin());
                    diff_str.push_str(s);
                }
                _ => {
                    diff_str.push_str(s);
                }
            }
        }
        true
    })
    .map_err(|e| e.to_string())?;

    Ok(diff_str)
}

/// Retrieves the content of a file as of the last HEAD commit.
pub fn git_get_file_at_head(repo_path: &str, file_path: &str) -> Result<String, String> {
    let repo = open_repo(repo_path)?;

    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return Ok(String::new()), // Empty if no commits yet
    };

    let commit = head.peel_to_commit().map_err(|e| e.to_string())?;
    let tree = commit.tree().map_err(|e| e.to_string())?;

    // Normalize path separators to forward slashes for git2
    let normalized_path = file_path.replace('\\', "/");

    let entry = match tree.get_path(Path::new(&normalized_path)) {
        Ok(entry) => entry,
        Err(_) => return Ok(String::new()), // File not found in HEAD
    };

    let object = entry.to_object(&repo).map_err(|e| e.to_string())?;
    let blob = object.as_blob().ok_or("Object is not a blob")?;

    let content = std::str::from_utf8(blob.content())
        .map_err(|e| format!("Failed to read blob as UTF-8 string: {}", e))?;

    Ok(content.to_string())
}

fn get_git_executable() -> String {
    // 1. Check if git is available on PATH
    if std::process::Command::new("git")
        .arg("--version")
        .output()
        .is_ok()
    {
        return "git".to_string();
    }

    // 2. Check standard GitHub Desktop paths on D: drive
    if let Ok(entries) = std::fs::read_dir("D:\\Softwares\\Installed\\GitHubDesktop") {
        let mut app_dirs: Vec<std::path::PathBuf> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.is_dir()
                    && p.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("")
                        .starts_with("app-")
            })
            .collect();
        // Sort to get the latest app version
        app_dirs.sort();
        if let Some(latest_app) = app_dirs.last() {
            let cmd_path = latest_app.join("resources\\app\\git\\cmd\\git.exe");
            if cmd_path.exists() {
                return cmd_path.to_string_lossy().to_string();
            }
            let bin_path = latest_app.join("resources\\app\\git\\mingw64\\bin\\git.exe");
            if bin_path.exists() {
                return bin_path.to_string_lossy().to_string();
            }
        }
    }

    // Fallback to "git"
    "git".to_string()
}

/// Synchronizes (pushes) the active branch to the remote branch of 'origin'.
pub fn git_push(path: &str) -> Result<(), String> {
    let branch = git_current_branch(path)?;
    if branch == "DETACHED" {
        return Err("Cannot push in detached HEAD state".to_string());
    }

    // Run system command `git push origin <branch>` synchronously
    let git_exe = get_git_executable();
    let output = std::process::Command::new(git_exe)
        .args(["push", "origin", &branch])
        .current_dir(path)
        .output()
        .map_err(|e| format!("Failed to execute git push: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Git push failed: {}", stderr.trim()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{create_dir_all, remove_dir_all, File};
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

    #[test]
    fn test_git_diff_and_head_retrieval() {
        let temp_dir = get_temp_git_dir();
        let temp_dir_str = temp_dir.to_str().unwrap();

        // Initialize repo
        git_init(temp_dir_str).unwrap();

        // 1. Check diff on unborn branch before anything staged
        let empty_diff = git_diff_staged(temp_dir_str).unwrap();
        assert!(empty_diff.is_empty());

        // 2. Stage a file
        let file_path = temp_dir.join("test_file.txt");
        {
            let mut file = File::create(&file_path).unwrap();
            writeln!(file, "Hello, Git Diff!").unwrap();
        }
        git_stage_files(temp_dir_str, vec!["test_file.txt".to_string()]).unwrap();

        // 3. Diff should show the added file contents since HEAD is unborn
        let staged_diff = git_diff_staged(temp_dir_str).unwrap();
        assert!(staged_diff.contains("+Hello, Git Diff!"));

        // 4. Check file at head (should be empty since it is not committed yet)
        let head_content = git_get_file_at_head(temp_dir_str, "test_file.txt").unwrap();
        assert!(head_content.is_empty());

        // 5. Commit it
        git_create_commit(temp_dir_str, "commit for diff test").unwrap();

        // 6. Check file at head (should contain the committed content)
        let committed_head_content = git_get_file_at_head(temp_dir_str, "test_file.txt").unwrap();
        assert_eq!(
            committed_head_content.replace("\r\n", "\n"),
            "Hello, Git Diff!\n"
        );

        // 7. Modify it
        {
            let mut file = File::create(&file_path).unwrap();
            writeln!(file, "Hello, Git Diff!\nModified line.").unwrap();
        }
        git_stage_files(temp_dir_str, vec!["test_file.txt".to_string()]).unwrap();

        // 8. Diff should show the changes relative to HEAD
        let diff_after_mod = git_diff_staged(temp_dir_str).unwrap();
        assert!(diff_after_mod.contains("+Modified line."));

        // Cleanup
        let _ = remove_dir_all(&temp_dir);
    }
}
