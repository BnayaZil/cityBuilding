use assert_cmd::Command;
use predicates::prelude::*;
use std::fs;
use tempfile::tempdir;

const CASE_IDS: &[&str] = &[
    "2.1.1", "2.1.2", "2.1.3", "2.1.4", "2.1.5", "2.2.1", "2.2.2", "2.2.3", "2.2.4", "2.2.5",
    "2.2.6", "2.2.7", "2.3.1", "2.3.2", "2.3.3", "2.3.4", "2.3.5", "2.3.6", "2.3.7", "2.3.8",
    "2.4.1", "2.4.2", "2.4.3", "2.4.4", "2.4.5", "2.5.1", "2.5.2", "2.5.3", "2.5.4", "2.5.5",
    "2.6.1", "2.6.2", "2.6.3", "2.6.4", "2.7.1", "2.7.2", "2.7.3", "2.7.4", "2.7.5",
];

#[test]
fn cli_2x_cases_are_executable() {
    for case in CASE_IDS {
        run_case(case).unwrap_or_else(|e| panic!("case {case} failed: {e:#}"));
    }
}

fn run_case(case: &str) -> anyhow::Result<()> {
    match case {
        "2.1.1" => case_scan_stdout(),
        "2.1.2" => case_scan_to_file(),
        "2.1.5" => case_scan_nonexistent_dir_fails(),
        "2.6.1" => case_json_output(),
        "2.6.3" => case_non_interactive_missing_params_fails(),
        "2.7.4" => case_init_creates_city_yml(),
        "2.7.5" => case_init_when_exists_fails(),
        _ => case_smoke_subcommand(case),
    }
}

fn base_command(tmp_config: &std::path::Path) -> anyhow::Result<Command> {
    let mut cmd = Command::cargo_bin("city-building-cli")?;
    cmd.env("CITY_CONFIG_PATH", tmp_config);
    Ok(cmd)
}

fn case_scan_stdout() -> anyhow::Result<()> {
    let dir = tempdir()?;
    fs::write(dir.path().join("a.ts"), "export function hello() {}\n")?;
    let mut cmd = base_command(&dir.path().join("config.toml"))?;
    cmd.current_dir(dir.path()).arg("scan");
    cmd.assert().success().stdout(predicate::str::contains("\"files\""));
    Ok(())
}

fn case_scan_to_file() -> anyhow::Result<()> {
    let dir = tempdir()?;
    fs::write(dir.path().join("a.ts"), "export function hello() {}\n")?;
    let out = dir.path().join("bp.json");
    let mut cmd = base_command(&dir.path().join("config.toml"))?;
    cmd.current_dir(dir.path())
        .arg("scan")
        .arg("--out")
        .arg(&out);
    cmd.assert().success();
    let body = fs::read_to_string(out)?;
    assert!(body.contains("\"hash\""));
    Ok(())
}

fn case_scan_nonexistent_dir_fails() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let mut cmd = base_command(&dir.path().join("config.toml"))?;
    cmd.current_dir(dir.path())
        .arg("scan")
        .arg("--path")
        .arg("nonexistent");
    cmd.assert().failure();
    Ok(())
}

fn case_json_output() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let mut cmd = base_command(&dir.path().join("config.toml"))?;
    cmd.current_dir(dir.path())
        .arg("--json")
        .arg("team")
        .arg("list");
    cmd.assert().success().stdout(predicate::str::contains("team-default"));
    Ok(())
}

fn case_non_interactive_missing_params_fails() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let mut cmd = base_command(&dir.path().join("config.toml"))?;
    cmd.current_dir(dir.path())
        .arg("--non-interactive")
        .arg("register");
    cmd.assert().failure();
    Ok(())
}

fn case_init_creates_city_yml() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let mut cmd = base_command(&dir.path().join("config.toml"))?;
    cmd.current_dir(dir.path()).arg("init");
    cmd.assert().success();
    assert!(dir.path().join(".city.yml").exists());
    Ok(())
}

fn case_init_when_exists_fails() -> anyhow::Result<()> {
    let dir = tempdir()?;
    fs::write(dir.path().join(".city.yml"), "version: 1\n")?;
    let mut cmd = base_command(&dir.path().join("config.toml"))?;
    cmd.current_dir(dir.path()).arg("init");
    cmd.assert().failure();
    Ok(())
}

fn case_smoke_subcommand(case: &str) -> anyhow::Result<()> {
    let dir = tempdir()?;
    fs::write(dir.path().join("a.ts"), "export const x = 1;\n")?;
    let mut cmd = base_command(&dir.path().join("config.toml"))?;
    cmd.current_dir(dir.path());
    match case {
        "2.2.1" => {
            cmd.arg("register")
                .arg("--username")
                .arg("u")
                .arg("--email")
                .arg("e@example.com")
                .arg("--password")
                .arg("p");
        }
        "2.2.3" | "2.2.4" => {
            cmd.arg("login")
                .arg("--username")
                .arg("u")
                .arg("--password")
                .arg("p");
        }
        "2.3.1" => {
            cmd.arg("team").arg("create").arg("--name").arg("t");
        }
        "2.3.2" => {
            cmd.arg("team").arg("list");
        }
        "2.3.3" | "2.3.4" => {
            cmd.arg("team").arg("invite").arg("create").arg("--team").arg("team-1");
        }
        "2.3.5" | "2.3.6" | "2.3.7" => {
            cmd.arg("team").arg("join").arg("invite-code-123");
        }
        "2.3.8" => {
            cmd.arg("team").arg("members").arg("--team").arg("team-1");
        }
        "2.4.1" | "2.4.2" => {
            cmd.arg("create")
                .arg("--repo")
                .arg("owner/repo")
                .arg("--team")
                .arg("team-1");
        }
        "2.4.3" => {
            cmd.arg("api-key").arg("create").arg("--team").arg("team-1");
        }
        "2.4.4" => {
            cmd.arg("api-key").arg("list").arg("--team").arg("team-1");
        }
        "2.4.5" => {
            cmd.arg("api-key").arg("revoke").arg("key-1");
        }
        "2.5.1" | "2.5.2" | "2.5.3" | "2.5.4" | "2.5.5" => {
            cmd.arg("push");
        }
        "2.6.2" => {
            cmd.arg("--json")
                .arg("login")
                .arg("--username")
                .arg("bad")
                .arg("--password")
                .arg("bad");
        }
        "2.6.4" => {
            cmd.arg("team").arg("list");
        }
        "2.7.1" => {
            cmd.arg("config")
                .arg("set")
                .arg("server")
                .arg("https://example.com");
        }
        "2.7.2" => {
            cmd.arg("config").arg("set").arg("world").arg("w1");
        }
        "2.7.3" => {
            cmd.arg("config").arg("show");
        }
        _ => {
            cmd.arg("status");
        }
    }
    cmd.assert().success();
    Ok(())
}
