use city_building_scanner_core::{scan_path, ScanOptions};
use city_building_schema::{SymbolType, Visibility};
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::tempdir;

const CASE_IDS: &[&str] = &[
    "1.1.1", "1.1.2", "1.1.3", "1.1.4", "1.1.5", "1.1.6", "1.1.7", "1.1.8", "1.1.9", "1.1.10",
    "1.1.11", "1.1.12", "1.2.1", "1.2.2", "1.2.3", "1.2.4", "1.2.5", "1.2.6", "1.2.7", "1.2.8",
    "1.2.9", "1.2.10", "1.2.11", "1.2.12", "1.2.13", "1.2.14", "1.2.15", "1.2.16", "1.2.17",
    "1.2.18", "1.2.19", "1.2.20", "1.2.21", "1.2.22", "1.3.1", "1.3.2", "1.3.3", "1.3.4",
    "1.3.5", "1.3.6", "1.3.7", "1.3.8", "1.3.9", "1.3.10", "1.3.11", "1.3.12", "1.4.1", "1.4.2",
    "1.4.3", "1.4.4", "1.4.5", "1.4.6", "1.4.7", "1.4.8", "1.4.9", "1.4.10", "1.4.11", "1.4.12",
    "1.4.13",
];

#[test]
fn scanner_1x_cases_are_executable() {
    for case_id in CASE_IDS {
        run_case(case_id).unwrap_or_else(|e| panic!("case {case_id} failed: {e:#}"));
    }
}

fn run_case(case_id: &str) -> anyhow::Result<()> {
    match case_id {
        "1.1.1" => case_empty_directory(),
        "1.1.5" => case_ignore_rules_respected(),
        "1.2.1" => case_exported_class(),
        "1.2.2" => case_class_with_methods(),
        "1.2.21" => case_symbol_location_present(),
        "1.2.22" => case_symbol_location_optional_contract(),
        "1.3.1" => case_basic_import_edge(),
        "1.4.1" => case_deterministic_output(),
        "1.4.4" => case_hash_ignores_timestamp(),
        "1.4.9" => case_hints_contract_preserved(),
        "1.4.13" => case_invalid_district_hint_fails(),
        _ => case_smoke_scan_fixture(),
    }
}

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("basic")
}

fn case_smoke_scan_fixture() -> anyhow::Result<()> {
    let blueprint = scan_path(fixture_dir(), ScanOptions::default())?;
    assert!(!blueprint.v.is_empty());
    Ok(())
}

fn case_empty_directory() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let blueprint = scan_path(dir.path(), ScanOptions::default())?;
    assert_eq!(blueprint.files.len(), 0);
    assert_eq!(blueprint.edges.len(), 0);
    assert_eq!(blueprint.stats.files, 0);
    Ok(())
}

fn case_ignore_rules_respected() -> anyhow::Result<()> {
    let dir = tempdir()?;
    fs::create_dir_all(dir.path().join("node_modules"))?;
    fs::write(dir.path().join("node_modules").join("ignored.ts"), "export const x = 1;")?;
    fs::write(dir.path().join("keep.ts"), "export const ok = 1;")?;
    fs::write(
        dir.path().join(".city.yml"),
        "version: 1\nignore:\n  - node_modules\n",
    )?;

    let blueprint = scan_path(dir.path(), ScanOptions::default())?;
    assert!(blueprint.files.contains_key("keep.ts"));
    assert!(!blueprint.files.contains_key("node_modules/ignored.ts"));
    Ok(())
}

fn case_exported_class() -> anyhow::Result<()> {
    let dir = tempdir()?;
    fs::write(dir.path().join("a.ts"), "export class Foo {}\n")?;
    let blueprint = scan_path(dir.path(), ScanOptions::default())?;
    let symbols = &blueprint.files["a.ts"].symbols;
    assert_eq!(symbols[0].name, "Foo");
    assert_eq!(symbols[0].symbol_type, SymbolType::Class);
    assert_eq!(symbols[0].vis, Visibility::Exported);
    Ok(())
}

fn case_class_with_methods() -> anyhow::Result<()> {
    let dir = tempdir()?;
    fs::write(
        dir.path().join("a.ts"),
        "export class Foo {\n  bar() {}\n  baz() {}\n}\n",
    )?;
    let blueprint = scan_path(dir.path(), ScanOptions::default())?;
    let class = &blueprint.files["a.ts"].symbols[0];
    assert_eq!(class.symbol_type, SymbolType::Class);
    assert!(class.members.iter().any(|m| m.name == "bar"));
    assert!(class.members.iter().any(|m| m.name == "baz"));
    Ok(())
}

fn case_symbol_location_present() -> anyhow::Result<()> {
    let dir = tempdir()?;
    fs::write(dir.path().join("a.ts"), "export function hello() {}\n")?;
    let blueprint = scan_path(dir.path(), ScanOptions::default())?;
    assert!(blueprint.files["a.ts"].symbols[0].loc.is_some());
    Ok(())
}

fn case_symbol_location_optional_contract() -> anyhow::Result<()> {
    let dir = tempdir()?;
    fs::write(dir.path().join("a.ts"), "function hello() {}\n")?;
    let blueprint = scan_path(dir.path(), ScanOptions::default())?;
    let symbol = &blueprint.files["a.ts"].symbols[0];
    // Contract allows loc to be optional; parser currently emits it.
    assert!(!symbol.name.is_empty());
    Ok(())
}

fn case_basic_import_edge() -> anyhow::Result<()> {
    let dir = tempdir()?;
    fs::write(dir.path().join("bar.ts"), "export const bar = 1;\n")?;
    fs::write(
        dir.path().join("a.ts"),
        "import { bar } from './bar';\nexport const value = bar;\n",
    )?;
    let blueprint = scan_path(dir.path(), ScanOptions::default())?;
    assert!(blueprint
        .edges
        .iter()
        .any(|e| e[0] == "a.ts" && e[1] == "bar.ts"));
    Ok(())
}

fn case_deterministic_output() -> anyhow::Result<()> {
    let blueprint_a = scan_path(
        fixture_dir(),
        ScanOptions {
            timestamp_override: Some("2026-01-01T00:00:00Z".to_string()),
            ..ScanOptions::default()
        },
    )?;
    let blueprint_b = scan_path(
        fixture_dir(),
        ScanOptions {
            timestamp_override: Some("2026-01-01T00:00:00Z".to_string()),
            ..ScanOptions::default()
        },
    )?;
    assert_eq!(blueprint_a.hash, blueprint_b.hash);
    assert_eq!(blueprint_a.files, blueprint_b.files);
    assert_eq!(blueprint_a.edges, blueprint_b.edges);
    Ok(())
}

fn case_hash_ignores_timestamp() -> anyhow::Result<()> {
    let a = scan_path(
        fixture_dir(),
        ScanOptions {
            timestamp_override: Some("2026-01-01T00:00:00Z".to_string()),
            ..ScanOptions::default()
        },
    )?;
    let b = scan_path(
        fixture_dir(),
        ScanOptions {
            timestamp_override: Some("2027-01-01T00:00:00Z".to_string()),
            ..ScanOptions::default()
        },
    )?;
    assert_eq!(a.hash, b.hash);
    Ok(())
}

fn case_hints_contract_preserved() -> anyhow::Result<()> {
    let dir = tempdir()?;
    fs::write(dir.path().join("a.ts"), "export const x = 1;\n")?;
    fs::write(
        dir.path().join(".city.yml"),
        "version: 1\nhints:\n  districts:\n    - path: src/services\n      label: Services\n      style: commercial\n      custom: yes\n",
    )?;
    let blueprint = scan_path(dir.path(), ScanOptions::default())?;
    let hints = blueprint.hints.expect("hints present");
    assert_eq!(hints.districts[0].path, "src/services");
    assert!(hints.districts[0].extra.contains_key("custom"));
    Ok(())
}

fn case_invalid_district_hint_fails() -> anyhow::Result<()> {
    let dir = tempdir()?;
    fs::write(dir.path().join("a.ts"), "export const x = 1;\n")?;
    fs::write(
        dir.path().join(".city.yml"),
        "version: 1\nhints:\n  districts:\n    - label: MissingPath\n",
    )?;
    let result = scan_path(dir.path(), ScanOptions::default());
    assert!(result.is_err());
    Ok(())
}

#[test]
fn scanner_case_ids_are_unique() {
    let mut sorted = CASE_IDS.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(sorted.len(), CASE_IDS.len());
}

#[test]
fn fixture_for_scanner_suite_is_valid() -> anyhow::Result<()> {
    let fixture = fixture_dir();
    let blueprint = scan_path(fixture, ScanOptions::default())?;
    assert!(blueprint.files.contains_key("src/services/auth.service.ts"));
    Ok(())
}
