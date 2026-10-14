//! The relay: extension frames on stdin/stdout ↔ the app's Unix socket (NDJSON).
//!
//! One loop owns all the state; a thread reads stdin and one thread per app connection reads the
//! socket, both feeding the loop through a channel. stdout is written by the loop only and is
//! reserved for the protocol; logs go to stderr.
//!
//! App closed: `save.create` without `upload` is written to the `inbox/` spool, everything else
//! gets `APP_NOT_RUNNING`. No secret: the controls are `allowed_origins` / `allowed_extensions`
//! (browser), the origin in `argv` (main) and the protocol version (app).

use crate::constants::{
    BRIDGE_PROTOCOL_VERSION, HOST_PING_MS, MAX_FROM_EXT_BYTES, MAX_TO_EXT_BYTES,
};
use crate::framing::{self, DecodeEvent, FrameDecoder, LineDecoder, MAX_LINE_BYTES};
use crate::json::{self, Scanned};
use std::fs::{DirBuilder, OpenOptions};
use std::io::{ErrorKind, Read, Write};
use std::net::Shutdown;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const HOST_VERSION: &str = "1.0.0";
const RECONNECT: Duration = Duration::from_secs(2);

pub fn log(s: &str) {
    let _ = writeln!(std::io::stderr().lock(), "[recoltos-host] {s}");
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis())
}

extern "C" {
    fn getentropy(buf: *mut u8, len: usize) -> i32;
}

/// Random UUID v4 (the app validates `id` / `re` against the UUID pattern).
pub fn uuid() -> String {
    let mut b = [0u8; 16];
    // SAFETY: `b` is a valid writable buffer of 16 bytes (getentropy accepts up to 256).
    if unsafe { getentropy(b.as_mut_ptr(), b.len()) } != 0 {
        let seed = now_ms() ^ ((std::process::id() as u128) << 64);
        b = seed.to_le_bytes();
    }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    )
}

enum Event {
    Ext(Scanned),
    ExtInvalid(&'static str),
    ExtFatal(String),
    ExtEnd,
    AppLine(Vec<u8>),
    AppClosed(u64),
}

pub struct Options {
    pub origin: String,
    pub socket: String,
    pub inbox: String,
    pub browser: String,
}

struct Host {
    opts: Options,
    tx: Sender<Event>,
    /// `app.status` sent last (`None`: never, or reset by `hello` while the app is closed).
    announced: Option<bool>,
    sock: Option<(u64, UnixStream)>,
    conn_seq: u64,
    gave_up: bool,
    reconnect_at: Option<Instant>,
}

pub fn run(opts: Options) -> ! {
    let (tx, rx) = mpsc::channel::<Event>();
    let stdin_tx = tx.clone();
    let reader = std::thread::Builder::new()
        .name("stdin".into())
        .spawn(move || read_stdin(stdin_tx));
    if reader.is_err() {
        log("fermeture : thread");
        std::process::exit(1);
    }
    let mut host = Host {
        opts,
        tx,
        announced: None,
        sock: None,
        conn_seq: 0,
        gave_up: false,
        reconnect_at: None,
    };
    host.connect_app();
    // Without a configured socket the app is considered closed: the extension knows right away.
    if host.opts.socket.is_empty() {
        host.announce(false);
    }
    let ping_every = Duration::from_millis(HOST_PING_MS);
    let mut next_ping = Instant::now() + ping_every;
    loop {
        let deadline = host.reconnect_at.map_or(next_ping, |r| r.min(next_ping));
        match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(ev) => host.handle(ev),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => host.shutdown(0),
        }
        let now = Instant::now();
        if now >= next_ping {
            host.reply(None, "ping", None);
            next_ping = now + ping_every;
        }
        if host.reconnect_at.is_some_and(|r| now >= r) {
            host.reconnect_at = None;
            host.connect_app();
        }
    }
}

fn read_stdin(tx: Sender<Event>) {
    let mut decoder = FrameDecoder::new(MAX_FROM_EXT_BYTES);
    let mut stdin = std::io::stdin().lock();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = match stdin.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == ErrorKind::Interrupted => continue,
            Err(_) => break,
        };
        for ev in decoder.push(&buf[..n]) {
            let fatal = matches!(ev, DecodeEvent::Fatal(_));
            let sent = tx.send(match ev {
                DecodeEvent::Message(m) => Event::Ext(m),
                DecodeEvent::Invalid(r) => Event::ExtInvalid(r),
                DecodeEvent::Fatal(r) => Event::ExtFatal(r),
            });
            if fatal || sent.is_err() {
                return;
            }
        }
    }
    let _ = tx.send(Event::ExtEnd);
}

fn read_app(id: u64, mut stream: UnixStream, tx: Sender<Event>) {
    let mut lines = LineDecoder::new(MAX_LINE_BYTES);
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == ErrorKind::Interrupted => continue,
            Err(_) => break,
        };
        let Some(got) = lines.push(&buf[..n]) else {
            log("ligne de l’app trop longue");
            let _ = stream.shutdown(Shutdown::Both);
            break;
        };
        for line in got {
            if tx.send(Event::AppLine(line)).is_err() {
                return;
            }
        }
    }
    let _ = tx.send(Event::AppClosed(id));
}

impl Host {
    fn handle(&mut self, ev: Event) {
        match ev {
            Event::Ext(m) => self.on_from_extension(m),
            Event::ExtInvalid(reason) => log(&format!("trame ignorée : {reason}")),
            Event::ExtFatal(reason) => {
                log(&format!("fermeture : {reason}"));
                self.shutdown(4);
            }
            Event::ExtEnd => self.shutdown(0),
            Event::AppLine(line) => self.on_from_app(&line),
            Event::AppClosed(id) => {
                if self.sock.as_ref().is_some_and(|(cur, _)| *cur == id) {
                    self.sock = None;
                }
                self.on_app_gone();
            }
        }
    }

    fn on_app_gone(&mut self) {
        self.announce(false);
        if !self.gave_up {
            self.reconnect_at = Some(Instant::now() + RECONNECT);
        }
    }

    fn shutdown(&mut self, code: i32) -> ! {
        let _ = std::io::stdout().lock().flush();
        if let Some((_, s)) = &self.sock {
            let _ = s.shutdown(Shutdown::Write);
        }
        std::process::exit(code);
    }

    // ---- host → extension

    fn write_frame(&self, frame: &[u8]) {
        let mut out = std::io::stdout().lock();
        let _ = out.write_all(frame);
        let _ = out.flush();
    }

    /// Sends a compact JSON message; beyond 1 MiB, replaces it with `MESSAGE_TOO_LARGE`.
    fn to_extension(&self, msg: &[u8]) {
        if let Some(frame) = framing::encode_frame(msg, MAX_TO_EXT_BYTES) {
            return self.write_frame(&frame);
        }
        let parsed = json::scan(msg);
        let field = |name: &str| parsed.as_ref().and_then(|m| m.field(name));
        log(&format!(
            "message {} non transmis (> 1 Mo)",
            json::js_string(field("type"))
        ));
        if parsed.as_ref().and_then(|m| m.str_field("type")).as_deref() == Some("error") {
            return;
        }
        // `re: msg.re ?? msg.id`, `payload: { code, type: msg.type }` (undefined keys omitted).
        let re = field("re")
            .filter(|r| *r != &b"null"[..])
            .or_else(|| field("id"));
        let mut out =
            format!("{{\"v\":{BRIDGE_PROTOCOL_VERSION},\"id\":\"{}\"", uuid()).into_bytes();
        if let Some(re) = re {
            out.extend_from_slice(b",\"re\":");
            out.extend_from_slice(re);
        }
        out.extend_from_slice(
            format!(
                ",\"type\":\"error\",\"ts\":{},\"payload\":{{\"code\":\"MESSAGE_TOO_LARGE\"",
                now_ms()
            )
            .as_bytes(),
        );
        if let Some(ty) = field("type") {
            out.extend_from_slice(b",\"type\":");
            out.extend_from_slice(ty);
        }
        out.extend_from_slice(b"}}");
        self.to_extension(&out);
    }

    /// `{ v, id, type, ts, payload?, re? }` (`re` only when truthy, like `if (re) m.re = re`).
    fn reply(&self, re: Option<&[u8]>, ty: &str, payload: Option<&str>) {
        let mut out = format!(
            "{{\"v\":{BRIDGE_PROTOCOL_VERSION},\"id\":\"{}\",\"type\":{},\"ts\":{}",
            uuid(),
            json::encode_str(ty),
            now_ms()
        )
        .into_bytes();
        if let Some(p) = payload {
            out.extend_from_slice(b",\"payload\":");
            out.extend_from_slice(p.as_bytes());
        }
        if let Some(re) = re.filter(|r| json::truthy(r)) {
            out.extend_from_slice(b",\"re\":");
            out.extend_from_slice(re);
        }
        out.push(b'}');
        self.to_extension(&out);
    }

    /// `app.status` on each state change (and on the first connection failure).
    fn announce(&mut self, connected: bool) {
        if self.announced == Some(connected) {
            return;
        }
        self.announced = Some(connected);
        self.reply(
            None,
            "app.status",
            Some(&format!("{{\"connected\":{connected}}}")),
        );
    }

    // ---- host ↔ app: Unix socket, NDJSON

    fn connect_app(&mut self) {
        if self.gave_up || self.opts.socket.is_empty() {
            return;
        }
        let Ok(mut stream) = UnixStream::connect(&self.opts.socket) else {
            return self.on_app_gone();
        };
        let reader = stream.try_clone();
        self.conn_seq += 1;
        let id = self.conn_seq;
        let tx = self.tx.clone();
        let spawned = reader.and_then(|r| {
            std::thread::Builder::new()
                .name("app".into())
                .spawn(move || read_app(id, r, tx))
        });
        if spawned.is_err() {
            return self.on_app_gone();
        }
        let hello = format!(
            "{{\"v\":{v},\"id\":\"{id}\",\"type\":\"host.hello\",\"ts\":{ts},\"payload\":{{\"protocol\":{v},\"browser\":{browser},\"origin\":{origin},\"hostVersion\":\"{HOST_VERSION}\",\"pid\":{pid}}}}}\n",
            v = BRIDGE_PROTOCOL_VERSION,
            id = uuid(),
            ts = now_ms(),
            browser = json::encode_str(&self.opts.browser),
            origin = json::encode_str(&self.opts.origin),
            pid = std::process::id(),
        );
        if stream.write_all(hello.as_bytes()).is_err() {
            // The reader sees the closed socket and reports it.
            let _ = stream.shutdown(Shutdown::Both);
        }
        self.sock = Some((id, stream));
        self.reply(None, "app.status", Some("{\"connected\":true}"));
    }

    fn on_from_app(&mut self, line: &[u8]) {
        let text = String::from_utf8_lossy(line);
        let Some(m) = json::scan(text.as_bytes()) else {
            return log("ligne de l’app invalide");
        };
        if m.str_field("type").as_deref() == Some("error") {
            let code = m
                .field("payload")
                .and_then(json::scan)
                .and_then(|p| p.str_field("code"));
            if code.as_deref() == Some("PROTOCOL_MISMATCH") {
                self.gave_up = true;
            }
        }
        self.to_extension(&m.compact);
    }

    // ---- extension → host

    fn on_from_extension(&mut self, msg: Scanned) {
        if !msg.is_object() {
            return;
        }
        let Some(ty) = msg.str_field("type") else {
            return;
        };
        let id = msg.field("id");
        match ty.as_str() {
            "ping" => return self.reply(id, "pong", None),
            "pong" => return,
            _ => {}
        }
        if let Some((_, sock)) = &mut self.sock {
            let mut line = msg.compact.clone();
            line.push(b'\n');
            if sock.write_all(&line).is_err() {
                let _ = sock.shutdown(Shutdown::Both);
            }
            return;
        }
        // `!payload?.upload`
        let upload = msg
            .field("payload")
            .and_then(json::scan)
            .and_then(|p| p.field("upload").map(json::truthy))
            .unwrap_or(false);
        if ty == "save.create" && !upload && self.spool(&msg) {
            return self.reply(id, "save.ack", Some("{\"status\":\"queued\"}"));
        }
        if ty == "hello" || ty == "ext.status" {
            // The extension sends `hello` again when `app.status` turns connected.
            self.announced = None;
            return self.announce(false);
        }
        self.reply(id, "error", Some("{\"code\":\"APP_NOT_RUNNING\"}"));
    }

    /// Atomic write `inbox/<ms>-<id>.json` (folder 0700, file 0600), ingested by the app later.
    fn spool(&self, msg: &Scanned) -> bool {
        if self.opts.inbox.is_empty() {
            return false;
        }
        let id = json::js_string(msg.field("id"));
        if id.contains('/') || id.contains('\0') {
            log("spool impossible : identifiant invalide");
            return false;
        }
        let inbox = Path::new(&self.opts.inbox);
        let file = inbox.join(format!("{}-{id}.json", now_ms()));
        let mut tmp = file.clone().into_os_string();
        tmp.push(".tmp");
        let result = DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(inbox)
            .and_then(|()| {
                OpenOptions::new()
                    .write(true)
                    .create(true)
                    .truncate(true)
                    .mode(0o600)
                    .open(&tmp)
            })
            .and_then(|mut f| f.write_all(&msg.compact))
            .and_then(|()| std::fs::rename(&tmp, &file));
        match result {
            Ok(()) => true,
            Err(err) => {
                log(&format!("spool impossible : {err}"));
                false
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uuid_v4_shape() {
        let a = uuid();
        assert_eq!(a.len(), 36);
        assert_eq!(&a[14..15], "4");
        assert!(matches!(&a[19..20], "8" | "9" | "a" | "b"));
        assert!(a.chars().all(|c| c == '-' || c.is_ascii_hexdigit()));
        assert_ne!(a, uuid());
    }
}
