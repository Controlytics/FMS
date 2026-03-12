/**
 * SMS Notification Node — Rule chain node that sends SMS notifications.
 */

import { registerNode } from '../node-registry.js';
import { sendNotification } from '../../../modules/notification-delivery/delivery.service.js';
import { resolveTemplate } from '../../../modules/notification-delivery/template-engine.js';

registerNode({
  type: 'send-sms',
  category: 'EXTERNAL',
  name: 'Send SMS',
  description: 'Sends an SMS notification to specified phone numbers. Supports dynamic variables from message data.',
  outputs: ['Success', 'Failure'],
  defaultConfig: {
    phoneNumbers: '',
    messageTemplate: 'DigiLog Alert: ${alarmType} on ${entityName} - Severity: ${alarmSeverity} at ${timestamp}',
  },
  configSchema: {
    phoneNumbers: {
      type: 'textarea',
      label: 'Phone Numbers',
      description: 'Comma-separated phone numbers with country code (e.g. +919876543210). Supports ${metadata.phone} variables.',
    },
    messageTemplate: {
      type: 'textarea',
      label: 'Message Template',
      description: 'SMS message text (max 1600 chars). Supports ${entityName}, ${alarmType}, ${alarmSeverity}, ${timestamp}, ${msg.key} variables.',
    },
  },
  async execute(message, config, ctx) {
    const phoneNumbers = String(config.phoneNumbers ?? '');
    const messageTemplate = String(config.messageTemplate ?? '');

    if (!phoneNumbers.trim()) {
      return {
        output: 'Failure',
        message,
        log: 'No phone numbers configured',
      };
    }

    // Build variables from context and message
    const variables: Record<string, string> = {
      entityName: ctx.entityName,
      entityId: ctx.entityId,
      templateId: ctx.templateId,
      unsPath: ctx.unsPath,
      timestamp: new Date().toISOString(),
      messageJson: JSON.stringify(message),
      alarmType: String(message.alarmType ?? message.type ?? ctx.metadata.alarmType ?? ''),
      alarmSeverity: String(message.severity ?? ctx.metadata.severity ?? ''),
      description: String(message.description ?? message.details ?? ''),
      status: String(message.status ?? ''),
      deviceName: ctx.entityName,
    };

    for (const [k, v] of Object.entries(ctx.metadata)) {
      variables[`metadata.${k}`] = v;
    }
    for (const [k, v] of Object.entries(message)) {
      variables[`msg.${k}`] = String(v ?? '');
    }

    const resolvedPhones = resolveTemplate(phoneNumbers, variables);
    const resolvedMessage = resolveTemplate(messageTemplate, variables);

    const recipients = resolvedPhones.split(',').map(s => s.trim()).filter(Boolean);
    const errors: string[] = [];
    let successCount = 0;

    for (const recipient of recipients) {
      const result = await sendNotification({
        channel: 'SMS',
        recipient,
        message: resolvedMessage,
        triggeredBy: 'rule-chain',
        ruleChainId: undefined,
        metadata: { entityId: ctx.entityId, entityName: ctx.entityName },
      });

      if (result.success) {
        successCount++;
      } else {
        errors.push(`${recipient}: ${result.error}`);
      }
    }

    if (successCount === 0 && errors.length > 0) {
      return {
        output: 'Failure',
        message: { ...message, _smsErrors: errors },
        log: `SMS failed for all recipients: ${errors.join('; ')}`,
      };
    }

    return {
      output: 'Success',
      message: {
        ...message,
        _smsSent: true,
        _smsRecipients: recipients.length,
        _smsSuccessCount: successCount,
      },
      log: `SMS sent to ${successCount}/${recipients.length} recipients`,
    };
  },
});
