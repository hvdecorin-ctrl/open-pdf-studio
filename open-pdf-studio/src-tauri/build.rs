fn main() {
    // Copy the pdfium-worker binary into src-tauri/binaries/ so Tauri's
    // sidecar bundler picks it up. The binary must be named with the
    // target triple suffix per Tauri's externalBin convention.
    // This must happen BEFORE tauri_build::build() so the validator finds the file.
    let target = std::env::var("TARGET").unwrap_or_else(|_| "x86_64-pc-windows-msvc".to_string());
    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
    let src = std::path::PathBuf::from("../../target")
        .join(&profile)
        .join("pdfium-worker.exe");
    let dst = std::path::PathBuf::from("binaries")
        .join(format!("pdfium-worker-{}.exe", target));
    if src.exists() {
        let _ = std::fs::create_dir_all("binaries");
        let _ = std::fs::copy(&src, &dst);
    }

    // Windows: link Simple MAPI for MAPISendMail (src/email.rs). The in-source
    // #[link(name = "mapi32")] is not reliably honoured across every rustc/SDK
    // setup (CI left __imp_MAPISendMail unresolved), so force the link here.
    if target.contains("windows") {
        println!("cargo:rustc-link-lib=mapi32");
    }

    tauri_build::build();
}
