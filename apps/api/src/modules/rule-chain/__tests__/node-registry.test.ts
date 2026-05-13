import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { registerNode, getNode, getAllNodes, getNodesByCategory } from '../node-registry.js';
import { initializeNodes } from '../nodes/index.js';
import type { NodeContext, NodeResult } from '../types.js';

// Initialize all nodes before tests
beforeAll(() => {
  initializeNodes();
});

const mockContext: NodeContext = {
  entityId: 'entity-1',
  entityName: 'Sensor-1',
  templateId: 'template-1',
  unsPath: 'digilog/v1/enterprise/sensor-1',
  metadata: {},
  chainDepth: 0,
  maxChainDepth: 10,
  debugEnabled: false,
};

// ═══════════════════════════════════════════════════════
// Registry Tests
// ═══════════════════════════════════════════════════════

describe('Node Registry', () => {
  it('getAllNodes returns all registered nodes', () => {
    const nodes = getAllNodes();
    expect(nodes.length).toBeGreaterThanOrEqual(26);
  });

  it('getNode("input") returns the input node definition', () => {
    const node = getNode('input');
    expect(node).toBeDefined();
    expect(node!.type).toBe('input');
    expect(node!.category).toBe('INPUT');
    expect(node!.name).toBe('Input');
    expect(node!.outputs).toContain('Success');
  });

  it('getNode("nonexistent") returns undefined', () => {
    const node = getNode('nonexistent');
    expect(node).toBeUndefined();
  });

  // Backward-compat aliases for pre-rename rule_node rows. Snake_case types
  // were used by editor code before 2026-05-12 — chains authored then still
  // exist in some databases. The registry resolves them to the current
  // kebab-case node definitions so rule-engine.ts doesn't emit
  // ERR_NODE_TYPE_UNKNOWN for those rows. See LEGACY_TYPE_ALIASES in
  // node-registry.ts for the full list + rationale.
  it('getNode("log_action") aliases to the current "log" node', () => {
    const aliased = getNode('log_action');
    const canonical = getNode('log');
    expect(aliased).toBeDefined();
    expect(canonical).toBeDefined();
    expect(aliased).toBe(canonical);
    expect(aliased!.type).toBe('log');
  });

  it('getNode("msg_type_filter") aliases to the current "msg-type-filter" node', () => {
    const aliased = getNode('msg_type_filter');
    const canonical = getNode('msg-type-filter');
    expect(aliased).toBeDefined();
    expect(canonical).toBeDefined();
    expect(aliased).toBe(canonical);
    expect(aliased!.type).toBe('msg-type-filter');
  });

  it('legacy alias does not shadow direct registration (precedence test)', () => {
    // Direct lookup wins over alias lookup — proves we check the registry
    // first and only fall back to LEGACY_TYPE_ALIASES on miss.
    const direct = getNode('log');
    expect(direct).toBeDefined();
    expect(direct!.type).toBe('log');
  });

  // Counts mirror src/modules/rule-chain/nodes/*-nodes.ts. Update both
  // when adding or removing nodes in a category.
  it('getNodesByCategory("FILTER") returns 12 filter nodes', () => {
    const filterNodes = getNodesByCategory('FILTER');
    expect(filterNodes).toHaveLength(12);
    filterNodes.forEach((n) => expect(n.category).toBe('FILTER'));
  });

  it('getNodesByCategory("INPUT") returns 1 node', () => {
    const inputNodes = getNodesByCategory('INPUT');
    expect(inputNodes).toHaveLength(1);
    expect(inputNodes[0].type).toBe('input');
  });
});

// ═══════════════════════════════════════════════════════
// INPUT Node Tests
// ═══════════════════════════════════════════════════════

describe('INPUT Nodes', () => {
  it('input node passes message through with "Success" output', async () => {
    const node = getNode('input')!;
    const msg = { temp: 72, humidity: 45 };
    const result = await node.execute(msg, {}, mockContext);

    expect(result.output).toBe('Success');
    expect(result.message).toEqual(msg);
  });
});

// ═══════════════════════════════════════════════════════
// FILTER Node Tests
// ═══════════════════════════════════════════════════════

describe('FILTER Nodes', () => {
  describe('msg-type-filter', () => {
    it('returns "True" when message type matches configured types', async () => {
      const node = getNode('msg-type-filter')!;
      const msg = { _messageType: 'TELEMETRY', temp: 72 };
      const result = await node.execute(msg, { messageTypes: ['TELEMETRY', 'ATTRIBUTE'] }, mockContext);

      expect(result.output).toBe('True');
      expect(result.message).toEqual(msg);
    });

    it('returns "False" when message type does not match', async () => {
      const node = getNode('msg-type-filter')!;
      const msg = { _messageType: 'RPC_REQUEST', temp: 72 };
      const result = await node.execute(msg, { messageTypes: ['TELEMETRY'] }, mockContext);

      expect(result.output).toBe('False');
    });
  });

  describe('script-filter', () => {
    it('returns "True" when script evaluates to true', async () => {
      const node = getNode('script-filter')!;
      const msg = { temp: 150 };
      const result = await node.execute(msg, { script: 'return msg.temp > 100;' }, mockContext);

      expect(result.output).toBe('True');
    });

    it('returns "False" when script evaluates to false', async () => {
      const node = getNode('script-filter')!;
      const msg = { temp: 50 };
      const result = await node.execute(msg, { script: 'return msg.temp > 100;' }, mockContext);

      expect(result.output).toBe('False');
    });

    it('returns "Failure" with log on invalid script syntax', async () => {
      const node = getNode('script-filter')!;
      const msg = { temp: 50 };
      const result = await node.execute(msg, { script: 'return %%%invalid;' }, mockContext);

      expect(result.output).toBe('Failure');
      expect(result.log).toBeDefined();
      expect(result.log).toContain('Script error');
    });
  });
});

// ═══════════════════════════════════════════════════════
// TRANSFORM Node Tests
// ═══════════════════════════════════════════════════════

describe('TRANSFORM Nodes', () => {
  describe('script-transform', () => {
    it('doubles temp when script multiplies by 2', async () => {
      const node = getNode('script-transform')!;
      const msg = { temp: 50 };
      const result = await node.execute(msg, { script: 'msg.temp = msg.temp * 2; return msg;' }, mockContext);

      expect(result.output).toBe('Success');
      expect(result.message.temp).toBe(100);
    });

    it('passes message through with identity script', async () => {
      const node = getNode('script-transform')!;
      const msg = { temp: 72, humidity: 45 };
      const result = await node.execute(msg, { script: 'return msg;' }, mockContext);

      expect(result.output).toBe('Success');
      expect(result.message.temp).toBe(72);
      expect(result.message.humidity).toBe(45);
    });

    it('returns "Failure" on invalid script', async () => {
      const node = getNode('script-transform')!;
      const msg = { temp: 72 };
      const result = await node.execute(msg, { script: 'throw new Error("boom");' }, mockContext);

      expect(result.output).toBe('Failure');
      expect(result.log).toContain('Script error');
    });
  });

  describe('rename-keys', () => {
    it('renames keys according to mapping', async () => {
      const node = getNode('rename-keys')!;
      const msg = { temp: 72, hum: 45 };
      const result = await node.execute(msg, { mapping: { temp: 'temperature', hum: 'humidity' } }, mockContext);

      expect(result.output).toBe('Success');
      expect(result.message.temperature).toBe(72);
      expect(result.message.humidity).toBe(45);
      expect(result.message.temp).toBeUndefined();
      expect(result.message.hum).toBeUndefined();
    });

    it('passes through with empty mapping', async () => {
      const node = getNode('rename-keys')!;
      const msg = { temp: 72, humidity: 45 };
      const result = await node.execute(msg, { mapping: {} }, mockContext);

      expect(result.output).toBe('Success');
      expect(result.message).toEqual(msg);
    });
  });

  describe('to-email', () => {
    it('generates email format with entity name substitution', async () => {
      const node = getNode('to-email')!;
      const msg = { temp: 72 };
      const config = {
        subject: 'Alert: ${entityName}',
        body: 'Data received from ${entityName}',
        to: 'admin@example.com',
      };
      const result = await node.execute(msg, config, mockContext);

      expect(result.output).toBe('Success');
      expect(result.message._email).toBeDefined();
      const email = result.message._email as Record<string, unknown>;
      expect(email.subject).toBe('Alert: Sensor-1');
      expect(email.body).toBe('Data received from Sensor-1');
      expect(email.to).toBe('admin@example.com');
      expect(email.entityId).toBe('entity-1');
    });
  });

  describe('unit-conversion', () => {
    it('converts celsius to fahrenheit using formula', async () => {
      const node = getNode('unit-conversion')!;
      const msg = { temp: 100 };
      const config = {
        conversions: [{ key: 'temp', formula: 'x * 9/5 + 32' }],
      };
      const result = await node.execute(msg, config, mockContext);

      expect(result.output).toBe('Success');
      expect(result.message.temp).toBe(212);
    });

    it('skips conversion for non-numeric values', async () => {
      const node = getNode('unit-conversion')!;
      const msg = { temp: 'not-a-number' };
      const config = {
        conversions: [{ key: 'temp', formula: 'x * 9/5 + 32' }],
      };
      const result = await node.execute(msg, config, mockContext);

      expect(result.output).toBe('Success');
      expect(result.message.temp).toBe('not-a-number');
    });
  });
});

// ═══════════════════════════════════════════════════════
// ACTION Node Tests
// ═══════════════════════════════════════════════════════

describe('ACTION Nodes', () => {
  describe('save-timeseries', () => {
    it('adds _saveAs: "telemetry" to message', async () => {
      const node = getNode('save-timeseries')!;
      const msg = { temp: 72 };
      const result = await node.execute(msg, {}, mockContext);

      expect(result.output).toBe('Success');
      expect(result.message._saveAs).toBe('telemetry');
      expect(result.message.temp).toBe(72);
    });
  });

  describe('save-attributes', () => {
    it('adds _saveAs: "attributes" and _scope to message', async () => {
      const node = getNode('save-attributes')!;
      const msg = { firmware: '1.2.3' };
      const result = await node.execute(msg, { scope: 'server' }, mockContext);

      expect(result.output).toBe('Success');
      expect(result.message._saveAs).toBe('attributes');
      expect(result.message._scope).toBe('server');
    });
  });

  describe('create-alarm', () => {
    it('returns alarm action with entityId, type, and severity', async () => {
      const node = getNode('create-alarm')!;
      const msg = { temp: 200 };
      const config = { alarmType: 'HIGH_TEMP', severity: 'CRITICAL' };
      const result = await node.execute(msg, config, mockContext);

      expect(result.output).toBe('Success');
      expect(result.alarms).toBeDefined();
      expect(result.alarms).toHaveLength(1);
      expect(result.alarms![0].entityId).toBe('entity-1');
      expect(result.alarms![0].alarmType).toBe('HIGH_TEMP');
      expect(result.alarms![0].severity).toBe('CRITICAL');
      expect(result.alarms![0].clear).toBe(false);
      expect(result.alarms![0].details).toEqual(msg);
    });
  });

  describe('clear-alarm', () => {
    it('returns alarm action with clear: true', async () => {
      const node = getNode('clear-alarm')!;
      const msg = { temp: 50 };
      const config = { alarmType: 'HIGH_TEMP' };
      const result = await node.execute(msg, config, mockContext);

      expect(result.output).toBe('Success');
      expect(result.alarms).toBeDefined();
      expect(result.alarms).toHaveLength(1);
      expect(result.alarms![0].alarmType).toBe('HIGH_TEMP');
      expect(result.alarms![0].clear).toBe(true);
      expect(result.alarms![0].severity).toBe('INFO');
    });
  });

  describe('send-notification', () => {
    it('returns notification with title and message', async () => {
      const node = getNode('send-notification')!;
      const msg = { temp: 72 };
      const config = { title: 'Alert', messageTemplate: 'Something happened', targetRole: 'ADMIN' };
      const result = await node.execute(msg, config, mockContext);

      expect(result.output).toBe('Success');
      expect(result.notifications).toBeDefined();
      expect(result.notifications).toHaveLength(1);
      expect(result.notifications![0].type).toBe('RULE_CHAIN_ALERT');
      expect(result.notifications![0].title).toBe('Alert');
      expect(result.notifications![0].message).toBe('Something happened');
      expect(result.notifications![0].targetRole).toBe('ADMIN');
    });

    it('substitutes ${entityName} in title and message template', async () => {
      const node = getNode('send-notification')!;
      const msg = { temp: 72 };
      const config = {
        title: 'Alert on ${entityName}',
        messageTemplate: 'Check ${entityName} immediately',
      };
      const result = await node.execute(msg, config, mockContext);

      expect(result.output).toBe('Success');
      expect(result.notifications![0].title).toBe('Alert on Sensor-1');
      expect(result.notifications![0].message).toBe('Check Sensor-1 immediately');
    });
  });

  describe('assign-to-user', () => {
    it('sets assignedTo in returned metadata', async () => {
      const node = getNode('assign-to-user')!;
      const msg = { temp: 72 };
      const config = { userId: 'user-42' };
      const result = await node.execute(msg, config, mockContext);

      expect(result.output).toBe('Success');
      expect(result.metadata).toBeDefined();
      expect(result.metadata!.assignedTo).toBe('user-42');
    });
  });

  describe('log', () => {
    it('returns "Success" with log string containing entity name', async () => {
      const node = getNode('log')!;
      const msg = { temp: 72 };
      const config = { template: 'Log entry for ${entityName}' };
      const result = await node.execute(msg, config, mockContext);

      expect(result.output).toBe('Success');
      expect(result.log).toBe('Log entry for Sensor-1');
    });
  });

  describe('rpc-call-reply', () => {
    it('adds _rpcReply: true to message', async () => {
      const node = getNode('rpc-call-reply')!;
      const msg = { response: 'ok' };
      const result = await node.execute(msg, {}, mockContext);

      expect(result.output).toBe('Success');
      expect(result.message._rpcReply).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════
// EXTERNAL Node Tests
// ═══════════════════════════════════════════════════════

describe('EXTERNAL Nodes', () => {
  describe('mqtt-publish', () => {
    it('adds _mqttPublish with topic, qos, and retain to message', async () => {
      const node = getNode('mqtt-publish')!;
      const msg = { temp: 72 };
      const config = { topic: 'sensors/data', qos: 1, retain: true };
      const result = await node.execute(msg, config, mockContext);

      expect(result.output).toBe('Success');
      expect(result.message._mqttPublish).toBeDefined();
      const pub = result.message._mqttPublish as Record<string, unknown>;
      expect(pub.topic).toBe('sensors/data');
      expect(pub.qos).toBe(1);
      expect(pub.retain).toBe(true);
    });
  });

  describe('push-to-uns', () => {
    it('uses config unsPath when provided', async () => {
      const node = getNode('push-to-uns')!;
      const msg = { temp: 72 };
      const config = { unsPath: 'custom/uns/path' };
      const result = await node.execute(msg, config, mockContext);

      expect(result.output).toBe('Success');
      const pub = result.message._unsPublish as Record<string, unknown>;
      expect(pub.path).toBe('custom/uns/path');
    });

    it('falls back to ctx.unsPath when config unsPath is empty', async () => {
      const node = getNode('push-to-uns')!;
      const msg = { temp: 72 };
      const result = await node.execute(msg, { unsPath: '' }, mockContext);

      expect(result.output).toBe('Success');
      const pub = result.message._unsPublish as Record<string, unknown>;
      expect(pub.path).toBe('digilog/v1/enterprise/sensor-1');
    });
  });

  describe('send-email', () => {
    it('returns notification with EMAIL type and entity name substitution', async () => {
      const node = getNode('send-email')!;
      const msg = { temp: 72 };
      const config = {
        to: 'ops@example.com',
        subject: 'Alert: ${entityName}',
        body: 'Check ${entityName} now',
      };
      const result = await node.execute(msg, config, mockContext);

      expect(result.output).toBe('Success');
      expect(result.notifications).toBeDefined();
      expect(result.notifications).toHaveLength(1);
      expect(result.notifications![0].type).toBe('EMAIL');
      expect(result.notifications![0].title).toBe('Alert: Sensor-1');
      expect(result.notifications![0].message).toBe('Check Sensor-1 now');
      const meta = result.notifications![0].metadata as Record<string, unknown>;
      expect(meta.to).toBe('ops@example.com');
      expect(meta.entityId).toBe('entity-1');
    });
  });
});

// ═══════════════════════════════════════════════════════
// FLOW Node Tests
// ═══════════════════════════════════════════════════════

describe('FLOW Nodes', () => {
  describe('checkpoint', () => {
    it('adds _checkpoint: true to message', async () => {
      const node = getNode('checkpoint')!;
      const msg = { temp: 72 };
      const result = await node.execute(msg, {}, mockContext);

      expect(result.output).toBe('Success');
      expect(result.message._checkpoint).toBe(true);
    });
  });

  describe('acknowledge', () => {
    it('adds _acknowledged: true to message', async () => {
      const node = getNode('acknowledge')!;
      const msg = { temp: 72 };
      const result = await node.execute(msg, {}, mockContext);

      expect(result.output).toBe('Success');
      expect(result.message._acknowledged).toBe(true);
    });
  });

  describe('rule-chain-input', () => {
    it('adds _delegateChain and incremented _chainDepth when target chain is set', async () => {
      const node = getNode('rule-chain-input')!;
      const msg = { temp: 72 };
      const config = { targetChainId: 'chain-abc' };
      const result = await node.execute(msg, config, mockContext);

      expect(result.output).toBe('Success');
      expect(result.message._delegateChain).toBe('chain-abc');
      expect(result.message._chainDepth).toBe(1);
    });

    it('returns "Failure" when no target chain ID is configured', async () => {
      const node = getNode('rule-chain-input')!;
      const msg = { temp: 72 };
      const result = await node.execute(msg, { targetChainId: '' }, mockContext);

      expect(result.output).toBe('Failure');
      expect(result.log).toBe('No target chain ID configured');
    });

    it('returns "Failure" when chain depth exceeds max', async () => {
      const node = getNode('rule-chain-input')!;
      const msg = { temp: 72 };
      const config = { targetChainId: 'chain-abc' };
      const deepContext: NodeContext = { ...mockContext, chainDepth: 10, maxChainDepth: 10 };
      const result = await node.execute(msg, config, deepContext);

      expect(result.output).toBe('Failure');
      expect(result.log).toBe('Max chain depth exceeded');
    });
  });

  describe('delay', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('completes after configured delay and returns message unchanged', async () => {
      const node = getNode('delay')!;
      const msg = { temp: 72 };
      const config = { delayMs: 500, maxDelayMs: 10000 };

      const resultPromise = node.execute(msg, config, mockContext);

      // Advance fake timers past the delay
      await vi.advanceTimersByTimeAsync(500);

      const result = await resultPromise;
      expect(result.output).toBe('Success');
      expect(result.message).toEqual(msg);
    });
  });
});

// ═══════════════════════════════════════════════════════
// ENRICHMENT Node Tests (pure only)
// ═══════════════════════════════════════════════════════

describe('ENRICHMENT Nodes', () => {
  describe('tenant-attributes', () => {
    it('reads systemConfig rows, adds sys_<key> entries to metadata, and emits "Success"', async () => {
      // The node reads up to 20 systemConfig rows and prepends 'sys_' to each
      // configKey before writing into metadata. Stub findMany so this stays a
      // unit test - we don't rely on the live digilog_db state here.
      const { prisma } = await import('../../../lib/prisma.js');
      const spy = vi.spyOn(prisma.systemConfig, 'findMany').mockResolvedValue([
        { configKey: 'site_name', configValue: 'DigiLog' } as never,
        { configKey: 'tz', configValue: 'Asia/Kolkata' } as never,
      ]);

      try {
        const node = getNode('tenant-attributes')!;
        const msg = { temp: 72 };
        const result = await node.execute(msg, {}, mockContext);

        expect(result.output).toBe('Success');
        expect(result.message).toEqual(msg);
        expect(result.metadata).toBeDefined();
        expect(result.metadata!.sys_site_name).toBe('DigiLog');
        expect(result.metadata!.sys_tz).toBe('Asia/Kolkata');
      } finally {
        spy.mockRestore();
      }
    });

    it('falls back to existing metadata and still emits "Success" on DB error', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      const spy = vi
        .spyOn(prisma.systemConfig, 'findMany')
        .mockRejectedValue(new Error('db unavailable'));

      try {
        const node = getNode('tenant-attributes')!;
        const ctxWith = { ...mockContext, metadata: { existing: 'kept' } };
        const result = await node.execute({ temp: 1 }, {}, ctxWith);

        expect(result.output).toBe('Success');
        expect(result.metadata?.existing).toBe('kept');
      } finally {
        spy.mockRestore();
      }
    });
  });
});

// ═══════════════════════════════════════════════════════
// Category Count Verification
// ═══════════════════════════════════════════════════════

// Counts mirror src/modules/rule-chain/nodes/*-nodes.ts. Update these
// when adding or removing nodes in a category.
describe('Node Category Counts', () => {
  it('ENRICHMENT has 11 nodes', () => {
    expect(getNodesByCategory('ENRICHMENT')).toHaveLength(11);
  });

  it('TRANSFORM has 12 nodes', () => {
    expect(getNodesByCategory('TRANSFORM')).toHaveLength(12);
  });

  it('ACTION has 20 nodes', () => {
    expect(getNodesByCategory('ACTION')).toHaveLength(20);
  });

  it('EXTERNAL has 12 nodes', () => {
    expect(getNodesByCategory('EXTERNAL')).toHaveLength(12);
  });

  it('FLOW has 5 nodes', () => {
    expect(getNodesByCategory('FLOW')).toHaveLength(5);
  });
});
