//! RecoltOS native messaging host (`recolt-host`), launched by the browser from the manifest
//! written by the app (`com.recoltos.host.json`). See `host.rs` for the relay and
//! `docs/extension.md` for the protocol. Replaces the former Node SEA host with identical behavior.

mod config;
mod constants;
mod framing;
mod host;
mod json;

fn main() {
    let env = |key: &str| std::env::var(key).ok();
    let args: Vec<String> = std::env::args_os()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    let allowed = config::allowed_origins(&env);
    let Some(origin) = config::caller_origin(args.get(1..).unwrap_or(&[]), &allowed) else {
        host::log("origine refusée");
        std::process::exit(2);
    };
    let exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| args.first().cloned().unwrap_or_default());
    #[allow(deprecated)]
    let home = env("HOME")
        .filter(|h| !h.is_empty())
        .or_else(|| std::env::home_dir().map(|p| p.to_string_lossy().into_owned()))
        .unwrap_or_default();
    let cfg = config::host_config(&env, &exe, &home);
    let browser = env("RECOLTOS_BROWSER")
        .unwrap_or_else(|| config::parent_name(std::os::unix::process::parent_id()));
    host::run(host::Options {
        origin: origin.to_string(),
        socket: cfg.socket,
        inbox: cfg.inbox,
        browser,
    });
}
