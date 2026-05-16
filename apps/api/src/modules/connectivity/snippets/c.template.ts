import type { SnippetContext, Transport } from './types.js';

export function renderC(transport: Transport, ctx: SnippetContext): string {
  return transport === 'MQTT' ? mqtt(ctx) : http(ctx);
}

function mqtt(ctx: SnippetContext): string {
  return `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "MQTTClient.h"

// Entity: ${ctx.entityName}
// UNS Path: ${ctx.unsPath}

#define BROKER  "tcp://${ctx.mqttHost}:1883"
#define TOKEN   "${ctx.token}"
#define TEL_TOPIC "${ctx.telemetryTopic}"
#define ATTR_TOPIC "${ctx.attributesTopic}"
#define CLIENTID  "digilog_device"
#define QOS 1

int main() {
    MQTTClient client;
    MQTTClient_connectOptions opts = MQTTClient_connectOptions_initializer;
    MQTTClient_message msg = MQTTClient_message_initializer;
    MQTTClient_deliveryToken dt;

    MQTTClient_create(&client, BROKER, CLIENTID, MQTTCLIENT_PERSISTENCE_NONE, NULL);
    opts.username = TOKEN;
    opts.keepAliveInterval = 20;
    opts.cleansession = 1;

    if (MQTTClient_connect(client, &opts) != MQTTCLIENT_SUCCESS) {
        printf("Connection failed\\n");
        return 1;
    }
    printf("Connected to MQTT broker\\n");

    // Send telemetry
    const char *telemetry = "{\\"temperature\\": 25.5, \\"humidity\\": 60}";
    msg.payload = (void *)telemetry;
    msg.payloadlen = strlen(telemetry);
    msg.qos = QOS;
    MQTTClient_publishMessage(client, TEL_TOPIC, &msg, &dt);
    MQTTClient_waitForCompletion(client, dt, 5000);
    printf("Telemetry sent\\n");

    // Send attributes
    const char *attrs = "{\\"firmware_version\\": \\"1.2.3\\", \\"model\\": \\"SensorX\\"}";
    msg.payload = (void *)attrs;
    msg.payloadlen = strlen(attrs);
    MQTTClient_publishMessage(client, ATTR_TOPIC, &msg, &dt);
    MQTTClient_waitForCompletion(client, dt, 5000);
    printf("Attributes sent\\n");

    MQTTClient_disconnect(client, 1000);
    MQTTClient_destroy(&client);
    return 0;
}
// Compile: gcc -o device device.c -lpaho-mqtt3c`;
}

function http(ctx: SnippetContext): string {
  return `#include <stdio.h>
#include <string.h>
#include <curl/curl.h>

// Entity: ${ctx.entityName}
// UNS Path: ${ctx.unsPath}

#define API_URL "${ctx.apiUrl}/api/data/telemetry"
#define ATTR_URL "${ctx.apiUrl}/api/data/attributes"
#define TOKEN   "${ctx.token}"

int send_post(const char *url, const char *json) {
    CURL *curl = curl_easy_init();
    if (!curl) return 1;

    struct curl_slist *headers = NULL;
    char auth[256];
    snprintf(auth, sizeof(auth), "Authorization: Bearer %s", TOKEN);
    headers = curl_slist_append(headers, "Content-Type: application/json");
    headers = curl_slist_append(headers, auth);

    curl_easy_setopt(curl, CURLOPT_URL, url);
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, json);

    CURLcode res = curl_easy_perform(curl);
    if (res != CURLE_OK)
        fprintf(stderr, "Request failed: %s\\n", curl_easy_strerror(res));

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    return (int)res;
}

int main() {
    curl_global_init(CURL_GLOBAL_ALL);

    // Send telemetry
    send_post(API_URL, "{\\"temperature\\": 25.5, \\"humidity\\": 60}");
    printf("Telemetry sent\\n");

    // Send attributes
    send_post(ATTR_URL, "{\\"firmware_version\\": \\"1.2.3\\", \\"model\\": \\"SensorX\\"}");
    printf("Attributes sent\\n");

    curl_global_cleanup();
    return 0;
}
// Compile: gcc -o device device.c -lcurl`;
}
