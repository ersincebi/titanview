//! Go sunucusunu (titanview-server) sidecar olarak yönetir.
//!
//! - `-desktop -addr 127.0.0.1:0` ile rastgele boş loopback portunda başlar,
//!   seçilen adresi stdout'a `TITAN_LISTEN=<addr>` satırıyla basar.
//! - Açılış başına rastgele belirteç `TITAN_DESKTOP_TOKEN` ile verilir.
//! - stdin açık tutulur; kapatılınca (uygulama çıkışı ya da ebeveyn ölümü)
//!   sunucu SQLite'ı düzgün kapatıp çıkar. Süre dolarsa süreç öldürülür.

use std::fs::OpenOptions;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

pub const LISTEN_PREFIX: &str = "TITAN_LISTEN=";

/// `TITAN_LISTEN=127.0.0.1:5123` satırından adresi çıkarır.
pub fn parse_listen_line(line: &str) -> Option<String> {
    let rest = line.trim().strip_prefix(LISTEN_PREFIX)?;
    let addr = rest.trim();
    let (host, port) = addr.rsplit_once(':')?;
    if host.is_empty() || port.parse::<u16>().ok()? == 0 {
        return None;
    }
    Some(addr.to_string())
}

/// 32 baytlık rastgele belirteç (onaltılık).
pub fn new_token() -> String {
    let mut b = [0u8; 32];
    getrandom::getrandom(&mut b).expect("os rng");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Sidecar ikilisinin yolu: paketlerde ana yürütülebilir dosyanın yanında.
pub fn sidecar_path(exe_dir: &Path) -> PathBuf {
    let name = if cfg!(windows) { "titanview-server.exe" } else { "titanview-server" };
    exe_dir.join(name)
}

/// Sunucu komut satırı argümanları.
pub fn server_args(db: &Path) -> Vec<String> {
    vec![
        "-desktop".into(),
        "-addr".into(),
        "127.0.0.1:0".into(),
        "-exit-on-stdin-eof".into(),
        "-db".into(),
        db.to_string_lossy().into_owned(),
    ]
}

pub struct Sidecar {
    pub addr: String,
    pub token: String,
    child: Child,
    stdin: Option<ChildStdin>,
}

impl Sidecar {
    /// Sunucuyu başlatır ve dinleme satırını `timeout` boyunca bekler.
    pub fn spawn(bin: &Path, data_dir: &Path, log_file: &Path, timeout: Duration) -> Result<Sidecar, String> {
        std::fs::create_dir_all(data_dir).map_err(|e| format!("veri dizini: {e}"))?;
        let token = new_token();
        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_file)
            .map_err(|e| format!("günlük dosyası: {e}"))?;
        let mut cmd = Command::new(bin);
        cmd.args(server_args(&data_dir.join("titanview.db")))
            .current_dir(data_dir)
            .env("TITAN_DESKTOP_TOKEN", &token)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::from(log));
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd.spawn().map_err(|e| format!("sidecar başlatılamadı ({}): {e}", bin.display()))?;
        let stdout = child.stdout.take().ok_or("stdout yok")?;
        let stdin = child.stdin.take();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut sent = false;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if !sent {
                    if let Some(a) = parse_listen_line(&line) {
                        let _ = tx.send(a);
                        sent = true;
                    }
                }
            }
        });
        let deadline = Instant::now() + timeout;
        loop {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(addr) => return Ok(Sidecar { addr, token, child, stdin }),
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if let Ok(Some(st)) = child.try_wait() {
                        return Err(format!("sidecar erken çıktı: {st}"));
                    }
                    if Instant::now() >= deadline {
                        let _ = child.kill();
                        return Err("sidecar dinleme adresini zamanında bildirmedi".into());
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    let _ = child.kill();
                    return Err("sidecar stdout kapandı".into());
                }
            }
        }
    }

    pub fn base_url(&self) -> String {
        format!("http://{}", self.addr)
    }

    pub fn pid(&self) -> u32 {
        self.child.id()
    }

    /// Düzgün kapatma: stdin'i kapat (sunucu EOF görüp kapanır), `grace` içinde
    /// çıkmazsa öldür. Her durumda süreç biçilir (zombi kalmaz).
    pub fn stop(&mut self, grace: Duration) {
        self.stdin.take();
        let deadline = Instant::now() + grace;
        while Instant::now() < deadline {
            if let Ok(Some(_)) = self.child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        self.stop(Duration::from_secs(3));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_listen_line() {
        assert_eq!(parse_listen_line("TITAN_LISTEN=127.0.0.1:5123\n").as_deref(), Some("127.0.0.1:5123"));
        assert_eq!(parse_listen_line("  TITAN_LISTEN=[::1]:80 ").as_deref(), Some("[::1]:80"));
        assert_eq!(parse_listen_line("TITAN_LISTEN=127.0.0.1:0"), None);
        assert_eq!(parse_listen_line("TITAN_LISTEN=127.0.0.1"), None);
        assert_eq!(parse_listen_line("TITAN_LISTEN=:80"), None);
        assert_eq!(parse_listen_line("hello"), None);
    }

    #[test]
    fn token_is_random_hex() {
        let a = new_token();
        let b = new_token();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn args_and_path() {
        let a = server_args(Path::new("/d/titanview.db"));
        assert_eq!(a, vec!["-desktop", "-addr", "127.0.0.1:0", "-exit-on-stdin-eof", "-db", "/d/titanview.db"]);
        let p = sidecar_path(Path::new("/x"));
        assert!(p.to_string_lossy().contains("titanview-server"));
    }

    /// Gerçek Go ikilisiyle uçtan uca: rastgele port, belirteç zorunlu, stdin kapanınca çıkış.
    /// `TITAN_SIDECAR_BIN` verilmezse atlanır (CI'da verilir).
    #[test]
    fn real_sidecar_lifecycle() {
        let Ok(bin) = std::env::var("TITAN_SIDECAR_BIN") else {
            eprintln!("TITAN_SIDECAR_BIN yok: atlandı");
            return;
        };
        let dir = std::env::temp_dir().join(format!("titan-sidecar-{}", new_token()));
        let mut s = Sidecar::spawn(Path::new(&bin), &dir, &dir.join("server.log"), Duration::from_secs(20)).expect("spawn");
        let pid = s.pid();
        let port: u16 = s.addr.rsplit_once(':').unwrap().1.parse().unwrap();
        assert!(port > 0);
        let get = |path: &str, tok: Option<&str>| -> String {
            use std::io::{Read, Write};
            let mut c = std::net::TcpStream::connect(&s.addr).unwrap();
            let h = tok.map(|t| format!("X-Titan-Token: {t}\r\n")).unwrap_or_default();
            write!(c, "GET {path} HTTP/1.0\r\nHost: x\r\n{h}\r\n").unwrap();
            let mut out = String::new();
            c.read_to_string(&mut out).unwrap();
            out.lines().next().unwrap_or_default().to_string()
        };
        assert!(get("/healthz", None).contains("401"));
        assert!(get("/healthz", Some(&s.token)).contains("200"));
        assert!(dir.join("titanview.db").exists());
        s.stop(Duration::from_secs(5));
        assert!(s.child.try_wait().unwrap().is_some(), "pid {pid} hâlâ çalışıyor");
        assert!(std::net::TcpStream::connect(&s.addr).is_err(), "port kapanmadı");
        let _ = std::fs::remove_dir_all(dir);
    }
}
