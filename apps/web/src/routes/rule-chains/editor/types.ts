// ---------------------------------------------------------------------------
// Shared types for the rule-chain visual editor
// ---------------------------------------------------------------------------

export interface RuleChain {
  id: string;
  name: string;
  description?: string;
  isRoot: boolean;
  isSystem: boolean;
  firstRuleNodeId?: string;
  currentVersion: number;
  isActive: boolean;
  nodes: RuleNode[];
  connections: RuleNodeConnection[];
}

export interface RuleNode {
  id: string;
  ruleChainId: string;
  type: string;
  name: string;
  configuration: Record<string, any>;
  debugEnabled: boolean;
  positionX: number;
  positionY: number;
}

export interface RuleNodeConnection {
  id: string;
  ruleChainId: string;
  fromNodeId: string;
  toNodeId: string;
  label: string;
}

export interface NodeType {
  type: string;
  name: string;
  category: string;
  description: string;
  configSchema?: Record<string, any>;
  outputs: string[];
}

export interface DebugEvent {
  id: string;
  nodeId: string;
  nodeType: string;
  nodeName: string;
  inputMsg: any;
  outputMsg: any;
  output: string;
  durationMs: number;
  timestamp: string;
  error?: string;
}

export interface CustomNodeData {
  label: string;
  nodeType: string;
  category: string;
  debugEnabled: boolean;
  isFirst: boolean;
  selected: boolean;
}
