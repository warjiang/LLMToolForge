//! DuckDB-backed data tools for the in-app DataAgent.

use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use duckdb::types::ValueRef;
use duckdb::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Number, Value};

const DEFAULT_QUERY_LIMIT: usize = 200;
const MAX_QUERY_LIMIT: usize = 5_000;
const ARTIFACT_DIR: &str = "dataagent-artifacts";

type DataRow = Map<String, Value>;
type QueryPreview = (Vec<String>, Vec<DataRow>);

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DataSource {
    path: String,
    alias: Option<String>,
    format: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSource {
    alias: String,
    path: String,
    format: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckDbQueryRequest {
    workspace_root: String,
    sandbox_mode: String,
    sources: Vec<DataSource>,
    sql: String,
    limit: Option<usize>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DuckDbQueryResponse {
    columns: Vec<String>,
    rows: Vec<Map<String, Value>>,
    row_count: usize,
    truncated: bool,
    duration_ms: u128,
    sources: Vec<ResolvedSource>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataChartHtmlRequest {
    workspace_root: String,
    sandbox_mode: String,
    sources: Vec<DataSource>,
    sql: String,
    chart_type: String,
    x: String,
    y: String,
    series: Option<String>,
    title: Option<String>,
    output_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataChartHtmlResponse {
    columns: Vec<String>,
    rows: Vec<Map<String, Value>>,
    row_count: usize,
    truncated: bool,
    duration_ms: u128,
    sources: Vec<ResolvedSource>,
    output_path: String,
    output_dir: String,
    chart_type: String,
    title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportTable {
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSection {
    heading: String,
    text: Option<String>,
    chart_path: Option<String>,
    table: Option<ReportTable>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataReportHtmlRequest {
    workspace_root: String,
    sandbox_mode: String,
    title: String,
    sections: Vec<ReportSection>,
    output_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataReportHtmlResponse {
    output_path: String,
    output_dir: String,
    title: String,
    section_count: usize,
    duration_ms: u128,
}

struct QueryRun {
    response: DuckDbQueryResponse,
}

#[tauri::command]
pub fn duckdb_query(req: DuckDbQueryRequest) -> Result<DuckDbQueryResponse, String> {
    Ok(run_query(req, None)?.response)
}

#[tauri::command]
pub fn data_chart_html(req: DataChartHtmlRequest) -> Result<DataChartHtmlResponse, String> {
    let started = Instant::now();
    validate_mode(&req.sandbox_mode)?;
    let chart_type = normalize_chart_type(&req.chart_type)?;
    let query = run_query(
        DuckDbQueryRequest {
            workspace_root: req.workspace_root.clone(),
            sandbox_mode: req.sandbox_mode.clone(),
            sources: req.sources.clone(),
            sql: req.sql.clone(),
            limit: Some(MAX_QUERY_LIMIT),
        },
        Some(MAX_QUERY_LIMIT),
    )?
    .response;
    if !query.columns.iter().any(|c| c == &req.x) {
        return Err(format!("图表缺少 x 轴列: {}", req.x));
    }
    if !query.columns.iter().any(|c| c == &req.y) {
        return Err(format!("图表缺少 y 轴列: {}", req.y));
    }
    if let Some(series) = req.series.as_ref() {
        if !query.columns.iter().any(|c| c == series) {
            return Err(format!("图表缺少 series 列: {series}"));
        }
    }

    let output_dir = resolve_output_dir(
        &req.workspace_root,
        req.output_path.as_deref(),
        "chart",
        &req.sandbox_mode,
    )?;
    let title = req.title.unwrap_or_else(|| "DataAgent Chart".to_string());
    let index = write_chart_app(
        &output_dir,
        &title,
        &chart_type,
        &req.x,
        &req.y,
        req.series.as_deref(),
        &query,
    )?;

    Ok(DataChartHtmlResponse {
        columns: query.columns,
        rows: query.rows,
        row_count: query.row_count,
        truncated: query.truncated,
        duration_ms: started.elapsed().as_millis(),
        sources: query.sources,
        output_path: index.display().to_string(),
        output_dir: output_dir.display().to_string(),
        chart_type,
        title,
    })
}

#[tauri::command]
pub fn data_report_html(req: DataReportHtmlRequest) -> Result<DataReportHtmlResponse, String> {
    let started = Instant::now();
    validate_mode(&req.sandbox_mode)?;
    if req.title.trim().is_empty() {
        return Err("报告标题不能为空".to_string());
    }
    let output_dir = resolve_output_dir(
        &req.workspace_root,
        req.output_path.as_deref(),
        "report",
        &req.sandbox_mode,
    )?;
    let index = write_report_app(
        &output_dir,
        &req.workspace_root,
        &req.sandbox_mode,
        &req.title,
        &req.sections,
    )?;
    Ok(DataReportHtmlResponse {
        output_path: index.display().to_string(),
        output_dir: output_dir.display().to_string(),
        title: req.title,
        section_count: req.sections.len(),
        duration_ms: started.elapsed().as_millis(),
    })
}

fn run_query(req: DuckDbQueryRequest, forced_limit: Option<usize>) -> Result<QueryRun, String> {
    let started = Instant::now();
    validate_mode(&req.sandbox_mode)?;
    let sql = sanitize_readonly_sql(&req.sql)?;
    let limit = forced_limit
        .or(req.limit)
        .unwrap_or(DEFAULT_QUERY_LIMIT)
        .clamp(1, MAX_QUERY_LIMIT);
    let sources = resolve_sources(&req.workspace_root, &req.sandbox_mode, &req.sources)?;

    let conn = Connection::open_in_memory().map_err(|e| format!("DuckDB 初始化失败: {e}"))?;
    for source in &sources {
        let create_sql = source_view_sql(source)?;
        conn.execute_batch(&create_sql)
            .map_err(|e| format!("注册数据源 {} 失败: {e}", source.alias))?;
    }

    let row_count = count_rows(&conn, &sql)?;
    let (columns, rows) = preview_rows(&conn, &sql, limit)?;
    Ok(QueryRun {
        response: DuckDbQueryResponse {
            columns,
            rows,
            row_count,
            truncated: row_count > limit,
            duration_ms: started.elapsed().as_millis(),
            sources,
        },
    })
}

fn validate_mode(mode: &str) -> Result<(), String> {
    if matches!(mode, "read-only" | "workspace-write" | "danger-full-access") {
        Ok(())
    } else {
        Err(format!("未知沙箱模式: {mode}"))
    }
}

fn normalize_lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn resolve_path(workspace_root: &str, path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("缺少路径".to_string());
    }
    let candidate = Path::new(path);
    let base = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        if workspace_root.trim().is_empty() {
            return Err("未设置工作目录（workspace root）".to_string());
        }
        Path::new(workspace_root).join(candidate)
    };
    Ok(normalize_lexical(&base))
}

fn canonical_workspace(workspace_root: &str) -> Result<PathBuf, String> {
    if workspace_root.trim().is_empty() {
        return Err("未设置工作目录（workspace root）".to_string());
    }
    fs::canonicalize(workspace_root)
        .map_err(|e| format!("工作目录不可访问 {}: {e}", workspace_root))
}

fn is_within(root: &Path, path: &Path) -> bool {
    path.starts_with(root)
}

fn check_source_read(mode: &str, workspace_root: &str, target: &Path) -> Result<(), String> {
    if mode == "danger-full-access" {
        return Ok(());
    }
    let root = canonical_workspace(workspace_root)?;
    let canonical = fs::canonicalize(target)
        .map_err(|e| format!("数据源不可访问 {}: {e}", target.display()))?;
    if is_within(&root, &canonical) {
        Ok(())
    } else {
        Err(format!(
            "该沙箱模式下数据源必须位于工作目录内: {}",
            target.display()
        ))
    }
}

fn check_write(mode: &str, workspace_root: &str, target: &Path) -> Result<(), String> {
    match mode {
        "read-only" => Err("只读沙箱：写入 HTML 产物被拒绝".to_string()),
        "workspace-write" => {
            let root = canonical_workspace(workspace_root)?;
            let target_parent = target
                .parent()
                .map(normalize_lexical)
                .ok_or_else(|| "输出路径缺少父目录".to_string())?;
            let tmp = Path::new("/tmp");
            let private_tmp = Path::new("/private/tmp");
            if is_within(&root, &target_parent)
                || target_parent.starts_with(tmp)
                || target_parent.starts_with(private_tmp)
            {
                Ok(())
            } else {
                Err(format!(
                    "workspace-write 沙箱：仅允许写入工作目录或临时目录内: {}",
                    target.display()
                ))
            }
        }
        "danger-full-access" => Ok(()),
        _ => Err(format!("未知沙箱模式: {mode}")),
    }
}

fn resolve_output_dir(
    workspace_root: &str,
    output_path: Option<&str>,
    prefix: &str,
    sandbox_mode: &str,
) -> Result<PathBuf, String> {
    let raw = match output_path {
        Some(p) if !p.trim().is_empty() => {
            let trimmed = p.trim();
            // Treat a path ending in .html as a file hint: use its parent dir.
            let candidate = Path::new(trimmed);
            if candidate.extension().and_then(|s| s.to_str()) == Some("html") {
                candidate
                    .parent()
                    .filter(|p| !p.as_os_str().is_empty())
                    .map(|p| p.display().to_string())
                    .unwrap_or_else(|| format!("{ARTIFACT_DIR}/{prefix}-{}", timestamp_ms()))
            } else {
                trimmed.to_string()
            }
        }
        _ => format!("{ARTIFACT_DIR}/{prefix}-{}", timestamp_ms()),
    };
    let dir = resolve_path(workspace_root, &raw)?;
    // Reuse the file-oriented write check against the directory's index.html.
    let index = dir.join("index.html");
    check_write(sandbox_mode, workspace_root, &index)?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建输出目录失败 {}: {e}", dir.display()))?;
    Ok(dir)
}

fn resolve_sources(
    workspace_root: &str,
    sandbox_mode: &str,
    input: &[DataSource],
) -> Result<Vec<ResolvedSource>, String> {
    if input.is_empty() {
        return Err("至少需要一个数据源".to_string());
    }
    let mut counts: HashMap<String, usize> = HashMap::new();
    input
        .iter()
        .map(|source| {
            let path = resolve_path(workspace_root, &source.path)?;
            if !path.is_file() {
                return Err(format!("数据源不是文件: {}", path.display()));
            }
            check_source_read(sandbox_mode, workspace_root, &path)?;
            let format = resolve_format(&path, source.format.as_deref())?;
            let base_alias = source
                .alias
                .as_deref()
                .map(sanitize_alias)
                .transpose()?
                .unwrap_or_else(|| alias_from_path(&path));
            let entry = counts.entry(base_alias.clone()).or_insert(0);
            *entry += 1;
            let alias = if *entry == 1 {
                base_alias
            } else {
                format!("{base_alias}_{entry}")
            };
            Ok(ResolvedSource {
                alias,
                path: path.display().to_string(),
                format,
            })
        })
        .collect()
}

fn resolve_format(path: &Path, explicit: Option<&str>) -> Result<String, String> {
    let raw = explicit
        .map(str::to_string)
        .or_else(|| {
            path.extension()
                .and_then(|s| s.to_str())
                .map(str::to_string)
        })
        .unwrap_or_default()
        .to_ascii_lowercase();
    match raw.as_str() {
        "csv" | "tsv" | "json" | "jsonl" | "ndjson" | "parquet" => Ok(if raw == "ndjson" {
            "jsonl".to_string()
        } else {
            raw
        }),
        _ => Err(format!(
            "不支持的数据格式: {}（支持 csv, tsv, json, jsonl, parquet）",
            raw
        )),
    }
}

fn sanitize_alias(alias: &str) -> Result<String, String> {
    let alias = alias.trim();
    if alias.is_empty() || alias.len() > 64 {
        return Err("数据源 alias 不能为空且不能超过 64 个字符".to_string());
    }
    let mut chars = alias.chars();
    let first = chars.next().unwrap();
    if !(first.is_ascii_alphabetic() || first == '_') {
        return Err(format!("非法 alias: {alias}"));
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(format!("非法 alias: {alias}"));
    }
    Ok(alias.to_string())
}

fn alias_from_path(path: &Path) -> String {
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("data");
    let mut alias = String::new();
    for (idx, c) in stem.chars().enumerate() {
        if c.is_ascii_alphanumeric() || c == '_' {
            if idx == 0 && c.is_ascii_digit() {
                alias.push('_');
            }
            alias.push(c.to_ascii_lowercase());
        } else if !alias.ends_with('_') {
            alias.push('_');
        }
    }
    let alias = alias.trim_matches('_');
    if alias.is_empty() {
        "data".to_string()
    } else {
        alias.chars().take(64).collect()
    }
}

fn sanitize_readonly_sql(sql: &str) -> Result<String, String> {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        return Err("SQL 不能为空".to_string());
    }
    let sql = trimmed.strip_suffix(';').unwrap_or(trimmed).trim();
    if sql.contains(';') {
        return Err("仅允许单条 SQL 语句".to_string());
    }
    let lowered = strip_sql_comments(sql).to_ascii_lowercase();
    let leading = lowered.trim_start();
    if !(leading.starts_with("select") || leading.starts_with("with")) {
        return Err("仅允许 SELECT 或 WITH 查询".to_string());
    }
    let forbidden = [
        "insert",
        "update",
        "delete",
        "drop",
        "create",
        "alter",
        "attach",
        "detach",
        "copy",
        "export",
        "import",
        "install",
        "load",
        "pragma",
        "call",
        "set",
        "truncate",
        "replace",
        "merge",
        "vacuum",
        "read_csv",
        "read_csv_auto",
        "read_json",
        "read_json_auto",
        "read_parquet",
        "read_text",
        "read_blob",
        "glob",
    ];
    for token in forbidden {
        if contains_sql_word(&lowered, token) {
            return Err(format!("SQL 包含不允许的操作或函数: {token}"));
        }
    }
    Ok(sql.to_string())
}

fn strip_sql_comments(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len());
    let mut chars = sql.chars().peekable();
    let mut in_line = false;
    let mut in_block = false;
    while let Some(c) = chars.next() {
        if in_line {
            if c == '\n' {
                in_line = false;
                out.push(' ');
            }
            continue;
        }
        if in_block {
            if c == '*' && chars.peek() == Some(&'/') {
                let _ = chars.next();
                in_block = false;
                out.push(' ');
            }
            continue;
        }
        if c == '-' && chars.peek() == Some(&'-') {
            let _ = chars.next();
            in_line = true;
            continue;
        }
        if c == '/' && chars.peek() == Some(&'*') {
            let _ = chars.next();
            in_block = true;
            continue;
        }
        out.push(c);
    }
    out
}

fn contains_sql_word(sql: &str, word: &str) -> bool {
    sql.match_indices(word).any(|(idx, _)| {
        let before = sql[..idx].chars().next_back();
        let after = sql[idx + word.len()..].chars().next();
        !is_ident_char(before) && !is_ident_char(after)
    })
}

fn is_ident_char(c: Option<char>) -> bool {
    c.map(|ch| ch.is_ascii_alphanumeric() || ch == '_')
        .unwrap_or(false)
}

fn quote_ident(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn quote_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn source_view_sql(source: &ResolvedSource) -> Result<String, String> {
    let alias = quote_ident(&source.alias);
    let path = quote_string(&source.path);
    let reader = match source.format.as_str() {
        "csv" => format!("read_csv_auto({path})"),
        "tsv" => format!("read_csv_auto({path}, delim='\\t')"),
        "json" => format!("read_json_auto({path})"),
        "jsonl" => format!("read_json_auto({path}, records=true)"),
        "parquet" => format!("read_parquet({path})"),
        other => return Err(format!("不支持的数据格式: {other}")),
    };
    Ok(format!(
        "CREATE TEMP VIEW {alias} AS SELECT * FROM {reader};"
    ))
}

fn count_rows(conn: &Connection, sql: &str) -> Result<usize, String> {
    let count_sql = format!("SELECT COUNT(*) AS __count FROM ({sql}) AS __dataagent_count");
    conn.query_row(&count_sql, [], |row| row.get::<_, i64>(0))
        .map(|v| v.max(0) as usize)
        .map_err(|e| format!("统计行数失败: {e}"))
}

fn preview_rows(conn: &Connection, sql: &str, limit: usize) -> Result<QueryPreview, String> {
    let preview_sql = format!("SELECT * FROM ({sql}) AS __dataagent_query LIMIT {limit}");
    let mut stmt = conn
        .prepare(&preview_sql)
        .map_err(|e| format!("准备查询失败: {e}"))?;
    let mut rows = stmt.query([]).map_err(|e| format!("执行查询失败: {e}"))?;
    let columns = rows
        .as_ref()
        .map(|stmt| stmt.column_names())
        .unwrap_or_default();
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| format!("读取查询结果失败: {e}"))? {
        let mut obj = Map::new();
        for (idx, col) in columns.iter().enumerate() {
            let value = row
                .get_ref(idx)
                .map(value_ref_to_json)
                .map_err(|e| format!("读取列 {col} 失败: {e}"))?;
            obj.insert(col.clone(), value);
        }
        out.push(obj);
    }
    Ok((columns, out))
}

fn value_ref_to_json(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Boolean(v) => Value::Bool(v),
        ValueRef::TinyInt(v) => json!(v),
        ValueRef::SmallInt(v) => json!(v),
        ValueRef::Int(v) => json!(v),
        ValueRef::BigInt(v) => json!(v),
        ValueRef::HugeInt(v) => Value::String(v.to_string()),
        ValueRef::UTinyInt(v) => json!(v),
        ValueRef::USmallInt(v) => json!(v),
        ValueRef::UInt(v) => json!(v),
        ValueRef::UBigInt(v) => json!(v),
        ValueRef::Float(v) => Number::from_f64(v as f64)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        ValueRef::Double(v) => Number::from_f64(v)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        ValueRef::Decimal(v) => Value::String(v.to_string()),
        ValueRef::Timestamp(unit, v) => Value::String(format!("{unit:?}:{v}")),
        ValueRef::Text(v) => Value::String(String::from_utf8_lossy(v).to_string()),
        ValueRef::Blob(v) => Value::String(format!("[blob {} bytes]", v.len())),
        ValueRef::Date32(v) => Value::String(format!("date32:{v}")),
        ValueRef::Time64(unit, v) => Value::String(format!("{unit:?}:{v}")),
        ValueRef::Interval {
            months,
            days,
            nanos,
        } => Value::String(format!(
            "interval:{months} months {days} days {nanos} nanos"
        )),
        other => Value::String(format!("{:?}", other.to_owned())),
    }
}

fn normalize_chart_type(raw: &str) -> Result<String, String> {
    match raw.trim().to_ascii_lowercase().as_str() {
        t @ ("bar" | "line" | "area" | "scatter" | "pie") => Ok(t.to_string()),
        _ => Err("chartType 仅支持 bar, line, area, scatter, pie".to_string()),
    }
}

/// Write an interactive ECharts chart app into `dir`, returning the path to the
/// generated `index.html`.
fn write_chart_app(
    dir: &Path,
    title: &str,
    chart_type: &str,
    x: &str,
    y: &str,
    series: Option<&str>,
    query: &DuckDbQueryResponse,
) -> Result<PathBuf, String> {
    let data = json!({
        "kind": "chart",
        "title": title,
        "chartType": chart_type,
        "x": x,
        "y": y,
        "series": series,
        "columns": query.columns,
        "rows": query.rows,
        "rowCount": query.row_count,
    });
    write_app(dir, title, &data)
}

#[allow(dead_code)]
fn display_value(value: &Value) -> String {
    match value {
        Value::Null => "".to_string(),
        Value::String(v) => v.clone(),
        other => other.to_string().trim_matches('"').to_string(),
    }
}

fn write_report_app(
    dir: &Path,
    workspace_root: &str,
    sandbox_mode: &str,
    title: &str,
    sections: &[ReportSection],
) -> Result<PathBuf, String> {
    let mut out_sections = Vec::with_capacity(sections.len());
    for section in sections {
        let table = section
            .table
            .as_ref()
            .map(|t| json!({ "columns": t.columns, "rows": t.rows }));
        let chart = match section.chart_path.as_ref() {
            Some(path) => Some(embed_chart(workspace_root, sandbox_mode, path)?),
            None => None,
        };
        out_sections.push(json!({
            "heading": section.heading.trim(),
            "text": section.text,
            "table": table,
            "chart": chart,
        }));
    }
    let data = json!({
        "kind": "report",
        "title": title,
        "sections": out_sections,
    });
    write_app(dir, title, &data)
}

/// Read a previously generated chart app's `data.json` so a report section can
/// render the same chart inline. Accepts the chart directory or its index.html.
fn embed_chart(
    workspace_root: &str,
    sandbox_mode: &str,
    chart_path: &str,
) -> Result<Value, String> {
    let resolved = resolve_path(workspace_root, chart_path)?;
    let data_path = if resolved.is_dir() {
        resolved.join("data.json")
    } else {
        resolved
            .parent()
            .map(|p| p.join("data.json"))
            .unwrap_or_else(|| resolved.clone())
    };
    check_source_read(sandbox_mode, workspace_root, &data_path)?;
    let raw = fs::read_to_string(&data_path)
        .map_err(|e| format!("读取图表数据失败 {}: {e}", data_path.display()))?;
    let value: Value = serde_json::from_str(&raw)
        .map_err(|e| format!("解析图表数据失败 {}: {e}", data_path.display()))?;
    Ok(json!({
        "title": value.get("title"),
        "chartType": value.get("chartType"),
        "x": value.get("x"),
        "y": value.get("y"),
        "series": value.get("series"),
        "columns": value.get("columns"),
        "rows": value.get("rows"),
    }))
}

/// Materialise the shared app shell (index.html + style.css + main.js) plus a
/// `data.json` payload into `dir`. Returns the path to `index.html`.
fn write_app(dir: &Path, title: &str, data: &Value) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| format!("创建输出目录失败 {}: {e}", dir.display()))?;
    let index_html = APP_INDEX.replace("{{TITLE}}", &escape_html(title));
    write_file(&dir.join("index.html"), index_html.as_bytes())?;
    write_file(&dir.join("style.css"), APP_CSS.as_bytes())?;
    write_file(&dir.join("main.js"), APP_JS.as_bytes())?;
    let payload = serde_json::to_string(data).map_err(|e| format!("序列化数据失败: {e}"))?;
    write_file(&dir.join("data.json"), payload.as_bytes())?;
    Ok(dir.join("index.html"))
}

fn write_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    fs::write(path, bytes).map_err(|e| format!("写入文件失败 {}: {e}", path.display()))
}

const APP_INDEX: &str = r##"<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{TITLE}}</title>
  <link rel="stylesheet" href="./style.css">
  <script src="/_vendor/echarts.min.js"></script>
</head>
<body>
  <div id="app"><div class="boot">Loading…</div></div>
  <script src="./main.js"></script>
</body>
</html>
"##;

const APP_CSS: &str = r##"
:root {
  color-scheme: light;
  --bg: #f6f7fb;
  --card: #ffffff;
  --border: #e8eaf0;
  --ink: #1a1c23;
  --muted: #6b7184;
  --accent: #4f46e5;
  --shadow: 0 1px 2px rgba(16,18,32,.04), 0 12px 32px rgba(16,18,32,.06);
  font-family: "Inter", "Geist", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background:
    radial-gradient(1200px 480px at 100% -10%, rgba(79,70,229,.06), transparent 60%),
    radial-gradient(900px 420px at -10% 0%, rgba(6,182,212,.05), transparent 55%),
    var(--bg);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}
#app { width: min(1080px, calc(100vw - 40px)); margin: 0 auto; padding: 40px 0 64px; }
.boot { color: var(--muted); padding: 80px 0; text-align: center; }
.page-head { margin: 0 0 24px; }
.eyebrow {
  margin: 0 0 10px;
  display: inline-flex; align-items: center; gap: 8px;
  color: var(--accent); font-size: 11px; font-weight: 700;
  letter-spacing: .12em; text-transform: uppercase;
}
.eyebrow::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
h1 { margin: 0; font-size: 30px; line-height: 1.12; letter-spacing: -.01em; font-weight: 700; }
.meta { margin: 10px 0 0; color: var(--muted); font-size: 13px; }
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 20px;
  margin: 18px 0;
  box-shadow: var(--shadow);
}
.card h2 { margin: 0 0 4px; font-size: 17px; font-weight: 650; letter-spacing: -.01em; }
.card { min-width: 0; overflow-wrap: anywhere; }
.card .section-text { margin: 10px 0 0; color: #3b3f4d; line-height: 1.7; font-size: 14px; overflow-wrap: anywhere; word-break: break-word; }
.card .section-text b, .card .section-text strong { color: #1f2430; font-weight: 650; }
.card .section-text ul, .card .section-text ol { margin: 8px 0 0; padding-left: 20px; }
.card .section-text li { margin: 3px 0; }
.card .section-text p { margin: 8px 0 0; }
.card .section-text code { background: #f2f3f7; border-radius: 4px; padding: 1px 5px; font-size: 12.5px; }
.chart-box { width: 100%; height: 440px; }
.card.is-chart { padding: 14px 14px 10px; }
.card-label { margin: 0 0 10px; font-size: 12px; font-weight: 600; color: var(--muted); }
.table-wrap { overflow: auto; border: 1px solid var(--border); border-radius: 10px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead th {
  position: sticky; top: 0;
  background: #fafbff; color: #41475a; font-weight: 650;
  text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
tbody td { padding: 9px 12px; border-bottom: 1px solid #f0f1f6; vertical-align: top; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:nth-child(even) { background: #fcfcfe; }
.empty { color: var(--muted); font-size: 13px; padding: 8px 2px; }
"##;

const APP_JS: &str = r##"
const PALETTE = ["#4f46e5","#06b6d4","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#14b8a6","#f97316","#3b82f6"];
const FONT = '"Inter","Geist",ui-sans-serif,system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
const charts = [];

function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m])); }
// Render section narrative as safe rich text: fully escape first (so scripts,
// attributes and unknown tags stay inert), then restore ONLY a whitelist of
// attribute-less inline/list tags. Authors may also use plain newlines.
function richText(s){
  let h = esc(s);
  h = h.replace(/&lt;(\/?)(b|strong|i|em|u|s|br|ul|ol|li|p|code|small|sub|sup|h3|h4)\s*\/?\s*&gt;/gi, "<$1$2>");
  h = h.replace(/\n/g, "<br>");
  return h;
}
function num(v){ if(typeof v==="number") return isFinite(v)?v:null; const n=parseFloat(v); return isFinite(n)?n:null; }
function fmt(v){ if(v==null) return ""; if(typeof v==="number") return Number.isInteger(v)?v.toLocaleString():(+v.toFixed(4)).toLocaleString(); return String(v); }
function uniq(arr){ const out=[]; const seen=new Set(); for(const v of arr){ const k=String(v); if(!seen.has(k)){ seen.add(k); out.push(v);} } return out; }

function baseOption(){
  return {
    color: PALETTE,
    textStyle: { fontFamily: FONT, color: "#41475a" },
    grid: { left: 12, right: 22, top: 52, bottom: 28, containLabel: true },
    legend: { top: 12, icon: "roundRect", itemWidth: 12, itemHeight: 12, itemGap: 16, textStyle: { color: "#5b6173", fontSize: 12 } },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: "rgba(79,70,229,.06)" } },
      backgroundColor: "rgba(26,28,35,.92)", borderWidth: 0, padding: [8,12],
      textStyle: { color: "#fff", fontSize: 12 }, extraCssText: "border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.22);"
    },
    animationDuration: 620, animationEasing: "cubicOut"
  };
}
function axisCommon(name){
  return {
    name, nameTextStyle: { color: "#8a90a2", fontSize: 11, padding: [0,0,0,4] },
    axisLine: { lineStyle: { color: "#d7dae4" } },
    axisTick: { show: false },
    axisLabel: { color: "#6b7184", fontSize: 11, hideOverlap: true },
    splitLine: { lineStyle: { color: "#eef0f6", type: "dashed" } }
  };
}

function buildOption(spec){
  const { chartType, x, y, series, rows } = spec;
  const opt = baseOption();
  const safeRows = Array.isArray(rows) ? rows : [];

  if (chartType === "pie") {
    const map = new Map();
    for (const r of safeRows){ const k=String(r[x]); map.set(k,(map.get(k)||0)+(num(r[y])||0)); }
    opt.tooltip = { trigger: "item", backgroundColor: "rgba(26,28,35,.92)", borderWidth: 0, textStyle:{color:"#fff",fontSize:12}, extraCssText:"border-radius:10px;", formatter: "{b}: {c} ({d}%)" };
    opt.legend = { type: "scroll", orient: "vertical", right: 8, top: "middle", textStyle:{color:"#5b6173",fontSize:12} };
    opt.series = [{
      type: "pie", radius: ["48%","74%"], center: ["40%","54%"], avoidLabelOverlap: true,
      itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: 6 },
      label: { color: "#41475a", fontSize: 12 },
      labelLine: { lineStyle: { color: "#c8ccd8" } },
      data: [...map.entries()].map(([name,value])=>({ name, value }))
    }];
    return opt;
  }

  const groups = series ? uniq(safeRows.map(r=>r[series])) : [null];

  if (chartType === "scatter") {
    const xNumeric = safeRows.length>0 && safeRows.every(r=>num(r[x])!==null);
    opt.tooltip = { trigger: "item", backgroundColor:"rgba(26,28,35,.92)", borderWidth:0, textStyle:{color:"#fff",fontSize:12}, extraCssText:"border-radius:10px;" };
    opt.xAxis = Object.assign(axisCommon(x), { type: xNumeric ? "value" : "category", scale: true });
    if (!xNumeric) opt.xAxis.data = uniq(safeRows.map(r=>r[x])).map(String);
    opt.yAxis = Object.assign(axisCommon(y), { type: "value", scale: true });
    opt.series = groups.map(g=>({
      type: "scatter", name: g==null ? y : String(g), symbolSize: 13,
      itemStyle: { opacity: .82, borderColor: "#fff", borderWidth: 1 },
      data: safeRows.filter(r=>g==null||String(r[series])===String(g))
        .map(r=>[ xNumeric ? num(r[x]) : String(r[x]), num(r[y]) ])
    }));
    return opt;
  }

  // bar / line / area
  const cats = uniq(safeRows.map(r=>r[x]));
  opt.xAxis = Object.assign(axisCommon(x), { type: "category", boundaryGap: chartType==="bar", data: cats.map(String) });
  opt.yAxis = Object.assign(axisCommon(y), { type: "value" });
  opt.series = groups.map((g,i)=>{
    const color = PALETTE[i % PALETTE.length];
    const data = cats.map(c=>{
      const r = safeRows.find(rr=>String(rr[x])===String(c) && (g==null||String(rr[series])===String(g)));
      return r ? num(r[y]) : null;
    });
    if (chartType === "bar") {
      return { name: g==null?y:String(g), type: "bar", barMaxWidth: 38, itemStyle: { borderRadius: [6,6,0,0] }, data };
    }
    const isArea = chartType === "area";
    return {
      name: g==null?y:String(g), type: "line", smooth: .35,
      showSymbol: cats.length <= 60, symbol: "circle", symbolSize: 7,
      lineStyle: { width: 3 }, emphasis: { focus: "series" },
      areaStyle: isArea ? { color: new echarts.graphic.LinearGradient(0,0,0,1,[
        { offset: 0, color: hexA(color,.28) }, { offset: 1, color: hexA(color,.02) }
      ]) } : undefined,
      data
    };
  });
  if (cats.length > 40) {
    opt.dataZoom = [{ type: "inside" }, { type: "slider", height: 16, bottom: 8, borderColor: "transparent", fillerColor: "rgba(79,70,229,.12)", handleStyle:{color:"#4f46e5"} }];
    opt.grid.bottom = 56;
  }
  return opt;
}

function hexA(hex,a){
  const m = hex.replace("#",""); const n = parseInt(m.length===3 ? m.split("").map(c=>c+c).join("") : m, 16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
}

function tableHTML(columns, rows){
  if (!columns || !columns.length) return '<div class="empty">无数据</div>';
  const head = columns.map(c=>`<th>${esc(c)}</th>`).join("");
  const isObjRows = rows.length>0 && !Array.isArray(rows[0]);
  const body = rows.slice(0,200).map(r=>{
    const cells = isObjRows ? columns.map(c=>`<td>${esc(fmt(r[c]))}</td>`) : r.map(v=>`<td>${esc(fmt(v))}</td>`);
    return `<tr>${cells.join("")}</tr>`;
  }).join("");
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function mountChart(el, spec){
  const c = echarts.init(el, null, { renderer: "canvas" });
  c.setOption(buildOption(spec));
  charts.push(c);
}

function renderChartPage(app, data){
  const head = document.createElement("div");
  head.className = "page-head";
  head.innerHTML = `<p class="eyebrow">DataAgent Chart</p><h1>${esc(data.title||"Chart")}</h1>`+
    `<p class="meta">${data.rowCount||0} 行 · x: ${esc(data.x)} · y: ${esc(data.y)}${data.series?` · series: ${esc(data.series)}`:""}</p>`;
  app.appendChild(head);

  const chartCard = document.createElement("div");
  chartCard.className = "card is-chart";
  const box = document.createElement("div"); box.className = "chart-box";
  chartCard.appendChild(box); app.appendChild(chartCard);
  mountChart(box, data);

  const tableCard = document.createElement("div");
  tableCard.className = "card";
  tableCard.innerHTML = `<p class="card-label">数据预览（前 200 行）</p>` + tableHTML(data.columns, data.rows);
  app.appendChild(tableCard);
}

function renderReport(app, data){
  const head = document.createElement("div");
  head.className = "page-head";
  head.innerHTML = `<p class="eyebrow">DataAgent Report</p><h1>${esc(data.title||"Report")}</h1>`;
  app.appendChild(head);

  for (const s of (data.sections||[])){
    const card = document.createElement("div");
    card.className = "card";
    let html = `<h2>${esc(s.heading||"")}</h2>`;
    if (s.text) html += `<div class="section-text">${richText(s.text)}</div>`;
    card.innerHTML = html;
    if (s.table) {
      const wrap = document.createElement("div"); wrap.style.marginTop = "12px";
      wrap.innerHTML = tableHTML(s.table.columns, s.table.rows);
      card.appendChild(wrap);
    }
    let box = null;
    if (s.chart && s.chart.chartType) {
      box = document.createElement("div"); box.className = "chart-box"; box.style.marginTop = "12px";
      card.appendChild(box);
    }
    app.appendChild(card);
    if (box) mountChart(box, s.chart);
  }
}

async function boot(){
  const app = document.getElementById("app");
  try {
    const res = await fetch("./data.json", { cache: "no-store" });
    const data = await res.json();
    app.innerHTML = "";
    if (data.kind === "report") renderReport(app, data);
    else renderChartPage(app, data);
  } catch (e) {
    app.innerHTML = `<div class="boot">加载失败：${esc(e && e.message || e)}</div>`;
  }
}

let resizeTimer = null;
window.addEventListener("resize", ()=>{
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(()=>{ for (const c of charts) c.resize(); }, 120);
});

boot();
"##;

fn timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_mutating_sql() {
        assert!(sanitize_readonly_sql("delete from x").is_err());
        assert!(sanitize_readonly_sql("select * from read_csv('x.csv')").is_err());
        assert!(sanitize_readonly_sql("select 1; select 2").is_err());
        assert!(sanitize_readonly_sql("with x as (select 1) select * from x").is_ok());
    }

    #[test]
    fn validates_aliases() {
        assert!(sanitize_alias("sales_2024").is_ok());
        assert!(sanitize_alias("2024_sales").is_err());
        assert!(sanitize_alias("sales;drop").is_err());
    }

    #[test]
    fn escapes_html_content() {
        assert_eq!(
            escape_html("<script>alert('x')</script>"),
            "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;"
        );
    }

    #[test]
    fn read_only_denies_output_writes() {
        let path = Path::new("/tmp/dataagent-test.html");
        assert!(check_write("read-only", "/tmp", path).is_err());
    }

    #[test]
    fn queries_csv_source() {
        let root = std::env::temp_dir().join(format!("dataagent-test-{}", timestamp_ms()));
        fs::create_dir_all(&root).unwrap();
        let csv = root.join("sales.csv");
        fs::write(&csv, "region,amount\nEast,10\nWest,20\n").unwrap();

        let result = run_query(
            DuckDbQueryRequest {
                workspace_root: root.display().to_string(),
                sandbox_mode: "read-only".to_string(),
                sources: vec![DataSource {
                    path: "sales.csv".to_string(),
                    alias: Some("sales".to_string()),
                    format: None,
                }],
                sql: "select sum(amount) as total from sales".to_string(),
                limit: Some(10),
            },
            None,
        )
        .unwrap()
        .response;

        assert_eq!(result.columns, vec!["total"]);
        assert_eq!(result.row_count, 1);
        assert_eq!(
            result.rows[0].get("total").map(display_value).as_deref(),
            Some("30")
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_source_outside_workspace() {
        let root = std::env::temp_dir().join(format!("dataagent-root-{}", timestamp_ms()));
        let outside = std::env::temp_dir().join(format!("dataagent-outside-{}", timestamp_ms()));
        fs::create_dir_all(&root).unwrap();
        fs::write(&outside, "x\n1\n").unwrap();
        let sources = resolve_sources(
            &root.display().to_string(),
            "read-only",
            &[DataSource {
                path: outside.display().to_string(),
                alias: Some("outside".to_string()),
                format: Some("csv".to_string()),
            }],
        );

        assert!(sources.is_err());
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_file(outside);
    }

    #[test]
    fn writes_multifile_chart_app() {
        let dir = std::env::temp_dir().join(format!("dataagent-chart-{}", timestamp_ms()));
        let query = DuckDbQueryResponse {
            columns: vec!["region".to_string(), "amount".to_string()],
            rows: vec![
                {
                    let mut m = Map::new();
                    m.insert("region".to_string(), Value::from("East"));
                    m.insert("amount".to_string(), Value::from(10));
                    m
                },
                {
                    let mut m = Map::new();
                    m.insert("region".to_string(), Value::from("West"));
                    m.insert("amount".to_string(), Value::from(20));
                    m
                },
            ],
            row_count: 2,
            truncated: false,
            duration_ms: 0,
            sources: vec![],
        };
        let index =
            write_chart_app(&dir, "Sales", "bar", "region", "amount", None, &query).unwrap();

        assert!(index.ends_with("index.html"));
        for f in ["index.html", "style.css", "main.js", "data.json"] {
            assert!(dir.join(f).is_file(), "missing {f}");
        }
        let html = fs::read_to_string(dir.join("index.html")).unwrap();
        assert!(html.contains("/_vendor/echarts.min.js"));
        assert!(html.contains("<title>Sales</title>"));
        let data: Value =
            serde_json::from_str(&fs::read_to_string(dir.join("data.json")).unwrap()).unwrap();
        assert_eq!(data["kind"], "chart");
        assert_eq!(data["chartType"], "bar");
        assert_eq!(data["x"], "region");
        assert_eq!(data["rows"].as_array().unwrap().len(), 2);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn report_embeds_existing_chart() {
        let root = std::env::temp_dir().join(format!("dataagent-rep-{}", timestamp_ms()));
        let chart_dir = root.join("chart");
        fs::create_dir_all(&chart_dir).unwrap();
        let query = DuckDbQueryResponse {
            columns: vec!["k".to_string(), "v".to_string()],
            rows: vec![{
                let mut m = Map::new();
                m.insert("k".to_string(), Value::from("a"));
                m.insert("v".to_string(), Value::from(3));
                m
            }],
            row_count: 1,
            truncated: false,
            duration_ms: 0,
            sources: vec![],
        };
        write_chart_app(&chart_dir, "C", "line", "k", "v", None, &query).unwrap();

        let report_dir = root.join("report");
        let sections = vec![ReportSection {
            heading: "S1".to_string(),
            text: Some("hello".to_string()),
            chart_path: Some(chart_dir.display().to_string()),
            table: None,
        }];
        let index = write_report_app(
            &report_dir,
            &root.display().to_string(),
            "danger-full-access",
            "Report",
            &sections,
        )
        .unwrap();
        assert!(index.is_file());
        let data: Value =
            serde_json::from_str(&fs::read_to_string(report_dir.join("data.json")).unwrap())
                .unwrap();
        assert_eq!(data["kind"], "report");
        assert_eq!(data["sections"][0]["chart"]["chartType"], "line");
        assert_eq!(data["sections"][0]["chart"]["x"], "k");
        let _ = fs::remove_dir_all(root);
    }
}
