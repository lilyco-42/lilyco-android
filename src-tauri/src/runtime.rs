//! 运行时自举：把随包带进 APK 的 Termux python3 + ffmpeg + yt-dlp 源码（CI 预解包到
//! resources/runtime/）首次启动时复制到 App 数据目录，并写一个包装脚本让 lycodl 走它。
//!
//! 事实核查（已坐实）：官方 yt-dlp 是 glibc x86_64 PyInstaller 单文件，Android 用 bionic、
//! 无 glibc、更无 Python，直接跑不了。所以「Seal 式捆绑」在 Android 上的等价实现是：
//! 把 Termux 的 python3 + ffmpeg 预编译 .deb 在 CI 里解包，随 APK 一起分发（离线可用），
//! 再配 yt-dlp 纯 Python 源码 —— 这正是 youtubedl-android 的做法（自带 python + yt-dlp + ffmpeg）。

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::error::Result;

/// App data 下的 runtime 目录：首次启动从 resources 复制而来
pub fn runtime_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .map(|p| p.join("runtime"))
        .unwrap_or_else(|_| PathBuf::from("./runtime"))
}

pub fn runtime_bin_path(app: &AppHandle) -> String {
    let bin = runtime_dir(app).join("usr/bin");
    let mut p = std::env::var("PATH").unwrap_or_default();
    p.insert_str(0, &format!("{}:", bin.to_string_lossy()));
    p
}

pub fn runtime_lib_path(app: &AppHandle) -> String {
    runtime_dir(app).join("usr/lib").to_string_lossy().to_string()
}

/// 是否已就绪（runtime/usr/bin/python3 存在）
pub fn is_ready(app: &AppHandle) -> bool {
    runtime_dir(app).join("usr/bin/python3").exists()
}

/// 首次启动自举：把 resources/runtime 复制到 data/runtime（幂等）
pub fn bootstrap(app: &AppHandle) -> Result<()> {
    let dest = runtime_dir(app);
    if is_ready(app) {
        return Ok(());
    }
    let src = app
        .path()
        .resource_dir()
        .map(|p| p.join("runtime"))
        .map_err(|_| crate::error::AppError::Runtime("找不到随包 runtime 资源".into()))?;
    if !src.exists() {
        return Err(crate::error::AppError::Runtime(format!(
            "随包 runtime 缺失：{}（CI 未解包 Termux python/ffmpeg？）",
            src.display()
        )));
    }
    copy_dir_all(&src, &dest).map_err(|e| crate::error::AppError::Runtime(e.to_string()))?;
    write_wrapper(app)?;
    Ok(())
}

fn write_wrapper(app: &AppHandle) -> Result<()> {
    let dir = runtime_dir(app);
    let yt = dir.join("yt-dlp/yt_dlp/__main__.py");
    let script = format!(
        "#!/system/bin/sh\n# 由 lilyco-android 自举生成（离线，无需联网）\nRUNTIME=\"{}\"\nexport LD_LIBRARY_PATH=\"$RUNTIME/usr/lib:$LD_LIBRARY_PATH\"\nexport PATH=\"$RUNTIME/usr/bin:$PATH\"\nexec \"$RUNTIME/usr/bin/python3\" \"{}\" \"$@\"\n",
        dir.display(), yt.display()
    );
    let p = dir.join("run-ytdlp.sh");
    std::fs::write(&p, script).map_err(|e| crate::error::AppError::Runtime(e.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perm = std::fs::metadata(&p).unwrap().permissions();
        perm.set_mode(0o755);
        std::fs::set_permissions(&p, perm).ok();
    }
    Ok(())
}

fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}
