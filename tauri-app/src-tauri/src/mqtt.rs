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

pub fn start_mqtt(
    host: String,
    port: u16,
    username: String,
    password: String,
    topic: String,
) -> MqttHandle {
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

    tokio::spawn(async move {
        // Subscribe
        if let Err(e) = client
            .subscribe(&subscribe_topic, QoS::AtMostOnce)
            .await
        {
            eprintln!("MQTT subscribe error: {}", e);
        }

        let mut shutdown_rx = shutdown_rx;

        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    println!("MQTT shutdown signal received");
                    let _ = client.disconnect().await;
                    *st.lock().await = MqttStatus::Disconnected;
                    break;
                }
                poll_result = eventloop.poll() => {
                    match poll_result {
                        Ok(Event::Incoming(Packet::ConnAck(_))) => {
                            println!("MQTT connected to {}:{}", host, port);
                            *st.lock().await = MqttStatus::Connected;
                        }
                        Ok(Event::Incoming(Packet::Publish(publish))) => {
                            let full_topic = publish.topic.clone();
                            let prefix_len = topic.len() + 1; // topic + "/"
                            if full_topic.len() > prefix_len {
                                let subtopic = &full_topic[prefix_len..];
                                let payload = String::from_utf8_lossy(&publish.payload).to_string();
                                let msg = serde_json::json!({
                                    "command": subtopic,
                                    "payload": payload,
                                });
                                println!("MQTT {}: {}", subtopic, payload);
                                let _ = cmd_tx.send(msg.to_string());
                            }
                        }
                        Ok(_) => {}
                        Err(e) => {
                            eprintln!("MQTT error: {}", e);
                            *st.lock().await = MqttStatus::Reconnecting;
                            // rumqttc auto-reconnects, small delay to avoid busy loop
                            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                        }
                    }
                }
            }
        }
    });

    MqttHandle {
        status,
        command_tx,
        shutdown_tx: Some(shutdown_tx),
    }
}
