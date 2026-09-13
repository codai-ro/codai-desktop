// SPDX-License-Identifier: Apache-2.0
//! Browser tools over the Chrome DevTools Protocol, raw WebSocket via
//! `tungstenite` (blocking, loopback only — no TLS, no async runtime glue).
//!
//! `browser_launch` starts Edge/Chrome from the well-known install paths with
//! a dedicated `--user-data-dir` under the app data dir and
//! `--remote-debugging-port=9333`, then waits for `/json/version`. The other
//! commands attach to the first `page` target (creating one if none exists)
//! and speak `Runtime.evaluate` / `Page.navigate`. Everything the model gets
//! back is capped (body text 20 KB, 200 interactive elements).

use std::io::Read;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_store::StoreExt;
use tungstenite::{stream::MaybeTlsStream, Message, WebSocket};

use super::progress;

pub const CDP_PORT: u16 = 9333;
const TEXT_CAP: usize = 20 * 1024;
const ELEMENTS_CAP: usize = 200;
const CDP_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Default)]
pub struct BrowserState {
    pub child: Mutex<Option<std::process::Child>>,
}

// ── HTTP endpoint helpers (`/json/version`, `/json/list`, `/json/new`) ──────

fn http_get(path: &str, method: &str) -> Result<Value, String> {
    let mut s = TcpStream::connect_timeout(
        &format!("127.0.0.1:{CDP_PORT}").parse().expect("addr"),
        Duration::from_millis(800),
    )
    .map_err(|e| format!("browser not reachable on 127.0.0.1:{CDP_PORT}: {e}"))?;
    s.set_read_timeout(Some(Duration::from_secs(5))).ok();
    use std::io::Write;
    write!(
        s,
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{CDP_PORT}\r\nConnection: close\r\n\r\n"
    )
    .map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    s.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&buf);
    let body = text
        .split_once("\r\n\r\n")
        .map(|(_, b)| b)
        .ok_or_else(|| "malformed HTTP response".to_owned())?;
    serde_json::from_str(body.trim()).map_err(|e| format!("bad JSON from browser: {e}"))
}

fn page_ws_url() -> Result<String, String> {
    let list = http_get("/json/list", "GET")?;
    let pick = list
        .as_array()
        .and_then(|a| {
            a.iter()
                .find(|t| t["type"] == "page" && t["webSocketDebuggerUrl"].is_string())
        })
        .and_then(|t| t["webSocketDebuggerUrl"].as_str().map(str::to_owned));
    if let Some(u) = pick {
        return Ok(u);
    }
    // No page: open one. Chrome ≥ 112 requires PUT for /json/new.
    let created = http_get("/json/new?about:blank", "PUT")?;
    created["webSocketDebuggerUrl"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "could not open a page target".to_owned())
}

// ── CDP session ────────────────────────────────────────────────────────────

struct Cdp {
    ws: WebSocket<MaybeTlsStream<TcpStream>>,
    next_id: u64,
}

impl Cdp {
    fn connect() -> Result<Self, String> {
        let url = page_ws_url()?;
        if !url.starts_with("ws://127.0.0.1:") && !url.starts_with("ws://localhost:") {
            return Err("refusing non-loopback DevTools URL".into());
        }
        let (ws, _) = tungstenite::connect(&url).map_err(|e| format!("CDP connect: {e}"))?;
        if let MaybeTlsStream::Plain(s) = ws.get_ref() {
            s.set_read_timeout(Some(CDP_TIMEOUT)).ok();
        }
        Ok(Self { ws, next_id: 1 })
    }

    fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        let msg = json!({ "id": id, "method": method, "params": params });
        self.ws
            .send(Message::Text(msg.to_string().into()))
            .map_err(|e| format!("CDP send: {e}"))?;
        let deadline = Instant::now() + CDP_TIMEOUT;
        loop {
            if Instant::now() > deadline {
                return Err(format!("CDP {method}: timed out"));
            }
            let m = self.ws.read().map_err(|e| format!("CDP read: {e}"))?;
            let Message::Text(t) = m else { continue };
            let v: Value = match serde_json::from_str(&t) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if v["id"].as_u64() != Some(id) {
                continue; // an event or another reply
            }
            if let Some(err) = v.get("error") {
                return Err(format!("CDP {method}: {}", err["message"].as_str().unwrap_or("error")));
            }
            return Ok(v["result"].clone());
        }
    }

    /// `Runtime.evaluate` with `returnByValue`; awaits promises.
    fn eval(&mut self, expression: &str) -> Result<Value, String> {
        let r = self.call(
            "Runtime.evaluate",
            json!({ "expression": expression, "returnByValue": true, "awaitPromise": true }),
        )?;
        if let Some(ex) = r.get("exceptionDetails") {
            let text = ex["exception"]["description"]
                .as_str()
                .or_else(|| ex["text"].as_str())
                .unwrap_or("evaluation threw");
            return Err(text.chars().take(2000).collect());
        }
        Ok(r["result"]["value"].clone())
    }
}

fn close(mut c: Cdp) {
    let _ = c.ws.close(None);
}

// ── Launch ─────────────────────────────────────────────────────────────────

fn candidates(override_path: Option<&str>) -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(p) = override_path.filter(|s| !s.trim().is_empty()) {
        v.push(PathBuf::from(p.trim()));
    }
    #[cfg(windows)]
    {
        let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
        let pf86 =
            std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".into());
        let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
        for base in [&pf, &pf86] {
            v.push(PathBuf::from(format!(r"{base}\Microsoft\Edge\Application\msedge.exe")));
            v.push(PathBuf::from(format!(r"{base}\Google\Chrome\Application\chrome.exe")));
        }
        if !local.is_empty() {
            v.push(PathBuf::from(format!(r"{local}\Google\Chrome\Application\chrome.exe")));
        }
    }
    #[cfg(target_os = "macos")]
    {
        v.push(PathBuf::from("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"));
        v.push(PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for n in [
            "/usr/bin/microsoft-edge",
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/snap/bin/chromium",
        ] {
            v.push(PathBuf::from(n));
        }
    }
    v
}

/// First browser executable that exists, honouring the settings override.
pub fn detect_browser<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let override_path = app
        .store("settings.json")
        .ok()
        .and_then(|s| s.get("browserPath"))
        .and_then(|v| v.as_str().map(str::to_owned));
    candidates(override_path.as_deref()).into_iter().find(|p| p.is_file())
}

#[derive(Serialize)]
pub struct BrowserLaunchResult {
    pub executable: String,
    pub port: u16,
    pub already_running: bool,
    pub version: String,
}

#[tauri::command]
pub async fn browser_launch<R: Runtime>(app: AppHandle<R>) -> Result<BrowserLaunchResult, String> {
    progress(&app, "browser_launch", "start", "");
    if let Ok(v) = http_get("/json/version", "GET") {
        let version = v["Browser"].as_str().unwrap_or("").to_owned();
        progress(&app, "browser_launch", "end", "already running");
        return Ok(BrowserLaunchResult {
            executable: String::new(),
            port: CDP_PORT,
            already_running: true,
            version,
        });
    }
    let exe = detect_browser(&app).ok_or_else(|| {
        "no Edge/Chrome found; set the browser path in Settings → Executor".to_owned()
    })?;
    let profile = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("browser-profile");
    std::fs::create_dir_all(&profile).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(&exe);
    cmd.arg(format!("--remote-debugging-port={CDP_PORT}"))
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-features=Translate")
        .arg("about:blank")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let child = cmd.spawn().map_err(|e| format!("launch {}: {e}", exe.display()))?;
    if let Some(state) = app.try_state::<BrowserState>() {
        *state.child.lock().map_err(|e| e.to_string())? = Some(child);
    }
    let version = tauri::async_runtime::spawn_blocking(|| {
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            if let Ok(v) = http_get("/json/version", "GET") {
                return Ok(v["Browser"].as_str().unwrap_or("").to_owned());
            }
            if Instant::now() > deadline {
                return Err("browser did not open the DevTools port within 20 s".to_owned());
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    })
    .await
    .map_err(|e| e.to_string())??;
    progress(&app, "browser_launch", "end", version.clone());
    Ok(BrowserLaunchResult {
        executable: exe.display().to_string(),
        port: CDP_PORT,
        already_running: false,
        version,
    })
}

#[derive(Serialize)]
pub struct BrowserDetectResult {
    pub executable: Option<String>,
    pub running: bool,
}

/// For Settings: which executable would be launched, and whether the CDP port answers.
#[tauri::command]
pub fn browser_detect<R: Runtime>(app: AppHandle<R>) -> BrowserDetectResult {
    BrowserDetectResult {
        executable: detect_browser(&app).map(|p| p.display().to_string()),
        running: http_get("/json/version", "GET").is_ok(),
    }
}

// ── Page commands ──────────────────────────────────────────────────────────

fn js_string(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}

#[derive(Deserialize)]
pub struct BrowserEvalArgs {
    pub expression: String,
}

#[tauri::command]
pub async fn browser_eval<R: Runtime>(app: AppHandle<R>, args: BrowserEvalArgs) -> Result<Value, String> {
    progress(&app, "browser_eval", "start", args.expression.chars().take(120).collect::<String>());
    let r = tauri::async_runtime::spawn_blocking(move || {
        let mut c = Cdp::connect()?;
        let v = c.eval(&args.expression);
        close(c);
        v
    })
    .await
    .map_err(|e| e.to_string())?;
    let r = r.map(|v| {
        // Cap what goes back to the model.
        let s = v.to_string();
        if s.len() > TEXT_CAP {
            Value::String(super::cap_str(&s, TEXT_CAP).0 + "…(truncated)")
        } else {
            v
        }
    });
    progress(&app, "browser_eval", if r.is_ok() { "end" } else { "error" }, "");
    r
}

#[derive(Deserialize)]
pub struct BrowserNavigateArgs {
    pub url: String,
}

#[derive(Serialize)]
pub struct BrowserNavigateResult {
    pub url: String,
    pub title: String,
}

#[tauri::command]
pub async fn browser_navigate<R: Runtime>(
    app: AppHandle<R>,
    args: BrowserNavigateArgs,
) -> Result<BrowserNavigateResult, String> {
    let url = args.url.trim().to_owned();
    if !(url.starts_with("http://") || url.starts_with("https://") || url == "about:blank") {
        return Err("only http(s) URLs are allowed".into());
    }
    progress(&app, "browser_navigate", "start", url.clone());
    let r = tauri::async_runtime::spawn_blocking(move || {
        let mut c = Cdp::connect()?;
        c.call("Page.enable", json!({}))?;
        let nav = c.call("Page.navigate", json!({ "url": url }))?;
        if let Some(e) = nav["errorText"].as_str() {
            close(c);
            return Err(format!("navigation failed: {e}"));
        }
        // Wait for readyState !== loading (bounded).
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            let st = c.eval("document.readyState")?;
            if st.as_str().map(|s| s != "loading").unwrap_or(true) || Instant::now() > deadline {
                break;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        let info = c.eval("JSON.stringify({url: location.href, title: document.title})")?;
        close(c);
        let v: Value = serde_json::from_str(info.as_str().unwrap_or("{}")).unwrap_or(json!({}));
        Ok(BrowserNavigateResult {
            url: v["url"].as_str().unwrap_or("").to_owned(),
            title: v["title"].as_str().unwrap_or("").to_owned(),
        })
    })
    .await
    .map_err(|e| e.to_string())?;
    progress(&app, "browser_navigate", if r.is_ok() { "end" } else { "error" }, "");
    r
}

#[derive(Serialize, Deserialize)]
pub struct InteractiveElement {
    pub tag: String,
    pub text: String,
    pub selector: String,
}

#[derive(Serialize)]
pub struct BrowserSnapshot {
    pub url: String,
    pub title: String,
    pub text: String,
    pub text_truncated: bool,
    pub elements: Vec<InteractiveElement>,
    pub elements_truncated: bool,
}

/// Runs in the page: collects body text and interactive elements with a
/// stable-ish selector (id → name → nth-of-type path).
const SNAPSHOT_JS: &str = r#"(() => {
  const cssPath = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 6) {
      let sel = cur.tagName.toLowerCase();
      if (cur.getAttribute('name')) { sel += '[name=' + JSON.stringify(cur.getAttribute('name')) + ']'; parts.unshift(sel); break; }
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (same.length > 1) sel += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(sel);
      cur = parent;
    }
    return parts.join(' > ');
  };
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const nodes = Array.from(document.querySelectorAll('a[href],button,input,select,textarea,[role=button],[role=link],[onclick],[contenteditable=true]'));
  const elements = [];
  for (const el of nodes) {
    if (elements.length >= __CAP__) break;
    if (!visible(el)) continue;
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    elements.push({ tag: el.tagName.toLowerCase() + (el.type ? '[' + el.type + ']' : ''), text, selector: cssPath(el) });
  }
  return JSON.stringify({ url: location.href, title: document.title, text: (document.body && document.body.innerText) || '', elements, more: nodes.length > elements.length });
})()"#;

#[tauri::command]
pub async fn browser_snapshot<R: Runtime>(app: AppHandle<R>) -> Result<BrowserSnapshot, String> {
    progress(&app, "browser_snapshot", "start", "");
    let r = tauri::async_runtime::spawn_blocking(move || {
        let mut c = Cdp::connect()?;
        let js = SNAPSHOT_JS.replace("__CAP__", &ELEMENTS_CAP.to_string());
        let raw = c.eval(&js)?;
        close(c);
        let v: Value = serde_json::from_str(raw.as_str().unwrap_or("{}")).map_err(|e| e.to_string())?;
        let (text, text_truncated) = super::cap_str(v["text"].as_str().unwrap_or(""), TEXT_CAP);
        let elements: Vec<InteractiveElement> =
            serde_json::from_value(v["elements"].clone()).unwrap_or_default();
        Ok(BrowserSnapshot {
            url: v["url"].as_str().unwrap_or("").to_owned(),
            title: v["title"].as_str().unwrap_or("").to_owned(),
            text,
            text_truncated,
            elements_truncated: v["more"].as_bool().unwrap_or(false),
            elements,
        })
    })
    .await
    .map_err(|e| e.to_string())?;
    progress(&app, "browser_snapshot", if r.is_ok() { "end" } else { "error" }, "");
    r
}

#[derive(Deserialize)]
pub struct BrowserClickArgs {
    pub selector: String,
}

#[tauri::command]
pub async fn browser_click<R: Runtime>(app: AppHandle<R>, args: BrowserClickArgs) -> Result<Value, String> {
    progress(&app, "browser_click", "start", args.selector.clone());
    let sel = js_string(&args.selector);
    let r = tauri::async_runtime::spawn_blocking(move || {
        let mut c = Cdp::connect()?;
        let js = format!(
            "(() => {{ const el = document.querySelector({sel}); if (!el) return {{ ok: false, error: 'no element matches selector' }}; el.scrollIntoView({{block:'center'}}); el.focus && el.focus(); el.click(); return {{ ok: true, tag: el.tagName.toLowerCase(), text: (el.innerText||el.value||'').trim().slice(0,80) }}; }})()"
        );
        let v = c.eval(&js);
        close(c);
        v
    })
    .await
    .map_err(|e| e.to_string())?;
    progress(&app, "browser_click", if r.is_ok() { "end" } else { "error" }, "");
    r
}

#[derive(Deserialize)]
pub struct BrowserTypeArgs {
    pub selector: String,
    pub text: String,
}

#[tauri::command]
pub async fn browser_type<R: Runtime>(app: AppHandle<R>, args: BrowserTypeArgs) -> Result<Value, String> {
    progress(&app, "browser_type", "start", args.selector.clone());
    let sel = js_string(&args.selector);
    let text = js_string(&args.text);
    let r = tauri::async_runtime::spawn_blocking(move || {
        let mut c = Cdp::connect()?;
        // Set value through the native setter so React/Vue controlled inputs notice.
        let js = format!(
            "(() => {{ const el = document.querySelector({sel}); if (!el) return {{ ok: false, error: 'no element matches selector' }}; el.focus && el.focus(); const v = {text}; if (el.isContentEditable) {{ el.textContent = v; }} else {{ const proto = Object.getPrototypeOf(el); const d = Object.getOwnPropertyDescriptor(proto, 'value'); if (d && d.set) d.set.call(el, v); else el.value = v; }} el.dispatchEvent(new Event('input', {{bubbles:true}})); el.dispatchEvent(new Event('change', {{bubbles:true}})); return {{ ok: true, length: v.length }}; }})()"
        );
        let v = c.eval(&js);
        close(c);
        v
    })
    .await
    .map_err(|e| e.to_string())?;
    progress(&app, "browser_type", if r.is_ok() { "end" } else { "error" }, "");
    r
}
