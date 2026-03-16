use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct CityBlueprint {
    pub v: String,
    pub ts: String,
    pub hash: String,
    pub source: SourceInfo,
    pub checks: Option<Checks>,
    pub stats: Stats,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hints: Option<Hints>,
    pub files: BTreeMap<String, FileNode>,
    pub edges: Vec<[String; 2]>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct SourceInfo {
    #[serde(rename = "type")]
    pub source_type: SourceType,
    pub repo: String,
    pub sha: String,
    pub branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SourceType {
    GithubAction,
    Cli,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct Checks {
    pub status: ChecksStatus,
    pub runs: Vec<CheckRun>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct CheckRun {
    pub name: String,
    pub conclusion: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChecksStatus {
    Success,
    Failure,
    Pending,
    Mixed,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct Stats {
    pub files: u32,
    pub symbols: u32,
    pub langs: BTreeMap<String, u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct Hints {
    #[serde(default)]
    pub districts: Vec<DistrictHint>,
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct DistrictHint {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<DistrictStyle>,
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DistrictStyle {
    Commercial,
    Residential,
    Industrial,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct FileNode {
    pub lang: String,
    pub symbols: Vec<Symbol>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct Symbol {
    pub name: String,
    #[serde(rename = "type")]
    pub symbol_type: SymbolType,
    pub vis: Visibility,
    #[serde(default)]
    pub members: Vec<SymbolMember>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loc: Option<SymbolLocation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct SymbolMember {
    pub name: String,
    #[serde(rename = "type")]
    pub symbol_type: SymbolType,
    pub vis: Visibility,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loc: Option<SymbolLocation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SymbolType {
    Class,
    Function,
    Method,
    Interface,
    Enum,
    Variable,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Visibility {
    Exported,
    Public,
    Private,
    Protected,
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct SymbolLocation {
    #[serde(rename = "startLine")]
    pub start_line: u32,
    #[serde(rename = "endLine")]
    pub end_line: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct CitySummary {
    pub id: String,
    pub name: String,
    pub repo: String,
    pub seq: u64,
    pub blueprint_hash: String,
    pub checks_status: ChecksStatus,
    pub files_count: u32,
    pub symbols_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct WorldResponse {
    pub id: String,
    pub name: String,
    pub cities: Vec<CitySummary>,
}

pub fn city_blueprint_json_schema() -> Value {
    serde_json::to_value(schemars::schema_for!(CityBlueprint))
        .expect("CityBlueprint schema serialization must succeed")
}

pub fn city_summary_json_schema() -> Value {
    serde_json::to_value(schemars::schema_for!(CitySummary))
        .expect("CitySummary schema serialization must succeed")
}
