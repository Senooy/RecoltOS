//! Launch context: caller origin, the app's data folder, socket and spool, browser name.

use crate::json;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Environment lookup (`std::env::var` in production, a map in tests).
pub type Env<'a> = &'a dyn Fn(&str) -> Option<String>;

/// Caller origin: Chrome passes `chrome-extension://<id>/` (1st argument), Firefox passes the
/// manifest path then the extension ID. Either one is searched for in `args`.
pub fn caller_origin<'a>(args: &'a [String], allowed: &[String]) -> Option<&'a str> {
    args.iter()
        .find(|a| allowed.iter().any(|x| x == *a))
        .map(String::as_str)
}

/// `RECOLTOS_ALLOWED_ORIGINS` (comma-separated, tests) or the built-in list.
pub fn allowed_origins(env: Env) -> Vec<String> {
    match env("RECOLTOS_ALLOWED_ORIGINS") {
        Some(v) if !v.is_empty() => v
            .split(',')
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect(),
        _ => crate::constants::DEFAULT_ALLOWED
            .iter()
            .map(|s| s.to_string())
            .collect(),
    }
}

/// Data folder of the app that installed the host: `RECOLTOS_USER_DATA`, otherwise
/// `~/Library/Application Support/RecoltOS` (executable inside a `.app`) or `RecoltOS-dev`.
pub fn app_user_data(env: Env, exe: &str, home: &str) -> PathBuf {
    if let Some(dir) = env("RECOLTOS_USER_DATA").filter(|v| !v.is_empty()) {
        return PathBuf::from(dir);
    }
    let name = if exe.contains(".app/Contents/") {
        "RecoltOS"
    } else {
        "RecoltOS-dev"
    };
    Path::new(home)
        .join("Library")
        .join("Application Support")
        .join(name)
}

pub struct HostConfig {
    /// Empty: no socket, the app is considered closed.
    pub socket: String,
    pub inbox: String,
}

/// Socket and spool: environment variables (tests; set but empty still counts), otherwise
/// `host.json` written by the app at each launch. The browser launches the executable DIRECTLY.
pub fn host_config(env: Env, exe: &str, home: &str) -> HostConfig {
    let dir = app_user_data(env, exe, home);
    let from_file = std::fs::read(dir.join("host.json"))
        .ok()
        .and_then(|b| json::scan(&b));
    let file_str = |name: &str| from_file.as_ref().and_then(|f| f.str_field(name));
    HostConfig {
        socket: env("RECOLTOS_SOCKET")
            .or_else(|| file_str("socket"))
            .unwrap_or_default(),
        inbox: env("RECOLTOS_INBOX")
            .or_else(|| file_str("inbox"))
            .unwrap_or_else(|| dir.join("inbox").to_string_lossy().into_owned()),
    }
}

/// `/bin/ps -o comm=` output → browser name (the `.app` name when there is one), 40 characters.
pub fn browser_name_from_comm(comm: &str) -> String {
    let comm = comm.trim();
    const MARK: &str = ".app/Contents/MacOS/";
    let mut app = None;
    let mut from = 0;
    while let Some(pos) = comm[from..].find(MARK) {
        let end = from + pos;
        // `/([^/]+)\.app\/Contents\/MacOS\//`: a non-empty segment right after a slash.
        if let Some(slash) = comm[..end].rfind('/') {
            if slash + 1 < end {
                app = Some(&comm[slash + 1..end]);
                break;
            }
        }
        from = end + 1;
    }
    let base = app.unwrap_or_else(|| comm.trim_end_matches('/').rsplit('/').next().unwrap_or(""));
    let name: String = base.chars().take(40).collect();
    if name.is_empty() {
        "unknown".into()
    } else {
        name
    }
}

/// Name of the parent process (the browser), shown in the app's Settings.
pub fn parent_name(ppid: u32) -> String {
    if ppid == 0 {
        return "unknown".into();
    }
    let child = Command::new("/bin/ps")
        .args(["-o", "comm=", "-p", &ppid.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();
    let Ok(mut child) = child else {
        return "unknown".into();
    };
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) | Err(_) => return "unknown".into(),
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return "unknown".into();
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(5)),
        }
    }
    let mut out = String::new();
    if let Some(mut stdout) = child.stdout.take() {
        use std::io::Read;
        let _ = stdout.read_to_string(&mut out);
    }
    browser_name_from_comm(&out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env_of(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let m: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k| m.get(k).cloned()
    }

    fn tmp(name: &str) -> PathBuf {
        let d =
            std::env::temp_dir().join(format!("recolt-host-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn origin_is_found_anywhere_in_the_arguments() {
        let allowed: Vec<String> = vec!["chrome-extension://abc/".into(), "x@y".into()];
        let args: Vec<String> = vec!["/m.json".into(), "x@y".into()];
        assert_eq!(caller_origin(&args, &allowed), Some("x@y"));
        assert_eq!(
            caller_origin(&["chrome-extension://autre/".into()], &allowed),
            None
        );
        let env = env_of(&[("RECOLTOS_ALLOWED_ORIGINS", "a,,b")]);
        assert_eq!(
            allowed_origins(&env),
            vec!["a".to_string(), "b".to_string()]
        );
        let none = env_of(&[]);
        assert!(allowed_origins(&none).len() >= 4);
    }

    #[test]
    fn user_data_follows_the_executable() {
        let none = env_of(&[]);
        assert_eq!(
            app_user_data(
                &none,
                "/Applications/RecoltOS.app/Contents/Resources/native-host/recolt-host",
                "/Users/u"
            ),
            PathBuf::from("/Users/u/Library/Application Support/RecoltOS")
        );
        assert_eq!(
            app_user_data(
                &none,
                "/src/RecoltOS/out/native-host/recolt-host",
                "/Users/u"
            ),
            PathBuf::from("/Users/u/Library/Application Support/RecoltOS-dev")
        );
        let empty = env_of(&[("RECOLTOS_USER_DATA", "")]);
        assert!(app_user_data(&empty, "/x", "/h").ends_with("RecoltOS-dev"));
        let set = env_of(&[("RECOLTOS_USER_DATA", "/data")]);
        assert_eq!(app_user_data(&set, "/x", "/h"), PathBuf::from("/data"));
    }

    #[test]
    fn socket_and_spool_from_host_json_unless_the_environment_says_otherwise() {
        let dir = tmp("cfg");
        std::fs::write(
            dir.join("host.json"),
            r#"{"socket":"/tmp/s.sock","inbox":"/tmp/in","pid":1}"#,
        )
        .unwrap();
        let ud = dir.to_string_lossy().into_owned();
        let from_file = env_of(&[("RECOLTOS_USER_DATA", &ud)]);
        let c = host_config(&from_file, "/x", "/h");
        assert_eq!(
            (c.socket.as_str(), c.inbox.as_str()),
            ("/tmp/s.sock", "/tmp/in")
        );
        // Set but empty: no socket (the app is closed), no fallback to host.json.
        let empty = env_of(&[
            ("RECOLTOS_USER_DATA", &ud),
            ("RECOLTOS_SOCKET", ""),
            ("RECOLTOS_INBOX", "/i"),
        ]);
        let c = host_config(&empty, "/x", "/h");
        assert_eq!((c.socket.as_str(), c.inbox.as_str()), ("", "/i"));
        let missing = tmp("cfg-missing");
        let ud2 = missing.to_string_lossy().into_owned();
        let c = host_config(&env_of(&[("RECOLTOS_USER_DATA", &ud2)]), "/x", "/h");
        assert_eq!(c.socket, "");
        assert_eq!(PathBuf::from(c.inbox), missing.join("inbox"));
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(missing);
    }

    #[test]
    fn browser_name() {
        assert_eq!(
            browser_name_from_comm("/Applications/Firefox.app/Contents/MacOS/firefox\n"),
            "Firefox"
        );
        assert_eq!(
            browser_name_from_comm("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            "Google Chrome"
        );
        assert_eq!(browser_name_from_comm("/usr/bin/zsh"), "zsh");
        assert_eq!(browser_name_from_comm("X.app/Contents/MacOS/x"), "x");
        assert_eq!(browser_name_from_comm(""), "unknown");
        assert_eq!(browser_name_from_comm(&"a".repeat(60)).len(), 40);
        assert_ne!(parent_name(std::process::id()), "");
    }
}
