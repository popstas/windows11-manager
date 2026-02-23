import mqtt from 'mqtt';
import { getConfig } from './config.js';
import { placeWindowByConfig, placeWindows } from './placement.js';
import { storeWindows, restoreWindows } from './store.js';
import { virtualDesktop } from './virtual-desktop.js';

function startMqtt() {
  const config = getConfig();
  const mqttConfig = config.mqtt;

  if (!mqttConfig) {
    console.error('MQTT config not found in config file');
    process.exit(1);
  }

  const { host, port, username, password, topic } = mqttConfig;

  const client = mqtt.connect(host, {
    port,
    username,
    password,
  });

  client.on('connect', () => {
    console.log(`MQTT connected to ${host}`);
    client.subscribe(`${topic}/#`, (err) => {
      if (err) {
        console.error('MQTT subscribe error:', err);
      } else {
        console.log(`MQTT subscribed to ${topic}/#`);
      }
    });
  });

  client.on('reconnect', () => {
    console.log('MQTT reconnecting...');
  });

  client.on('error', (err) => {
    console.error('MQTT error:', err.message);
  });

  client.on('message', async (receivedTopic, message) => {
    const subtopic = receivedTopic.slice(topic.length + 1);
    const payload = message.toString();

    console.log(`MQTT ${subtopic}: ${payload}`);

    try {
      switch (subtopic) {
        case 'place': {
          const rule = JSON.parse(payload);
          await placeWindowByConfig(rule);
          break;
        }
        case 'placeAll': {
          await placeWindows();
          break;
        }
        case 'store': {
          await storeWindows();
          break;
        }
        case 'restore': {
          await restoreWindows();
          break;
        }
        case 'desktop': {
          const { number } = JSON.parse(payload);
          virtualDesktop.GoToDesktopNumber(number - 1);
          break;
        }
        default:
          console.log(`MQTT unknown subtopic: ${subtopic}`);
      }
    } catch (err) {
      console.error(`MQTT error handling ${subtopic}:`, err.message);
    }
  });

  return client;
}

export { startMqtt };
