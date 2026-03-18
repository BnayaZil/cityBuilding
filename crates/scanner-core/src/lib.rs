use anyhow::{Context, Result};
use chrono::Utc;
use city_building_schema::{
    Checks, CityBlueprint, DistrictHint, FileNode, Hints, SourceInfo, SourceType, Stats, Symbol,
    SymbolLocation, SymbolMember, SymbolType, Visibility,
};
use globset::{Glob, GlobSet, GlobSetBuilder};
use regex::Regex;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

#[derive(Debug, Clone)]
pub struct ScanOptions {
    pub source_type: SourceType,
    pub repo: String,
    pub sha: String,
    pub branch: String,
    pub checks: Option<Checks>,
    pub timestamp_override: Option<String>,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            source_type: SourceType::Cli,
            repo: "local/local".to_string(),
            sha: "unknown".to_string(),
            branch: "main".to_string(),
            checks: None,
            timestamp_override: None,
        }
    }
}

#[derive(Debug, Deserialize, Default)]
struct CityConfig {
    #[serde(default)]
    ignore: Vec<String>,
    #[serde(default)]
    hints: Option<Hints>,
}

pub fn scan_path(root: impl AsRef<Path>, options: ScanOptions) -> Result<CityBlueprint> {
    let root = root.as_ref();
    let config = load_config(root)?;
    validate_hints(config.hints.as_ref())?;
    let matcher = build_ignore_matcher(&config.ignore)?;

    let mut files = BTreeMap::<String, FileNode>::new();
    let mut pending_imports = Vec::<(String, String)>::new();

    for entry in WalkDir::new(root).follow_links(false) {
        let entry = entry?;
        if entry.file_type().is_symlink() || !entry.file_type().is_file() {
            continue;
        }

        let rel = relative_path(root, entry.path())?;
        if matcher.is_match(&rel) {
            continue;
        }
        if rel == ".city.yml" {
            continue;
        }

        let Some(lang) = detect_lang(entry.path()) else {
            continue;
        };

        let Ok(content) = fs::read_to_string(entry.path()) else {
            continue;
        };

        let symbols = extract_symbols(lang, &content);
        let imports = extract_imports(lang, &content);
        for import in imports {
            pending_imports.push((rel.clone(), import));
        }

        files.insert(
            rel,
            FileNode {
                lang: lang.to_string(),
                symbols,
            },
        );
    }

    let file_set = files.keys().cloned().collect::<HashSet<_>>();
    let mut edge_set = BTreeSet::<(String, String)>::new();
    for (from, import) in pending_imports {
        if let Some(to) = resolve_import(root, &from, &import, &file_set) {
            if to != from {
                edge_set.insert((from.clone(), to));
            }
        }
    }

    let edges = edge_set
        .into_iter()
        .map(|(a, b)| [a, b])
        .collect::<Vec<[String; 2]>>();

    let mut langs = BTreeMap::<String, u32>::new();
    let mut symbol_count: u32 = 0;
    for file in files.values() {
        *langs.entry(file.lang.clone()).or_insert(0) += 1;
        for symbol in &file.symbols {
            symbol_count += 1;
            symbol_count += symbol.members.len() as u32;
        }
    }

    let stats = Stats {
        files: files.len() as u32,
        symbols: symbol_count,
        langs,
    };

    let hash = compute_blueprint_hash(&files, &edges, &stats)?;

    Ok(CityBlueprint {
        v: "1.0.0".to_string(),
        ts: options
            .timestamp_override
            .unwrap_or_else(|| Utc::now().to_rfc3339()),
        hash,
        source: SourceInfo {
            source_type: options.source_type,
            repo: options.repo,
            sha: options.sha,
            branch: options.branch,
        },
        checks: options.checks,
        stats,
        hints: config.hints,
        files,
        edges,
    })
}

fn load_config(root: &Path) -> Result<CityConfig> {
    let config_path = root.join(".city.yml");
    if !config_path.exists() {
        return Ok(CityConfig::default());
    }
    let content = fs::read_to_string(&config_path)
        .with_context(|| format!("failed to read {}", config_path.display()))?;
    let parsed: CityConfig = serde_yaml::from_str(&content)
        .with_context(|| format!("failed to parse {}", config_path.display()))?;
    Ok(parsed)
}

fn validate_hints(hints: Option<&Hints>) -> Result<()> {
    if let Some(hints) = hints {
        for DistrictHint { path, .. } in &hints.districts {
            if path.trim().is_empty() {
                anyhow::bail!("invalid hints.districts entry: path is required");
            }
        }
    }
    Ok(())
}

fn build_ignore_matcher(ignore_patterns: &[String]) -> Result<GlobSet> {
    let mut builder = GlobSetBuilder::new();
    for pattern in ignore_patterns {
        builder.add(Glob::new(pattern)?);
        let has_glob = pattern.contains('*') || pattern.contains('?') || pattern.contains('[');
        if !has_glob {
            builder.add(Glob::new(&format!("{pattern}/**"))?);
            builder.add(Glob::new(&format!("**/{pattern}/**"))?);
        }
    }
    Ok(builder.build()?)
}

fn relative_path(root: &Path, file: &Path) -> Result<String> {
    let rel = file
        .strip_prefix(root)
        .with_context(|| format!("{} is not under {}", file.display(), root.display()))?;
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

fn detect_lang(path: &Path) -> Option<&'static str> {
    match path.extension().and_then(|x| x.to_str()) {
        Some("ts") | Some("tsx") => Some("ts"),
        Some("js") | Some("jsx") => Some("js"),
        Some("py") => Some("py"),
        Some("java") => Some("java"),
        Some("go") => Some("go"),
        Some("rs") => Some("rs"),
        Some("cs") => Some("cs"),
        _ => None,
    }
}

fn extract_symbols(lang: &str, content: &str) -> Vec<Symbol> {
    let class_re =
        Regex::new(r"^\s*(?:export\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)").expect("valid regex");
    let iface_re =
        Regex::new(r"^\s*(?:export\s+)?interface\s+([A-Za-z_][A-Za-z0-9_]*)").expect("valid regex");
    let enum_re =
        Regex::new(r"^\s*(?:export\s+)?enum\s+([A-Za-z_][A-Za-z0-9_]*)").expect("valid regex");
    let fn_re =
        Regex::new(r"^\s*(?:export\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)").expect("valid regex");
    let var_re = Regex::new(r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)")
        .expect("valid regex");

    let py_class_re = Regex::new(r"^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)").expect("valid regex");
    let py_fn_re = Regex::new(r"^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\(").expect("valid regex");

    let go_fn_re = Regex::new(r"^\s*func\s+([A-Za-z_][A-Za-z0-9_]*)\(").expect("valid regex");
    let rust_struct_re =
        Regex::new(r"^\s*(pub\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)").expect("valid regex");
    let rust_enum_re =
        Regex::new(r"^\s*(pub\s+)?enum\s+([A-Za-z_][A-Za-z0-9_]*)").expect("valid regex");
    let rust_fn_re =
        Regex::new(r"^\s*(pub\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\(").expect("valid regex");
    let java_cs_class_re =
        Regex::new(r"^\s*(public|private|protected|internal)?\s*class\s+([A-Za-z_][A-Za-z0-9_]*)")
            .expect("valid regex");
    let method_re =
        Regex::new(r"^\s*(public|private|protected|internal|pub)?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(")
            .expect("valid regex");

    let mut symbols: Vec<Symbol> = Vec::new();
    let mut current_class_idx: Option<usize> = None;
    let mut class_depth = 0i32;

    for (idx, line) in content.lines().enumerate() {
        let line_no = (idx + 1) as u32;
        let trimmed = line.trim();

        if trimmed.contains('{') {
            class_depth += trimmed.matches('{').count() as i32;
        }
        if trimmed.contains('}') {
            class_depth -= trimmed.matches('}').count() as i32;
            if class_depth <= 0 {
                current_class_idx = None;
            }
        }

        if let Some(c) = class_re.captures(line) {
            let name = c[1].to_string();
            current_class_idx = Some(symbols.len());
            symbols.push(Symbol {
                name,
                symbol_type: SymbolType::Class,
                vis: ts_like_visibility(line),
                members: vec![],
                loc: Some(SymbolLocation {
                    start_line: line_no,
                    end_line: line_no,
                }),
            });
            continue;
        }
        if let Some(c) = iface_re.captures(line) {
            symbols.push(Symbol {
                name: c[1].to_string(),
                symbol_type: SymbolType::Interface,
                vis: ts_like_visibility(line),
                members: vec![],
                loc: Some(SymbolLocation {
                    start_line: line_no,
                    end_line: line_no,
                }),
            });
            continue;
        }
        if let Some(c) = enum_re.captures(line) {
            symbols.push(Symbol {
                name: c[1].to_string(),
                symbol_type: SymbolType::Enum,
                vis: ts_like_visibility(line),
                members: vec![],
                loc: Some(SymbolLocation {
                    start_line: line_no,
                    end_line: line_no,
                }),
            });
            continue;
        }
        if let Some(c) = fn_re.captures(line) {
            symbols.push(Symbol {
                name: c[1].to_string(),
                symbol_type: SymbolType::Function,
                vis: ts_like_visibility(line),
                members: vec![],
                loc: Some(SymbolLocation {
                    start_line: line_no,
                    end_line: line_no,
                }),
            });
            continue;
        }
        if let Some(c) = var_re.captures(line) {
            symbols.push(Symbol {
                name: c[1].to_string(),
                symbol_type: SymbolType::Variable,
                vis: ts_like_visibility(line),
                members: vec![],
                loc: Some(SymbolLocation {
                    start_line: line_no,
                    end_line: line_no,
                }),
            });
            continue;
        }

        match lang {
            "py" => {
                if let Some(c) = py_class_re.captures(line) {
                    symbols.push(Symbol {
                        name: c[1].to_string(),
                        symbol_type: SymbolType::Class,
                        vis: Visibility::Public,
                        members: vec![],
                        loc: Some(SymbolLocation {
                            start_line: line_no,
                            end_line: line_no,
                        }),
                    });
                    continue;
                }
                if let Some(c) = py_fn_re.captures(line) {
                    symbols.push(Symbol {
                        name: c[1].to_string(),
                        symbol_type: SymbolType::Function,
                        vis: Visibility::Internal,
                        members: vec![],
                        loc: Some(SymbolLocation {
                            start_line: line_no,
                            end_line: line_no,
                        }),
                    });
                    continue;
                }
            }
            "go" => {
                if let Some(c) = go_fn_re.captures(line) {
                    let name = c[1].to_string();
                    let vis = if name.chars().next().map(|ch| ch.is_uppercase()) == Some(true) {
                        Visibility::Exported
                    } else {
                        Visibility::Private
                    };
                    symbols.push(Symbol {
                        name,
                        symbol_type: SymbolType::Function,
                        vis,
                        members: vec![],
                        loc: Some(SymbolLocation {
                            start_line: line_no,
                            end_line: line_no,
                        }),
                    });
                    continue;
                }
            }
            "rs" => {
                if let Some(c) = rust_struct_re.captures(line) {
                    symbols.push(Symbol {
                        name: c[2].to_string(),
                        symbol_type: SymbolType::Class,
                        vis: if c.get(1).is_some() {
                            Visibility::Exported
                        } else {
                            Visibility::Private
                        },
                        members: vec![],
                        loc: Some(SymbolLocation {
                            start_line: line_no,
                            end_line: line_no,
                        }),
                    });
                    continue;
                }
                if let Some(c) = rust_enum_re.captures(line) {
                    symbols.push(Symbol {
                        name: c[2].to_string(),
                        symbol_type: SymbolType::Enum,
                        vis: if c.get(1).is_some() {
                            Visibility::Exported
                        } else {
                            Visibility::Private
                        },
                        members: vec![],
                        loc: Some(SymbolLocation {
                            start_line: line_no,
                            end_line: line_no,
                        }),
                    });
                    continue;
                }
                if let Some(c) = rust_fn_re.captures(line) {
                    symbols.push(Symbol {
                        name: c[2].to_string(),
                        symbol_type: SymbolType::Function,
                        vis: if c.get(1).is_some() {
                            Visibility::Exported
                        } else {
                            Visibility::Private
                        },
                        members: vec![],
                        loc: Some(SymbolLocation {
                            start_line: line_no,
                            end_line: line_no,
                        }),
                    });
                    continue;
                }
            }
            "java" | "cs" => {
                if let Some(c) = java_cs_class_re.captures(line) {
                    let vis = map_visibility_keyword(c.get(1).map(|m| m.as_str()));
                    symbols.push(Symbol {
                        name: c[2].to_string(),
                        symbol_type: SymbolType::Class,
                        vis,
                        members: vec![],
                        loc: Some(SymbolLocation {
                            start_line: line_no,
                            end_line: line_no,
                        }),
                    });
                    continue;
                }
            }
            _ => {}
        }

        if let Some(class_idx) = current_class_idx {
            if let Some(c) = method_re.captures(line) {
                let method_name = c[2].to_string();
                if !is_keyword_method_name(&method_name) {
                    symbols[class_idx].members.push(SymbolMember {
                        name: method_name,
                        symbol_type: SymbolType::Method,
                        vis: map_visibility_keyword(c.get(1).map(|m| m.as_str())),
                        loc: Some(SymbolLocation {
                            start_line: line_no,
                            end_line: line_no,
                        }),
                    });
                }
            }
        }
    }

    symbols
}

fn is_keyword_method_name(name: &str) -> bool {
    matches!(
        name,
        "if" | "for" | "while" | "switch" | "catch" | "return" | "function" | "class"
    )
}

fn map_visibility_keyword(keyword: Option<&str>) -> Visibility {
    match keyword {
        Some("public") | Some("pub") => Visibility::Public,
        Some("private") => Visibility::Private,
        Some("protected") => Visibility::Protected,
        Some("internal") => Visibility::Internal,
        _ => Visibility::Private,
    }
}

fn ts_like_visibility(line: &str) -> Visibility {
    if line.contains("export ") {
        Visibility::Exported
    } else {
        Visibility::Private
    }
}

fn extract_imports(lang: &str, content: &str) -> Vec<String> {
    let mut imports = Vec::new();
    let ts_import_re =
        Regex::new(r#"^\s*(?:import|export)\b.*from\s+['"]([^'"]+)['"]"#).expect("valid regex");
    let ts_dyn_import_re = Regex::new(r#"import\(\s*['"]([^'"]+)['"]\s*\)"#).expect("valid regex");
    let py_import_re =
        Regex::new(r"^\s*from\s+([A-Za-z0-9_\.]+)\s+import\s+").expect("valid regex");
    let go_import_re = Regex::new(r#"^\s*import\s+"([^"]+)""#).expect("valid regex");
    let rust_use_re = Regex::new(r"^\s*use\s+([A-Za-z0-9_:]+)").expect("valid regex");

    for line in content.lines() {
        match lang {
            "ts" | "js" => {
                if let Some(c) = ts_import_re.captures(line) {
                    imports.push(c[1].to_string());
                }
                if let Some(c) = ts_dyn_import_re.captures(line) {
                    imports.push(c[1].to_string());
                }
            }
            "py" => {
                if let Some(c) = py_import_re.captures(line) {
                    imports.push(c[1].to_string());
                }
            }
            "go" => {
                if let Some(c) = go_import_re.captures(line) {
                    imports.push(c[1].to_string());
                }
            }
            "rs" => {
                if let Some(c) = rust_use_re.captures(line) {
                    imports.push(c[1].to_string());
                }
            }
            _ => {}
        }
    }

    imports
}

fn resolve_import(
    root: &Path,
    from: &str,
    import: &str,
    file_set: &HashSet<String>,
) -> Option<String> {
    if import.starts_with('.') {
        return resolve_relative_import(root, from, import, file_set);
    }

    // Best-effort language-specific non-relative resolution.
    let py_candidate = format!("{}.py", import.replace('.', "/"));
    if file_set.contains(&py_candidate) {
        return Some(py_candidate);
    }

    let go_candidate = format!("{import}.go");
    if file_set.contains(&go_candidate) {
        return Some(go_candidate);
    }

    let rust_candidate = format!("{}.rs", import.replace("crate::", "").replace("::", "/"));
    if file_set.contains(&rust_candidate) {
        return Some(rust_candidate);
    }

    None
}

fn resolve_relative_import(
    root: &Path,
    from: &str,
    import: &str,
    file_set: &HashSet<String>,
) -> Option<String> {
    let from_path = root.join(from);
    let parent = from_path.parent()?;
    let import_path = parent.join(import);

    let exts = ["ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "cs"];
    let mut candidates = vec![import_path.clone()];
    for ext in &exts {
        candidates.push(import_path.with_extension(ext));
        candidates.push(import_path.join(format!("index.{ext}")));
    }

    for candidate in candidates {
        let Ok(rel) = relative_path(root, &candidate) else {
            continue;
        };
        if file_set.contains(&rel) {
            return Some(rel);
        }
    }
    None
}

fn compute_blueprint_hash(
    files: &BTreeMap<String, FileNode>,
    edges: &[[String; 2]],
    stats: &Stats,
) -> Result<String> {
    #[derive(serde::Serialize)]
    struct HashPayload<'a> {
        files: &'a BTreeMap<String, FileNode>,
        edges: &'a [[String; 2]],
        stats: &'a Stats,
    }

    let payload = HashPayload {
        files,
        edges,
        stats,
    };
    let bytes = serde_json::to_vec(&payload)?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let hash = hasher.finalize();
    Ok(format!("sha256:{hash:x}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn deterministic_hash_ignores_timestamp() {
        let dir = tempdir().expect("tempdir");
        let path = dir.path().join("a.ts");
        let mut f = fs::File::create(path).expect("create file");
        writeln!(f, "export function hello() {{}}").expect("write");

        let one = scan_path(
            dir.path(),
            ScanOptions {
                timestamp_override: Some("2026-01-01T00:00:00Z".to_string()),
                ..ScanOptions::default()
            },
        )
        .expect("scan one");
        let two = scan_path(
            dir.path(),
            ScanOptions {
                timestamp_override: Some("2027-01-01T00:00:00Z".to_string()),
                ..ScanOptions::default()
            },
        )
        .expect("scan two");

        assert_eq!(one.hash, two.hash);
    }
}
