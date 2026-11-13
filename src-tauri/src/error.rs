use serde::Serialize;

/// 命令层的失败：一律带上下文，前端拿到就是一句能给人看的话
#[derive(Debug)]
pub enum AppError {
    /// sidecar 路径没配好（包内没有 binaries/lycodl）
    Sidecar(String),
    /// 起来了但进程没跑成
    Spawn(String),
    /// 参数就不对
    Args(String),
    /// 运行时自举失败（下载 / 解包 Termux python+ffmpeg）
    Runtime(String),
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Sidecar(one) => write!(f, "起不动随包带出来的 sidecar：{one}"),
            Self::Spawn(one) => write!(f, "跑 sidecar 失败：{one}"),
            Self::Args(one) => write!(f, "{one}"),
            Self::Runtime(one) => write!(f, "运行时自举失败：{one}"),
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
