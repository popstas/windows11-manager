use log::{error, info};
use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS};
use std::sync::Arc;
use tokio::sync::{broadcast, oneshot, Mutex as TokioMutex};

#[derive(Debug, Clone, PartialEq)]
pub enum MqttStatus {
    Disconnected,
    Connected,
    Reconnecting,
}

impl MqttStatus {
    pub fn label(&self) -> &str {
        match self {
            MqttStatus::Disconnected => "MQTT: Off",
            MqttStatus::Connected => "MQTT: Connected",
            MqttStatus::Reconnecting => "MQTT: Reconnecting",
        }
    }
}

pub struct MqttHandle {
    pub status: Arc<TokioMutex<MqttStatus>>,
    pub command_tx: broadcast::Sender<String>,
    shutdown_tx: Option<oneshot::Sender<()>>,
}

impl MqttHandle {
    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

/// Returns the MQTT handle and a future that runs the event loop. Spawn the future
/// with `tauri::async_runtime::spawn` (Tauri's runtime); do not use `tokio::spawn`
/// as there may be no Tokio reactor in the current context.
pub fn start_mqtt(
    host: String,
    port: u16,
    username: String,
    password: String,
    topic: String,
) -> (MqttHandle, impl std::future::Future<Output = ()> + Send) {
    let (command_tx, _) = broadcast::channel::<String>(64);
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let status = Arc::new(TokioMutex::new(MqttStatus::Disconnected));

    let cmd_tx = command_tx.clone();
    let st = status.clone();

    let client_id = format!("w11mgr-{}", std::process::id());
    let mut opts = MqttOptions::new(client_id, &host, port);
    opts.set_keep_alive(std::time::Duration::from_secs(30));
    if !username.is_empty() {
        opts.set_credentials(&username, &password);
    }

    let (client, mut eventloop) = AsyncClient::new(opts, 10);

    let subscribe_topic = format!("{}/#", topic);

    let future = async move {
        if let Err(e) = client
            .subscribe(&subscribe_topic, QoS::AtMostOnce)
            .await
        {
            error!("MQTT subscribe error: {}", e);
        }

        let mut shutdown_rx = shutdown_rx;

        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    info!("MQTT shutdown signal received");
                    let _ = client.disconnect().await;
                    *st.lock().await = MqttStatus::Disconnected;
                    break;
                }
                poll_result = eventloop.poll() => {
                    match poll_result {
                        Ok(Event::Incoming(Packet::ConnAck(_))) => {
                            info!("MQTT connected to {}:{}", host, port);
                            *st.lock().await = MqttStatus::Connected;
                        }
                        Ok(Event::Incoming(Packet::Publish(publish))) => {
                            let full_topic = publish.topic.clone();
                            let prefix_len = topic.len() + 1;
                            if full_topic.len() > prefix_len {
                                let subtopic = &full_topic[prefix_len..];
                                let payload = String::from_utf8_lossy(&publish.payload).to_string();
                                let msg = serde_json::json!({
                                    "command": subtopic,
                                    "payload": payload,
                                });
                                info!("MQTT {}: {}", subtopic, payload);
                                let _ = cmd_tx.send(msg.to_string());
                            }
                        }
                        Ok(_) => {}
                        Err(e) => {
                            error!("MQTT error: {}", e);
                            *st.lock().await = MqttStatus::Reconnecting;
                            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                        }
                    }
                }
            }
        }
    };

    let handle = MqttHandle {
        status,
        command_tx,
        shutdown_tx: Some(shutdown_tx),
    };

    (handle, future)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mqtt_status_labels() {
        assert_eq!(MqttStatus::Disconnected.label(), "MQTT: Off");
        assert_eq!(MqttStatus::Connected.label(), "MQTT: Connected");
        assert_eq!(MqttStatus::Reconnecting.label(), "MQTT: Reconnecting");
    }
}
