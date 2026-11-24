//! Android'de Go çekirdeği (`libtitan.so`, scripts/build-mobile-core.mjs)
//! Rust kütüphanesine dinamik bağlanır; masaüstünde ek bir şey yapılmaz.
use std::path::PathBuf;

fn android_abi(arch: &str) -> Option<&'static str> {
    match arch {
        "aarch64" => Some("arm64-v8a"),
        "x86_64" => Some("x86_64"),
        "arm" => Some("armeabi-v7a"),
        "x86" => Some("x86"),
        _ => None,
    }
}

fn main() {
    println!("cargo:rerun-if-env-changed=TITAN_CORE_DIR");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
        let abi = android_abi(&arch).unwrap_or_else(|| panic!("desteklenmeyen Android mimarisi: {arch}"));
        let dir = std::env::var("TITAN_CORE_DIR").map(PathBuf::from).unwrap_or_else(|_| {
            PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("binaries/android").join(abi)
        });
        let lib = dir.join("libtitan.so");
        if !lib.exists() {
            panic!("{} yok: önce `node scripts/build-mobile-core.mjs` çalıştır", lib.display());
        }
        println!("cargo:rerun-if-changed={}", lib.display());
        println!("cargo:rustc-link-search=native={}", dir.display());
        println!("cargo:rustc-link-lib=dylib=titan");
    }
    tauri_build::build()
}
