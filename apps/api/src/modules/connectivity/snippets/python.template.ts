import type { SnippetContext, Transport } from './types.js';

export function renderPython(transport: Transport, ctx: SnippetContext): string {
  return transport === 'MQTT' ? mqtt(ctx) : http(ctx);
}

function mqtt(ctx: SnippetContext): string {
  return `import paho.mqtt.client as mqtt
import json, time

# Entity: ${ctx.entityName}
# UNS Path: ${ctx.unsPath}

BROKER = "${ctx.mqttHost}"
PORT = 1883
TOKEN = "${ctx.token}"
TELEMETRY_TOPIC = "${ctx.telemetryTopic}"
ATTRIBUTES_TOPIC = "${ctx.attributesTopic}"

client = mqtt.Client()
client.username_pw_set(TOKEN)

def on_connect(client, userdata, flags, rc):
    print("Connected" if rc == 0 else f"Failed: {rc}")

client.on_connect = on_connect
client.connect(BROKER, PORT)
client.loop_start()

# Send telemetry data
data = {"temperature": 25.5, "humidity": 60}
client.publish(TELEMETRY_TOPIC, json.dumps(data))
print("Telemetry sent")

# Send attributes
attributes = {"firmware_version": "1.2.3", "model": "SensorX"}
client.publish(ATTRIBUTES_TOPIC, json.dumps(attributes))
print("Attributes sent")

time.sleep(1)
client.disconnect()`;
}

function http(ctx: SnippetContext): string {
  return `import requests

# Entity: ${ctx.entityName}
# UNS Path: ${ctx.unsPath}

url = "${ctx.apiUrl}/api/data/telemetry"
headers = {
    "Authorization": "Bearer ${ctx.token}",
    "Content-Type": "application/json"
}

# Send telemetry data
data = {"temperature": 25.5, "humidity": 60}
response = requests.post(url, json=data, headers=headers)
print(response.status_code, response.json())

# Send attributes
attr_url = "${ctx.apiUrl}/api/data/attributes"
attributes = {"firmware_version": "1.2.3", "model": "SensorX"}
response = requests.post(attr_url, json=attributes, headers=headers)
print(response.status_code, response.json())`;
}
