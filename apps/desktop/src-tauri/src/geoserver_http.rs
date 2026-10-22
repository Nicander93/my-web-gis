use reqwest::{header, Client, Method, Url};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Mutex};

const DEFAULT_TIMEOUT_MS: u64 = 30_000;
const MAX_TIMEOUT_MS: u64 = 120_000;
const MAX_REQUEST_BYTES: usize = 64 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;
const MAX_HEADER_BYTES: usize = 16 * 1024;

#[derive(Default)]
pub(crate) struct GeoServerHttpRequests {
    active: Mutex<HashMap<String, Box<dyn Fn() + Send + Sync>>>,
}

impl GeoServerHttpRequests {
    fn register(
        &self,
        request_id: &str,
        task: &tauri::async_runtime::JoinHandle<Result<GeoServerHttpResponse, String>>,
    ) -> bool {
        let Ok(mut active) = self.active.lock() else {
            return false;
        };
        if active.contains_key(request_id) {
            return false;
        }
        let abort = task.inner().abort_handle();
        active.insert(request_id.to_string(), Box::new(move || abort.abort()));
        true
    }

    fn finish(&self, request_id: &str) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(request_id);
        }
    }

    pub(crate) fn cancel(&self, request_id: &str) -> bool {
        let abort = self
            .active
            .lock()
            .ok()
            .and_then(|mut active| active.remove(request_id));
        if let Some(abort) = abort {
            abort();
            true
        } else {
            false
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeoServerHttpRequestArgs {
    request_id: String,
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<Vec<u8>>,
    timeout_ms: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeoServerHttpResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

fn validate_request(args: &GeoServerHttpRequestArgs) -> Result<(Url, Method), String> {
    if args.request_id.is_empty()
        || args.request_id.len() > 128
        || !args
            .request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("GeoServer 请求标识无效".into());
    }
    if args.url.len() > 8192 {
        return Err("GeoServer 请求地址超出限制".into());
    }
    let url = Url::parse(&args.url).map_err(|_| "GeoServer 请求地址无效".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("GeoServer 仅允许不含凭据的 HTTP(S) 地址".into());
    }
    let method = Method::from_bytes(args.method.as_bytes())
        .map_err(|_| "GeoServer HTTP 方法无效".to_string())?;
    if !matches!(
        method,
        Method::GET | Method::POST | Method::PUT | Method::DELETE
    ) {
        return Err("GeoServer HTTP 方法不受支持".into());
    }
    if args
        .body
        .as_ref()
        .is_some_and(|body| body.len() > MAX_REQUEST_BYTES)
    {
        return Err("GeoServer 请求体超出大小限制".into());
    }
    let timeout = args.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);
    if timeout == 0 || timeout > MAX_TIMEOUT_MS {
        return Err("GeoServer 请求超时设置无效".into());
    }
    let header_bytes = args
        .headers
        .iter()
        .try_fold(0usize, |total, (name, value)| {
            total
                .checked_add(name.len())
                .and_then(|size| size.checked_add(value.len()))
        })
        .ok_or_else(|| "GeoServer 请求头超出大小限制".to_string())?;
    if header_bytes > MAX_HEADER_BYTES {
        return Err("GeoServer 请求头超出大小限制".into());
    }
    Ok((url, method))
}

async fn execute_http_request(
    args: GeoServerHttpRequestArgs,
) -> Result<GeoServerHttpResponse, String> {
    let (url, method) = validate_request(&args)?;
    let timeout = std::time::Duration::from_millis(args.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS));
    let client = Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "GeoServer HTTP 客户端初始化失败".to_string())?;

    let mut request = client.request(method, url);
    for (name, value) in &args.headers {
        let name = header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| "GeoServer 请求头无效".to_string())?;
        let value =
            header::HeaderValue::from_str(value).map_err(|_| "GeoServer 请求头无效".to_string())?;
        request = request.header(name, value);
    }
    if let Some(body) = args.body {
        request = request.body(body);
    }

    let response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            "GeoServer 请求超时".to_string()
        } else {
            "GeoServer 网络请求失败".to_string()
        }
    })?;
    let status = response.status().as_u16();
    let mut response_headers = HashMap::new();
    for name in [
        header::CONTENT_TYPE,
        header::ETAG,
        header::CACHE_CONTROL,
        header::LAST_MODIFIED,
    ] {
        if let Some(value) = response
            .headers()
            .get(&name)
            .and_then(|value| value.to_str().ok())
        {
            response_headers.insert(name.as_str().to_string(), value.to_string());
        }
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("GeoServer 响应超出大小限制".into());
    }
    let mut response = response;
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "GeoServer 响应读取失败".to_string())?
    {
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err("GeoServer 响应超出大小限制".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(GeoServerHttpResponse {
        status,
        headers: response_headers,
        body,
    })
}

#[tauri::command]
pub(crate) async fn geoserver_http_request(
    requests: tauri::State<'_, GeoServerHttpRequests>,
    args: GeoServerHttpRequestArgs,
) -> Result<GeoServerHttpResponse, String> {
    validate_request(&args)?;
    let request_id = args.request_id.clone();
    let task = tauri::async_runtime::spawn(execute_http_request(args));
    if !requests.register(&request_id, &task) {
        task.abort();
        return Err("GeoServer 请求标识重复或请求状态不可用".into());
    }
    let joined = task.await;
    requests.finish(&request_id);
    joined.map_err(|_| "GeoServer 请求已取消或执行失败".to_string())?
}

#[tauri::command]
pub(crate) fn cancel_geoserver_http_request(
    requests: tauri::State<'_, GeoServerHttpRequests>,
    request_id: String,
) -> bool {
    requests.cancel(&request_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        sync::{mpsc, Arc},
        thread,
        time::{Duration, Instant},
    };

    fn request_args(url: String, method: &str) -> GeoServerHttpRequestArgs {
        GeoServerHttpRequestArgs {
            request_id: format!("req-{}", method.to_lowercase()),
            url,
            method: method.into(),
            headers: HashMap::new(),
            body: None,
            timeout_ms: Some(2_000),
        }
    }

    fn read_request(stream: &mut TcpStream) -> Vec<u8> {
        let mut head = Vec::new();
        let mut byte = [0];
        while !head.ends_with(b"\r\n\r\n") {
            if stream.read_exact(&mut byte).is_err() {
                break;
            }
            head.push(byte[0]);
            if head.len() > 32 * 1024 {
                break;
            }
        }
        let content_length = String::from_utf8_lossy(&head)
            .lines()
            .find_map(|line| {
                line.split_once(':')
                    .filter(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                    .and_then(|(_, value)| value.trim().parse::<usize>().ok())
            })
            .unwrap_or(0);
        let mut body = vec![0; content_length];
        let _ = stream.read_exact(&mut body);
        head.extend(body);
        head
    }

    fn write_response(stream: &mut TcpStream, status: &str, headers: &[(&str, &str)], body: &[u8]) {
        let mut response = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n",
            body.len()
        );
        for (name, value) in headers {
            response.push_str(&format!("{name}: {value}\r\n"));
        }
        response.push_str("\r\n");
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.write_all(body);
    }

    fn one_request_server<F>(handler: F) -> (String, thread::JoinHandle<()>)
    where
        F: FnOnce(TcpStream) + Send + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        (
            format!("http://{address}/rest/test"),
            thread::spawn(move || {
                if let Ok((stream, _)) = listener.accept() {
                    handler(stream);
                }
            }),
        )
    }

    #[test]
    fn sends_get_post_put_and_delete_once_with_binary_payload() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let expected = ["GET", "POST", "PUT", "DELETE"];
            for method in expected {
                let (mut stream, _) = listener.accept().unwrap();
                let request = read_request(&mut stream);
                assert!(String::from_utf8_lossy(&request).starts_with(&format!("{method} ")));
                if method == "POST" || method == "PUT" {
                    assert!(request.ends_with(&[0, 255, 1]));
                }
                write_response(
                    &mut stream,
                    "200 OK",
                    &[("Content-Type", "application/octet-stream")],
                    &[137, 80, 78, 71],
                );
            }
        });
        tauri::async_runtime::block_on(async {
            for method in ["GET", "POST", "PUT", "DELETE"] {
                let mut args = request_args(format!("http://{address}/rest/test"), method);
                if method == "POST" || method == "PUT" {
                    args.body = Some(vec![0, 255, 1]);
                }
                let response = execute_http_request(args).await.unwrap();
                assert_eq!(response.status, 200);
                assert_eq!(response.body, [137, 80, 78, 71]);
            }
        });
        server.join().unwrap();
    }

    #[test]
    fn times_out_without_exposing_request_details() {
        let (url, server) = one_request_server(|mut stream| {
            let _ = read_request(&mut stream);
            thread::sleep(Duration::from_millis(250));
            write_response(&mut stream, "200 OK", &[], b"late");
        });
        let mut args = request_args(url, "GET");
        args.timeout_ms = Some(50);
        let error = tauri::async_runtime::block_on(execute_http_request(args)).unwrap_err();
        assert_eq!(error, "GeoServer 请求超时");
        server.join().unwrap();
    }

    #[test]
    fn cancels_the_in_flight_network_task() {
        let (url, server) = one_request_server(|mut stream| {
            let _ = read_request(&mut stream);
            thread::sleep(Duration::from_millis(500));
        });
        let requests = Arc::new(GeoServerHttpRequests::default());
        let task = tauri::async_runtime::spawn(execute_http_request(request_args(url, "GET")));
        assert!(requests.register("cancel-me", &task));
        thread::sleep(Duration::from_millis(100));
        assert!(requests.cancel("cancel-me"));
        assert!(tauri::async_runtime::block_on(task).is_err());
        assert!(!requests.cancel("cancel-me"));
        server.join().unwrap();
    }

    #[test]
    fn rejects_oversized_response_before_returning_bytes() {
        let (url, server) = one_request_server(|mut stream| {
            let _ = read_request(&mut stream);
            let _ = stream.write_all(
                b"HTTP/1.1 200 OK\r\nContent-Length: 33554433\r\nConnection: close\r\n\r\n",
            );
        });
        let error = tauri::async_runtime::block_on(execute_http_request(request_args(url, "GET")))
            .unwrap_err();
        assert_eq!(error, "GeoServer 响应超出大小限制");
        server.join().unwrap();
    }

    #[test]
    fn redirect_response_does_not_replay_mutating_request() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let (count_tx, count_rx) = mpsc::channel();
        let server = thread::spawn(move || {
            let mut count = 0;
            let start = Instant::now();
            while start.elapsed() < Duration::from_millis(300) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        count += 1;
                        let _ = read_request(&mut stream);
                        write_response(
                            &mut stream,
                            "307 Temporary Redirect",
                            &[("Location", "/target")],
                            b"",
                        );
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10))
                    }
                    Err(_) => break,
                }
            }
            let _ = count_tx.send(count);
        });
        let mut args = request_args(format!("http://{address}/rest/test"), "POST");
        args.body = Some(b"mutating payload".to_vec());
        let response = tauri::async_runtime::block_on(execute_http_request(args)).unwrap();
        assert_eq!(response.status, 307);
        assert_eq!(count_rx.recv_timeout(Duration::from_secs(2)).unwrap(), 1);
        server.join().unwrap();
    }

    #[test]
    fn refuses_embedded_credentials_and_unsupported_methods() {
        let mut args = request_args("https://user:password@example.com/style".into(), "GET");
        assert_eq!(
            validate_request(&args).unwrap_err(),
            "GeoServer 仅允许不含凭据的 HTTP(S) 地址"
        );
        args.url = "https://example.com/style".into();
        args.method = "PATCH".into();
        assert_eq!(
            validate_request(&args).unwrap_err(),
            "GeoServer HTTP 方法不受支持"
        );
    }
}
