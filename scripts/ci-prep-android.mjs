// CI 准备：把 lycodl sidecar 与 Termux python/ffmpeg/yt-dlp 运行时备齐，
// 供 `tauri android build` 打包进 APK。纯 Node（无 gh CLI 依赖）。
//
// 关键事实：官方 yt-dlp 是 glibc x86_64 PyInstaller 单文件，Android（bionic、无 glibc、
// 无 Python）直接跑不了。所以这里借 youtubedl-android（Seal 内核）的做法：把 Termux 的
// python3 + ffmpeg 预编译 .deb 连同依赖一起解包，随 APK 分发，再配 yt-dlp 纯 Python 源码，
// 用一个包装脚本把 LYCODL_YTDLP 指过去，让 lycodl 走 Termux python 而非官方 glibc 二进制。
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve("src-tauri");
const RES = path.join(SRC, "resources", "runtime");
const BIN = path.join(SRC, "binaries");

const TERMUX_APT = "https://packages.termux.dev/apt/termux-main";
const TERMUX_PKGS_IDX = `${TERMUX_APT}/dists/stable/main/binary-aarch64/Packages`;
const PY_URL = `${TERMUX_APT}/pool/main/p/python/python_3.14.10_aarch64.deb`;
const FF_URL = `${TERMUX_APT}/pool/main/f/ffmpeg/ffmpeg_9.0.2-2_aarch64.deb`;
const YTDLP_SRC = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.tar.gz";
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

// 下载并解包一个 Termux .deb 到 `RES/usr`（.deb 内层是 data/data/com.termux/files/usr）
async function extractDeb(url) {
  const tmp = path.join(RES, "_deb_" + Date.now());
  ensureDir(tmp);
  const deb = path.join(tmp, "_pkg.deb");
  await downloadTo(url, deb);
  sh(`cd "${tmp}" && ar x "${deb}" && for f in data.tar.*; do [ -e "$f" ] && tar -xf "$f" && break; done; rm -f debian-binary control.tar.* data.tar.*`, tmp);
  const inner = path.join(tmp, "data", "data", "com.termux", "files", "usr");
  if (fs.existsSync(inner)) sh(`cp -a "${inner}/." "${RES}/usr/"`, RES);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 解析 Termux 依赖闭包：下载 Packages 索引，BFS 收集 seed 包及其全部依赖的 .deb
async function resolveTermuxDeps(seedUrls) {
  console.log("下载 Termux Packages 索引...");
  const idxText = await (await fetch(TERMUX_PKGS_IDX)).text();
  const byName = new Map();
  for (const block of idxText.split(/\n\n+/)) {
    const pkg = /\nPackage: (.+)/.exec(block)?.[1];
    const fn = /\nFilename: (.+)/.exec(block)?.[1];
    if (pkg && fn) byName.set(pkg, `${TERMUX_APT}/${fn}`);
  }
  const depRe = /\nDepends: (.+)/;
  const seeds = seedUrls.map((u) => path.basename(u, ".deb").replace(/_aarch64$/, "").replace(/_\d.*$/, ""));
  // 上面粗取包名不稳，改为从索引反查：按 Filename 末尾 pool 路径的包名
  const seedNames = [];
  for (const u of seedUrls) {
    const bn = path.basename(u);
    // 形如 python_3.14.10_aarch64.deb -> 取第一个下划线前的名字
    const name = bn.split("_")[0];
    seedNames.push(name);
    if (!byName.has(name)) byName.set(name, u); // 直接 URL 兜底
  }
  const seen = new Set();
  const queue = [...seedNames];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const block = [...idxText.split(/\n\n+/)].find((b) => new RegExp(`\\nPackage: ${name}\\n`).test(b));
    if (!block) continue;
    const m = depRe.exec(block);
    if (!m) continue;
    for (const part of m[1].split(",")) {
      const dep = part.split(/\s*\|\s*/)[0].trim().split(/\s+/)[0].split("(")[0].trim();
      if (byName.has(dep) && !seen.has(dep)) queue.push(dep);
    }
  }
  const urls = [];
  for (const name of seen) if (byName.has(name)) urls.push(byName.get(name));
  console.log(`解析到 ${urls.length} 个 Termux 包（含依赖）`);
  return urls;
}

async function main() {
  ensureDir(RES);
  ensureDir(BIN);

  // 1) lycodl sidecar -> binaries/lycodl-aarch64-linux-android
  const lycodlTar = path.join(BIN, "lycodl-android.tar.gz");
  await downloadTo(LYCODL_RELEASE, lycodlTar);
  sh(`tar -xzf "${lycodlTar}" && mv lycodl-android-aarch64/lycodl lycodl-aarch64-linux-android && chmod +x lycodl-aarch64-linux-android`, BIN);
  fs.rmSync(lycodlTar, { force: true });

  // 2) Termux python3 + ffmpeg（含依赖闭包）-> resources/runtime/usr/{bin,lib}
  const depUrls = await resolveTermuxDeps([PY_URL, FF_URL]);
  for (const url of depUrls) {
    try { await extractDeb(url); }
    catch (e) { console.warn("跳过解包失败:", url, e.message); }
  }

  // 3) yt-dlp 源码 -> resources/runtime/yt-dlp
  const yt = path.join(RES, "yt-dlp");
  ensureDir(yt);
  const ytgz = path.join(RES, "ytdlp.tar.gz");
  await downloadTo(YTDLP_SRC, ytgz);
  sh(`tar -xzf "${ytgz}" -C "${yt}" --strip-components=1`, RES);
  fs.rmSync(ytgz, { force: true });

  console.log("CI prep done: runtime at", RES);
  console.log("python3:", fs.existsSync(path.join(RES, "usr/bin/python3")) ? "ok" : "MISSING");
  console.log("ffmpeg:", fs.existsSync(path.join(RES, "usr/bin/ffmpeg")) ? "ok" : "MISSING");
}
main().catch((e) => { console.error(e); process.exit(1); });
