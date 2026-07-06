import type { Permission } from '@digilog/shared';

export type StepKind = 'action' | 'decision' | 'system';

export type ModuleCategory =
  | 'Operations'
  | 'Governance & Compliance'
  | 'Admin'
  | 'Reports'
  | 'System';

export interface FlowStep {
  label: string;
  description?: string;
  /** Backend permission gate (requireAnyPermission semantics). [] = no gate / read-only. */
  gate: Permission[];
  kind: StepKind;
  /** Optional side-branch (e.g. Bypass, Terminate). */
  branch?: { label: string; gate: Permission[] };
}

export interface ModuleFlow {
  /** Matches a sidebar item id where one exists. Unique across the catalog. */
  id: string;
  title: string;
  category: ModuleCategory;
  /** One-line "what it does". */
  summary: string;
  steps: FlowStep[];
}
