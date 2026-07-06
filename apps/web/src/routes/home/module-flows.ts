import type { ModuleFlow, ModuleCategory } from './types';

export const CATEGORY_ORDER: ModuleCategory[] = [
  'Operations', 'Governance & Compliance', 'Admin', 'Reports', 'System',
];

export const MODULE_FLOWS: ModuleFlow[] = [
  {
    id: 'filter-operations',
    title: 'Filter Operations',
    category: 'Operations',
    summary: 'Run a filter through its cleaning cycle: start, wash, dry, store, with checklists gating each advance.',
    steps: [
      { label: 'Start Cleaning Cycle', kind: 'action', gate: ['FILTER_OPERATE'],
        description: 'Select a cleaning reason and profile; profile is locked for the whole cycle.' },
      { label: 'Wash In / Wash Out', kind: 'action', gate: ['FILTER_OPERATE'] },
      { label: 'Submit Checklist', kind: 'decision', gate: ['FILTER_OPERATE'],
        description: 'Server blocks advance until the pending checklist is complete.',
        branch: { label: 'Bypass stage (records a deviation)', gate: ['FILTER_BYPASS'] } },
      { label: 'Dry In → set duration → Dry Out', kind: 'action', gate: ['FILTER_OPERATE'],
        description: 'Dryer duration is set and a countdown runs before Dry Out.' },
      { label: 'Storage In / Storage Out', kind: 'action', gate: ['FILTER_OPERATE'] },
      { label: 'Cycle auto-completes at the last stage', kind: 'system', gate: [],
        description: 'When the final STAGE leads to the END node the cycle closes automatically.',
        // Terminate is available throughout as an operator-initiated branch.
      },
      { label: 'Terminate cycle early (with reason)', kind: 'decision', gate: ['FILTER_OPERATE'],
        description: 'Optional off-ramp at any point; requires a reason.' },
    ],
  },
];
