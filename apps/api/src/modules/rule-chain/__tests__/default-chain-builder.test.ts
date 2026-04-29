import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Prisma Mock Setup ─────────────────────────────────────

const {
  mockCreate, mockUpdate, mockFindUniqueOrThrow,
  mockNodeCreate, mockNodeDeleteMany,
  mockConnectionCreate, mockConnectionDeleteMany,
  mockVersionCreate, mockVersionUpdateMany,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockFindUniqueOrThrow: vi.fn(),
  mockNodeCreate: vi.fn(),
  mockNodeDeleteMany: vi.fn(),
  mockConnectionCreate: vi.fn(),
  mockConnectionDeleteMany: vi.fn(),
  mockVersionCreate: vi.fn(),
  mockVersionUpdateMany: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    $transaction: vi.fn().mockImplementation(async (fn: Function) => {
      const tx = {
        ruleChain: {
          create: mockCreate,
          update: mockUpdate,
          findUniqueOrThrow: mockFindUniqueOrThrow,
        },
        ruleNode: { create: mockNodeCreate, deleteMany: mockNodeDeleteMany },
        ruleNodeConnection: { create: mockConnectionCreate, deleteMany: mockConnectionDeleteMany },
        ruleChainVersion: { create: mockVersionCreate, updateMany: mockVersionUpdateMany },
      };
      return fn(tx);
    }),
  },
}));

import { createDefaultRuleChain, updateDefaultRuleChain } from '../default-chain-builder.js';

// ─── Helpers ────────────────────────────────────────────────

let nodeCounter = 0;
let connCounter = 0;

function resetMocks() {
  nodeCounter = 0;
  connCounter = 0;

  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockFindUniqueOrThrow.mockReset();
  mockNodeCreate.mockReset();
  mockNodeDeleteMany.mockReset();
  mockConnectionCreate.mockReset();
  mockConnectionDeleteMany.mockReset();
  mockVersionCreate.mockReset();
  mockVersionUpdateMany.mockReset();

  // ruleChain.create returns an object with id and currentVersion
  mockCreate.mockResolvedValue({ id: 'chain-1', currentVersion: 1 });

  // ruleChain.update returns a minimal chain object
  mockUpdate.mockResolvedValue({ id: 'chain-1' });

  // ruleNode.create returns an object with a sequential id + the input fields
  mockNodeCreate.mockImplementation(async ({ data }) => {
    nodeCounter++;
    return {
      id: `node-${nodeCounter}`,
      type: data.type,
      name: data.name,
      configuration: data.configuration,
      positionX: data.positionX,
      positionY: data.positionY,
    };
  });

  // ruleNodeConnection.create returns an object with a sequential id + the input fields
  mockConnectionCreate.mockImplementation(async ({ data }) => {
    connCounter++;
    return {
      id: `conn-${connCounter}`,
      fromNodeId: data.fromNodeId,
      toNodeId: data.toNodeId,
      label: data.label,
    };
  });

  // deleteMany returns a count
  mockNodeDeleteMany.mockResolvedValue({ count: 0 });
  mockConnectionDeleteMany.mockResolvedValue({ count: 0 });

  // version create/updateMany
  mockVersionCreate.mockResolvedValue({ id: 'ver-1' });
  mockVersionUpdateMany.mockResolvedValue({ count: 0 });
}

// ─── Sample Alarm Rules ─────────────────────────────────────

const singleAlarmRule = [
  {
    name: 'High Temperature',
    type: 'HIGH',
    severity: 'CRITICAL',
    sourceField: 'temp',
    condition: '>',
    threshold: 100,
    deadband: 2,
    message: 'Temperature exceeded limit',
    notifyRoles: ['ADMIN'],
    enabled: true,
  },
];

const twoAlarmRules = [
  {
    name: 'High Temperature',
    type: 'HIGH',
    severity: 'CRITICAL',
    sourceField: 'temp',
    condition: '>',
    threshold: 100,
  },
  {
    name: 'Low Pressure',
    type: 'LOW',
    severity: 'WARNING',
    sourceField: 'pressure',
    condition: '<',
    threshold: 10,
  },
];

// ═══════════════════════════════════════════════════════════
// createDefaultRuleChain Tests
// ═══════════════════════════════════════════════════════════

describe('createDefaultRuleChain', () => {
  beforeEach(() => {
    resetMocks();
  });

  // ── Test 1: Returns null when no alarm rules provided ────

  it('returns null when alarmRules is undefined', async () => {
    const result = await createDefaultRuleChain('tpl-1', 'Reactor');
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // ── Test 2: Returns null when alarm rules is empty array ─

  it('returns null when alarmRules is an empty array', async () => {
    const result = await createDefaultRuleChain('tpl-1', 'Reactor', []);
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // ── Test 3: Creates chain with valid alarm rules ─────────

  it('creates a rule chain via transaction with valid alarm rules', async () => {
    const result = await createDefaultRuleChain('tpl-1', 'Reactor', singleAlarmRule);

    expect(result).toBe('chain-1');

    // Chain was created with correct name and metadata
    expect(mockCreate).toHaveBeenCalledOnce();
    const createArg = mockCreate.mock.calls[0][0];
    expect(createArg.data.name).toBe('Default: Reactor');
    expect(createArg.data.description).toContain('Reactor');
    expect(createArg.data.isRoot).toBe(true);
    expect(createArg.data.isSystem).toBe(true);
    expect(createArg.data.currentVersion).toBe(1);
    expect((createArg.data.configuration as Record<string, unknown>).templateId).toBe('tpl-1');
  });

  // ── Test 4: Creates input + filter + alarm + save nodes ──

  it('creates input, script-filter, create-alarm, clear-alarm, and save-timeseries for one alarm rule', async () => {
    await createDefaultRuleChain('tpl-1', 'Reactor', singleAlarmRule);

    // 1 alarm rule => 5 nodes: input, filter, create-alarm, clear-alarm, save
    expect(mockNodeCreate).toHaveBeenCalledTimes(5);

    const nodeTypes = mockNodeCreate.mock.calls.map(
      (call) => call[0].data.type,
    );
    expect(nodeTypes).toEqual([
      'input',
      'script-filter',
      'create-alarm',
      'clear-alarm',
      'save-timeseries',
    ]);

    const nodeNames = mockNodeCreate.mock.calls.map(
      (call) => call[0].data.name,
    );
    expect(nodeNames).toEqual([
      'Input',
      'Filter: High Temperature',
      'Alarm: High Temperature',
      'Clear: High Temperature',
      'Save Timeseries',
    ]);
  });

  // ── Test 5: Creates correct connections ───────────────────

  it('creates connections between nodes in the correct topology', async () => {
    await createDefaultRuleChain('tpl-1', 'Reactor', singleAlarmRule);

    // 1 alarm rule => 6 connections:
    //   input -> filter (Success)
    //   filter -> alarm (True)
    //   filter -> clear (False)
    //   input -> save (Success)
    //   alarm -> save (Success)
    //   clear -> save (Success)
    expect(mockConnectionCreate).toHaveBeenCalledTimes(6);

    const connections = mockConnectionCreate.mock.calls.map((call) => ({
      from: call[0].data.fromNodeId,
      to: call[0].data.toNodeId,
      label: call[0].data.label,
    }));

    // node-1 input, node-2 filter, node-3 alarm, node-4 clear, node-5 save
    expect(connections[0]).toEqual({ from: 'node-1', to: 'node-2', label: 'Success' });
    expect(connections[1]).toEqual({ from: 'node-2', to: 'node-3', label: 'True' });
    expect(connections[2]).toEqual({ from: 'node-2', to: 'node-4', label: 'False' });
    expect(connections[3]).toEqual({ from: 'node-1', to: 'node-5', label: 'Success' });
    expect(connections[4]).toEqual({ from: 'node-3', to: 'node-5', label: 'Success' });
    expect(connections[5]).toEqual({ from: 'node-4', to: 'node-5', label: 'Success' });
  });

  // ── Test 6: Creates version 1 snapshot ────────────────────

  it('creates version 1 snapshot with ACTIVE status and SYSTEM author', async () => {
    await createDefaultRuleChain('tpl-1', 'Reactor', singleAlarmRule);

    expect(mockVersionCreate).toHaveBeenCalledOnce();
    const versionArg = mockVersionCreate.mock.calls[0][0];

    expect(versionArg.data.ruleChainId).toBe('chain-1');
    expect(versionArg.data.version).toBe(1);
    expect(versionArg.data.status).toBe('ACTIVE');
    expect(versionArg.data.createdBy).toBe('SYSTEM');
    expect(versionArg.data.changeNotes).toContain('Auto-generated');

    // Snapshot contains chain metadata, nodes, and connections
    const snapshot = versionArg.data.snapshot as Record<string, unknown>;
    expect(snapshot.chainId).toBe('chain-1');
    expect(snapshot.name).toBe('Default: Reactor');
    expect(snapshot.version).toBe(1);
    expect(snapshot.firstRuleNodeId).toBe('node-1');
    expect((snapshot.nodes as unknown[]).length).toBe(5);
    expect((snapshot.connections as unknown[]).length).toBe(6);
  });

  // ── Test 8: Invalid alarm rule entries are filtered out ───

  it('filters out invalid alarm rule entries and returns null if none remain', async () => {
    const invalid = [
      42,                          // not an object
      null,                        // null
      { name: 'OnlyName' },        // missing type
      { type: 'HIGH' },            // missing name
      'string-entry',              // not an object
      { name: 123, type: 'HIGH' }, // name is not a string
    ];

    const result = await createDefaultRuleChain('tpl-1', 'Reactor', invalid);
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('filters out invalid entries but processes valid ones', async () => {
    const mixed = [
      null,
      { name: 'Valid Alarm', type: 'HIGH', severity: 'WARNING' },
      42,
    ];

    const result = await createDefaultRuleChain('tpl-1', 'Reactor', mixed);

    expect(result).toBe('chain-1');
    // 1 valid alarm rule => 5 nodes (input, filter, alarm, clear, save)
    expect(mockNodeCreate).toHaveBeenCalledTimes(5);
  });

  it('creates 8 nodes and 11 connections for two alarm rules', async () => {
    await createDefaultRuleChain('tpl-1', 'Reactor', twoAlarmRules);

    // 2 alarm rules => 8 nodes: input + (filter, create-alarm, clear-alarm)*2 + save
    expect(mockNodeCreate).toHaveBeenCalledTimes(8);

    const nodeTypes = mockNodeCreate.mock.calls.map((call) => call[0].data.type);
    expect(nodeTypes).toEqual([
      'input',
      'script-filter', 'create-alarm', 'clear-alarm',
      'script-filter', 'create-alarm', 'clear-alarm',
      'save-timeseries',
    ]);

    // 2 alarm rules => 11 connections:
    //   per rule (3): input->filter (Success), filter->alarm (True), filter->clear (False)
    //   shared (1):   input->save (Success)
    //   per rule (2): alarm->save (Success), clear->save (Success)
    //   total = 3*2 + 1 + 2*2 = 11
    expect(mockConnectionCreate).toHaveBeenCalledTimes(11);
  });

  it('sets firstRuleNodeId to the input node after creation', async () => {
    await createDefaultRuleChain('tpl-1', 'Reactor', singleAlarmRule);

    // The update call sets firstRuleNodeId to node-1 (the input node)
    expect(mockUpdate).toHaveBeenCalledOnce();
    const updateArg = mockUpdate.mock.calls[0][0];
    expect(updateArg.where.id).toBe('chain-1');
    expect(updateArg.data.firstRuleNodeId).toBe('node-1');
  });

  it('builds correct filter configuration from alarm rule fields', async () => {
    await createDefaultRuleChain('tpl-1', 'Reactor', singleAlarmRule);

    // Second node is the script-filter
    const filterConfig = mockNodeCreate.mock.calls[1][0].data.configuration;
    expect(filterConfig.script).toBe("return msg['temp'] > 100;");
    expect(filterConfig.sourceField).toBe('temp');
    expect(filterConfig.condition).toBe('>');
    expect(filterConfig.threshold).toBe(100);
    expect(filterConfig.alarmType).toBe('HIGH');
    expect(filterConfig.alarmName).toBe('High Temperature');
  });

  it('builds correct alarm configuration from alarm rule fields', async () => {
    await createDefaultRuleChain('tpl-1', 'Reactor', singleAlarmRule);

    // Third node is the create-alarm
    const alarmConfig = mockNodeCreate.mock.calls[2][0].data.configuration;
    expect(alarmConfig.alarmType).toBe('High Temperature');
    expect(alarmConfig.severity).toBe('CRITICAL');
    expect(alarmConfig.ruleType).toBe('HIGH');
    expect(alarmConfig.sourceField).toBe('temp');
    expect(alarmConfig.condition).toBe('>');
    expect(alarmConfig.threshold).toBe(100);
    expect(alarmConfig.deadband).toBe(2);
    expect(alarmConfig.message).toBe('Temperature exceeded limit');
    expect(alarmConfig.notifyRoles).toEqual(['ADMIN']);
    expect(alarmConfig.enabled).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// updateDefaultRuleChain Tests
// ═══════════════════════════════════════════════════════════

describe('updateDefaultRuleChain', () => {
  beforeEach(() => {
    resetMocks();
  });

  // ── Test 7: updateDefaultRuleChain increments version ─────

  it('increments the version number from the existing chain', async () => {
    // Existing chain is at version 3
    mockFindUniqueOrThrow.mockResolvedValue({ id: 'chain-1', currentVersion: 3 });

    await updateDefaultRuleChain('chain-1', 'Reactor', singleAlarmRule);

    // Chain update should set currentVersion to 4
    // The second update call is the one that sets name + firstRuleNodeId + currentVersion
    // (first update clears firstRuleNodeId)
    const updateCalls = mockUpdate.mock.calls;
    const finalUpdate = updateCalls[updateCalls.length - 1][0];
    expect(finalUpdate.data.currentVersion).toBe(4);
    expect(finalUpdate.data.name).toBe('Default: Reactor');
  });

  it('deletes existing connections and nodes before recreating', async () => {
    mockFindUniqueOrThrow.mockResolvedValue({ id: 'chain-1', currentVersion: 1 });

    await updateDefaultRuleChain('chain-1', 'Reactor', singleAlarmRule);

    // Connections deleted first (FK constraint order)
    expect(mockConnectionDeleteMany).toHaveBeenCalledOnce();
    expect(mockConnectionDeleteMany.mock.calls[0][0].where.ruleChainId).toBe('chain-1');

    // Then nodes deleted
    expect(mockNodeDeleteMany).toHaveBeenCalledOnce();
    expect(mockNodeDeleteMany.mock.calls[0][0].where.ruleChainId).toBe('chain-1');
  });

  it('marks previous ACTIVE versions as SUPERSEDED', async () => {
    mockFindUniqueOrThrow.mockResolvedValue({ id: 'chain-1', currentVersion: 2 });

    await updateDefaultRuleChain('chain-1', 'Reactor', singleAlarmRule);

    expect(mockVersionUpdateMany).toHaveBeenCalledOnce();
    const updateManyArg = mockVersionUpdateMany.mock.calls[0][0];
    expect(updateManyArg.where.ruleChainId).toBe('chain-1');
    expect(updateManyArg.where.status).toBe('ACTIVE');
    expect(updateManyArg.data.status).toBe('SUPERSEDED');
  });

  it('creates a new version snapshot with incremented version number', async () => {
    mockFindUniqueOrThrow.mockResolvedValue({ id: 'chain-1', currentVersion: 5 });

    await updateDefaultRuleChain('chain-1', 'Reactor', singleAlarmRule);

    expect(mockVersionCreate).toHaveBeenCalledOnce();
    const versionArg = mockVersionCreate.mock.calls[0][0];
    expect(versionArg.data.version).toBe(6);
    expect(versionArg.data.status).toBe('ACTIVE');
    expect(versionArg.data.createdBy).toBe('SYSTEM');
    expect(versionArg.data.changeNotes).toContain('v6');

    const snapshot = versionArg.data.snapshot as Record<string, unknown>;
    expect(snapshot.version).toBe(6);
    expect(snapshot.name).toBe('Default: Reactor');
  });

  it('clears firstRuleNodeId before recreating nodes', async () => {
    mockFindUniqueOrThrow.mockResolvedValue({ id: 'chain-1', currentVersion: 1 });

    await updateDefaultRuleChain('chain-1', 'Reactor', singleAlarmRule);

    // The first update call clears firstRuleNodeId
    const firstUpdate = mockUpdate.mock.calls[0][0];
    expect(firstUpdate.where.id).toBe('chain-1');
    expect(firstUpdate.data.firstRuleNodeId).toBeNull();
  });

  it('recreates all nodes and connections for updated alarm rules', async () => {
    mockFindUniqueOrThrow.mockResolvedValue({ id: 'chain-1', currentVersion: 1 });

    await updateDefaultRuleChain('chain-1', 'Reactor', twoAlarmRules);

    // 2 rules => 8 nodes, 11 connections (matching the create path topology)
    expect(mockNodeCreate).toHaveBeenCalledTimes(8);
    expect(mockConnectionCreate).toHaveBeenCalledTimes(11);
  });

  it('handles empty alarm rules by building a graph with only input and save nodes', async () => {
    mockFindUniqueOrThrow.mockResolvedValue({ id: 'chain-1', currentVersion: 1 });

    await updateDefaultRuleChain('chain-1', 'Reactor', []);

    // 0 alarm rules => 2 nodes: input + save-timeseries
    expect(mockNodeCreate).toHaveBeenCalledTimes(2);

    const nodeTypes = mockNodeCreate.mock.calls.map((call) => call[0].data.type);
    expect(nodeTypes).toEqual(['input', 'save-timeseries']);

    // 0 alarm rules => 1 connection: input -> save
    expect(mockConnectionCreate).toHaveBeenCalledTimes(1);
    const conn = mockConnectionCreate.mock.calls[0][0].data;
    expect(conn.fromNodeId).toBe('node-1');
    expect(conn.toNodeId).toBe('node-2');
    expect(conn.label).toBe('Success');
  });
});
