//! Incremental HTML artifact tools for the in-app agent.
//!
//! Unlike [`super::data_report_html`], which renders a fixed, sanitized template
//! in a single shot, these tools let an agent author a page the way a coding
//! agent does: scaffold a workspace artifact directory, then append/replace/
//! reorder one raw HTML/CSS/JS *block* at a time. Every mutation re-assembles
//! `index.html` and bumps a version file that an injected live-reload client
//! polls, so the built-in browser preview refreshes automatically as the page
//! is built up.
//!
//! Blocks are passed through verbatim (including `<style>` / `<script>`): the
//! artifact is served locally to a single user from trusted agent output, and
//! full HTML/CSS/JS freedom is exactly what makes a rich, compelling page
//! possible. ECharts is available offline at `/_vendor/echarts.min.js`.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::{Deserialize, Serialize};

use super::{
    check_write, escape_html, resolve_output_dir, resolve_path, timestamp_ms, validate_mode,
    write_file,
};

const MANIFEST_FILE: &str = "manifest.json";
const INDEX_FILE: &str = "index.html";
const VERSION_FILE: &str = "__artifact_version";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Block {
    id: String,
    html: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    title: String,
    #[serde(default)]
    lang: String,
    #[serde(default)]
    head_html: String,
    #[serde(default)]
    use_echarts: bool,
    #[serde(default)]
    blocks: Vec<Block>,
    #[serde(default)]
    version: u128,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HtmlArtifactCreateRequest {
    workspace_root: String,
    sandbox_mode: String,
    title: String,
    lang: Option<String>,
    head_html: Option<String>,
    use_echarts: Option<bool>,
    output_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HtmlArtifactResponse {
    output_path: String,
    output_dir: String,
    title: String,
    block_count: usize,
    duration_ms: u128,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HtmlArtifactBlockRequest {
    workspace_root: String,
    sandbox_mode: String,
    /// The `outputDir` returned by `html_artifact_create`.
    output_dir: String,
    id: String,
    html: Option<String>,
    /// "end" (default), "start", "before:<id>", or "after:<id>".
    position: Option<String>,
    delete: Option<bool>,
}

#[tauri::command]
pub fn html_artifact_create(
    req: HtmlArtifactCreateRequest,
) -> Result<HtmlArtifactResponse, String> {
    let started = Instant::now();
    validate_mode(&req.sandbox_mode)?;
    if req.title.trim().is_empty() {
        return Err("artifact 标题不能为空".to_string());
    }
    let dir = resolve_output_dir(
        &req.workspace_root,
        req.output_path.as_deref(),
        "page",
        &req.sandbox_mode,
    )?;

    let manifest = Manifest {
        title: req.title.trim().to_string(),
        lang: req
            .lang
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .unwrap_or_else(|| "zh".to_string()),
        head_html: req.head_html.unwrap_or_default(),
        use_echarts: req.use_echarts.unwrap_or(false),
        blocks: Vec::new(),
        version: timestamp_ms(),
    };
    let index = write_artifact(&dir, &manifest)?;

    Ok(HtmlArtifactResponse {
        output_path: index.display().to_string(),
        output_dir: dir.display().to_string(),
        title: manifest.title,
        block_count: manifest.blocks.len(),
        duration_ms: started.elapsed().as_millis(),
    })
}

#[tauri::command]
pub fn html_artifact_block(req: HtmlArtifactBlockRequest) -> Result<HtmlArtifactResponse, String> {
    let started = Instant::now();
    validate_mode(&req.sandbox_mode)?;
    if req.id.trim().is_empty() {
        return Err("block id 不能为空".to_string());
    }
    let dir = resolve_existing_dir(&req.workspace_root, &req.sandbox_mode, &req.output_dir)?;
    let mut manifest = read_manifest(&dir)?;

    apply_block(
        &mut manifest,
        req.id.trim(),
        req.html,
        req.position.as_deref(),
        req.delete.unwrap_or(false),
    )?;
    manifest.version = timestamp_ms();
    let index = write_artifact(&dir, &manifest)?;

    Ok(HtmlArtifactResponse {
        output_path: index.display().to_string(),
        output_dir: dir.display().to_string(),
        title: manifest.title,
        block_count: manifest.blocks.len(),
        duration_ms: started.elapsed().as_millis(),
    })
}

/// Insert, update, move, or delete a block in place.
fn apply_block(
    manifest: &mut Manifest,
    id: &str,
    html: Option<String>,
    position: Option<&str>,
    delete: bool,
) -> Result<(), String> {
    let existing = manifest.blocks.iter().position(|b| b.id == id);
    if delete {
        if let Some(i) = existing {
            manifest.blocks.remove(i);
        }
        return Ok(());
    }
    let html = html.unwrap_or_default();
    match position {
        // No explicit position: update in place if present, else append.
        None => match existing {
            Some(i) => manifest.blocks[i].html = html,
            None => manifest.blocks.push(Block {
                id: id.to_string(),
                html,
            }),
        },
        Some(pos) => {
            if let Some(i) = existing {
                manifest.blocks.remove(i);
            }
            let at = resolve_position(&manifest.blocks, pos)?;
            manifest.blocks.insert(
                at.min(manifest.blocks.len()),
                Block {
                    id: id.to_string(),
                    html,
                },
            );
        }
    }
    Ok(())
}

fn resolve_position(blocks: &[Block], position: &str) -> Result<usize, String> {
    let pos = position.trim();
    if pos.is_empty() || pos.eq_ignore_ascii_case("end") {
        return Ok(blocks.len());
    }
    if pos.eq_ignore_ascii_case("start") {
        return Ok(0);
    }
    if let Some(target) = pos.strip_prefix("before:") {
        let target = target.trim();
        return Ok(blocks
            .iter()
            .position(|b| b.id == target)
            .unwrap_or(blocks.len()));
    }
    if let Some(target) = pos.strip_prefix("after:") {
        let target = target.trim();
        return Ok(blocks
            .iter()
            .position(|b| b.id == target)
            .map(|i| i + 1)
            .unwrap_or(blocks.len()));
    }
    Err(format!(
        "无效 position: {pos}（仅支持 end, start, before:<id>, after:<id>）"
    ))
}

/// Resolve an existing artifact directory and ensure it is writable.
fn resolve_existing_dir(
    workspace_root: &str,
    sandbox_mode: &str,
    output_dir: &str,
) -> Result<PathBuf, String> {
    if output_dir.trim().is_empty() {
        return Err("缺少 outputDir（先用 html_artifact_create 创建）".to_string());
    }
    let dir = resolve_path(workspace_root, output_dir)?;
    if !dir.is_dir() {
        return Err(format!("artifact 目录不存在: {}", dir.display()));
    }
    check_write(sandbox_mode, workspace_root, &dir.join(INDEX_FILE))?;
    Ok(dir)
}

fn read_manifest(dir: &Path) -> Result<Manifest, String> {
    let path = dir.join(MANIFEST_FILE);
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("读取 artifact 清单失败 {}: {e}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|e| format!("解析 artifact 清单失败 {}: {e}", path.display()))
}

/// Persist the manifest, re-assemble `index.html`, and bump the version file.
/// Returns the path to `index.html`.
fn write_artifact(dir: &Path, manifest: &Manifest) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| format!("创建输出目录失败 {}: {e}", dir.display()))?;
    let manifest_json =
        serde_json::to_string_pretty(manifest).map_err(|e| format!("序列化清单失败: {e}"))?;
    write_file(&dir.join(MANIFEST_FILE), manifest_json.as_bytes())?;
    write_file(
        &dir.join(VERSION_FILE),
        manifest.version.to_string().as_bytes(),
    )?;
    let index = dir.join(INDEX_FILE);
    write_file(&index, assemble_index(manifest).as_bytes())?;
    Ok(index)
}

/// Re-assemble the full `index.html` from the manifest. The title and block ids
/// are escaped; head html and block html are passed through verbatim.
fn assemble_index(m: &Manifest) -> String {
    let lang = if m.lang.trim().is_empty() {
        "zh"
    } else {
        m.lang.trim()
    };
    let echarts = if m.use_echarts {
        "  <script src=\"/_vendor/echarts.min.js\"></script>\n"
    } else {
        ""
    };
    let head_html = if m.head_html.trim().is_empty() {
        String::new()
    } else {
        format!("{}\n", m.head_html)
    };
    let body: String = m
        .blocks
        .iter()
        .map(|b| {
            format!(
                "  <section data-block=\"{}\">\n{}\n  </section>\n",
                escape_html(&b.id),
                b.html
            )
        })
        .collect();

    format!(
        "<!doctype html>\n<html lang=\"{lang}\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <title>{title}</title>\n{echarts}{head}</head>\n<body>\n{body}{reload}\n</body>\n</html>\n",
        lang = escape_html(lang),
        title = escape_html(&m.title),
        echarts = echarts,
        head = head_html,
        body = body,
        reload = RELOAD_SCRIPT,
    )
}

/// Polls the version file and reloads when the artifact changes. Kept inline so
/// the served page is fully self-contained.
const RELOAD_SCRIPT: &str = r##"  <script>
  (function () {
    var url = "./__artifact_version";
    var current = null;
    function poll() {
      fetch(url, { cache: "no-store" })
        .then(function (r) { return r.ok ? r.text() : null; })
        .then(function (v) {
          if (v == null) return;
          v = v.trim();
          if (current === null) { current = v; }
          else if (v !== current) { location.reload(); return; }
          setTimeout(poll, 700);
        })
        .catch(function () { setTimeout(poll, 1200); });
    }
    poll();
  })();
  </script>"##;

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_workspace(tag: &str) -> PathBuf {
        let ns = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("artifact-test-{tag}-{ns}"));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::canonicalize(&dir).unwrap()
    }

    fn create(ws: &Path, out: &str) -> HtmlArtifactResponse {
        html_artifact_create(HtmlArtifactCreateRequest {
            workspace_root: ws.display().to_string(),
            sandbox_mode: "workspace-write".to_string(),
            title: "My Page".to_string(),
            lang: None,
            head_html: Some("<style>body{margin:0}</style>".to_string()),
            use_echarts: Some(true),
            output_path: Some(out.to_string()),
        })
        .unwrap()
    }

    fn block(ws: &Path, dir: &str, id: &str, html: &str, position: Option<&str>, delete: bool) {
        html_artifact_block(HtmlArtifactBlockRequest {
            workspace_root: ws.display().to_string(),
            sandbox_mode: "workspace-write".to_string(),
            output_dir: dir.to_string(),
            id: id.to_string(),
            html: Some(html.to_string()),
            position: position.map(|s| s.to_string()),
            delete: Some(delete),
        })
        .unwrap();
    }

    #[test]
    fn create_writes_shell_manifest_and_version() {
        let ws = temp_workspace("create");
        let res = create(&ws, "page");
        let dir = PathBuf::from(&res.output_dir);
        let index = std::fs::read_to_string(dir.join("index.html")).unwrap();
        assert!(index.contains("<title>My Page</title>"));
        assert!(index.contains("/_vendor/echarts.min.js"));
        assert!(index.contains("<style>body{margin:0}</style>"));
        assert!(index.contains("__artifact_version"));
        assert!(dir.join("manifest.json").is_file());
        assert!(dir.join("__artifact_version").is_file());
        assert_eq!(res.block_count, 0);
        let _ = std::fs::remove_dir_all(ws);
    }

    #[test]
    fn block_upsert_reassembles_and_bumps_version() {
        let ws = temp_workspace("upsert");
        let res = create(&ws, "page");
        let dir = res.output_dir.clone();
        let v0 = std::fs::read_to_string(PathBuf::from(&dir).join("__artifact_version")).unwrap();

        block(&ws, &dir, "hero", "<h1>Hello</h1>", None, false);
        let index = std::fs::read_to_string(PathBuf::from(&dir).join("index.html")).unwrap();
        assert!(index.contains("data-block=\"hero\""));
        assert!(index.contains("<h1>Hello</h1>"));
        let v1 = std::fs::read_to_string(PathBuf::from(&dir).join("__artifact_version")).unwrap();
        assert_ne!(v0, v1);

        // Update in place keeps a single block.
        block(&ws, &dir, "hero", "<h1>Hi</h1>", None, false);
        let index = std::fs::read_to_string(PathBuf::from(&dir).join("index.html")).unwrap();
        assert!(index.contains("<h1>Hi</h1>"));
        assert!(!index.contains("<h1>Hello</h1>"));
        let _ = std::fs::remove_dir_all(ws);
    }

    #[test]
    fn block_ordering_and_delete() {
        let ws = temp_workspace("order");
        let res = create(&ws, "page");
        let dir = res.output_dir.clone();
        block(&ws, &dir, "a", "<p>A</p>", None, false);
        block(&ws, &dir, "c", "<p>C</p>", None, false);
        block(&ws, &dir, "b", "<p>B</p>", Some("after:a"), false);

        let index = std::fs::read_to_string(PathBuf::from(&dir).join("index.html")).unwrap();
        let pa = index.find("<p>A</p>").unwrap();
        let pb = index.find("<p>B</p>").unwrap();
        let pc = index.find("<p>C</p>").unwrap();
        assert!(pa < pb && pb < pc, "expected A,B,C order");

        block(&ws, &dir, "b", "", None, true);
        let index = std::fs::read_to_string(PathBuf::from(&dir).join("index.html")).unwrap();
        assert!(!index.contains("<p>B</p>"));
        let _ = std::fs::remove_dir_all(ws);
    }

    #[test]
    fn raw_script_passes_through() {
        let ws = temp_workspace("raw");
        let res = create(&ws, "page");
        let dir = res.output_dir.clone();
        block(
            &ws,
            &dir,
            "js",
            "<script>console.log(1)</script>",
            None,
            false,
        );
        let index = std::fs::read_to_string(PathBuf::from(&dir).join("index.html")).unwrap();
        assert!(index.contains("<script>console.log(1)</script>"));
        let _ = std::fs::remove_dir_all(ws);
    }

    #[test]
    fn rejects_dir_outside_workspace() {
        let ws = temp_workspace("outside");
        let other = temp_workspace("outside-other");
        let err = html_artifact_block(HtmlArtifactBlockRequest {
            workspace_root: ws.display().to_string(),
            sandbox_mode: "workspace-write".to_string(),
            output_dir: other.display().to_string(),
            id: "x".to_string(),
            html: Some("<p>x</p>".to_string()),
            position: None,
            delete: Some(false),
        });
        assert!(err.is_err());
        let _ = std::fs::remove_dir_all(ws);
        let _ = std::fs::remove_dir_all(other);
    }
}
