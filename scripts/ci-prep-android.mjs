// CI 准备：把 lycodl sidecar 与 Termux python/ffmpeg/yt-dlp 运行时备齐，
// 供 `tauri android build` 打包进 APK。纯 Node（无 gh CLI 依赖）。
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve("src-tauri");
const RES = path.join(SRC, "resources", "runtime");
const BIN = path.join(SRC, "binaries");

const TERMUX_BASE = "https://packages.termux.dev/apt/termux-main/pool/main";
const PY_URL = `${TERMUX_BASE}/p/python/python_3.14.10_aarch64.deb`;
const FF_URL = `${TERMUX_BASE}/f/ffmpeg/ffmpeg_9.0.2-2_aarch64.deb`;
const YTDLP_SRC = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.tar.gz";
// lycodl 已发布 Android aarch64 CLI（GitHub Release lycodl-android-aarch64.tar.gz）
const LYCODL_RELEASE = "https://github.com/lilyco-42/lycodl/releases/latest/download/lycodl-android-aarch64.tar.gz";

function sh(c, cwd) {
  console.log("+ " + c);
  execSync(c, { stdio: "inherit", cwd });
}
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

async function downloadTo(url, dest) {
  console.log("download", url, "->", dest);
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

async function extractDeb(url, into) {
  ensureDir(into);
  const deb = path.join(into, "_pkg.deb");
  await downloadTo(url, deb);
  // .deb = ar 档案，解 data.tar.* 到 into（Termux 用 zst/xz/gz）
  const tmp = path.join(into, "_deb");
  ensureDir(tmp);
  sh(`ar x "${deb}" && for f in data.tar.*; do [ -e "$f" ] && tar -xf "$f" && break; done; rm -f debian-binary control.tar.* data.tar.*`, tmp);
  sh(`cp -a "${tmp}/usr" "${into}/"`, into);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(deb, { force: true });
}

async function main() {
  // 1) lycodl sidecar -> binaries/lycodl-aarch64-linux-android
  ensureDir(BIN);
  const lycodlTar = path.join(BIN, "lycodl-android.tar.gz");
  await downloadTo(LYCODL_RELEASE, lycodlTar);
  sh(`tar -xzf "${lycodlTar}" && mv lycodl binaries/lycodl-aarch64-linux-android && chmod +x binaries/lycodl-aarch64-linux-android`, BIN);
  fs.rmSync(lycodlTar, { force: true });

  // 2) Termux python3 + ffmpeg -> resources/runtime/usr/{bin,lib}
  ensureDir(RES);
  await extractDeb(PY_URL, RES);
  await extractDeb(FF_URL, RES);

  // 3) yt-dlp 源码 -> resources/runtime/yt-dlp
  const yt = path.join(RES, "yt-dlp");
  ensureDir(yt);
  const ytgz = path.join(RES, "ytdlp.tar.gz");
  await downloadTo(YTDLP_SRC, ytgz);
  sh(`tar -xzf "${ytgz}" -C "${yt}" --strip-components=1`, RES);
  fs.rmSync(ytgz, { force: true });

  console.log("CI prep done: runtime at", RES);
}
main().catch((e) => { console.error(e); process.exit(1); });
