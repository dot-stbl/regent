//! bad.rs — files with `.unwrap()` calls outside tests.
fn load_config(path: &str) -> Config {
    let raw = std::fs::read_to_string(path).unwrap();
    let parsed: Config = serde_json::from_str(&raw).unwrap();
    parsed
}