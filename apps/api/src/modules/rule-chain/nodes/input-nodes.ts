/**
 * Input Node Registrations
 */

import { registerNode } from '../node-registry.js';
import type { NodeResult } from '../types.js';

export function registerInputNodes(): void {

registerNode({
  type: 'input',
  category: 'INPUT',
  name: 'Input',
  description: 'Entry point for the rule chain. Passes message through.',
  outputs: ['Success'],
  defaultConfig: {},
  async execute(message, _config, _ctx): Promise<NodeResult> {
    return { output: 'Success', message };
  },
});

}
