use city_building_schema::{city_blueprint_json_schema, city_summary_json_schema};
use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let out_dir = env::args()
        .nth(1)
        .unwrap_or_else(|| "schema-out".to_string());
    let out_path = PathBuf::from(out_dir);
    fs::create_dir_all(&out_path).expect("failed to create output directory");

    let blueprint_schema = city_blueprint_json_schema();
    let summary_schema = city_summary_json_schema();

    fs::write(
        out_path.join("city-blueprint.schema.json"),
        serde_json::to_vec_pretty(&blueprint_schema).expect("serialize blueprint schema"),
    )
    .expect("write blueprint schema");

    fs::write(
        out_path.join("city-summary.schema.json"),
        serde_json::to_vec_pretty(&summary_schema).expect("serialize summary schema"),
    )
    .expect("write summary schema");
}
