import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Hoisted Mocks ─────────────────────────────────────────

const { mockFindUnique, mockGetConfigOrDefault, mockGetNode, mockRecordDebug } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockGetConfigOrDefault: vi.fn(),
  mockGetNode: vi.fn(),
  mockRecordDebug: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    ruleChain: {
      findUnique: mockFindUnique,
    },
  },
}));

vi.mock('../../data-ingestion/ingestion-config.service.js', () => ({
  getConfigOrDefault: mockGetConfigOrDefault,
}));

vi.mock('../node-registry.js', () => ({
  getNode: mockGetNode,
}));

vi.mock('../debug-recorder.js', () => ({
  recordDebug: mockRecordDebug,
}));

import { executeRuleChain, invalidateChainCache } from '../rule-engine.js';
import type { NodeDefinition, NodeResult, AlarmAction, NotificationAction } from '../types.js';

// ─── Helpers ────────────────────────────────────────────────

const defaultEntityContext = {
  entityId: 'entity-1',
  entityName: 'Sensor-1',
  templateId: 'template-1',
  unsPath: 'digilog/v1/enterprise/sensor-1',
};

function makeChainData(overrides: {
  id?: string;
  isActive?: boolean;
  firstRuleNodeId?: string | null;
  nodes?: Array<{ id: string; type: string; name: string; configuration: Record<string, unknown>; debugEnabled: boolean }>;
  connections?: Array<{ fromNodeId: string; toNodeId: string; label: string }>;
} = {}) {
  return {
    id: overrides.id !== undefined ? overrides.id : 'chain-1',
    isActive: overrides.isActive !== undefined ? overrides.isActive : true,
    firstRuleNodeId: 'firstRuleNodeId' in overrides ? overrides.firstRuleNodeId : 'node-1',
    nodes: overrides.nodes !== undefined ? overrides.nodes : [],
    connections: overrides.connections !== undefined ? overrides.connections : [],
  };
}

function makeNodeDef(overrides: Partial<NodeDefinition> = {}): NodeDefinition {
  return {
    type: overrides.type ?? 'filter',
    category: overrides.category ?? 'FILTER',
    name: overrides.name ?? 'Test Filter',
    description: overrides.description ?? 'A test filter node',
    outputs: overrides.outputs ?? ['True', 'False'],
    defaultConfig: overrides.defaultConfig ?? {},
    execute: overrides.execute ?? vi.fn<NodeDefinition['execute']>().mockResolvedValue({
      output: 'True',
      message: { temp: 72 },
    }),
  };
}

// ─── Tests ──────────────────────────────────────────────────

describe('Rule Engine — executeRuleChain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfigOrDefault.mockResolvedValue(10);
    invalidateChainCache(); // Clear cache between tests
  });

  // ═══════════════════════════════════════════════════════
  // Chain not found / inactive
  // ═══════════════════════════════════════════════════════

  describe('chain not found or inactive', () => {
    it('returns pass-through success when chain is not found in DB', async () => {
      mockFindUnique.mockResolvedValue(null);

      const result = await executeRuleChain(
        { temp: 72 },
        { source: 'mqtt' },
        'nonexistent-chain',
        defaultEntityContext,
      );

      expect(result.success).toBe(true);
      expect(result.nodesExecuted).toBe(0);
      expect(result.errors).toEqual([]);
      expect(result.message).toEqual({ temp: 72 });
      expect(result.metadata).toEqual({ source: 'mqtt' });
    });

    it('returns pass-through success when chain is inactive', async () => {
      mockFindUnique.mockResolvedValue(
        makeChainData({ isActive: false }),
      );

      const result = await executeRuleChain(
        { temp: 72 },
        {},
        'chain-inactive',
        defaultEntityContext,
      );

      expect(result.success).toBe(true);
      expect(result.nodesExecuted).toBe(0);
      expect(result.errors).toEqual([]);
    });

    it('returns pass-through success when chain has no firstRuleNodeId', async () => {
      mockFindUnique.mockResolvedValue(
        makeChainData({ firstRuleNodeId: null }),
      );

      const result = await executeRuleChain(
        { temp: 72 },
        {},
        'chain-no-first',
        defaultEntityContext,
      );

      expect(result.success).toBe(true);
      expect(result.nodesExecuted).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════
  // Max chain depth
  // ═══════════════════════════════════════════════════════

  describe('max chain depth', () => {
    it('returns failure with ERR_MAX_CHAIN_DEPTH when chainDepth >= maxChainDepth', async () => {
      mockGetConfigOrDefault.mockResolvedValue(5);

      const result = await executeRuleChain(
        { temp: 72 },
        { source: 'mqtt' },
        'chain-deep',
        defaultEntityContext,
        5, // chainDepth = 5, maxChainDepth = 5
      );

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('ERR_MAX_CHAIN_DEPTH');
      expect(result.errors[0]).toContain('5');
      expect(result.nodesExecuted).toBe(0);
      // Should NOT call prisma at all
      expect(mockFindUnique).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════
  // Single node execution — filter True/False
  // ═══════════════════════════════════════════════════════

  describe('single filter node', () => {
    it('follows True connection when filter returns True output', async () => {
      const filterExecute = vi.fn<NodeDefinition['execute']>().mockResolvedValue({
        output: 'True',
        message: { temp: 72, filtered: true },
      });

      const actionExecute = vi.fn<NodeDefinition['execute']>().mockResolvedValue({
        output: 'Success',
        message: { temp: 72, filtered: true, saved: true },
      });

      mockFindUnique.mockResolvedValue(makeChainData({
        firstRuleNodeId: 'filter-1',
        nodes: [
          { id: 'filter-1', type: 'msg-type-filter', name: 'Type Filter', configuration: {}, debugEnabled: false },
          { id: 'action-true', type: 'save-timeseries', name: 'Save TS', configuration: {}, debugEnabled: false },
          { id: 'action-false', type: 'log', name: 'Log', configuration: {}, debugEnabled: false },
        ],
        connections: [
          { fromNodeId: 'filter-1', toNodeId: 'action-true', label: 'True' },
          { fromNodeId: 'filter-1', toNodeId: 'action-false', label: 'False' },
        ],
      }));

      mockGetNode.mockImplementation((type: string) => {
        if (type === 'msg-type-filter') return makeNodeDef({ type, execute: filterExecute });
        if (type === 'save-timeseries') return makeNodeDef({ type, category: 'ACTION', execute: actionExecute });
        if (type === 'log') return makeNodeDef({ type, category: 'ACTION', execute: vi.fn() });
        return undefined;
      });

      const result = await executeRuleChain(
        { temp: 72 },
        {},
        'chain-1',
        defaultEntityContext,
      );

      expect(result.success).toBe(true);
      expect(result.nodesExecuted).toBe(2);
      expect(filterExecute).toHaveBeenCalledOnce();
      expect(actionExecute).toHaveBeenCalledOnce();
      expect(result.message).toEqual({ temp: 72, filtered: true, saved: true });
    });

    it('follows False connection when filter returns False output', async () => {
      const filterExecute = vi.fn<NodeDefinition['execute']>().mockResolvedValue({
        output: 'False',
        message: { temp: 72 },
      });

      const trueAction = vi.fn<NodeDefinition['execute']>();
      const falseAction = vi.fn<NodeDefinition['execute']>().mockResolvedValue({
        output: 'Success',
        message: { temp: 72, logged: true },
      });

      mockFindUnique.mockResolvedValue(makeChainData({
        firstRuleNodeId: 'filter-1',
        nodes: [
          { id: 'filter-1', type: 'script-filter', name: 'Script Filter', configuration: {}, debugEnabled: false },
          { id: 'action-true', type: 'save-timeseries', name: 'Save', configuration: {}, debugEnabled: false },
          { id: 'action-false', type: 'log', name: 'Log', configuration: {}, debugEnabled: false },
        ],
        connections: [
          { fromNodeId: 'filter-1', toNodeId: 'action-true', label: 'True' },
          { fromNodeId: 'filter-1', toNodeId: 'action-false', label: 'False' },
        ],
      }));

      mockGetNode.mockImplementation((type: string) => {
        if (type === 'script-filter') return makeNodeDef({ type, execute: filterExecute });
        if (type === 'save-timeseries') return makeNodeDef({ type, execute: trueAction });
        if (type === 'log') return makeNodeDef({ type, execute: falseAction });
        return undefined;
      });

      const result = await executeRuleChain(
        { temp: 72 },
        {},
        'chain-1',
        defaultEntityContext,
      );

      expect(result.success).toBe(true);
      expect(result.nodesExecuted).toBe(2);
      expect(filterExecute).toHaveBeenCalledOnce();
      expect(trueAction).not.toHaveBeenCalled();
      expect(falseAction).toHaveBeenCalledOnce();
      expect(result.message).toEqual({ temp: 72, logged: true });
    });
  });

  // ═══════════════════════════════════════════════════════
  // Multi-node chain
  // ═══════════════════════════════════════════════════════

  describe('multi-node chain', () => {
    it('filter → transform → action executes all three nodes in sequence', async () => {
      const filterExec = vi.fn<NodeDefinition['execute']>().mockResolvedValue({
        output: 'True',
        message: { temp: 100 },
      });
      const transformExec = vi.fn<NodeDefinition['execute']>().mockResolvedValue({
        output: 'Success',
        message: { temp: 212 },
        metadata: { unit: 'fahrenheit' },
      });
      const actionExec = vi.fn<NodeDefinition['execute']>().mockResolvedValue({
        output: 'Success',
        message: { temp: 212, _saveAs: 'telemetry' },
      });

      mockFindUnique.mockResolvedValue(makeChainData({
        firstRuleNodeId: 'n-filter',
        nodes: [
          { id: 'n-filter', type: 'script-filter', name: 'Check Temp', configuration: { script: 'return msg.temp > 50;' }, debugEnabled: false },
          { id: 'n-transform', type: 'unit-conversion', name: 'C to F', configuration: {}, debugEnabled: false },
          { id: 'n-action', type: 'save-timeseries', name: 'Save', configuration: {}, debugEnabled: false },
        ],
        connections: [
          { fromNodeId: 'n-filter', toNodeId: 'n-transform', label: 'True' },
          { fromNodeId: 'n-transform', toNodeId: 'n-action', label: 'Success' },
        ],
      }));

      mockGetNode.mockImplementation((type: string) => {
        if (type === 'script-filter') return makeNodeDef({ type, execute: filterExec });
        if (type === 'unit-conversion') return makeNodeDef({ type, category: 'TRANSFORM', execute: transformExec });
        if (type === 'save-timeseries') return makeNodeDef({ type, category: 'ACTION', execute: actionExec });
        return undefined;
      });

      const result = await executeRuleChain(
        { temp: 100 },
        { source: 'mqtt' },
        'chain-1',
        defaultEntityContext,
      );

      expect(result.success).toBe(true);
      expect(result.nodesExecuted).toBe(3);
      expect(filterExec).toHaveBeenCalledOnce();
      expect(transformExec).toHaveBeenCalledOnce();
      expect(actionExec).toHaveBeenCalledOnce();
      expect(result.message).toEqual({ temp: 212, _saveAs: 'telemetry' });
      // Metadata should be merged
      expect(result.metadata).toEqual({ source: 'mqtt', unit: 'fahrenheit' });
    });
  });

  // ═══════════════════════════════════════════════════════
  // Node execution error → Failure connections
  // ═══════════════════════════════════════════════════════

  describe('node execution error', () => {
    it('routes to Failure connection when a node throws an error', async () => {
      const failingExec = vi.fn<NodeDefinition['execute']>().mockRejectedValue(
        new Error('Database timeout'),
      );
      const errorHandlerExec = vi.fn<NodeDefinition['execute']>().mockResolvedValue({
        output: 'Success',
        message: { error: 'handled' },
      });

      mockFindUnique.mockResolvedValue(makeChainData({
        firstRuleNodeId: 'n-fail',
        nodes: [
          { id: 'n-fail', type: 'save-timeseries', name: 'Save TS', configuration: {}, debugEnabled: false },
          { id: 'n-error-handler', type: 'log', name: 'Error Logger', configuration: {}, debugEnabled: false },
        ],
        connections: [
          { fromNodeId: 'n-fail', toNodeId: 'n-error-handler', label: 'Failure' },
        ],
      }));

      mockGetNode.mockImplementation((type: string) => {
        if (type === 'save-timeseries') return makeNodeDef({ type, category: 'ACTION', execute: failingExec });
        if (type === 'log') return makeNodeDef({ type, category: 'ACTION', execute: errorHandlerExec });
        return undefined;
      });

      const result = await executeRuleChain(
        { temp: 72 },
        {},
        'chain-1',
        defaultEntityContext,
      );

      // Has errors so success should be false
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('ERR_NODE_save-timeseries');
      expect(result.errors[0]).toContain('Database timeout');
      // Error handler was executed
      expect(errorHandlerExec).toHaveBeenCalledOnce();
      expect(result.nodesExecuted).toBe(2);
    });

    it('records error but stops branch when no Failure connection exists', async () => {
      const failingExec = vi.fn<NodeDefinition['execute']>().mockRejectedValue(
        new Error('Kaboom'),
      );

      mockFindUnique.mockResolvedValue(makeChainData({
        firstRuleNodeId: 'n-fail',
        nodes: [
          { id: 'n-fail', type: 'save-timeseries', name: 'Save', configuration: {}, debugEnabled: false },
        ],
        connections: [], // No Failure connection
      }));

      mockGetNode.mockImplementation((type: string) => {
        if (type === 'save-timeseries') return makeNodeDef({ type, execute: failingExec });
        return undefined;
      });

      const result = await executeRuleChain(
        { temp: 72 },
        {},
        'chain-1',
        defaultEntityContext,
      );

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Kaboom');
      expect(result.nodesExecuted).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════
  // Unknown node type
  // ═══════════════════════════════════════════════════════

  describe('unknown node type', () => {
    it('routes to Failure connections and records error for unknown node types', async () => {
      const errorHandlerExec = vi.fn<NodeDefinition['execute']>().mockResolvedValue({
        output: 'Success',
        message: { handled: true },
      });

      mockFindUnique.mockResolvedValue(makeChainData({
        firstRuleNodeId: 'n-unknown',
        nodes: [
          { id: 'n-unknown', type: 'nonexistent-type', name: 'Unknown', configuration: {}, debugEnabled: false },
          { id: 'n-handler', type: 'log', name: 'Handler', configuration: {}, debugEnabled: false },
        ],
        connections: [
          { fromNodeId: 'n-unknown', toNodeId: 'n-handler', label: 'Failure' },
        ],
      }));

      mockGetNode.mockImplementation((type: string) => {
        if (type === 'nonexistent-type') return undefined;
        if (type === 'log') return makeNodeDef({ type, category: 'ACTION', execute: errorHandlerExec });
        return undefined;
      });

      const result = await executeRuleChain(
        { temp: 72 },
        {},
        'chain-1',
        defaultEntityContext,
      );

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('ERR_NODE_TYPE_UNKNOWN');
      expect(result.errors[0]).toContain('nonexistent-type');
      // The error handler node should still be executed
      expect(errorHandlerExec).toHaveBeenCalledOnce();
      expect(result.nodesExecuted).toBe(1); // Only handler executed; unknown node is skipped
    });
  });

  // ═══════════════════════════════════════════════════════
  // Alarms collected from node results
  // ═══════════════════════════════════════════════════════

  describe('alarm collection', () => {
    it('collects alarms from node results into the final result', async () => {
      const alarmNode: AlarmAction = {
        entityId: 'entity-1',
        alarmType: 'HIGH_TEMP',
        severity: 'CRITICAL',
        details: { temp: 200 },
        clear: false,
      };

      const alarmExec = vi.fn<NodeDefinition['execute']>().mockResolvedValue({
        output: 'Success',
        message: { temp: 200 },
        alarms: [alarmNode],
      });

      mockFindUnique.mockResolvedValue(makeChainData({
        firstRuleNodeId: 'n-alarm',
        nodes: [
          { id: 'n-alarm', type: 'create-alarm', name: 'Create Alarm', configuration: {}, debugEnabled: false },
        ],
        connections: [],
      }));

      mockGetNode.mockReturnValue(makeNodeDef({ type: 'create-alarm', category: 'ACTION', execute: alarmExec }));

      const result = await executeRuleChain(
        { temp: 200 },
        {},
        'chain-1',
        defaultEntityContext,
      );

      expect(result.success).toBe(true);
      expect(result.alarms).toHaveLength(1);
      expect(result.alarms[0].alarmType).toBe('HIGH_TEMP');
      expect(result.alarms[0].severity).toBe('CRITICAL');
      expect(result.alarms[0].entityId).toBe('entity-1');
      expect(result.alarms[0].clear).toBe(false);
    });

    it('collects alarms from multiple nodes', async () => {
      const alarm1: AlarmAction = { entityId: 'entity-1', alarmType: 'HIGH_TEMP', severity: 'CRITICAL' };
      const alarm2: AlarmAction = { entityId: 'entity-1', alarmType: 'LOW_PRESSURE', severity: 'WARNING' };

      const node1Exec = vi.fn<NodeDefinition['execute']>().mockResolvedValue({
        output: 'Success',
        message: { temp: 200 },
        alarms: [alarm1],
      });
      const node2Exec = vi.fn<NodeDefinition['execute']>().mockResolvedValue({
        output: 'Success',
        message: { temp: 200, pressure: 10 },
        alarms: [alarm2],
      });

      mockFindUnique.mockResolvedValue(makeChainData({
        firstRuleNodeId: 'n1',
        nodes: [
          { id: 'n1', type: 'create-alarm', name: 'Alarm 1', configuration: {}, debugEnabled: false },
          { id: 'n2', type: 'create-alarm', name: 'Alarm 2', configuration: {}, debugEnabled: false },
        ],
        connections: [
          { fromNodeId: 'n1', toNodeId: 'n2', label: 'Success' },
        ],
      }));

      let callCount = 0;
      mockGetNode.mockReturnValue(makeNodeDef({
        type: 'create-alarm',
        category: 'ACTION',
        execute: (msg, config, ctx) => {
          callCount++;
          return callCount === 1 ? node1Exec(msg, config, ctx) : node2Exec(msg, config, ctx);
        },
      }));

      const result = await executeRuleChain(
        { temp: 200 },
        {},
        'chain-1',
        defaultEntityContext,
      );

      expect(result.alarms).toHaveLength(2);
      expect(result.alarms[0].alarmType).toBe('HIGH_TEMP');
      expect(result.alarms[1].alarmType).toBe('LOW_PRESSURE');
    });
  });

  // ═══════════════════════════════════════════════════════
  // Notifications collected from node results
  // ═══════════════════════════════════════════════════════

  describe('notification collection', () => {
    it('collects notifications from node results into the final result', async () => {
      const notification: NotificationAction = {
        type: 'RULE_CHAIN_ALERT',
        title: 'Temperature Alert',
        message: 'Temperature exceeded threshold',
        targetRole: 'ADMIN',
      };

      const notifExec = vi.fn<NodeDefinition['execute']>().mockResolvedValue({
        output: 'Success',
        message: { temp: 200 },
        notifications: [notification],
      });

      mockFindUnique.mockResolvedValue(makeChainData({
        firstRuleNodeId: 'n-notif',
        nodes: [
          { id: 'n-notif', type: 'send-notification', name: 'Send Notif', configuration: {}, debugEnabled: false },
        ],
        connections: [],
      }));

      mockGetNode.mockReturnValue(makeNodeDef({ type: 'send-notification', category: 'ACTION', execute: notifExec }));

      const result = await executeRuleChain(
        { temp: 200 },
        {},
        'chain-1',
        defaultEntityContext,
      );

      expect(result.success).toBe(true);
      expect(result.notifications).toHaveLength(1);
      expect(result.notifications[0].type).toBe('RULE_CHAIN_ALERT');
      expect(result.notifications[0].title).toBe('Temperature Alert');
      expect(result.notifications[0].targetRole).toBe('ADMIN');
    });
  });

  // ═══════════════════════════════════════════════════════
  // Debug recording
  // ═══════════════════════════════════════════════════════

  describe('debug recording', () => {
    it('calls recordDebug when node has debugEnabled: true', async () => {
      const nodeExec = vi.fn<NodeDefinition['execute']>().mockResolvedValue({
        output: 'Success',
        message: { temp: 72, processed: true },
      });

      mockFindUnique.mockResolvedValue(makeChainData({
        firstRuleNodeId: 'n-debug',
        nodes: [
          { id: 'n-debug', type: 'script-transform', name: 'Debug Transform', configuration: { script: 'return msg;' }, debugEnabled: true },
        ],
        connections: [],
      }));

      mockGetNode.mockReturnValue(makeNodeDef({ type: 'script-transform', category: 'TRANSFORM', execute: nodeExec }));

      await executeRuleChain(
        { temp: 72 },
        {},
        'chain-1',
        defaultEntityContext,
      );

      expect(mockRecordDebug).toHaveBeenCalledOnce();
      expect(mockRecordDebug).toHaveBeenCalledWith(
        'chain-1',
        expect.objectContaining({
          nodeId: 'n-debug',
          nodeType: 'script-transform',
          nodeName: 'Debug Transform',
          inputMsg: { temp: 72 },
          outputMsg: { temp: 72, processed: true },
          output: 'Success',
          durationMs: expect.any(Number),
          timestamp: expect.any(String),
        }),
      );
    });

    it('does NOT call recordDebug when node has debugEnabled: false', async () => {
      const nodeExec = vi.fn<NodeDefinition['execute']>().mockResolvedValue({
        output: 'Success',
        message: { temp: 72 },
      });

      mockFindUnique.mockResolvedValue(makeChainData({
        firstRuleNodeId: 'n-no-debug',
        nodes: [
          { id: 'n-no-debug', type: 'script-transform', name: 'No Debug', configuration: {}, debugEnabled: false },
        ],
        connections: [],
      }));

      mockGetNode.mockReturnValue(makeNodeDef({ type: 'script-transform', execute: nodeExec }));

      await executeRuleChain(
        { temp: 72 },
        {},
        'chain-1',
        defaultEntityContext,
      );

      expect(mockRecordDebug).not.toHaveBeenCalled();
    });

    it('calls recordDebug with error details when node throws and debugEnabled is true', async () => {
      const failingExec = vi.fn<NodeDefinition['execute']>().mockRejectedValue(
        new Error('Transform failed'),
      );

      mockFindUnique.mockResolvedValue(makeChainData({
        firstRuleNodeId: 'n-debug-err',
        nodes: [
          { id: 'n-debug-err', type: 'script-transform', name: 'Debug Err', configuration: {}, debugEnabled: true },
        ],
        connections: [],
      }));

      mockGetNode.mockReturnValue(makeNodeDef({ type: 'script-transform', execute: failingExec }));

      await executeRuleChain(
        { temp: 72 },
        {},
        'chain-1',
        defaultEntityContext,
      );

      expect(mockRecordDebug).toHaveBeenCalledOnce();
      expect(mockRecordDebug).toHaveBeenCalledWith(
        'chain-1',
        expect.objectContaining({
          nodeId: 'n-debug-err',
          nodeType: 'script-transform',
          nodeName: 'Debug Err',
          output: 'Failure',
          error: 'Transform failed',
          inputMsg: { temp: 72 },
          outputMsg: { temp: 72 }, // On error, outputMsg is same as inputMsg
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════
  // Node not found in chain map
  // ═══════════════════════════════════════════════════════

  describe('node not found in chain', () => {
    it('records ERR_NODE_NOT_FOUND when a connection points to a missing nodeId', async () => {
      const filterExec = vi.fn<NodeDefinition['execute']>().mockResolvedValue({
        output: 'True',
        message: { temp: 72 },
      });

      mockFindUnique.mockResolvedValue(makeChainData({
        firstRuleNodeId: 'n-filter',
        nodes: [
          // Only the filter node exists — 'n-missing' is NOT in the nodes array
          { id: 'n-filter', type: 'script-filter', name: 'Filter', configuration: {}, debugEnabled: false },
        ],
        connections: [
          { fromNodeId: 'n-filter', toNodeId: 'n-missing', label: 'True' },
        ],
      }));

      mockGetNode.mockReturnValue(makeNodeDef({ type: 'script-filter', execute: filterExec }));

      const result = await executeRuleChain(
        { temp: 72 },
        {},
        'chain-1',
        defaultEntityContext,
      );

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('ERR_NODE_NOT_FOUND');
      expect(result.errors[0]).toContain('n-missing');
      expect(result.nodesExecuted).toBe(1); // Only the filter node executed
    });
  });

  // ═══════════════════════════════════════════════════════
  // Branching chain — fan-out
  // ═══════════════════════════════════════════════════════

  describe('branching chain', () => {
    it('executes multiple downstream nodes when output has multiple matching connections', async () => {
      const inputExec = vi.fn<NodeDefinition['execute']>().mockResolvedValue({
        output: 'Success',
        message: { temp: 72 },
      });
      const branch1Exec = vi.fn<NodeDefinition['execute']>().mockResolvedValue({
        output: 'Success',
        message: { temp: 72, branch: 1 },
      });
      const branch2Exec = vi.fn<NodeDefinition['execute']>().mockResolvedValue({
        output: 'Success',
        message: { temp: 72, branch: 2 },
      });

      mockFindUnique.mockResolvedValue(makeChainData({
        firstRuleNodeId: 'n-input',
        nodes: [
          { id: 'n-input', type: 'input', name: 'Input', configuration: {}, debugEnabled: false },
          { id: 'n-branch1', type: 'save-timeseries', name: 'Branch 1', configuration: {}, debugEnabled: false },
          { id: 'n-branch2', type: 'log', name: 'Branch 2', configuration: {}, debugEnabled: false },
        ],
        connections: [
          // Two connections with the same label from the same node = fan-out
          { fromNodeId: 'n-input', toNodeId: 'n-branch1', label: 'Success' },
          { fromNodeId: 'n-input', toNodeId: 'n-branch2', label: 'Success' },
        ],
      }));

      mockGetNode.mockImplementation((type: string) => {
        if (type === 'input') return makeNodeDef({ type, category: 'INPUT', execute: inputExec });
        if (type === 'save-timeseries') return makeNodeDef({ type, category: 'ACTION', execute: branch1Exec });
        if (type === 'log') return makeNodeDef({ type, category: 'ACTION', execute: branch2Exec });
        return undefined;
      });

      const result = await executeRuleChain(
        { temp: 72 },
        {},
        'chain-1',
        defaultEntityContext,
      );

      expect(result.success).toBe(true);
      expect(result.nodesExecuted).toBe(3);
      expect(inputExec).toHaveBeenCalledOnce();
      expect(branch1Exec).toHaveBeenCalledOnce();
      expect(branch2Exec).toHaveBeenCalledOnce();
    });
  });

  // ═══════════════════════════════════════════════════════
  // Cache behavior
  // ═══════════════════════════════════════════════════════

  describe('cache behavior', () => {
    it('does not call DB again for the same chainId on second execution (cache hit)', async () => {
      const nodeExec = vi.fn<NodeDefinition['execute']>().mockResolvedValue({
        output: 'Success',
        message: { temp: 72 },
      });

      mockFindUnique.mockResolvedValue(makeChainData({
        firstRuleNodeId: 'n1',
        nodes: [
          { id: 'n1', type: 'input', name: 'Input', configuration: {}, debugEnabled: false },
        ],
        connections: [],
      }));

      mockGetNode.mockReturnValue(makeNodeDef({ type: 'input', category: 'INPUT', execute: nodeExec }));

      // First call — loads from DB
      await executeRuleChain({ temp: 72 }, {}, 'chain-cached', defaultEntityContext);
      expect(mockFindUnique).toHaveBeenCalledTimes(1);

      // Second call — should use cache
      await executeRuleChain({ temp: 80 }, {}, 'chain-cached', defaultEntityContext);
      expect(mockFindUnique).toHaveBeenCalledTimes(1); // Still only 1 DB call
    });
  });
});

// ═══════════════════════════════════════════════════════
// invalidateChainCache
// ═══════════════════════════════════════════════════════

describe('Rule Engine — invalidateChainCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfigOrDefault.mockResolvedValue(10);
    invalidateChainCache(); // Start with clean cache
  });

  it('invalidates a specific chain so the next call fetches from DB', async () => {
    const nodeExec = vi.fn<NodeDefinition['execute']>().mockResolvedValue({
      output: 'Success',
      message: { temp: 72 },
    });

    mockFindUnique.mockResolvedValue(makeChainData({
      id: 'chain-specific',
      firstRuleNodeId: 'n1',
      nodes: [
        { id: 'n1', type: 'input', name: 'Input', configuration: {}, debugEnabled: false },
      ],
      connections: [],
    }));

    mockGetNode.mockReturnValue(makeNodeDef({ type: 'input', category: 'INPUT', execute: nodeExec }));

    // First call — DB fetch
    await executeRuleChain({ temp: 72 }, {}, 'chain-specific', defaultEntityContext);
    expect(mockFindUnique).toHaveBeenCalledTimes(1);

    // Invalidate just this chain
    invalidateChainCache('chain-specific');

    // Second call — should fetch from DB again
    await executeRuleChain({ temp: 72 }, {}, 'chain-specific', defaultEntityContext);
    expect(mockFindUnique).toHaveBeenCalledTimes(2);
  });

  it('invalidates all chains when called without arguments', async () => {
    const nodeExec = vi.fn<NodeDefinition['execute']>().mockResolvedValue({
      output: 'Success',
      message: { temp: 72 },
    });

    mockFindUnique.mockResolvedValue(makeChainData({
      firstRuleNodeId: 'n1',
      nodes: [
        { id: 'n1', type: 'input', name: 'Input', configuration: {}, debugEnabled: false },
      ],
      connections: [],
    }));

    mockGetNode.mockReturnValue(makeNodeDef({ type: 'input', category: 'INPUT', execute: nodeExec }));

    // Populate cache for two chains
    await executeRuleChain({ temp: 72 }, {}, 'chain-a', defaultEntityContext);
    await executeRuleChain({ temp: 72 }, {}, 'chain-b', defaultEntityContext);
    expect(mockFindUnique).toHaveBeenCalledTimes(2);

    // Invalidate all
    invalidateChainCache();

    // Both should fetch from DB again
    await executeRuleChain({ temp: 72 }, {}, 'chain-a', defaultEntityContext);
    await executeRuleChain({ temp: 72 }, {}, 'chain-b', defaultEntityContext);
    expect(mockFindUnique).toHaveBeenCalledTimes(4);
  });
});
