# lilyco-android

lilyco 家族的 **移动端 Tauri 2 模板**：把任意一个「lilyco CLI 二进制」作为 sidecar 带进 App，
在 Android 上自举它的运行时，然后用 WebView 打开它自带的 Web 控制台。

**lycodl（多平台视频下载器）是第一个、也是目前唯一一个消费方** —— 它自带完整的 Web 控制台
（解析、REST API、内核热更新、反爬兜底链），App 只负责「把它的控制台塞进 WebView」。

```
lilyco-android/
├── src-tauri/                # Rust 移动端壳（Tauri 2）
│   ├── src/
│   │   ├── lib.rs            # 入口：注册插件 + 4 个命令
│   │   ├── commands.rs       # 自举运行时 / 启动控制台 / 停止 / 查状态 / 打开外链
│   │   ├── lyco.rs           # lycodl 消费方：sidecar 拉起 --web，读 web.port
│   │   ├── runtime.rs        # Termux python3 + ffmpeg + yt-dlp 自举逻辑
│   │   └── error.rs
│   ├── binaries/             # 放 lycodl-aarch64-linux-android（CI 产出，见下）
│   ├── resources/runtime/    # Termux python/ffmpeg + yt-dlp 源码（CI 解包）
│   ├── capabilities/         # shell:allow-execute（lycodl sidecar + pkill + xdg-open）
│   ├── tauri.conf.json       # externalBin=binaries/lycodl，resources=runtime
│   └── Cargo.toml
├── ui/                       # 极简 React 前端：按钮 + 内嵌 iframe 控制台
├── scripts/ci-prep-android.mjs   # 准备 sidecar + 运行时
└── .github/workflows/android-apk.yml
```

> ⚠️ 本模板 **只出 Android APK**（aarch64）。iOS / 鸿蒙需要 Xcode Cloud / DevEco 签名与原生
> 外壳封装，GitHub Runner 出不了 App，文档里说明，不在此模板范围内。

## 为什么需要自带 Python 运行时（关键事实）

官方 yt-dlp 是 **glibc x86_64 的 PyInstaller 单文件**。Android 用 **bionic libc、无 glibc、
更无 Python**，直接跑不了。所以「Seal 式 yt-dlp/ffmpeg 捆绑」在 Android 上的等价实现是：

- 用 **Termux 的 python3 + ffmpeg 预编译 .deb**（aarch64），在 CI 里解包，随 APK 一起分发；
- 配 **yt-dlp 纯 Python 源码**（`yt_dlp/__main__.py`）；
- 写一个包装脚本 `run-ytdlp.sh`，把 `LYCODL_YTDLP` 指向它，让 lycodl 走 Termux python
  而不是官方 glibc 二进制（后者在 Android 上会被 lycodl 内核热更新错误覆盖，故必须绕开）。

这正是 youtubedl-android（Seal 的内核）的做法：自带 python + yt-dlp + ffmpeg。

## 本地开发 / 打包

```bash
npm install                       # 装本地 @tauri-apps/cli
node scripts/ci-prep-android.mjs  # 准备 sidecar + runtime（需联网拉 Termux deb / lycodl release）
npx tauri android init            # 生成 gen/android（需 Android SDK + NDK）
npx tauri android build --apk --debug --target aarch64
```

产物：`src-tauri/gen/android/app/build/outputs/apk/**/*.apk`（debug 签名，可直接 waydroid 侧载）。

一键 CI：push 一个 `v*` tag 或手动 `workflow_dispatch`，自动化产出并 draft 一个 Release。

## 把新的 lilyco CLI 接进来（加第二个消费方）

1. 在 CI prep 里下载该 CLI 的 aarch64 二进制到 `binaries/<name>-aarch64-linux-android`；
2. 在 `tauri.conf.json` 的 `bundle.externalBin` 加 `binaries/<name>`；
3. 在 `capabilities/default.json` 加一条 `shell:allow-execute`（sidecar: true）；
4. 若要它自带新运行时，扩展 `runtime.rs` 与 `ci-prep-android.mjs`。

## waydroid 烟测（本机已装）

```bash
# 以 session 用户身份（带 DBUS session bus）侧载 debug APK
waydroid app install src-tauri/gen/android/app/build/outputs/apk/debug/*.apk
waydroid app launch <package>
```

> ⚠️ `waydroid app install` 必须走 **session 用户** 的 D-Bus（sudo/root 视角看不到，会报
> "WayDroid session is stopped"）。必要时 `waydroid session start` 后等其稳定再装。
