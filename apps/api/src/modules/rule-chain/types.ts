/**
 * Rule Chain Engine — Shared types and interfaces.
 */

export interface RuleNodeConfig {
  [key: string]: unknown;
}

export interface NodeContext {
  entityId: string;
  entityName: string;
  templateId: string;
  unsPath: string;
  metadata: Record<string, string>;
  chainDepth: number;
  maxChainDepth: number;
  debugEnabled: boolean;
}

export type NodeOutput = 'Success' | 'Failure' | 'True' | 'False' | string;

export interface NodeResult {
  output: NodeOutput;
  message: Record<string, unknown>;
  metadata?: Record<string, string>;
  alarms?: AlarmAction[];
  notifications?: NotificationAction[];
  log?: string;
}

export interface AlarmAction {
  entityId: string;
  alarmType: string;
  severity: string;
  details?: Record<string, unknown>;
  clear?: boolean; // true = clear alarm, false = create
}

export interface NotificationAction {
  type: string;
  title: string;
  message: string;
  targetRole?: string;
  metadata?: Record<string, unknown>;
}

export interface NodeDefinition {
  type: string;
  category: 'INPUT' | 'FILTER' | 'ENRICHMENT' | 'TRANSFORM' | 'ACTION' | 'EXTERNAL' | 'FLOW';
  name: string;
  description: string;
  outputs: string[];
  defaultConfig: RuleNodeConfig;
  execute: (
    message: Record<string, unknown>,
    config: RuleNodeConfig,
    ctx: NodeContext,
  ) => Promise<NodeResult>;
}

export interface RuleEngineResult {
  success: boolean;
  message: Record<string, unknown>;
  metadata: Record<string, string>;
  alarms: AlarmAction[];
  notifications: NotificationAction[];
  errors: string[];
  nodesExecuted: number;
  durationMs: number;
}

export interface DebugRecord {
  nodeId: string;
  nodeType: string;
  nodeName: string;
  inputMsg: Record<string, unknown>;
  outputMsg: Record<string, unknown>;
  output: string;
  durationMs: number;
  timestamp: string;
  error?: string;
}
