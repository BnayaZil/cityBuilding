use assert_cmd::Command;
use mockito::{Matcher, Server};
use predicates::prelude::*;
use std::fs;
use std::path::Path;
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
        "2.1.1" | "2.1.3" | "2.1.4" => case_scan_stdout(),
        "2.1.2" => case_scan_to_file(),
        "2.1.5" => case_scan_nonexistent_dir_fails(),
        "2.2.1" => case_register_success(),
        "2.2.2" | "2.2.6" => case_register_or_login_failure(),
        "2.2.3" => case_login_success(),
        "2.2.4" => case_logout_success(),
        "2.2.5" => case_whoami_success(),
        "2.2.7" => case_whoami_requires_login(),
        "2.3.1" => case_team_create(),
        "2.3.2" | "2.6.4" => case_team_list(),
        "2.3.3" => case_team_invite_create(),
        "2.3.4" => case_team_invite_list(),
        "2.3.5" | "2.3.6" | "2.3.7" => case_team_join(),
        "2.3.8" => case_team_members(),
        "2.4.1" | "2.4.2" => case_city_create(),
        "2.4.3" => case_api_key_create(),
        "2.4.4" => case_api_key_list(),
        "2.4.5" => case_api_key_revoke(),
        "2.5.1" => case_push_success(),
        "2.5.2" => case_push_requires_city(),
        "2.5.3" => case_status_success(),
        "2.5.4" => case_worlds_success(),
        "2.5.5" => case_history_success(),
        "2.6.1" => case_json_output(),
        "2.6.2" => case_json_error_output(),
        "2.6.3" => case_non_interactive_missing_params_fails(),
        "2.7.1" => case_config_set_server(),
        "2.7.2" => case_config_set_world(),
        "2.7.3" => case_config_show(),
        "2.7.4" => case_init_creates_city_yml(),
        "2.7.5" => case_init_when_exists_fails(),
        _ => anyhow::bail!("unhandled CLI case id {case}"),
    }
}

fn base_command(tmp_config: &Path) -> anyhow::Result<Command> {
    let mut cmd = Command::cargo_bin("city-building-cli")?;
    cmd.env("CITY_CONFIG_PATH", tmp_config);
    Ok(cmd)
}

fn write_config(
    path: &Path,
    server_url: &str,
    token: Option<&str>,
    city_id: Option<&str>,
    api_key: Option<&str>,
) -> anyhow::Result<()> {
    let mut raw = format!("server_url = \"{server_url}\"\nworld = \"default\"\n");
    if let Some(token) = token {
        raw.push_str(&format!("token = \"{token}\"\n"));
    }
    if let Some(city_id) = city_id {
        raw.push_str(&format!("city_id = \"{city_id}\"\n"));
    }
    if let Some(api_key) = api_key {
        raw.push_str(&format!("api_key = \"{api_key}\"\n"));
    }
    fs::write(path, raw)?;
    Ok(())
}

fn case_scan_stdout() -> anyhow::Result<()> {
    let dir = tempdir()?;
    fs::write(dir.path().join("a.ts"), "export function hello() {}\n")?;
    let mut cmd = base_command(&dir.path().join("config.toml"))?;
    cmd.current_dir(dir.path()).arg("scan");
    cmd.assert()
        .success()
        .stdout(predicate::str::contains("\"hash\""));
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

fn case_register_success() -> anyhow::Result<()> {
    let mut server = Server::new();
    let _mock = server
        .mock("POST", "/api/v1/auth/register")
        .match_body(Matcher::PartialJson(serde_json::json!({"username":"u"})))
        .with_status(201)
        .with_body(r#"{"token":"token-u"}"#)
        .create();
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    write_config(&cfg, &server.url(), None, None, None)?;
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path())
        .arg("register")
        .arg("--username")
        .arg("u")
        .arg("--password")
        .arg("p");
    cmd.assert().success();
    Ok(())
}

fn case_register_or_login_failure() -> anyhow::Result<()> {
    let mut server = Server::new();
    let _register = server
        .mock("POST", "/api/v1/auth/register")
        .with_status(409)
        .with_body(r#"{"error":"username_exists"}"#)
        .create();
    let _login = server
        .mock("POST", "/api/v1/auth/login")
        .with_status(401)
        .with_body(r#"{"error":"unauthorized"}"#)
        .create();
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    write_config(&cfg, &server.url(), None, None, None)?;

    let mut register = base_command(&cfg)?;
    register
        .current_dir(dir.path())
        .arg("register")
        .arg("--username")
        .arg("u")
        .arg("--password")
        .arg("p");
    register.assert().failure();

    let mut login = base_command(&cfg)?;
    login
        .current_dir(dir.path())
        .arg("--json")
        .arg("login")
        .arg("--username")
        .arg("u")
        .arg("--password")
        .arg("bad");
    login.assert().failure();
    Ok(())
}

fn case_login_success() -> anyhow::Result<()> {
    let mut server = Server::new();
    let _mock = server
        .mock("POST", "/api/v1/auth/login")
        .with_status(200)
        .with_body(r#"{"token":"token-user-1"}"#)
        .create();
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    write_config(&cfg, &server.url(), None, None, None)?;
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path())
        .arg("login")
        .arg("--username")
        .arg("u")
        .arg("--password")
        .arg("p");
    cmd.assert().success();
    let raw = fs::read_to_string(&cfg)?;
    assert!(raw.contains("token-user-1"));
    Ok(())
}

fn case_logout_success() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    write_config(&cfg, "http://localhost:3000", Some("token-x"), None, None)?;
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path()).arg("logout");
    cmd.assert().success();
    let raw = fs::read_to_string(&cfg)?;
    assert!(!raw.contains("token-x"));
    Ok(())
}

fn case_whoami_success() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    write_config(
        &cfg,
        "http://localhost:3000",
        Some("token-user-42"),
        None,
        None,
    )?;
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path()).arg("whoami");
    cmd.assert()
        .success()
        .stdout(predicate::str::contains("user-42"));
    Ok(())
}

fn case_whoami_requires_login() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    write_config(&cfg, "http://localhost:3000", None, None, None)?;
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path()).arg("whoami");
    cmd.assert().failure();
    Ok(())
}

fn case_team_create() -> anyhow::Result<()> {
    let mut server = Server::new();
    let _mock = server
        .mock("POST", "/api/v1/teams")
        .match_header("authorization", "Bearer token-user")
        .with_status(201)
        .with_body(r#"{"id":"team-1","name":"Core"}"#)
        .create();
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    write_config(&cfg, &server.url(), Some("token-user"), None, None)?;
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path())
        .arg("team")
        .arg("create")
        .arg("--name")
        .arg("Core");
    cmd.assert().success();
    Ok(())
}

fn case_team_list() -> anyhow::Result<()> {
    let mut server = Server::new();
    let _mock = server
        .mock("GET", "/api/v1/teams")
        .with_status(200)
        .with_body(r#"[{"id":"team-1","name":"Core","role":"owner"}]"#)
        .create();
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    write_config(&cfg, &server.url(), Some("token-user"), None, None)?;
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path())
        .arg("--json")
        .arg("team")
        .arg("list");
    cmd.assert()
        .success()
        .stdout(predicate::str::contains("team-1"));
    Ok(())
}

fn case_team_invite_create() -> anyhow::Result<()> {
    let mut server = Server::new();
    let _mock = server
        .mock("POST", "/api/v1/teams/team-1/invites")
        .with_status(201)
        .with_body(r#"{"code":"invite-1"}"#)
        .create();
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    write_config(&cfg, &server.url(), Some("token-user"), None, None)?;
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path())
        .arg("team")
        .arg("invite")
        .arg("create")
        .arg("--team")
        .arg("team-1");
    cmd.assert().success();
    Ok(())
}

fn case_team_invite_list() -> anyhow::Result<()> {
    let mut server = Server::new();
    let _mock = server
        .mock("GET", "/api/v1/teams/team-1/invites")
        .with_status(200)
        .with_body(r#"[{"code":"invite-1"}]"#)
        .create();
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    write_config(&cfg, &server.url(), Some("token-user"), None, None)?;
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path())
        .arg("team")
        .arg("invite")
        .arg("list")
        .arg("--team")
        .arg("team-1");
    cmd.assert().success();
    Ok(())
}

fn case_team_join() -> anyhow::Result<()> {
    let mut server = Server::new();
    let _mock = server
        .mock("POST", "/api/v1/teams/join/invite-1")
        .with_status(200)
        .with_body(r#"{"ok":true}"#)
        .create();
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    write_config(&cfg, &server.url(), Some("token-user"), None, None)?;
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path())
        .arg("team")
        .arg("join")
        .arg("invite-1");
    cmd.assert().success();
    Ok(())
}

fn case_team_members() -> anyhow::Result<()> {
    let mut server = Server::new();
    let _mock = server
        .mock("GET", "/api/v1/teams/team-1")
        .with_status(200)
        .with_body(r#"{"members":[{"user_id":"u1","role":"owner"}]}"#)
        .create();
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    write_config(&cfg, &server.url(), Some("token-user"), None, None)?;
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path())
        .arg("team")
        .arg("members")
        .arg("--team")
        .arg("team-1");
    cmd.assert().success();
    Ok(())
}

fn case_city_create() -> anyhow::Result<()> {
    let mut server = Server::new();
    let _mock = server
        .mock("POST", "/api/v1/cities")
        .with_status(201)
        .with_body(r#"{"id":"city-1","repo":"owner/repo"}"#)
        .create();
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    write_config(&cfg, &server.url(), Some("token-user"), None, None)?;
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path())
        .arg("create")
        .arg("--repo")
        .arg("owner/repo")
        .arg("--team")
        .arg("team-1");
    cmd.assert().success();
    Ok(())
}

fn case_api_key_create() -> anyhow::Result<()> {
    let mut server = Server::new();
    let _mock = server
        .mock("POST", "/api/v1/teams/team-1/api-keys")
        .with_status(201)
        .with_body(r#"{"id":"key-1","key":"city_pk_1"}"#)
        .create();
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    write_config(&cfg, &server.url(), Some("token-user"), None, None)?;
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path())
        .arg("api-key")
        .arg("create")
        .arg("--team")
        .arg("team-1");
    cmd.assert().success();
    Ok(())
}

fn case_api_key_list() -> anyhow::Result<()> {
    let mut server = Server::new();
    let _mock = server
        .mock("GET", "/api/v1/teams/team-1/api-keys")
        .with_status(200)
        .with_body(r#"[{"id":"key-1"}]"#)
        .create();
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    write_config(&cfg, &server.url(), Some("token-user"), None, None)?;
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path())
        .arg("api-key")
        .arg("list")
        .arg("--team")
        .arg("team-1");
    cmd.assert().success();
    Ok(())
}

fn case_api_key_revoke() -> anyhow::Result<()> {
    let mut server = Server::new();
    let _mock = server
        .mock("POST", "/api/v1/api-keys/key-1/revoke")
        .with_status(200)
        .with_body(r#"{"ok":true}"#)
        .create();
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    write_config(&cfg, &server.url(), Some("token-user"), None, None)?;
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path())
        .arg("api-key")
        .arg("revoke")
        .arg("key-1");
    cmd.assert().success();
    Ok(())
}

fn case_push_success() -> anyhow::Result<()> {
    let mut server = Server::new();
    let _mock = server
        .mock("POST", "/api/v1/cities/city-1/push")
        .match_header("x-api-key", "city_pk_1")
        .with_status(201)
        .with_body(r#"{"ok":true,"seq":1}"#)
        .create();
    let dir = tempdir()?;
    fs::write(dir.path().join("a.ts"), "export const x = 1;\n")?;
    let cfg = dir.path().join("config.toml");
    write_config(&cfg, &server.url(), None, Some("city-1"), Some("city_pk_1"))?;
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path()).arg("push");
    cmd.assert().success();
    Ok(())
}

fn case_push_requires_city() -> anyhow::Result<()> {
    let dir = tempdir()?;
    fs::write(dir.path().join("a.ts"), "export const x = 1;\n")?;
    let cfg = dir.path().join("config.toml");
    write_config(&cfg, "http://localhost:3000", None, None, Some("city_pk_1"))?;
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path()).arg("push");
    cmd.assert().failure();
    Ok(())
}

fn case_status_success() -> anyhow::Result<()> {
    let mut server = Server::new();
    let _mock = server
        .mock("GET", "/api/v1/cities/city-1")
        .with_status(200)
        .with_body(r#"{"id":"city-1"}"#)
        .create();
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    write_config(&cfg, &server.url(), None, Some("city-1"), None)?;
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path()).arg("status");
    cmd.assert().success();
    Ok(())
}

fn case_worlds_success() -> anyhow::Result<()> {
    let mut server = Server::new();
    let _mock = server
        .mock("GET", "/api/v1/worlds")
        .with_status(200)
        .with_body(r#"[{"id":"default"}]"#)
        .create();
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    write_config(&cfg, &server.url(), None, None, None)?;
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path()).arg("worlds");
    cmd.assert().success();
    Ok(())
}

fn case_history_success() -> anyhow::Result<()> {
    let mut server = Server::new();
    let _mock = server
        .mock("GET", "/api/v1/cities/city-1/events")
        .match_query(Matcher::UrlEncoded("limit".into(), "5".into()))
        .with_status(200)
        .with_body(r#"[]"#)
        .create();
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    write_config(&cfg, &server.url(), None, None, None)?;
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path())
        .arg("history")
        .arg("--city")
        .arg("city-1");
    cmd.assert().success();
    Ok(())
}

fn case_json_output() -> anyhow::Result<()> {
    let mut server = Server::new();
    let _mock = server
        .mock("GET", "/api/v1/teams")
        .with_status(200)
        .with_body(r#"[{"id":"team-1"}]"#)
        .create();
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    write_config(&cfg, &server.url(), Some("token-user"), None, None)?;
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path())
        .arg("--json")
        .arg("team")
        .arg("list");
    cmd.assert()
        .success()
        .stdout(predicate::str::contains("\"team-1\""));
    Ok(())
}

fn case_json_error_output() -> anyhow::Result<()> {
    let mut server = Server::new();
    let _mock = server
        .mock("POST", "/api/v1/auth/login")
        .with_status(401)
        .with_body(r#"{"error":"unauthorized"}"#)
        .create();
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    write_config(&cfg, &server.url(), None, None, None)?;
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path())
        .arg("--json")
        .arg("login")
        .arg("--username")
        .arg("bad")
        .arg("--password")
        .arg("bad");
    cmd.assert().failure();
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

fn case_config_set_server() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path())
        .arg("config")
        .arg("set")
        .arg("server")
        .arg("https://example.com");
    cmd.assert().success();
    assert!(fs::read_to_string(cfg)?.contains("https://example.com"));
    Ok(())
}

fn case_config_set_world() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path())
        .arg("config")
        .arg("set")
        .arg("world")
        .arg("w1");
    cmd.assert().success();
    assert!(fs::read_to_string(cfg)?.contains("w1"));
    Ok(())
}

fn case_config_show() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let cfg = dir.path().join("config.toml");
    write_config(&cfg, "http://localhost:3000", None, None, None)?;
    let mut cmd = base_command(&cfg)?;
    cmd.current_dir(dir.path()).arg("config").arg("show");
    cmd.assert()
        .success()
        .stdout(predicate::str::contains("server=http://localhost:3000"));
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
