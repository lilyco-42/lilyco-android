// CI 准备：把 lycodl sidecar 与 Termux python/ffmpeg/yt-dlp 运行时备齐，
// 供 `tauri android build` 打包进 APK。纯 Node（无 gh CLI 依赖）。
//
// 关键事实：官方 yt-dlp 是 glibc x86_64 PyInstaller 单文件，Android（bionic、无 glibc、
// 无 Python）直接跑不了。所以这里借 youtubedl-android（Seal 内核）的做法：把 Termux 的
// python3 + ffmpeg 预编译 .deb 连同依赖一起解包，随 APK 分发，再配 yt-dlp 纯 Python 源码，
// 用一个包装脚本把 LYCODL_YTDLP 指过去，让 lycodl 走 Termux python 而非官方 glibc 二进制。
import { execSync } from "node:child_process";
import os from "node:os";
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

// 用 Node 递归复制并解引用 symlink；遇到指向本批之外（坏链）的直接跳过，
// 避免 cp -aL 因指向兄弟包的文档相对链接报错。
function copyTreeDeref(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isSymbolicLink()) {
      try {
        const real = fs.realpathSync(s);
        const st = fs.statSync(real);
        if (st.isDirectory()) copyTreeDeref(real, d);
        else if (st.isFile()) fs.copyFileSync(real, d);
      } catch { /* 坏链跳过 */ }
      continue;
    }
    if (ent.isDirectory()) copyTreeDeref(s, d);
    else if (ent.isFile()) fs.copyFileSync(s, d);
  }
}

async function extractDeb(url) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "deb-"));
  try {
    const deb = path.join(tmp, "_pkg.deb");
    await downloadTo(url, deb);
    sh(`cd "${tmp}" && ar x "${deb}" && for f in data.tar.*; do [ -e "$f" ] && tar -xf "$f" && break; done; rm -f debian-binary control.tar.* data.tar.*`, tmp);
    const inner = path.join(tmp, "data", "data", "com.termux", "files", "usr");
    if (fs.existsSync(inner)) {
      // 先剔除纯文档/手册：常有指向兄弟包的相对 symlink（如 share/doc/ffmpeg/copyright
      // -> ../libavcodec/copyright），解引用复制时若目标包未在本批里就是坏链。
      sh(`rm -rf "${inner}/share/doc" "${inner}/share/man" "${inner}/share/lintian" "${inner}/share/info"`, tmp);
      copyTreeDeref(inner, path.join(RES, "usr"));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 解析 Termux 依赖闭包：下载 aarch64 Packages 索引，按 stanza 解析 Package/Filename/Depends，
// BFS 收集 seed 包及其全部依赖的 .deb。
async function resolveTermuxDeps(seedUrls) {
  console.log("下载 Termux Packages 索引 (aarch64)...");
  const idxText = await (await fetch(TERMUX_PKGS_IDX)).text();
  const blocks = idxText.split(/\n\n+/).filter((b) => /^Package: /m.test(b));
  const byName = new Map();
  for (const b of blocks) {
    const pkg = (b.match(/^Package: (\S+)/m) || [])[1];
    const fnm = (b.match(/^Filename: (\S+)/m) || [])[1];
    if (!pkg || !fnm) continue;
    byName.set(pkg, `${TERMUX_APT}/${fnm}`);
  }
  const seedNames = seedUrls.map((u) => path.basename(u).split("_")[0]);
  const seen = new Set();
  const queue = [...seedNames];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const b = blocks.find((x) => x.split("\n").some((l) => l === `Package: ${name}`));
    if (!b) continue;
    const m = /^Depends: (.+)/m.exec(b);
    if (!m) continue;
    for (const part of m[1].split(",")) {
      const dep = part.split(/\s*\|\s*/)[0].trim().split(/\s+/)[0].split("(")[0].trim();
      if (byName.has(dep) && !seen.has(dep)) queue.push(dep);
    }
  }
  const urls = [...seen].map((n) => byName.get(n)).filter(Boolean);
  console.log(`解析到 ${urls.length} 个 Termux 包（含依赖）：` + [...seen].join(", "));
  return urls;
}

async function main() {
  // 先彻底清空上一轮（或历史失败）留下的运行时树，确保 Tauri 打包时
  // resources/runtime 里只有真实文件、无残留死链。
  fs.rmSync(RES, { recursive: true, force: true });
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

  // 硬校验：python3 / ffmpeg / yt-dlp 缺一不可，否则打出假绿 APK
  const py = fs.existsSync(path.join(RES, "usr/bin/python3"));
  const ff = fs.existsSync(path.join(RES, "usr/bin/ffmpeg"));
  const ytOk = fs.existsSync(path.join(RES, "yt-dlp", "yt_dlp", "__main__.py"));
  console.log("CI prep done: runtime at", RES);
  console.log("python3:", py ? "ok" : "MISSING", "| ffmpeg:", ff ? "ok" : "MISSING", "| yt-dlp:", ytOk ? "ok" : "MISSING");
  if (!py || !ff || !ytOk) throw new Error("Termux 运行时不完整或 yt-dlp 缺失，拒绝继续构建");
}
main().catch((e) => { console.error(e); process.exit(1); });
