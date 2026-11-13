//! 命令层：前端（WebView 里的 React）只调这几个命令。
//! 不重复 lycodl 的解析逻辑 —— 只负责「自举运行时 / 拉起 Web 控制台 / 查状态 / 打开外链」。

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_shell::ShellExt;

use crate::error::{AppError, Result};
use crate::lyco::LycoState;
use crate::runtime;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusInfo {
    pub ready: bool,
    pub port: Option<u16>,
    pub runtime_dir: String,
}

/// 首次启动：把随包带的 Termux python3 + ffmpeg + yt-dlp 复制到 App 数据目录
#[tauri::command]
pub async fn bootstrap_runtime(app: AppHandle) -> Result<()> {
    runtime::bootstrap(&app)
}

/// 启动 lycodl 的 Web 控制台（sidecar），返回端口
#[tauri::command]
pub async fn launch_web(app: AppHandle, state: State<'_, LycoState>) -> Result<u16> {
    if !runtime::is_ready(&app) {
        runtime::bootstrap(&app)?;
    }
    let port = crate::lyco::launch(&app, &state)?;
    *state.0.lock().unwrap() = Some(port);
    Ok(port)
}

/// 停掉 lycodl Web 控制台
#[tauri::command]
pub async fn stop_web(_app: AppHandle, state: State<'_, LycoState>) -> Result<()> {
    let mut guard = state.1.lock().unwrap();
    if let Some(child) = guard.take() {
        let _ = child.kill();
    }
    drop(guard);
    *state.0.lock().unwrap() = None;
    Ok(())
}

/// 查状态：运行时是否就绪、当前端口
#[tauri::command]
pub async fn status(app: AppHandle, state: State<'_, LycoState>) -> Result<StatusInfo> {
    let port = *state.0.lock().unwrap();
    Ok(StatusInfo {
        ready: runtime::is_ready(&app),
        port,
        runtime_dir: runtime::runtime_dir(&app).to_string_lossy().to_string(),
    })
}

/// 打开系统浏览器到某个外链（比如 lycodl 帮助）
#[tauri::command]
pub async fn open_url(app: AppHandle, url: String) -> Result<()> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppError::Args("只接受 http(s) 链接".into()));
    }
    app.shell()
        .command("xdg-open")
        .arg(&url)
        .status()
        .await
        .map(|_| ())
        .map_err(|e| AppError::Spawn(e.to_string()))
}
