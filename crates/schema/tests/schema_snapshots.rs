use city_building_schema::{city_blueprint_json_schema, city_summary_json_schema};
use sha2::{Digest, Sha256};

fn schema_hash(value: &serde_json::Value) -> String {
    let bytes = serde_json::to_vec_pretty(value).expect("schema serialization");
    format!("{:x}", Sha256::digest(bytes))
}

#[test]
fn city_blueprint_schema_snapshot_hash() {
    let schema = city_blueprint_json_schema();
    assert_eq!(
        schema_hash(&schema),
        "32a4886a7322a1897ded57d301b41dd307ce2f79257ddf2b63e5bfe2e18f2586"
    );
}

#[test]
fn city_summary_schema_snapshot_hash() {
    let schema = city_summary_json_schema();
    assert_eq!(
        schema_hash(&schema),
        "ec0755664321677023b404b57ea627bb78572f0d8bc062a39b2a442854e86804"
    );
}

#[test]
fn city_blueprint_contract_contains_core_fields() {
    let schema = city_blueprint_json_schema();
    let required = schema["required"]
        .as_array()
        .expect("required must be array")
        .iter()
        .filter_map(|v| v.as_str())
        .collect::<Vec<_>>();
    assert!(required.contains(&"v"));
    assert!(required.contains(&"hash"));
    assert!(required.contains(&"stats"));
    assert!(required.contains(&"files"));
    assert!(required.contains(&"edges"));
}
