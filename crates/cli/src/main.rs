use anyhow::{bail, Context, Result};
use city_building_scanner_core::{scan_path, ScanOptions};
use clap::{Args, Parser, Subcommand};
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

#[derive(Parser, Debug)]
#[command(name = "city")]
#[command(about = "City Building CLI")]
struct Cli {
    #[arg(long, global = true)]
    json: bool,
    #[arg(long, global = true)]
    non_interactive: bool,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    Register(AuthArgs),
    Login(LoginArgs),
    Logout,
    Whoami,
    Init,
    Config {
        #[command(subcommand)]
        command: ConfigCmd,
    },
    Team {
        #[command(subcommand)]
        command: TeamCmd,
    },
    Create(CityCreateArgs),
    ApiKey {
        #[command(subcommand)]
        command: ApiKeyCmd,
    },
    Scan(ScanArgs),
    Push(PushArgs),
    Status,
    Worlds,
    Cities(CitiesArgs),
    History(HistoryArgs),
}

#[derive(Args, Debug)]
struct AuthArgs {
    #[arg(long)]
    username: String,
    #[arg(long)]
    email: Option<String>,
    #[arg(long)]
    password: String,
}

#[derive(Args, Debug)]
struct LoginArgs {
    #[arg(long)]
    username: String,
    #[arg(long)]
    password: String,
}

#[derive(Subcommand, Debug)]
enum ConfigCmd {
    Set(ConfigSetArgs),
    Show,
}

#[derive(Args, Debug)]
struct ConfigSetArgs {
    key: String,
    value: String,
}

#[derive(Subcommand, Debug)]
enum TeamCmd {
    Create(TeamCreateArgs),
    List,
    Invite {
        #[command(subcommand)]
        command: TeamInviteCmd,
    },
    Join(TeamJoinArgs),
    Members(TeamMembersArgs),
}

#[derive(Args, Debug)]
struct TeamCreateArgs {
    #[arg(long)]
    name: String,
}

#[derive(Subcommand, Debug)]
enum TeamInviteCmd {
    Create(TeamIdArg),
    List(TeamIdArg),
}

#[derive(Args, Debug)]
struct TeamJoinArgs {
    code: String,
}

#[derive(Args, Debug)]
struct TeamMembersArgs {
    #[arg(long)]
    team: String,
}

#[derive(Args, Debug)]
struct TeamIdArg {
    #[arg(long)]
    team: String,
}

#[derive(Args, Debug)]
struct CityCreateArgs {
    #[arg(long)]
    repo: String,
    #[arg(long)]
    team: String,
}

#[derive(Subcommand, Debug)]
enum ApiKeyCmd {
    Create(TeamIdArg),
    List(TeamIdArg),
    Revoke(ApiKeyRevokeArgs),
}

#[derive(Args, Debug)]
struct ApiKeyRevokeArgs {
    key_id: String,
}

#[derive(Args, Debug)]
struct ScanArgs {
    #[arg(long)]
    out: Option<String>,
    #[arg(long, default_value = ".")]
    path: String,
}

#[derive(Args, Debug)]
struct PushArgs {
    #[arg(long)]
    server: Option<String>,
    #[arg(long)]
    city: Option<String>,
    #[arg(long)]
    api_key: Option<String>,
    #[arg(long, default_value = ".")]
    path: String,
}

#[derive(Args, Debug)]
struct CitiesArgs {
    #[arg(long)]
    world: String,
}

#[derive(Args, Debug)]
struct HistoryArgs {
    #[arg(long)]
    city: String,
    #[arg(long, default_value_t = 5)]
    limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Config {
    #[serde(default = "default_server_url")]
    server_url: String,
    #[serde(default = "default_world")]
    world: String,
    #[serde(default)]
    token: Option<String>,
    #[serde(default)]
    api_key: Option<String>,
    #[serde(default)]
    city_id: Option<String>,
    #[serde(default)]
    team_id: Option<String>,
    #[serde(default)]
    repo: Option<String>,
}

fn default_server_url() -> String {
    "http://localhost:3000".to_string()
}

fn default_world() -> String {
    "default".to_string()
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let mut config = load_config()?;
    let client = Client::builder().build()?;

    match cli.command {
        Commands::Register(args) => {
            let mut payload = json!({
                "username": args.username,
                "password": args.password
            });
            if let Some(email) = args.email {
                payload["email"] = Value::String(email);
            }
            let response = send_json(
                &client,
                "POST",
                &api_url(&config.server_url, "/api/v1/auth/register"),
                None,
                Some(payload),
                None,
            )?;
            print_output(cli.json, "registered", response)?;
        }
        Commands::Login(args) => {
            let response = send_json(
                &client,
                "POST",
                &api_url(&config.server_url, "/api/v1/auth/login"),
                None,
                Some(json!({
                    "username": args.username,
                    "password": args.password
                })),
                None,
            )?;
            config.token = response["token"].as_str().map(ToString::to_string);
            save_config(&config)?;
            print_output(cli.json, "logged in", response)?;
        }
        Commands::Logout => {
            config.token = None;
            save_config(&config)?;
            print_output(cli.json, "logged out", json!({ "ok": true }))?;
        }
        Commands::Whoami => {
            let token = require_token(&config)?;
            let username = token.trim_start_matches("token-").to_string();
            print_output(cli.json, &username, json!({ "username": username }))?;
        }
        Commands::Init => {
            let init_path = Path::new(".city.yml");
            if init_path.exists() {
                anyhow::bail!(".city.yml already exists");
            }
            fs::write(
                init_path,
                "version: 1\nignore:\n  - node_modules\n  - dist\nhints:\n  districts: []\n",
            )?;
            print_output(cli.json, "initialized", json!({ "ok": true }))?;
        }
        Commands::Config { command } => match command {
            ConfigCmd::Set(args) => {
                match args.key.as_str() {
                    "server" => config.server_url = args.value,
                    "world" => config.world = args.value,
                    "city" => config.city_id = Some(args.value),
                    "api_key" => config.api_key = Some(args.value),
                    other => anyhow::bail!("unsupported config key: {other}"),
                }
                save_config(&config)?;
                print_output(cli.json, "config updated", json!({ "ok": true }))?;
            }
            ConfigCmd::Show => {
                print_output(
                    cli.json,
                    &format!("server={} world={}", config.server_url, config.world),
                    json!({
                        "server": config.server_url,
                        "world": config.world,
                        "city_id": config.city_id,
                        "has_api_key": config.api_key.is_some(),
                        "logged_in": config.token.is_some()
                    }),
                )?;
            }
        },
        Commands::Team { command } => match command {
            TeamCmd::Create(args) => {
                let token = require_token(&config)?;
                let response = send_json(
                    &client,
                    "POST",
                    &api_url(&config.server_url, "/api/v1/teams"),
                    Some(&token),
                    Some(json!({ "name": args.name })),
                    None,
                )?;
                config.team_id = response["id"].as_str().map(ToString::to_string);
                save_config(&config)?;
                print_output(cli.json, "team created", response)?;
            }
            TeamCmd::List => {
                let token = require_token(&config)?;
                let response = send_json(
                    &client,
                    "GET",
                    &api_url(&config.server_url, "/api/v1/teams"),
                    Some(&token),
                    None,
                    None,
                )?;
                print_output(cli.json, "teams listed", response)?;
            }
            TeamCmd::Invite { command } => match command {
                TeamInviteCmd::Create(args) => {
                    let token = require_token(&config)?;
                    let response = send_json(
                        &client,
                        "POST",
                        &api_url(
                            &config.server_url,
                            &format!("/api/v1/teams/{}/invites", args.team),
                        ),
                        Some(&token),
                        Some(json!({})),
                        None,
                    )?;
                    print_output(cli.json, "invite created", response)?;
                }
                TeamInviteCmd::List(args) => {
                    let token = require_token(&config)?;
                    let response = send_json(
                        &client,
                        "GET",
                        &api_url(
                            &config.server_url,
                            &format!("/api/v1/teams/{}/invites", args.team),
                        ),
                        Some(&token),
                        None,
                        None,
                    )?;
                    print_output(cli.json, "invite list", response)?;
                }
            },
            TeamCmd::Join(args) => {
                let token = require_token(&config)?;
                let response = send_json(
                    &client,
                    "POST",
                    &api_url(
                        &config.server_url,
                        &format!("/api/v1/teams/join/{}", args.code),
                    ),
                    Some(&token),
                    Some(json!({})),
                    None,
                )?;
                print_output(cli.json, "joined team", response)?;
            }
            TeamCmd::Members(args) => {
                let token = require_token(&config)?;
                let response = send_json(
                    &client,
                    "GET",
                    &api_url(&config.server_url, &format!("/api/v1/teams/{}", args.team)),
                    Some(&token),
                    None,
                    None,
                )?;
                print_output(cli.json, "members listed", response)?;
            }
        },
        Commands::Create(args) => {
            let token = require_token(&config)?;
            let response = send_json(
                &client,
                "POST",
                &api_url(&config.server_url, "/api/v1/cities"),
                Some(&token),
                Some(json!({
                    "world_id": config.world,
                    "team_id": args.team,
                    "repo": args.repo,
                    "name": args.repo.split('/').last().unwrap_or("city")
                })),
                None,
            )?;
            config.city_id = response["id"].as_str().map(ToString::to_string);
            config.repo = response["repo"].as_str().map(ToString::to_string);
            save_config(&config)?;
            print_output(cli.json, "city created", response)?;
        }
        Commands::ApiKey { command } => match command {
            ApiKeyCmd::Create(args) => {
                let token = require_token(&config)?;
                let response = send_json(
                    &client,
                    "POST",
                    &api_url(
                        &config.server_url,
                        &format!("/api/v1/teams/{}/api-keys", args.team),
                    ),
                    Some(&token),
                    Some(json!({})),
                    None,
                )?;
                config.api_key = response["key"].as_str().map(ToString::to_string);
                save_config(&config)?;
                print_output(cli.json, "api key created", response)?;
            }
            ApiKeyCmd::List(args) => {
                let token = require_token(&config)?;
                let response = send_json(
                    &client,
                    "GET",
                    &api_url(
                        &config.server_url,
                        &format!("/api/v1/teams/{}/api-keys", args.team),
                    ),
                    Some(&token),
                    None,
                    None,
                )?;
                print_output(cli.json, "api keys listed", response)?;
            }
            ApiKeyCmd::Revoke(args) => {
                let token = require_token(&config)?;
                let response = send_json(
                    &client,
                    "POST",
                    &api_url(
                        &config.server_url,
                        &format!("/api/v1/api-keys/{}/revoke", args.key_id),
                    ),
                    Some(&token),
                    Some(json!({})),
                    None,
                )?;
                print_output(cli.json, "api key revoked", response)?;
            }
        },
        Commands::Scan(args) => {
            let blueprint = scan_path(&args.path, ScanOptions::default())?;
            let output = serde_json::to_string_pretty(&blueprint)?;
            if let Some(path) = args.out {
                fs::write(path, &output)?;
            } else {
                println!("{output}");
            }
        }
        Commands::Push(args) => {
            let server = args.server.unwrap_or_else(|| config.server_url.clone());
            let city_id = args
                .city
                .or_else(|| config.city_id.clone())
                .ok_or_else(|| {
                    anyhow::anyhow!("city id is required: set with `city config set city <id>`")
                })?;
            let api_key = args
                .api_key
                .or_else(|| config.api_key.clone())
                .ok_or_else(|| {
                    anyhow::anyhow!("api key is required: set with `city config set api_key <key>`")
                })?;
            let blueprint = scan_path(&args.path, ScanOptions::default())?;
            let response = send_json(
                &client,
                "POST",
                &api_url(&server, &format!("/api/v1/cities/{city_id}/push")),
                None,
                Some(serde_json::to_value(blueprint)?),
                Some(&api_key),
            )?;
            print_output(cli.json, "pushed", response)?;
        }
        Commands::Status => {
            let city_id = config.city_id.clone().ok_or_else(|| {
                anyhow::anyhow!("city id is required: set with `city config set city <id>`")
            })?;
            let response = send_json(
                &client,
                "GET",
                &api_url(&config.server_url, &format!("/api/v1/cities/{city_id}")),
                None,
                None,
                None,
            )?;
            print_output(cli.json, "status", response)?;
        }
        Commands::Worlds => {
            let response = send_json(
                &client,
                "GET",
                &api_url(&config.server_url, "/api/v1/worlds"),
                None,
                None,
                None,
            )?;
            print_output(cli.json, "worlds", response)?;
        }
        Commands::Cities(args) => {
            let response = send_json(
                &client,
                "GET",
                &api_url(
                    &config.server_url,
                    &format!("/api/v1/worlds/{}", args.world),
                ),
                None,
                None,
                None,
            )?;
            print_output(cli.json, "cities", response["cities"].clone())?;
        }
        Commands::History(args) => {
            let response = send_json(
                &client,
                "GET",
                &api_url(
                    &config.server_url,
                    &format!("/api/v1/cities/{}/events?limit={}", args.city, args.limit),
                ),
                None,
                None,
                None,
            )?;
            print_output(cli.json, "history", response)?;
        }
    }

    Ok(())
}

fn print_output(as_json: bool, human_message: &str, payload: serde_json::Value) -> Result<()> {
    if as_json {
        println!("{}", serde_json::to_string_pretty(&payload)?);
    } else {
        println!("{human_message}");
    }
    Ok(())
}

fn require_token(config: &Config) -> Result<String> {
    config
        .token
        .clone()
        .ok_or_else(|| anyhow::anyhow!("not logged in, run `city login`"))
}

fn api_url(server: &str, route: &str) -> String {
    format!("{}{}", server.trim_end_matches('/'), route)
}

fn send_json(
    client: &Client,
    method: &str,
    url: &str,
    bearer_token: Option<&str>,
    body: Option<Value>,
    api_key: Option<&str>,
) -> Result<Value> {
    let mut headers = HeaderMap::new();
    if let Some(token) = bearer_token {
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {token}")).context("invalid token header")?,
        );
    }

    let mut request = match method {
        "GET" => client.get(url),
        "POST" => client.post(url),
        "PUT" => client.put(url),
        "DELETE" => client.delete(url),
        other => bail!("unsupported method {other}"),
    }
    .headers(headers);

    if let Some(key) = api_key {
        request = request.header("x-api-key", key);
    }
    if let Some(payload) = body {
        request = request.json(&payload);
    }

    let response = request
        .send()
        .with_context(|| format!("request failed: {url}"))?;
    let status = response.status();
    let body_text = response.text().unwrap_or_else(|_| "{}".to_string());
    let payload = serde_json::from_str(&body_text).unwrap_or_else(|_| json!({ "raw": body_text }));
    if !status.is_success() {
        bail!("http {}: {}", status.as_u16(), payload);
    }
    Ok(payload)
}

fn config_path() -> PathBuf {
    if let Ok(path) = std::env::var("CITY_CONFIG_PATH") {
        return PathBuf::from(path);
    }
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home)
            .join(".config")
            .join("city-building")
            .join("config.toml");
    }
    PathBuf::from(".city-config.toml")
}

fn load_config() -> Result<Config> {
    let path = config_path();
    if !path.exists() {
        return Ok(Config {
            server_url: "http://localhost:3000".to_string(),
            world: "default".to_string(),
            token: None,
            api_key: None,
            city_id: None,
            team_id: None,
            repo: None,
        });
    }
    let raw = fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
    let config: Config = toml::from_str(&raw)?;
    Ok(config)
}

fn save_config(config: &Config) -> Result<()> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let raw = toml::to_string(config)?;
    fs::write(path, raw)?;
    io::stdout().flush()?;
    Ok(())
}
