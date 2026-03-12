/**
 * Email Notification Node — Rule chain node that sends email notifications.
 */

import { registerNode } from '../node-registry.js';
import { sendNotification } from '../../../modules/notification-delivery/delivery.service.js';
import { resolveTemplate } from '../../../modules/notification-delivery/template-engine.js';

registerNode({
  type: 'send-email',
  category: 'EXTERNAL',
  name: 'Send Email',
  description: 'Sends an email notification to specified recipients. Supports dynamic variables from message data.',
  outputs: ['Success', 'Failure'],
  defaultConfig: {
    toAddresses: '',
    subject: 'DigiLog Alert: ${alarmType} on ${entityName}',
    bodyTemplate: '<h3>Alert Notification</h3><p><strong>Entity:</strong> ${entityName}</p><p><strong>Alarm Type:</strong> ${alarmType}</p><p><strong>Severity:</strong> ${alarmSeverity}</p><p><strong>Time:</strong> ${timestamp}</p><p><strong>Details:</strong> ${description}</p>',
    isHtml: true,
  },
  configSchema: {
    toAddresses: {
      type: 'textarea',
      label: 'To Addresses',
      description: 'Comma-separated email addresses. Supports ${metadata.email} variables.',
    },
    subject: {
      type: 'string',
      label: 'Subject',
      description: 'Email subject line. Supports template variables.',
    },
    bodyTemplate: {
      type: 'textarea',
      label: 'Body Template',
      description: 'HTML or plain text email body. Supports ${entityName}, ${alarmType}, ${alarmSeverity}, ${timestamp}, ${msg.key} variables.',
    },
    isHtml: {
      type: 'boolean',
      label: 'HTML Format',
      description: 'Send as HTML email.',
    },
  },
  async execute(message, config, ctx) {
    const toAddresses = String(config.toAddresses ?? '');
    const subject = String(config.subject ?? 'DigiLog Notification');
    const bodyTemplate = String(config.bodyTemplate ?? '');

    if (!toAddresses.trim()) {
      return {
        output: 'Failure',
        message,
        log: 'No recipient email addresses configured',
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
      // Alarm-specific variables (from message or metadata)
      alarmType: String(message.alarmType ?? message.type ?? ctx.metadata.alarmType ?? ''),
      alarmSeverity: String(message.severity ?? ctx.metadata.severity ?? ''),
      description: String(message.description ?? message.details ?? ''),
      status: String(message.status ?? ''),
      deviceName: ctx.entityName,
    };

    // Add metadata variables
    for (const [k, v] of Object.entries(ctx.metadata)) {
      variables[`metadata.${k}`] = v;
    }
    // Add message variables
    for (const [k, v] of Object.entries(message)) {
      variables[`msg.${k}`] = String(v ?? '');
    }

    // Resolve template variables in addresses too
    const resolvedAddresses = resolveTemplate(toAddresses, variables);
    const resolvedSubject = resolveTemplate(subject, variables);
    const resolvedBody = resolveTemplate(bodyTemplate, variables);

    const recipients = resolvedAddresses.split(',').map(s => s.trim()).filter(Boolean);
    const errors: string[] = [];
    let successCount = 0;

    for (const recipient of recipients) {
      const result = await sendNotification({
        channel: 'EMAIL',
        recipient,
        subject: resolvedSubject,
        message: resolvedBody,
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
        message: { ...message, _emailErrors: errors },
        log: `Email failed for all recipients: ${errors.join('; ')}`,
      };
    }

    return {
      output: 'Success',
      message: {
        ...message,
        _emailSent: true,
        _emailRecipients: recipients.length,
        _emailSuccessCount: successCount,
      },
      log: `Email sent to ${successCount}/${recipients.length} recipients`,
    };
  },
});
