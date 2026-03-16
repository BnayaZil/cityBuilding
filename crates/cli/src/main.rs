use anyhow::{Context, Result};
use city_building_scanner_core::{scan_path, ScanOptions};
use clap::{Args, Parser, Subcommand};
use serde::{Deserialize, Serialize};
use serde_json::json;
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
    server_url: String,
    world: String,
    token: Option<String>,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let mut config = load_config()?;

    match cli.command {
        Commands::Register(args) => {
            let out = json!({
                "ok": true,
                "username": args.username,
                "email": args.email
            });
            print_output(cli.json, "registered", out)?;
        }
        Commands::Login(args) => {
            config.token = Some(format!("token_for_{}", args.username));
            save_config(&config)?;
            let out = json!({
                "ok": true,
                "username": args.username
            });
            print_output(cli.json, "logged in", out)?;
        }
        Commands::Logout => {
            config.token = None;
            save_config(&config)?;
            print_output(cli.json, "logged out", json!({ "ok": true }))?;
        }
        Commands::Whoami => {
            let username = config
                .token
                .as_ref()
                .map(|t| t.replace("token_for_", ""))
                .unwrap_or_else(|| "anonymous".to_string());
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
                        "logged_in": config.token.is_some()
                    }),
                )?;
            }
        },
        Commands::Team { command } => match command {
            TeamCmd::Create(args) => print_output(
                cli.json,
                &format!("team {} created", args.name),
                json!({ "id": format!("team-{}", args.name), "name": args.name }),
            )?,
            TeamCmd::List => print_output(
                cli.json,
                "teams listed",
                json!([{ "id": "team-default", "name": "Default Team" }]),
            )?,
            TeamCmd::Invite { command } => match command {
                TeamInviteCmd::Create(args) => print_output(
                    cli.json,
                    "invite created",
                    json!({ "team": args.team, "code": "invite-code-123" }),
                )?,
                TeamInviteCmd::List(args) => print_output(
                    cli.json,
                    "invite list",
                    json!([{ "team": args.team, "code": "invite-code-123" }]),
                )?,
            },
            TeamCmd::Join(args) => print_output(
                cli.json,
                "joined team",
                json!({ "ok": true, "code": args.code }),
            )?,
            TeamCmd::Members(args) => print_output(
                cli.json,
                "members listed",
                json!([{ "team": args.team, "username": "owner", "role": "owner" }]),
            )?,
        },
        Commands::Create(args) => print_output(
            cli.json,
            "city created",
            json!({ "id": format!("city-{}", args.repo.replace('/', "-")), "repo": args.repo, "team": args.team }),
        )?,
        Commands::ApiKey { command } => match command {
            ApiKeyCmd::Create(args) => print_output(
                cli.json,
                "api key created",
                json!({ "id": "key-1", "team": args.team, "key": "city_pk_example" }),
            )?,
            ApiKeyCmd::List(args) => print_output(
                cli.json,
                "api keys listed",
                json!([{ "id": "key-1", "team": args.team }]),
            )?,
            ApiKeyCmd::Revoke(args) => print_output(
                cli.json,
                "api key revoked",
                json!({ "ok": true, "key_id": args.key_id }),
            )?,
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
            let blueprint = scan_path(".", ScanOptions::default())?;
            print_output(
                cli.json,
                "pushed",
                json!({
                    "ok": true,
                    "server": args.server.unwrap_or(config.server_url),
                    "seq": 1,
                    "hash": blueprint.hash
                }),
            )?;
        }
        Commands::Status => print_output(
            cli.json,
            "status",
            json!({ "city": "local", "last_seq": 1, "health": "ok" }),
        )?,
        Commands::Worlds => print_output(
            cli.json,
            "worlds",
            json!([{ "id": "default", "name": "Default World" }]),
        )?,
        Commands::Cities(args) => print_output(
            cli.json,
            "cities",
            json!([{ "id": "city-local", "world": args.world, "name": "local" }]),
        )?,
        Commands::History(args) => print_output(
            cli.json,
            "history",
            json!({ "city": args.city, "events": [], "limit": args.limit }),
        )?,
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
            server_url: "https://world.city-building.dev".to_string(),
            world: "default".to_string(),
            token: None,
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
