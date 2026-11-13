import React, { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export function App() {
  const [status, setStatus] = useState({ ready: false, port: null });
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState("");

  const refresh = useCallback(async () => {
    try {
      const s = await invoke("status");
      setStatus(s);
    } catch (e) {
      setLog(String(e));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const bootstrap = async () => {
    setLoading(true);
    try { await invoke("bootstrap_runtime"); setLog("运行时已就绪（离线，随包自带）"); }
    catch (e) { setLog("自举失败: " + e); }
    finally { setLoading(false); refresh(); }
  };

  const launch = async () => {
    setLoading(true);
    try {
      const port = await invoke("launch_web");
      setStatus((s) => ({ ...s, port }));
      setLog("lycodl 控制台已启动，端口 " + port);
    } catch (e) { setLog("启动失败: " + e); }
    finally { setLoading(false); }
  };

  const stop = async () => {
    await invoke("stop_web");
    setStatus((s) => ({ ...s, port: null }));
    setLog("已停止");
  };

  const consoleUrl = status.port ? `http://127.0.0.1:${status.port}` : null;

  return (
    <div className="app">
      <div className="h">
        <span className={"dot" + (status.port ? " on" : "")} />
        lilyco · lycodl 移动端
      </div>

      <div className="card">
        <div className="muted">
          运行时: {status.ready ? "已就绪" : "未就绪"} · 端口: {status.port ?? "—"}
        </div>
        {!status.ready && (
          <button onClick={bootstrap} disabled={loading}>自举运行时（含 Termux python+ffmpeg+yt-dlp）</button>
        )}
        {status.port ? (
          <button className="ghost" onClick={stop} disabled={loading}>停止 lycodl</button>
        ) : (
          <button onClick={launch} disabled={loading || !status.ready}>
            启动 lycodl 控制台
          </button>
        )}
      </div>

      {consoleUrl && (
        <iframe className="frame" src={consoleUrl} title="lycodl 控制台" />
      )}

      {log && <div className="muted">{log}</div>}
    </div>
  );
}
