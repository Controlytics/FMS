// Dumps PERMISSION_TREE (from packages/shared SOURCE, not dist) to <P4_OUT>/tree.json.
// P4_SHARED = a packages/shared folder to read instead of the repo's (e.g. a git-archive extract of the
// commit under test, so other agents' uncommitted edits are not what gets measured).
//   P4_SHARED=<extract>/packages/shared P4_OUT=QA/results/phase4/2026-10-22 npx tsx QA/tests/phase4/dump-tree.mts
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const shared = path.resolve(process.env.P4_SHARED ?? 'packages/shared');
const out = path.resolve(process.env.P4_OUT ?? 'QA/results/phase4');
const { PERMISSION_TREE } = await import(pathToFileURL(path.join(shared, 'src/types/permission-tree.ts')).href);
const { FEATURE_TO_PERMISSION_MAP } = await import(pathToFileURL(path.join(shared, 'src/types/feature-privileges.ts')).href);
const nodes = PERMISSION_TREE.flatMap((g: any) => g.nodes.map((n: any) => ({ ...n, group: g.sidebarId })));
fs.writeFileSync(path.join(out, 'tree.json'), JSON.stringify({ source: shared, groups: PERMISSION_TREE.map((g: any) => ({ sidebarId: g.sidebarId, vis: g.visibilityPrivilegeIds })), nodes, map: FEATURE_TO_PERMISSION_MAP }, null, 1));
console.log('nodes', nodes.length, 'configurable', nodes.filter((n: any) => n.configurable).length, 'map', Object.keys(FEATURE_TO_PERMISSION_MAP).length);
