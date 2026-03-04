use log::{error, info};
use serde::Deserialize;

#[derive(Debug, Clone)]
pub struct UpdateInfo {
    pub version: String,
    pub download_url: String,
}

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
}

pub fn is_newer(current: &str, latest: &str) -> bool {
    let parse = |v: &str| -> Option<(u32, u32, u32)> {
        let v = v.strip_prefix('v').unwrap_or(v);
        let parts: Vec<&str> = v.split('.').collect();
        if parts.len() != 3 {
            return None;
        }
        Some((
            parts[0].parse().ok()?,
            parts[1].parse().ok()?,
            parts[2].parse().ok()?,
        ))
    };

    match (parse(current), parse(latest)) {
        (Some(c), Some(l)) => l > c,
        _ => false,
    }
}

pub fn should_check(last_check_timestamp: i64, interval: &str) -> bool {
    if interval == "never" {
        return false;
    }
    if interval == "launch" || last_check_timestamp == 0 {
        return true;
    }

    let now = chrono::Utc::now().timestamp();
    let elapsed = now - last_check_timestamp;

    let threshold = match interval {
        "daily" => 86400,
        "weekly" => 604800,
        "monthly" => 2592000,
        "yearly" => 31536000,
        _ => 0, // treat unknown as "launch"
    };

    elapsed >= threshold
}

pub async fn check_latest_release(current_version: &str) -> Option<UpdateInfo> {
    let client = reqwest::Client::builder()
        .user_agent("windows11-manager")
        .build()
        .ok()?;

    let resp = client
        .get("https://api.github.com/repos/popstas/windows11-manager/releases/latest")
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        error!("GitHub API returned status {}", resp.status());
        return None;
    }

    let release: GitHubRelease = resp.json().await.ok()?;
    let latest = release.tag_name.strip_prefix('v').unwrap_or(&release.tag_name);

    if is_newer(current_version, latest) {
        let download_url = format!(
            "https://github.com/popstas/windows11-manager/releases/download/v{}/windows11-manager_{}_x64-setup.exe",
            latest, latest
        );
        info!("Update available: v{} -> v{}", current_version, latest);
        Some(UpdateInfo {
            version: latest.to_string(),
            download_url,
        })
    } else {
        info!("No update available (current: v{}, latest: v{})", current_version, latest);
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_newer() {
        assert!(is_newer("1.0.7", "1.0.8"));
        assert!(is_newer("1.0.7", "1.1.0"));
        assert!(is_newer("1.0.7", "2.0.0"));
        assert!(!is_newer("1.0.7", "1.0.7"));
        assert!(!is_newer("1.0.8", "1.0.7"));
        assert!(!is_newer("2.0.0", "1.9.9"));
    }

    #[test]
    fn test_is_newer_with_v_prefix() {
        assert!(is_newer("v1.0.7", "v1.0.8"));
        assert!(is_newer("1.0.7", "v1.0.8"));
        assert!(is_newer("v1.0.7", "1.0.8"));
        assert!(!is_newer("v1.0.8", "v1.0.7"));
    }

    #[test]
    fn test_is_newer_invalid() {
        assert!(!is_newer("abc", "1.0.0"));
        assert!(!is_newer("1.0.0", "abc"));
        assert!(!is_newer("1.0", "1.0.1"));
    }

    #[test]
    fn test_should_check_launch() {
        assert!(should_check(0, "launch"));
        assert!(should_check(1000000, "launch"));
    }

    #[test]
    fn test_should_check_never() {
        assert!(!should_check(0, "never"));
        assert!(!should_check(1000000, "never"));
    }

    #[test]
    fn test_should_check_first_time() {
        assert!(should_check(0, "daily"));
        assert!(should_check(0, "weekly"));
    }

    #[test]
    fn test_should_check_daily() {
        let now = chrono::Utc::now().timestamp();
        assert!(!should_check(now, "daily"));
        assert!(should_check(now - 86401, "daily"));
    }

    #[test]
    fn test_should_check_weekly() {
        let now = chrono::Utc::now().timestamp();
        assert!(!should_check(now, "weekly"));
        assert!(should_check(now - 604801, "weekly"));
    }
}
