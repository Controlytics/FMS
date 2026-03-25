/**
 * Flow Node Registrations
 */

import { registerNode } from '../node-registry.js';
import type { NodeResult } from '../types.js';

export function registerFlowNodes(): void {

registerNode({
  type: 'rule-chain-input',
  category: 'FLOW',
  name: 'Rule Chain Input',
  description: 'Enter another rule chain (increments depth counter).',
  outputs: ['Success', 'Failure'],
  defaultConfig: { targetChainId: '' },
  configSchema: {
    targetChainId: {
      type: 'rule-chain-select',
      label: 'Target Rule Chain',
      description: 'Select the rule chain to delegate execution to.',
    },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    const targetChainId = config.targetChainId as string;
    if (!targetChainId) return { output: 'Failure', message, log: 'No target chain ID configured' };
    if (ctx.chainDepth >= ctx.maxChainDepth) return { output: 'Failure', message, log: 'Max chain depth exceeded' };
    return { output: 'Success', message: { ...message, _delegateChain: targetChainId, _chainDepth: ctx.chainDepth + 1 } };
  },
});

registerNode({
  type: 'checkpoint',
  category: 'FLOW',
  name: 'Checkpoint',
  description: 'Force-save current state before continuing.',
  outputs: ['Success', 'Failure'],
  defaultConfig: {},
  async execute(message, _config, _ctx): Promise<NodeResult> {
    return { output: 'Success', message: { ...message, _checkpoint: true } };
  },
});

registerNode({
  type: 'delay',
  category: 'FLOW',
  name: 'Delay',
  description: 'Wait N milliseconds then continue.',
  outputs: ['Success'],
  defaultConfig: { delayMs: 1000, maxDelayMs: 10000 },
  configSchema: {
    delayMs: { type: 'number', label: 'Delay (ms)', description: 'Delay duration in milliseconds.' },
    maxDelayMs: { type: 'number', label: 'Max Delay (ms)', description: 'Maximum delay cap in milliseconds.' },
  },
  async execute(message, config, _ctx): Promise<NodeResult> {
    const delayMs = Math.min((config.delayMs as number) ?? 1000, (config.maxDelayMs as number) ?? 10000);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return { output: 'Success', message };
  },
});

registerNode({
  type: 'acknowledge',
  category: 'FLOW',
  name: 'Acknowledge',
  description: 'Mark message as acknowledged (stop further processing on this branch).',
  outputs: [],
  defaultConfig: {},
  async execute(message, _config, _ctx): Promise<NodeResult> {
    return { output: 'Success', message: { ...message, _acknowledged: true } };
  },
});

registerNode({
  type: 'output',
  category: 'FLOW',
  name: 'Output',
  description: 'Terminal node that marks the end of a sub-chain and returns the message to the parent chain.',
  outputs: [],
  defaultConfig: { outputName: 'default' },
  configSchema: {
    outputName: { type: 'string', label: 'Output Name', description: 'Name for this output point (used by parent chain to route).' },
  },
  async execute(message, config, _ctx): Promise<NodeResult> {
    return { output: 'Success', message: { ...message, _subChainOutput: config.outputName ?? 'default' } };
  },
});

}
