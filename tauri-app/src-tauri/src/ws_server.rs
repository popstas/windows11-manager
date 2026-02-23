use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio::sync::{broadcast, oneshot};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

pub struct WsServerHandle {
    shutdown_tx: Option<oneshot::Sender<()>>,
}

impl WsServerHandle {
    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

/// Returns the handle and a future that runs the server. Spawn the future with
/// `tauri::async_runtime::spawn` so it runs on Tauri's runtime.
pub fn start_ws_server(
    port: u16,
    command_tx: broadcast::Sender<String>,
) -> (WsServerHandle, impl std::future::Future<Output = ()> + Send) {
    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();

    let future = async move {
        let addr = format!("127.0.0.1:{}", port);
        let listener = match TcpListener::bind(&addr).await {
            Ok(l) => {
                println!("WS server listening on {}", addr);
                l
            }
            Err(e) => {
                eprintln!("WS server failed to bind {}: {}", addr, e);
                return;
            }
        };

        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    println!("WS server shutdown");
                    break;
                }
                accept_result = listener.accept() => {
                    match accept_result {
                        Ok((stream, peer)) => {
                            println!("WS client connected: {}", peer);
                            let mut rx = command_tx.subscribe();
                            tauri::async_runtime::spawn(async move {
                                let ws_stream = match accept_async(stream).await {
                                    Ok(ws) => ws,
                                    Err(e) => {
                                        eprintln!("WS handshake error: {}", e);
                                        return;
                                    }
                                };
                                let (mut sink, mut stream) = ws_stream.split();

                                loop {
                                    tokio::select! {
                                        msg = rx.recv() => {
                                            match msg {
                                                Ok(text) => {
                                                    if sink.send(Message::Text(text)).await.is_err() {
                                                        break;
                                                    }
                                                }
                                                Err(broadcast::error::RecvError::Lagged(n)) => {
                                                    eprintln!("WS client lagged, skipped {} messages", n);
                                                }
                                                Err(broadcast::error::RecvError::Closed) => break,
                                            }
                                        }
                                        ws_msg = stream.next() => {
                                            match ws_msg {
                                                Some(Ok(_)) => {}
                                                _ => break,
                                            }
                                        }
                                    }
                                }
                                println!("WS client disconnected: {}", peer);
                            });
                        }
                        Err(e) => {
                            eprintln!("WS accept error: {}", e);
                        }
                    }
                }
            }
        }
    };

    let handle = WsServerHandle {
        shutdown_tx: Some(shutdown_tx),
    };

    (handle, future)
}
