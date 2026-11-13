//! lycodl 消费方：启动随包带进来的 lycodl sidecar（`binaries/lycodl`），
//! 让它以 Web 控制台模式监听 127.0.0.1，并把端口记到 App 态里供前端 WebView 打开。
//!
//! 这里刻意不重复 lycodl 的任何解析逻辑：lycodl 自己有完整的 Web 控制台、REST API、
//! 内核热更新与反爬兜底链，App 只是「把它的 Web 控制台塞进 WebView」。

use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

use crate::error::Result;
use crate::runtime;

/// App 态：当前 lycodl Web 控制台端口 + sidecar 子进程句柄（保活）
pub struct LycoState(pub Mutex<Option<u16>>, pub Mutex<Option<CommandChild>>);

impl Default for LycoState {
    fn default() -> Self {
        Self(Mutex::new(None), Mutex::new(None))
    }
}

/// 读端口：前端 WebView 用它拼 `http://127.0.0.1:{port}`
#[tauri::command]
pub fn lyco_port(state: State<'_, LycoState>) -> Option<u16> {
    *state.0.lock().unwrap()
}

/// 启动 lycodl --web（它会自己挑一个空闲端口并写进 web.port）
pub fn launch(app: &AppHandle, state: &State<'_, LycoState>) -> Result<u16> {
    let wrapper = runtime::runtime_dir(app).join("run-ytdlp.sh");
    let spawned = app
        .shell()
        .sidecar("lycodl")
        .map_err(|one| crate::error::AppError::Sidecar(one.to_string()))?
        .args(["--web"])
        .env("LYCODL_ANDROID", "1")
        // 指向自举出来的 python3+yt-dlp 包装脚本，绕过官方 glibc 二进制
        .env("LYCODL_YTDLP", wrapper.to_string_lossy().to_string())
        .env("PATH", runtime::runtime_bin_path(app))
        .env("LD_LIBRARY_PATH", runtime::runtime_lib_path(app))
        .spawn()
        .map_err(|one| crate::error::AppError::Spawn(one.to_string()))?;
    // spawn() 返回 (事件接收端, 子进程句柄)；把接收端丢进后台任务持续排空，
    // 否则 sidecar 的 stdout/stderr 事件通道被关闭。
    let (mut rx, child) = spawned;
    tauri::async_runtime::spawn(async move {
        while rx.recv().await.is_some() {}
    });

    *state.1.lock().unwrap() = Some(child);
    let port = wait_for_port(app);
    Ok(port)
}

fn wait_for_port(app: &AppHandle) -> u16 {
    if let Ok(data) = app.path().app_data_dir() {
        let port_file = data.join("web.port");
        for _ in 0..50 {
            if let Ok(s) = std::fs::read_to_string(&port_file) {
                if let Ok(p) = s.trim().parse::<u16>() {
                    return p;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }
    8765
}
