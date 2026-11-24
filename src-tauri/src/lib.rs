//! TitanView kabuğu: masaüstü (Faz 31, Tauri v2 + Go sidecar) ve Android
//! (Faz 33, Go çekirdeği süreç içinde, `core`).

pub mod alerts;
pub mod core;
pub mod sidecar;

use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
#[cfg(desktop)]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
#[cfg(desktop)]
use tauri::WindowEvent;
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
#[cfg(desktop)]
use tauri_plugin_dialog::MessageDialogButtons;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
#[cfg(desktop)]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;
#[cfg(desktop)]
use tauri_plugin_opener::OpenerExt;
#[cfg(desktop)]
use tauri_plugin_updater::UpdaterExt;

/// Pencereyi göster/gizle genel kısayolu.
pub const TOGGLE_SHORTCUT: &str = "CmdOrCtrl+Shift+T";

struct AppState {
    sidecar: Mutex<Option<sidecar::Sidecar>>,
    stop: Arc<AtomicBool>,
    data_dir: PathBuf,
    log_dir: PathBuf,
    quitting: AtomicBool,
}

/// Çalışılan platform (arayüz mobil yerleşim/özellik seçimi için okur).
pub fn platform() -> &'static str {
    if cfg!(target_os = "android") {
        "android"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(windows) {
        "windows"
    } else {
        "linux"
    }
}

/// Webview'a pencere oluşmadan enjekte edilen yapılandırma betiği.
pub fn init_script(base: &str, token: &str, version: &str) -> String {
    let cfg = serde_json::json!({ "base": base, "token": token, "version": version, "platform": platform() });
    format!("Object.defineProperty(window,'__TITAN_DESKTOP__',{{value:Object.freeze({cfg}),configurable:false}});")
}

/// Güncelleme uç noktası: `TITAN_UPDATE_URL` verilirse o, yoksa yapılandırmadaki.
pub fn update_endpoint_override() -> Option<String> {
    std::env::var("TITAN_UPDATE_URL").ok().filter(|s| !s.trim().is_empty())
}

fn app_log(app: &AppHandle, line: &str) {
    if let Some(st) = app.try_state::<AppState>() {
        let _ = std::fs::create_dir_all(&st.log_dir);
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(st.log_dir.join("desktop.log")) {
            let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
            let _ = writeln!(f, "{ts} {line}");
        }
    }
    log::info!("{line}");
}

#[cfg(desktop)]
fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg(desktop)]
fn toggle_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
            let _ = w.hide();
        } else {
            show_main(app);
        }
    }
}

#[cfg(desktop)]
fn quit(app: &AppHandle) {
    if let Some(st) = app.try_state::<AppState>() {
        st.quitting.store(true, Ordering::SeqCst);
    }
    app.exit(0);
}

fn stop_sidecar(app: &AppHandle) {
    if let Some(st) = app.try_state::<AppState>() {
        st.stop.store(true, Ordering::SeqCst);
        if let Some(mut s) = st.sidecar.lock().unwrap().take() {
            let pid = s.pid();
            app_log(app, &format!("sidecar durduruluyor (pid {pid})"));
            s.stop(Duration::from_secs(5));
            app_log(app, &format!("sidecar durduruldu (pid {pid})"));
        }
    }
}

#[cfg(desktop)]
/// Güncelleme denetimi. `interactive`: tepsiden istendi (sonuç her durumda gösterilir).
/// `TITAN_UPDATE_AUTO_INSTALL=1`: sormadan kur (kanıt/CI için).
async fn check_update(app: AppHandle, interactive: bool) {
    let mut b = app.updater_builder();
    if let Some(url) = update_endpoint_override() {
        match url.parse() {
            Ok(u) => match b.endpoints(vec![u]) {
                Ok(nb) => b = nb,
                Err(e) => return app_log(&app, &format!("güncelleme uç noktası: {e}")),
            },
            Err(e) => return app_log(&app, &format!("güncelleme uç noktası: {e}")),
        }
    }
    let updater = match b.build() {
        Ok(u) => u,
        Err(e) => return app_log(&app, &format!("güncelleyici: {e}")),
    };
    let current = app.package_info().version.to_string();
    let update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => {
            app_log(&app, &format!("güncelleme yok (sürüm {current})"));
            if interactive {
                app.dialog().message(format!("TitanView güncel (sürüm {current}).")).title("Güncelleme").show(|_| {});
            }
            return;
        }
        Err(e) => {
            app_log(&app, &format!("güncelleme denetimi başarısız: {e}"));
            if interactive {
                app.dialog().message(format!("Güncelleme denetlenemedi: {e}")).kind(MessageDialogKind::Error).title("Güncelleme").show(|_| {});
            }
            return;
        }
    };
    app_log(&app, &format!("güncelleme bulundu: {current} → {}", update.version));
    let auto = std::env::var("TITAN_UPDATE_AUTO_INSTALL").map(|v| v == "1").unwrap_or(false);
    if !auto {
        let (tx, rx) = std::sync::mpsc::channel();
        app.dialog()
            .message(format!("TitanView {} hazır (kurulu: {current}). Şimdi indirilip kurulsun mu?", update.version))
            .title("Güncelleme")
            .buttons(MessageDialogButtons::OkCancelCustom("Kur ve yeniden başlat".into(), "Sonra".into()))
            .show(move |ok| {
                let _ = tx.send(ok);
            });
        if !tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(false)).await.unwrap_or(false) {
            app_log(&app, "güncelleme ertelendi");
            return;
        }
    }
    let mut got = 0usize;
    let res = update
        .download_and_install(
            |n, _total| {
                got += n;
            },
            || {},
        )
        .await;
    match res {
        Ok(()) => {
            app_log(&app, &format!("güncelleme imzası doğrulandı ve kuruldu: {} ({got} bayt); yeniden başlatılıyor", update.version));
            stop_sidecar(&app);
            app.restart();
        }
        Err(e) => {
            app_log(&app, &format!("güncelleme reddedildi/başarısız: {e}"));
            if interactive {
                app.dialog().message(format!("Güncelleme kurulamadı: {e}")).kind(MessageDialogKind::Error).title("Güncelleme").show(|_| {});
            }
        }
    }
}

#[cfg(desktop)]
fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "TitanView'u göster/gizle", true, Some(TOGGLE_SHORTCUT))?;
    let update = MenuItem::with_id(app, "update", "Güncellemeleri denetle…", true, None::<&str>)?;
    let data = MenuItem::with_id(app, "data", "Veri klasörünü aç", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Çık", true, None::<&str>)?;
    let version = MenuItem::with_id(app, "version", format!("Sürüm {}", app.package_info().version), false, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &sep, &update, &data, &version, &sep2, &quit_i])?;
    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().expect("ikon"))
        .tooltip("TitanView")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "show" => toggle_main(app),
            "update" => {
                let a = app.clone();
                tauri::async_runtime::spawn(check_update(a, true));
            }
            "data" => {
                if let Some(st) = app.try_state::<AppState>() {
                    let _ = app.opener().open_path(st.data_dir.to_string_lossy(), None::<&str>);
                }
            }
            "quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                toggle_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg(desktop)]
fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let data_dir = std::env::var("TITAN_DATA_DIR").map(PathBuf::from).unwrap_or(app.path().app_data_dir()?);
    let log_dir = app.path().app_log_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    std::fs::create_dir_all(&log_dir)?;
    let stop = Arc::new(AtomicBool::new(false));
    app.manage(AppState { sidecar: Mutex::new(None), stop: stop.clone(), data_dir: data_dir.clone(), log_dir: log_dir.clone(), quitting: AtomicBool::new(false) });

    let exe_dir = std::env::current_exe()?.parent().map(PathBuf::from).ok_or("exe dizini")?;
    let bin = sidecar::sidecar_path(&exe_dir);
    let sc = match sidecar::Sidecar::spawn(&bin, &data_dir, &log_dir.join("server.log"), Duration::from_secs(30)) {
        Ok(s) => s,
        Err(e) => {
            app_log(&handle, &format!("HATA: {e}"));
            handle.dialog().message(format!("Veri sunucusu başlatılamadı:\n{e}")).kind(MessageDialogKind::Error).title("TitanView").blocking_show();
            return Err(e.into());
        }
    };
    let base = sc.base_url();
    app_log(&handle, &format!("sidecar başladı: pid {} {} veri={}", sc.pid(), base, data_dir.display()));
    let (addr, token) = (sc.addr.clone(), sc.token.clone());
    let version = app.package_info().version.to_string();
    *app.state::<AppState>().sidecar.lock().unwrap() = Some(sc);

    let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("TitanView")
        .inner_size(1440.0, 900.0)
        .min_inner_size(900.0, 600.0)
        .initialization_script(&init_script(&base, &token, &version))
        .build()?;
    let wh = handle.clone();
    win.on_window_event(move |e| {
        if let WindowEvent::CloseRequested { api, .. } = e {
            // Kapat → tepsiye gizle (alarmlar ve sunucu çalışmaya devam eder). Çıkış tepsiden.
            let quitting = wh.try_state::<AppState>().map(|s| s.quitting.load(Ordering::SeqCst)).unwrap_or(true);
            if !quitting {
                api.prevent_close();
                if let Some(w) = wh.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
        }
    });

    build_tray(&handle)?;

    match handle.global_shortcut().on_shortcut(TOGGLE_SHORTCUT, |app, _s, e| {
        if e.state() == ShortcutState::Pressed {
            toggle_main(app);
        }
    }) {
        Ok(()) => app_log(&handle, &format!("genel kısayol kayıtlı: {TOGGLE_SHORTCUT}")),
        Err(e) => app_log(&handle, &format!("genel kısayol kaydedilemedi: {e}")),
    }

    let nh = handle.clone();
    alerts::spawn_watcher(addr, token, stop, move |a| {
        let (title, body) = alerts::notification_text(&a);
        app_log(&nh, &format!("bildirim #{}: {title} — {body}", a.id));
        if let Err(e) = nh.notification().builder().title(title).body(body).show() {
            app_log(&nh, &format!("bildirim gösterilemedi: {e}"));
        }
    });

    if std::env::var("TITAN_UPDATE_CHECK").map(|v| v != "0").unwrap_or(true) {
        let uh = handle.clone();
        tauri::async_runtime::spawn(async move {
            tokio_sleep(Duration::from_secs(3)).await;
            check_update(uh, false).await;
        });
    }
    Ok(())
}

/// Android (Faz 33): Go çekirdeğini süreç içinde başlatır, webview'a aynı
/// `{ base, token }` yapılandırmasını verir ve alarm akışını yerel bildirime
/// çevirir. Tepsi, genel kısayol ve güncelleyici yoktur (APK güncellemesi
/// GitHub sürümlerinden elle kurulur).
#[cfg(mobile)]
fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let data_dir = app.path().app_data_dir()?;
    let log_dir = app.path().app_log_dir().unwrap_or_else(|_| data_dir.join("logs"));
    std::fs::create_dir_all(&data_dir)?;
    let stop = Arc::new(AtomicBool::new(false));
    app.manage(AppState { sidecar: Mutex::new(None), stop: stop.clone(), data_dir: data_dir.clone(), log_dir, quitting: AtomicBool::new(false) });
    #[cfg(target_os = "android")]
    let started = core::start(&data_dir.to_string_lossy());
    #[cfg(not(target_os = "android"))]
    let started: Result<(String, String), String> = Err("bu mobil platform desteklenmiyor".into());
    let (base, token) = match started {
        Ok(v) => v,
        Err(e) => {
            app_log(&handle, &format!("HATA: çekirdek başlatılamadı: {e}"));
            handle.dialog().message(format!("Veri sunucusu başlatılamadı:\n{e}")).kind(MessageDialogKind::Error).title("TitanView").show(|_| {});
            return Err(e.into());
        }
    };
    app_log(&handle, &format!("çekirdek başladı: {base} veri={}", data_dir.display()));
    let version = app.package_info().version.to_string();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .initialization_script(&init_script(&base, &token, &version))
        .build()?;
    // Android 13+: bildirim izni çalışma zamanında istenir (reddedilirse alarmlar uygulama içinde kalır).
    let ph = handle.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_notification::PermissionState;
        match ph.notification().permission_state() {
            Ok(PermissionState::Granted) => {}
            _ => match ph.notification().request_permission() {
                Ok(st) => app_log(&ph, &format!("bildirim izni: {st:?}")),
                Err(e) => app_log(&ph, &format!("bildirim izni istenemedi: {e}")),
            },
        }
    });
    let addr = base.trim_start_matches("http://").to_string();
    let nh = handle.clone();
    alerts::spawn_watcher(addr, token, stop, move |a| {
        let (title, body) = alerts::notification_text(&a);
        app_log(&nh, &format!("bildirim #{}: {title} — {body}", a.id));
        if let Err(e) = nh.notification().builder().title(title).body(body).show() {
            app_log(&nh, &format!("bildirim gösterilemedi: {e}"));
        }
    });
    Ok(())
}

/// Uzak sunucu modunda arayüz alarm akışını kendisi dinler ve bildirimi
/// buradan gösterir (yerel modda Rust izleyicisi zaten gösterir).
#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    let title: String = title.chars().take(120).collect();
    let body: String = body.chars().take(500).collect();
    app.notification().builder().title(title).body(body).show().map_err(|e| e.to_string())
}

#[cfg(desktop)]
async fn tokio_sleep(d: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    let app = builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![notify])
        .setup(setup)
        .build(tauri::generate_context!())
        .expect("TitanView başlatılamadı");
    app.run(|handle, event| match event {
        RunEvent::ExitRequested { api, code, .. } => {
            // Son pencere gizlenince çıkma; açık çıkış (tepsi → Çık) code ile gelir.
            let quitting = handle.try_state::<AppState>().map(|s| s.quitting.load(Ordering::SeqCst)).unwrap_or(true);
            if code.is_none() && !quitting {
                api.prevent_exit();
            }
        }
        RunEvent::Exit => {
            stop_sidecar(handle);
            #[cfg(target_os = "android")]
            core::stop();
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show_main(handle),
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_script_is_frozen_json() {
        let s = init_script("http://127.0.0.1:5", "t\"k", "1.0.0");
        assert!(s.contains(r#""base":"http://127.0.0.1:5""#));
        assert!(s.contains(r#""token":"t\"k""#));
        assert!(s.contains("Object.freeze"));
        assert!(s.contains(&format!(r#""platform":"{}""#, platform())));
    }

    #[test]
    fn update_override_ignores_blank() {
        std::env::set_var("TITAN_UPDATE_URL", "  ");
        assert!(update_endpoint_override().is_none());
        std::env::set_var("TITAN_UPDATE_URL", "http://127.0.0.1:9/latest.json");
        assert_eq!(update_endpoint_override().as_deref(), Some("http://127.0.0.1:9/latest.json"));
        std::env::remove_var("TITAN_UPDATE_URL");
    }
}
