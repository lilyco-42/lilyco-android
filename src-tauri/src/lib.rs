//! lilyco-android —— lilyco 家族的移动端 Tauri 2 模板。
//!
//! 模板本身只做一件事：把任意一个「lilyco CLI 二进制」作为 sidecar 带进 App，
//! 在 Android 上自举它的运行时，然后用 WebView 打开它自带的 Web 控制台。
//! lycodl（多平台视频下载器）是第一个消费方，见 `lyco.rs`。

mod commands;
mod error;
mod lyco;
mod runtime;

pub use error::AppError;
use lyco::LycoState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(LycoState::default())
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap_runtime,
            commands::launch_web,
            commands::stop_web,
            commands::status,
            commands::open_url,
            lyco::lyco_port
        ])
        .run(tauri::generate_context!())
        .expect("lilyco-android 起不来");
}
