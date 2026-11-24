//! Alarm SSE dinleyicisi: sidecar'ın `/api/alerts/stream` akışını okur ve her
//! yeni alarm için bir kez işletim sistemi bildirimi üretir. Pencere gizli
//! (tepside) olsa da çalışır; HTTP/1.0 kullanılır (chunked kodlama yok).

use serde::Deserialize;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Default, Clone, PartialEq)]
pub struct SseEvent {
    pub event: String,
    pub data: String,
    pub id: Option<String>,
}

/// Satır satır SSE ayrıştırıcı (WHATWG event-stream alt kümesi).
#[derive(Default)]
pub struct SseParser {
    cur: SseEvent,
    has_data: bool,
}

impl SseParser {
    /// Bir satır besler; boş satırda tamamlanan olayı döndürür.
    pub fn feed(&mut self, raw: &str) -> Option<SseEvent> {
        let line = raw.strip_suffix('\n').unwrap_or(raw);
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.is_empty() {
            if !self.has_data {
                self.cur = SseEvent::default();
                return None;
            }
            let mut ev = std::mem::take(&mut self.cur);
            self.has_data = false;
            if ev.event.is_empty() {
                ev.event = "message".into();
            }
            return Some(ev);
        }
        if line.starts_with(':') {
            return None;
        }
        let (field, value) = match line.split_once(':') {
            Some((f, v)) => (f, v.strip_prefix(' ').unwrap_or(v)),
            None => (line, ""),
        };
        match field {
            "event" => self.cur.event = value.to_string(),
            "data" => {
                if self.has_data {
                    self.cur.data.push('\n');
                }
                self.cur.data.push_str(value);
                self.has_data = true;
            }
            "id" => self.cur.id = Some(value.to_string()),
            _ => {}
        }
        None
    }
}

#[derive(Debug, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AlertEntry {
    pub id: i64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub symbol: String,
    #[serde(default)]
    pub interval: String,
    #[serde(default)]
    pub price: f64,
    #[serde(default)]
    pub message: String,
}

/// Bildirim başlığı ve gövdesi.
pub fn notification_text(a: &AlertEntry) -> (String, String) {
    let title = if a.name.trim().is_empty() {
        format!("Alarm: {}", a.symbol)
    } else {
        format!("Alarm: {}", a.name.trim())
    };
    let mut body = if a.message.trim().is_empty() {
        format!("{} {}", a.symbol, fmt_price(a.price))
    } else {
        a.message.trim().to_string()
    };
    if !a.interval.is_empty() && a.message.trim().is_empty() {
        body.push_str(&format!(" ({})", a.interval));
    }
    (title, body)
}

fn fmt_price(p: f64) -> String {
    if p == 0.0 {
        return String::new();
    }
    let s = if p.abs() >= 1000.0 { format!("{p:.2}") } else { format!("{p:.6}") };
    let s = s.trim_end_matches('0').trim_end_matches('.').to_string();
    s
}

/// Aynı alarm iki kez yayınlanır (tetiklenme + teslimatlar); her `id` bir kez bildirilir.
#[derive(Default)]
pub struct Dedupe {
    last: i64,
}

impl Dedupe {
    pub fn accept(&mut self, id: i64) -> bool {
        if id <= self.last {
            return false;
        }
        self.last = id;
        true
    }
}

/// Bir SSE olayını alarm girdisine çevirir (yalnız `event: alert`).
pub fn alert_from_event(ev: &SseEvent) -> Option<AlertEntry> {
    if ev.event != "alert" {
        return None;
    }
    serde_json::from_str(&ev.data).ok()
}

/// Arka planda akışı dinler; kopmada 3 sn sonra yeniden bağlanır.
pub fn spawn_watcher<F>(addr: String, token: String, stop: Arc<AtomicBool>, mut on_alert: F)
where
    F: FnMut(AlertEntry) + Send + 'static,
{
    std::thread::spawn(move || {
        let mut dedupe = Dedupe::default();
        while !stop.load(Ordering::Relaxed) {
            if let Err(e) = stream_once(&addr, &token, &stop, &mut dedupe, &mut on_alert) {
                log::warn!("alarm akışı: {e}");
            }
            for _ in 0..30 {
                if stop.load(Ordering::Relaxed) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    });
}

fn stream_once<F: FnMut(AlertEntry)>(addr: &str, token: &str, stop: &AtomicBool, dedupe: &mut Dedupe, on_alert: &mut F) -> std::io::Result<()> {
    let mut c = TcpStream::connect(addr)?;
    c.set_read_timeout(Some(Duration::from_secs(60)))?; // sunucu 25 sn'de bir ping atar
    let req = format!("GET /api/alerts/stream?titan_token={token} HTTP/1.0\r\nHost: {addr}\r\nAccept: text/event-stream\r\n\r\n");
    c.write_all(req.as_bytes())?;
    let mut r = BufReader::new(c);
    let mut line = String::new();
    // Başlıklar
    r.read_line(&mut line)?;
    if !line.contains(" 200") {
        return Err(std::io::Error::other(format!("durum: {}", line.trim())));
    }
    loop {
        line.clear();
        if r.read_line(&mut line)? == 0 || line.trim().is_empty() {
            break;
        }
    }
    let mut p = SseParser::default();
    while !stop.load(Ordering::Relaxed) {
        line.clear();
        if r.read_line(&mut line)? == 0 {
            return Ok(());
        }
        if let Some(ev) = p.feed(&line) {
            if let Some(a) = alert_from_event(&ev) {
                if dedupe.accept(a.id) {
                    on_alert(a);
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpListener;
    use std::sync::mpsc;

    #[test]
    fn parser_handles_events_comments_and_multiline() {
        let mut p = SseParser::default();
        let input = "retry: 3000\n: connected\n\nid: 7\nevent: alert\ndata: {\"id\":7}\n\n: ping\n\ndata: a\ndata: b\r\n\r\n";
        let evs: Vec<SseEvent> = input.split_inclusive('\n').filter_map(|l| p.feed(l)).collect();
        assert_eq!(evs.len(), 2);
        assert_eq!(evs[0], SseEvent { event: "alert".into(), data: "{\"id\":7}".into(), id: Some("7".into()) });
        assert_eq!(evs[1].event, "message");
        assert_eq!(evs[1].data, "a\nb");
        assert_eq!(p.feed("data\n"), None);
        assert_eq!(p.feed("\n").unwrap().data, "");
    }

    #[test]
    fn alert_json_and_text() {
        let ev = SseEvent { event: "alert".into(), data: r#"{"id":3,"alertId":"x","name":"BTC kırılım","symbol":"BTCUSDT","interval":"1m","price":98765.4321,"message":""}"#.into(), id: None };
        let a = alert_from_event(&ev).unwrap();
        assert_eq!(a.id, 3);
        let (t, b) = notification_text(&a);
        assert_eq!(t, "Alarm: BTC kırılım");
        assert_eq!(b, "BTCUSDT 98765.43 (1m)");
        let a2 = AlertEntry { id: 4, name: " ".into(), symbol: "THYAO.IS".into(), interval: String::new(), price: 0.0, message: "Fiyat 300'ü geçti".into() };
        assert_eq!(notification_text(&a2), ("Alarm: THYAO.IS".into(), "Fiyat 300'ü geçti".into()));
        assert_eq!(fmt_price(1.2345), "1.2345");
        assert!(alert_from_event(&SseEvent { event: "message".into(), ..Default::default() }).is_none());
        assert!(alert_from_event(&SseEvent { event: "alert".into(), data: "bozuk".into(), id: None }).is_none());
    }

    #[test]
    fn dedupe_notifies_each_id_once() {
        let mut d = Dedupe::default();
        assert!(d.accept(1));
        assert!(!d.accept(1));
        assert!(d.accept(2));
        assert!(!d.accept(1));
    }

    #[test]
    fn watcher_reads_a_real_stream() {
        let ln = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = ln.local_addr().unwrap().to_string();
        std::thread::spawn(move || {
            let (mut s, _) = ln.accept().unwrap();
            let mut req = String::new();
            let mut buf = [0u8; 512];
            while !req.contains("\r\n\r\n") {
                let n = s.read(&mut buf).unwrap();
                req.push_str(&String::from_utf8_lossy(&buf[..n]));
            }
            assert!(req.contains("titan_token=tok"));
            let body = "retry: 3000\n: connected\n\nid: 1\nevent: alert\ndata: {\"id\":1,\"symbol\":\"BTCUSDT\",\"price\":1}\n\nid: 1\nevent: alert\ndata: {\"id\":1,\"symbol\":\"BTCUSDT\",\"price\":1}\n\nid: 2\nevent: alert\ndata: {\"id\":2,\"symbol\":\"ETHUSDT\",\"price\":2}\n\n";
            let _ = write!(s, "HTTP/1.0 200 OK\r\nContent-Type: text/event-stream\r\n\r\n{body}");
            std::thread::sleep(Duration::from_millis(300));
        });
        let (tx, rx) = mpsc::channel();
        let stop = Arc::new(AtomicBool::new(false));
        spawn_watcher(addr, "tok".into(), stop.clone(), move |a| tx.send(a.symbol).unwrap());
        assert_eq!(rx.recv_timeout(Duration::from_secs(3)).unwrap(), "BTCUSDT");
        assert_eq!(rx.recv_timeout(Duration::from_secs(3)).unwrap(), "ETHUSDT");
        assert!(rx.recv_timeout(Duration::from_millis(400)).is_err(), "tekrar bildirim olmamalı");
        stop.store(true, Ordering::Relaxed);
    }
}
