// Dumps PERMISSION_TREE (from packages/shared SOURCE, not dist) to QA/results/phase4/tree.json
import fs from 'node:fs';
import { PERMISSION_TREE } from '../../../packages/shared/src/types/permission-tree.ts';
import { FEATURE_TO_PERMISSION_MAP } from '../../../packages/shared/src/types/feature-privileges.ts';
const nodes = PERMISSION_TREE.flatMap((g) => g.nodes.map((n) => ({ ...n, group: g.sidebarId })));
fs.writeFileSync('QA/results/phase4/tree.json', JSON.stringify({ groups: PERMISSION_TREE.map((g) => ({ sidebarId: g.sidebarId, vis: g.visibilityPrivilegeIds })), nodes, map: FEATURE_TO_PERMISSION_MAP }, null, 1));
console.log('nodes', nodes.length, 'configurable', nodes.filter((n) => n.configurable).length, 'map', Object.keys(FEATURE_TO_PERMISSION_MAP).length);
