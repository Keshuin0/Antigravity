# ?? Antigravity Contribution Guidelines 
 
## ?? Branch Strategy Regulation 
* **Production Main Freeze**: Direct commits or force-pushes to the `main` branch are strictly prohibited by active protection rules. 
* **Integration Target**: All functional code additions, dependency upgrades, and layer component engineering must target the `dev` branch. 
* **Branch Naming Standard**: Feature branches must utilize clear prefixes: `feature/`, `bugfix/`, or `architecture/`. 
 
## ?? Conventional Commits Specification 
Every commit message must align strictly to structured formatting bounds: 
* `feat(backend):` Incremental kernel features, builder struct extensions, or database additions 
* `fix(frontend):` UI state adjustments, Monaco API corrections, or style overrides 
* `perf(context):` SIMD intrinsic adjustments, memory allocation removals, or query pruning 
