//! good.rs — `.unwrap()` in production code is replaced with `?` propagation.
fn load_config(path: &str) -> Result<Config, ConfigError> {
    let raw = std::fs::read_to_string(path)
        .map_err(ConfigError::Io)?;
    let parsed: Config = serde_json::from_str(&raw)
        .map_err(ConfigError::Parse)?;
    Ok(parsed)
}