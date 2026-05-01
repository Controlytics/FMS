/**
 * External Node Registrations
 */

import { registerNode } from '../node-registry.js';
import type { NodeResult } from '../types.js';
import { resolveTemplate } from './index.js';

export function registerExternalNodes(): void {

registerNode({
  type: 'rest-api-call',
  category: 'EXTERNAL',
  name: 'REST API Call',
  description: 'HTTP request to an external service. Supports all HTTP methods, custom headers, and timeout.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { url: '', method: 'POST', headers: '{}', timeout: 5000 },
  configSchema: {
    url: { type: 'string', label: 'URL', description: 'Target URL. Supports ${entityName}, ${metadata.key} variables.' },
    method: { type: 'select', label: 'Method', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
    headers: { type: 'textarea', label: 'Headers (JSON)', description: 'Custom HTTP headers as JSON object.' },
    timeout: { type: 'number', label: 'Timeout (ms)', description: 'Request timeout in milliseconds.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const url = resolveTemplate((config.url as string) ?? '', ctx, message);
      if (!url) return { output: 'Failure', message, log: 'No URL configured' };
      const method = (config.method as string) ?? 'POST';
      let headers: Record<string, string> = {};
      try { headers = typeof config.headers === 'string' ? JSON.parse(config.headers) : (config.headers as Record<string, string>) ?? {}; } catch { /* use empty */ }
      const timeout = (config.timeout as number) ?? 5000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: method !== 'GET' ? JSON.stringify(message) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) return { output: 'Failure', message, log: `HTTP ${response.status}: ${response.statusText}` };
      // If the upstream API returned 2xx but a non-JSON body, fall back to
      // an empty object so the rule-chain message can still flow. Log so the
      // mismatch is visible — silent JSON-parse failures here would mask
      // misconfigured webhooks.
      const responseData = await response.json().catch((parseErr) => {
        console.warn(
          `[rule-chain external-call] response from ${url} parsed as non-JSON:`,
          parseErr instanceof Error ? parseErr.message : parseErr,
        );
        return {};
      });
      return { output: 'Success', message: { ...message, _apiResponse: responseData } };
    } catch (err) {
      return { output: 'Failure', message, log: `API call error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

registerNode({
  type: 'mqtt-publish',
  category: 'EXTERNAL',
  name: 'MQTT Publish',
  description: 'Publish to a custom MQTT topic.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { topic: '', qos: 0, retain: false },
  configSchema: {
    topic: { type: 'string', label: 'Topic', description: 'MQTT topic. Supports ${entityName}, ${unsPath} variables.' },
    qos: { type: 'select', label: 'QoS', options: ['0', '1', '2'] },
    retain: { type: 'boolean', label: 'Retain', description: 'Retain message on broker.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    const topic = resolveTemplate((config.topic as string) ?? '', ctx, message);
    return {
      output: 'Success',
      message: { ...message, _mqttPublish: { topic, qos: Number(config.qos ?? 0), retain: config.retain ?? false } },
    };
  },
});

registerNode({
  type: 'push-to-uns',
  category: 'EXTERNAL',
  name: 'Push to UNS',
  description: 'Publish data to a UNS path.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { unsPath: '' },
  configSchema: {
    unsPath: { type: 'string', label: 'UNS Path', description: 'Target UNS path (empty = entity default path).' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    const unsPath = (config.unsPath as string) || ctx.unsPath;
    return { output: 'Success', message: { ...message, _unsPublish: { path: unsPath } } };
  },
});

registerNode({
  type: 'send-email',
  category: 'EXTERNAL',
  name: 'Send Email',
  description: 'Format and enqueue email notification.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { to: '', subject: '', body: '' },
  configSchema: {
    to: { type: 'string', label: 'To', description: 'Recipient email address.' },
    subject: { type: 'string', label: 'Subject', description: 'Email subject.' },
    body: { type: 'textarea', label: 'Body', description: 'Email body. Supports ${entityName} variables.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    const notification = {
      type: 'EMAIL',
      title: resolveTemplate((config.subject as string) ?? '', ctx, message),
      message: resolveTemplate((config.body as string) ?? '', ctx, message),
      metadata: { to: config.to, entityId: ctx.entityId },
    };
    return { output: 'Success', message, notifications: [notification] };
  },
});

registerNode({
  type: 'send-sms',
  category: 'EXTERNAL',
  name: 'Send SMS',
  description: 'Sends an SMS via a configured provider (Twilio, AWS SNS, or custom API).',
  outputs: ['Success', 'Failure'],
  defaultConfig: { provider: 'twilio', phoneNumber: '', messageTemplate: 'Alert from ${entityName}', accountSid: '', authToken: '', fromNumber: '' },
  configSchema: {
    provider: { type: 'select', label: 'Provider', options: ['twilio', 'aws-sns', 'custom-api'] },
    phoneNumber: { type: 'string', label: 'To Phone Number', description: 'Target phone number.' },
    messageTemplate: { type: 'textarea', label: 'Message Template', description: 'SMS message. Supports ${entityName} variables.' },
    accountSid: { type: 'string', label: 'Account SID (Twilio)', description: 'Twilio account SID.' },
    authToken: { type: 'string', label: 'Auth Token', description: 'Provider auth token.' },
    fromNumber: { type: 'string', label: 'From Number', description: 'Sender phone number.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const smsBody = resolveTemplate((config.messageTemplate as string) ?? '', ctx, message);
      const provider = (config.provider as string) ?? 'twilio';
      if (provider === 'twilio') {
        const accountSid = (config.accountSid as string) ?? '';
        const authToken = (config.authToken as string) ?? '';
        if (!accountSid || !authToken) return { output: 'Failure', message, log: 'Missing Twilio credentials' };
        const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}` },
          body: new URLSearchParams({ To: (config.phoneNumber as string) ?? '', From: (config.fromNumber as string) ?? '', Body: smsBody }).toString(),
        });
        if (!response.ok) return { output: 'Failure', message, log: `Twilio: ${response.status}` };
      }
      return { output: 'Success', message: { ...message, _smsSent: true } };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'send-to-slack',
  category: 'EXTERNAL',
  name: 'Send to Slack',
  description: 'Sends a message to a Slack channel via webhook URL.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { webhookUrl: '', channel: '', messageTemplate: 'Alert: ${entityName}', username: 'DigiLog' },
  configSchema: {
    webhookUrl: { type: 'string', label: 'Webhook URL', description: 'Slack incoming webhook URL.' },
    channel: { type: 'string', label: 'Channel', description: 'Override channel (optional).' },
    messageTemplate: { type: 'textarea', label: 'Message Template', description: 'Supports ${entityName}, ${msg.key} variables.' },
    username: { type: 'string', label: 'Bot Username' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const webhookUrl = (config.webhookUrl as string) ?? '';
      if (!webhookUrl) return { output: 'Failure', message, log: 'No webhook URL' };
      const text = resolveTemplate((config.messageTemplate as string) ?? '', ctx, message);
      const payload: Record<string, string> = { text };
      if (config.channel) payload.channel = config.channel as string;
      if (config.username) payload.username = config.username as string;
      const response = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) return { output: 'Failure', message, log: `Slack: ${response.status}` };
      return { output: 'Success', message };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'aws-sns',
  category: 'EXTERNAL',
  name: 'AWS SNS',
  description: 'Publishes a message to an Amazon SNS topic.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { topicArn: '', region: 'ap-south-1', messageTemplate: '' },
  configSchema: {
    topicArn: { type: 'string', label: 'Topic ARN' },
    region: { type: 'string', label: 'AWS Region' },
    messageTemplate: { type: 'textarea', label: 'Message Template', description: 'Supports ${entityName} variables. Empty = full message JSON.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    const body = (config.messageTemplate as string) ? resolveTemplate(config.messageTemplate as string, ctx, message) : JSON.stringify(message);
    return { output: 'Success', message: { ...message, _awsSns: { topicArn: config.topicArn, region: config.region, body } } };
  },
});

registerNode({
  type: 'aws-sqs',
  category: 'EXTERNAL',
  name: 'AWS SQS',
  description: 'Sends a message to an Amazon SQS queue.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { queueUrl: '', region: 'ap-south-1', messageTemplate: '' },
  configSchema: {
    queueUrl: { type: 'string', label: 'Queue URL' },
    region: { type: 'string', label: 'AWS Region' },
    messageTemplate: { type: 'textarea', label: 'Message Template', description: 'Supports ${entityName} variables. Empty = full message JSON.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    const body = (config.messageTemplate as string) ? resolveTemplate(config.messageTemplate as string, ctx, message) : JSON.stringify(message);
    return { output: 'Success', message: { ...message, _awsSqs: { queueUrl: config.queueUrl, region: config.region, body } } };
  },
});

registerNode({
  type: 'aws-lambda',
  category: 'EXTERNAL',
  name: 'AWS Lambda',
  description: 'Invokes an AWS Lambda function and returns its response.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { functionName: '', region: 'ap-south-1', invocationType: 'RequestResponse' },
  configSchema: {
    functionName: { type: 'string', label: 'Function Name' },
    region: { type: 'string', label: 'AWS Region' },
    invocationType: { type: 'select', label: 'Invocation Type', options: ['RequestResponse', 'Event'] },
  },
  async execute(message, config, _ctx): Promise<NodeResult> {
    return { output: 'Success', message: { ...message, _awsLambda: { functionName: config.functionName, region: config.region, invocationType: config.invocationType, payload: message } } };
  },
});

registerNode({
  type: 'kafka',
  category: 'EXTERNAL',
  name: 'Kafka',
  description: 'Publishes a message to a Kafka topic.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { bootstrapServers: '', topic: '', key: '', acks: 'all' },
  configSchema: {
    bootstrapServers: { type: 'string', label: 'Bootstrap Servers', description: 'Comma-separated host:port pairs.' },
    topic: { type: 'string', label: 'Topic' },
    key: { type: 'string', label: 'Message Key', description: 'Partition key (defaults to entityId).' },
    acks: { type: 'select', label: 'Acks', options: ['0', '1', 'all'] },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    return { output: 'Success', message: { ...message, _kafkaPublish: { bootstrapServers: config.bootstrapServers, topic: config.topic, key: (config.key as string) || ctx.entityId, acks: config.acks } } };
  },
});

registerNode({
  type: 'rabbitmq',
  category: 'EXTERNAL',
  name: 'RabbitMQ',
  description: 'Publishes a message to a RabbitMQ exchange.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { host: 'localhost', port: 5672, exchange: '', routingKey: '', username: 'guest', password: 'guest', exchangeType: 'direct' },
  configSchema: {
    host: { type: 'string', label: 'Host' },
    port: { type: 'number', label: 'Port' },
    exchange: { type: 'string', label: 'Exchange Name' },
    routingKey: { type: 'string', label: 'Routing Key' },
    username: { type: 'string', label: 'Username' },
    password: { type: 'string', label: 'Password' },
    exchangeType: { type: 'select', label: 'Exchange Type', options: ['direct', 'fanout', 'topic', 'headers'] },
  },
  async execute(message, config, _ctx): Promise<NodeResult> {
    return { output: 'Success', message: { ...message, _rabbitmqPublish: { host: config.host, port: config.port, exchange: config.exchange, routingKey: config.routingKey, exchangeType: config.exchangeType } } };
  },
});

registerNode({
  type: 'ai-request',
  category: 'EXTERNAL',
  name: 'AI Request',
  description: 'Sends message data to an AI/LLM API (OpenAI, Claude, etc.) for analysis.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { provider: 'openai', apiUrl: 'https://api.openai.com/v1/chat/completions', apiKey: '', model: 'gpt-3.5-turbo', promptTemplate: 'Analyze this sensor data: ${messageJson}', maxTokens: 200, timeout: 30000 },
  configSchema: {
    provider: { type: 'select', label: 'Provider', options: ['openai', 'anthropic', 'custom'] },
    apiUrl: { type: 'string', label: 'API URL' },
    apiKey: { type: 'string', label: 'API Key' },
    model: { type: 'string', label: 'Model' },
    promptTemplate: { type: 'textarea', label: 'Prompt Template', description: 'Use ${messageJson}, ${entityName} variables.' },
    maxTokens: { type: 'number', label: 'Max Tokens' },
    timeout: { type: 'number', label: 'Timeout (ms)' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const apiUrl = (config.apiUrl as string) ?? '';
      const apiKey = (config.apiKey as string) ?? '';
      if (!apiUrl || !apiKey) return { output: 'Failure', message, log: 'Missing API URL or key' };
      const prompt = resolveTemplate((config.promptTemplate as string) ?? '', ctx, message);
      const provider = (config.provider as string) ?? 'openai';
      const timeout = (config.timeout as number) ?? 30000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      let body: string;
      let headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (provider === 'anthropic') {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
        body = JSON.stringify({ model: config.model ?? 'claude-sonnet-4-20250514', max_tokens: config.maxTokens ?? 200, messages: [{ role: 'user', content: prompt }] });
      } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
        body = JSON.stringify({ model: config.model ?? 'gpt-3.5-turbo', max_tokens: config.maxTokens ?? 200, messages: [{ role: 'user', content: prompt }] });
      }
      const response = await fetch(apiUrl, { method: 'POST', headers, body, signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) return { output: 'Failure', message, log: `AI API: ${response.status}` };
      const data = await response.json();
      const aiText = provider === 'anthropic' ? data?.content?.[0]?.text : data?.choices?.[0]?.message?.content;
      return { output: 'Success', message: { ...message, _aiResponse: aiText ?? '' } };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

}
