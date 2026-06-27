//! DuckDB-backed data tools for the in-app DataAgent.

use std::collections::{BTreeMap, HashMap};
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

    let output = resolve_output_path(
        &req.workspace_root,
        req.output_path.as_deref(),
        "chart",
        &req.sandbox_mode,
    )?;
    let title = req.title.unwrap_or_else(|| "DataAgent Chart".to_string());
    let html = chart_html(
        &title,
        &chart_type,
        &req.x,
        &req.y,
        req.series.as_deref(),
        &query,
    )?;
    write_html(&output, &html)?;

    Ok(DataChartHtmlResponse {
        columns: query.columns,
        rows: query.rows,
        row_count: query.row_count,
        truncated: query.truncated,
        duration_ms: started.elapsed().as_millis(),
        sources: query.sources,
        output_path: output.display().to_string(),
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
    let output = resolve_output_path(
        &req.workspace_root,
        req.output_path.as_deref(),
        "report",
        &req.sandbox_mode,
    )?;
    let html = report_html(
        &req.workspace_root,
        &req.sandbox_mode,
        &req.title,
        &req.sections,
    )?;
    write_html(&output, &html)?;
    Ok(DataReportHtmlResponse {
        output_path: output.display().to_string(),
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

fn resolve_output_path(
    workspace_root: &str,
    output_path: Option<&str>,
    prefix: &str,
    sandbox_mode: &str,
) -> Result<PathBuf, String> {
    let raw = output_path
        .map(str::to_string)
        .unwrap_or_else(|| format!("{ARTIFACT_DIR}/{prefix}-{}.html", timestamp_ms()));
    let mut path = resolve_path(workspace_root, &raw)?;
    if path.extension().and_then(|s| s.to_str()) != Some("html") {
        path.set_extension("html");
    }
    check_write(sandbox_mode, workspace_root, &path)?;
    Ok(path)
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
        "bar" | "line" | "scatter" => Ok(raw.trim().to_ascii_lowercase()),
        _ => Err("chartType 仅支持 bar, line, scatter".to_string()),
    }
}

fn chart_html(
    title: &str,
    chart_type: &str,
    x: &str,
    y: &str,
    series: Option<&str>,
    query: &DuckDbQueryResponse,
) -> Result<String, String> {
    let points = chart_points(x, y, series, &query.rows)?;
    let svg = match chart_type {
        "bar" => bar_svg(&points),
        "line" => line_svg(&points),
        "scatter" => scatter_svg(&points),
        _ => return Err("不支持的图表类型".to_string()),
    };
    let table = rows_table(&query.columns, &query.rows);
    Ok(format!(
        r#"<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>{css}</style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">DataAgent Chart</p>
      <h1>{title}</h1>
      <p class="meta">{row_count} rows · x: {x} · y: {y}</p>
    </header>
    <section class="chart">{svg}</section>
    <section>
      <h2>Data Preview</h2>
      {table}
    </section>
  </main>
</body>
</html>"#,
        title = escape_html(title),
        css = chart_css(),
        row_count = query.row_count,
        x = escape_html(x),
        y = escape_html(y),
        svg = svg,
        table = table
    ))
}

#[derive(Clone)]
struct ChartPoint {
    label: String,
    group: String,
    value: f64,
}

fn chart_points(
    x: &str,
    y: &str,
    series: Option<&str>,
    rows: &[Map<String, Value>],
) -> Result<Vec<ChartPoint>, String> {
    let mut points = Vec::new();
    for row in rows {
        let label = row
            .get(x)
            .map(display_value)
            .ok_or_else(|| format!("缺少 x 列: {x}"))?;
        let value = row
            .get(y)
            .and_then(Value::as_f64)
            .ok_or_else(|| format!("y 列必须是数值: {y}"))?;
        let group = series
            .and_then(|name| row.get(name))
            .map(display_value)
            .unwrap_or_else(|| "series".to_string());
        points.push(ChartPoint {
            label,
            group,
            value,
        });
    }
    if points.is_empty() {
        return Err("查询结果为空，无法生成图表".to_string());
    }
    Ok(points)
}

fn display_value(value: &Value) -> String {
    match value {
        Value::Null => "".to_string(),
        Value::String(v) => v.clone(),
        other => other.to_string().trim_matches('"').to_string(),
    }
}

fn value_range(points: &[ChartPoint]) -> (f64, f64) {
    let min = points.iter().map(|p| p.value).fold(f64::INFINITY, f64::min);
    let max = points
        .iter()
        .map(|p| p.value)
        .fold(f64::NEG_INFINITY, f64::max);
    if (max - min).abs() < f64::EPSILON {
        (0.0_f64.min(min), max.max(1.0))
    } else {
        (0.0_f64.min(min), max)
    }
}

fn scale_y(value: f64, min: f64, max: f64, height: f64, pad: f64) -> f64 {
    let pct = if (max - min).abs() < f64::EPSILON {
        0.0
    } else {
        (value - min) / (max - min)
    };
    height - pad - pct * (height - pad * 2.0)
}

fn grouped(points: &[ChartPoint]) -> BTreeMap<String, Vec<ChartPoint>> {
    let mut out: BTreeMap<String, Vec<ChartPoint>> = BTreeMap::new();
    for point in points {
        out.entry(point.group.clone())
            .or_default()
            .push(point.clone());
    }
    out
}

fn palette(idx: usize) -> &'static str {
    const COLORS: [&str; 8] = [
        "#2563eb", "#16a34a", "#dc2626", "#9333ea", "#d97706", "#0891b2", "#be123c", "#4f46e5",
    ];
    COLORS[idx % COLORS.len()]
}

fn bar_svg(points: &[ChartPoint]) -> String {
    let width = 920.0;
    let height = 420.0;
    let pad = 54.0;
    let (_, max) = value_range(points);
    let bar_gap = 8.0;
    let available = width - pad * 2.0;
    let bar_w = ((available - bar_gap * (points.len().saturating_sub(1) as f64))
        / points.len() as f64)
        .max(3.0);
    let mut body = String::new();
    for (idx, point) in points.iter().enumerate() {
        let x = pad + idx as f64 * (bar_w + bar_gap);
        let y = scale_y(point.value, 0.0, max, height, pad);
        let h = height - pad - y;
        body.push_str(&format!(
            r#"<rect x="{x:.2}" y="{y:.2}" width="{bar_w:.2}" height="{h:.2}" rx="3" fill="{color}"><title>{label}: {value}</title></rect>"#,
            color = palette(idx),
            label = escape_html(&point.label),
            value = point.value
        ));
    }
    svg_frame(width, height, body, points, max)
}

fn line_svg(points: &[ChartPoint]) -> String {
    let width = 920.0;
    let height = 420.0;
    let pad = 54.0;
    let (min, max) = value_range(points);
    let groups = grouped(points);
    let mut body = String::new();
    for (series_idx, group_points) in groups.values().enumerate() {
        let denom = group_points.len().saturating_sub(1).max(1) as f64;
        let path = group_points
            .iter()
            .enumerate()
            .map(|(idx, point)| {
                let x = pad + idx as f64 * ((width - pad * 2.0) / denom);
                let y = scale_y(point.value, min, max, height, pad);
                format!("{x:.2},{y:.2}")
            })
            .collect::<Vec<_>>()
            .join(" ");
        body.push_str(&format!(
            r#"<polyline points="{path}" fill="none" stroke="{color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>"#,
            color = palette(series_idx)
        ));
    }
    for (idx, point) in points.iter().enumerate() {
        let denom = points.len().saturating_sub(1).max(1) as f64;
        let x = pad + idx as f64 * ((width - pad * 2.0) / denom);
        let y = scale_y(point.value, min, max, height, pad);
        body.push_str(&format!(
            r#"<circle cx="{x:.2}" cy="{y:.2}" r="4" fill="{color}"><title>{label}: {value}</title></circle>"#,
            color = palette(idx),
            label = escape_html(&point.label),
            value = point.value
        ));
    }
    svg_frame(width, height, body, points, max)
}

fn scatter_svg(points: &[ChartPoint]) -> String {
    let width = 920.0;
    let height = 420.0;
    let pad = 54.0;
    let (min, max) = value_range(points);
    let denom = points.len().saturating_sub(1).max(1) as f64;
    let mut body = String::new();
    for (idx, point) in points.iter().enumerate() {
        let x = pad + idx as f64 * ((width - pad * 2.0) / denom);
        let y = scale_y(point.value, min, max, height, pad);
        body.push_str(&format!(
            r#"<circle cx="{x:.2}" cy="{y:.2}" r="6" fill="{color}" opacity="0.86"><title>{label}: {value}</title></circle>"#,
            color = palette(idx),
            label = escape_html(&point.label),
            value = point.value
        ));
    }
    svg_frame(width, height, body, points, max)
}

fn svg_frame(width: f64, height: f64, body: String, points: &[ChartPoint], max: f64) -> String {
    let first = points.first().map(|p| p.label.as_str()).unwrap_or("");
    let last = points.last().map(|p| p.label.as_str()).unwrap_or("");
    format!(
        r##"<svg viewBox="0 0 {width:.0} {height:.0}" role="img" aria-label="Data chart">
  <rect x="0" y="0" width="{width:.0}" height="{height:.0}" rx="12" fill="#ffffff"/>
  <line x1="54" y1="366" x2="866" y2="366" stroke="#111827" stroke-width="1"/>
  <line x1="54" y1="54" x2="54" y2="366" stroke="#111827" stroke-width="1"/>
  <text x="54" y="34" fill="#374151" font-size="12">max {max:.2}</text>
  <text x="54" y="392" fill="#6b7280" font-size="12">{first}</text>
  <text x="866" y="392" fill="#6b7280" font-size="12" text-anchor="end">{last}</text>
  {body}
</svg>"##,
        first = escape_html(first),
        last = escape_html(last)
    )
}

fn rows_table(columns: &[String], rows: &[Map<String, Value>]) -> String {
    let head = columns
        .iter()
        .map(|c| format!("<th>{}</th>", escape_html(c)))
        .collect::<String>();
    let body = rows
        .iter()
        .take(200)
        .map(|row| {
            let cells = columns
                .iter()
                .map(|c| {
                    format!(
                        "<td>{}</td>",
                        escape_html(&row.get(c).map(display_value).unwrap_or_default())
                    )
                })
                .collect::<String>();
            format!("<tr>{cells}</tr>")
        })
        .collect::<String>();
    format!("<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>")
}

fn report_html(
    workspace_root: &str,
    sandbox_mode: &str,
    title: &str,
    sections: &[ReportSection],
) -> Result<String, String> {
    let sections_html = sections
        .iter()
        .map(|section| report_section_html(workspace_root, sandbox_mode, section))
        .collect::<Result<Vec<_>, _>>()?
        .join("\n");
    Ok(format!(
        r#"<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>{css}</style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">DataAgent Report</p>
      <h1>{title}</h1>
    </header>
    {sections_html}
  </main>
</body>
</html>"#,
        title = escape_html(title),
        css = chart_css(),
        sections_html = sections_html
    ))
}

fn report_section_html(
    workspace_root: &str,
    sandbox_mode: &str,
    section: &ReportSection,
) -> Result<String, String> {
    let mut html = format!("<section><h2>{}</h2>", escape_html(section.heading.trim()));
    if let Some(text) = section.text.as_ref() {
        html.push_str(&format!(
            "<p>{}</p>",
            escape_html(text).replace('\n', "<br>")
        ));
    }
    if let Some(table) = section.table.as_ref() {
        let rows = table
            .rows
            .iter()
            .map(|r| {
                let cells = r
                    .iter()
                    .map(|v| format!("<td>{}</td>", escape_html(v)))
                    .collect::<String>();
                format!("<tr>{cells}</tr>")
            })
            .collect::<String>();
        let head = table
            .columns
            .iter()
            .map(|v| format!("<th>{}</th>", escape_html(v)))
            .collect::<String>();
        html.push_str(&format!(
            "<table><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table>"
        ));
    }
    if let Some(chart_path) = section.chart_path.as_ref() {
        let chart = resolve_path(workspace_root, chart_path)?;
        check_source_read(sandbox_mode, workspace_root, &chart)?;
        let chart_html = fs::read_to_string(&chart)
            .map_err(|e| format!("读取图表 HTML 失败 {}: {e}", chart.display()))?;
        html.push_str(&format!(
            r#"<iframe title="{}" sandbox="" srcdoc="{}"></iframe>"#,
            escape_html(&section.heading),
            escape_attr(&chart_html)
        ));
    }
    html.push_str("</section>");
    Ok(html)
}

fn chart_css() -> &'static str {
    r#"
:root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
body { margin: 0; background: #f3f4f6; color: #111827; }
main { width: min(1040px, calc(100vw - 40px)); margin: 36px auto; }
header { margin-bottom: 24px; }
.eyebrow { margin: 0 0 8px; color: #2563eb; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
h1 { margin: 0; font-size: 34px; line-height: 1.08; letter-spacing: 0; }
h2 { margin: 28px 0 12px; font-size: 20px; }
.meta, p { color: #4b5563; line-height: 1.65; }
.chart, section { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 18px; margin: 16px 0; box-shadow: 0 12px 30px rgba(17,24,39,.08); }
svg { width: 100%; height: auto; display: block; }
table { width: 100%; border-collapse: collapse; font-size: 13px; overflow: hidden; border-radius: 6px; }
th, td { border-bottom: 1px solid #e5e7eb; padding: 8px 10px; text-align: left; vertical-align: top; }
th { background: #f9fafb; color: #374151; font-weight: 700; }
iframe { width: 100%; min-height: 540px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; }
"#
}

fn write_html(path: &Path, html: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建输出目录失败 {}: {e}", parent.display()))?;
    }
    fs::write(path, html).map_err(|e| format!("写入 HTML 失败 {}: {e}", path.display()))
}

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

fn escape_attr(value: &str) -> String {
    escape_html(value)
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
}
