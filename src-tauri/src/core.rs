//! Android yerel modu (Faz 33): Go sunucusu süreç içinde, `libtitan.so`
//! C dışa aktarımlarıyla (backend/cmd/libtitan) başlatılır. Sonuç masaüstü
//! sidecar'ıyla aynı biçimdedir: `{ base, token }`.

use serde::Deserialize;

#[derive(Debug, Deserialize, PartialEq)]
struct StartResult {
    base: Option<String>,
    token: Option<String>,
    error: Option<String>,
}

/// `TitanStart` JSON çıktısını (base, token) çiftine çevirir.
pub fn parse_start(json: &str) -> Result<(String, String), String> {
    let r: StartResult = serde_json::from_str(json).map_err(|e| format!("çekirdek yanıtı okunamadı: {e}"))?;
    if let Some(e) = r.error {
        return Err(e);
    }
    match (r.base, r.token) {
        (Some(b), Some(t)) if b.starts_with("http://127.0.0.1:") && t.len() >= 32 => Ok((b, t)),
        _ => Err(format!("çekirdek yanıtı eksik: {json}")),
    }
}

#[cfg(target_os = "android")]
mod ffi {
    use std::ffi::{c_char, CStr, CString};
    extern "C" {
        fn TitanStart(data_dir: *const c_char) -> *mut c_char;
        fn TitanStop();
        fn TitanFree(p: *mut c_char);
    }

    pub fn start(data_dir: &str) -> Result<(String, String), String> {
        let c = CString::new(data_dir).map_err(|e| e.to_string())?;
        // SAFETY: TitanStart geçerli, NUL sonlu bir C dizgesi döndürür; TitanFree ile bırakılır.
        let json = unsafe {
            let p = TitanStart(c.as_ptr());
            if p.is_null() {
                return Err("TitanStart boş döndü".into());
            }
            let s = CStr::from_ptr(p).to_string_lossy().into_owned();
            TitanFree(p);
            s
        };
        super::parse_start(&json)
    }

    pub fn stop() {
        // SAFETY: argümansız, birden çok çağrıya dayanıklı.
        unsafe { TitanStop() }
    }
}

#[cfg(target_os = "android")]
pub use ffi::{start, stop};

#[cfg(test)]
mod tests {
    use super::parse_start;

    #[test]
    fn parses_ok_and_error() {
        let tok = "a".repeat(64);
        let ok = format!(r#"{{"base":"http://127.0.0.1:5123","token":"{tok}"}}"#);
        assert_eq!(parse_start(&ok), Ok(("http://127.0.0.1:5123".into(), tok)));
        assert_eq!(parse_start(r#"{"error":"disk dolu"}"#), Err("disk dolu".into()));
        assert!(parse_start(r#"{"base":"http://evil:1","token":"x"}"#).is_err());
        assert!(parse_start("nope").is_err());
    }
}
