import type { Permission } from '@digilog/shared';

export type StepKind = 'action' | 'decision' | 'system';

export type ModuleCategory =
  | 'Operations'
  | 'Governance & Compliance'
  | 'Admin'
  | 'Reports'
  | 'System';

/**
 * Non-permission, non-role access marker for steps whose backend gate is not
 * a permission constant. Exactly one of gate/gateRoles/access must resolve
 * to something renderable — see FlowChart's role-display resolution order.
 */
export type AccessKind = 'public' | 'authenticated' | 'automatic' | 'configured';

export interface FlowStep {
  label: string;
  description?: string;
  /** Backend permission gate (requireAnyPermission semantics). [] = no gate / read-only. */
  gate: Permission[];
  /** Role-level gate (requireRole / requireSuperAdmin) — roles that may perform this step. */
  gateRoles?: string[];
  /** Non-permission, non-role access marker. Exactly one of gate/gateRoles/access must resolve. */
  access?: AccessKind;
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
