# Developer Guide

## Coding Standards

### TypeScript
- Strict mode enabled
- Use `interface` for object shapes, `type` for unions/intersections
- No `any` unless absolutely necessary (use `unknown` + type guard)
- All functions should have explicit return types in services

### File Naming
- Backend: `kebab-case.ts` (e.g., `auth.service.ts`, `user.repository.ts`)
- Frontend: `kebab-case.tsx` for pages, `PascalCase.tsx` for components
- Config definitions: `module-name.def.ts`

### Module Pattern (Backend)
Each module follows:
```
modules/feature-name/
+-- routes.ts          # Fastify route handlers
+-- feature.service.ts # Business logic
+-- feature.repository.ts # Database queries (optional)
```

### Theme (Frontend)
- ALL pages use unified light theme -- no dark theme anywhere
- Colors: bg-white cards, bg-slate-50 sections, border-slate-200
- Gradient dialog headers are acceptable
- Text: text-slate-800 primary, text-slate-600 secondary

## How to Add a New API Endpoint

### 1. Create route in existing module
```typescript
// In modules/your-module/routes.ts
app.get('/your-endpoint', {
  preHandler: [app.requirePermission('YOUR_PERMISSION')],
  schema: {
    tags: ['Your Module'],
    summary: 'Description',
    response: { 200: { type: 'object', properties: { ... } } },
  },
}, async (req, reply) => {
  const result = await yourService.doSomething();
  return result;
});
```

### 2. Register route (if new module)
```typescript
// In app.ts
import yourRoutes from './modules/your-module/routes.js';
await app.register(yourRoutes, { prefix: '/api/your-prefix' });
```

### 3. Add permission (if needed)
```sql
-- Update role permissions in DB
UPDATE roles SET permissions = permissions || '["YOUR_PERMISSION"]' WHERE name = 'ADMIN';
```

### 4. Update ALL 12 config touchpoints (for new features)
When adding a new feature, ensure you update:
1. Backend sidebar config definition
2. Frontend sidebar.tsx (navigation items)
3. Frontend admin sidebar config
4. Permission constants in shared package
5. Role privileges config definition
6. Re-auth config definition
7. Seed file (roles, permissions)
8. Auth plugin (if new route patterns)
9. Shared package types (rebuild with `npx nx build shared`)
10. Field IDs config (if new data fields)
11. Help articles (contextual help)
12. Swagger schema tags

## How to Add a New Frontend Page

### 1. Create page component
```typescript
// routes/your-feature/index.tsx
export function YourPage() {
  const { data } = useSWR('/api/your-endpoint');
  return <div>...</div>;
}
```

### 2. Add route in main.tsx
```typescript
const YourPage = lazy(() => import('./routes/your-feature').then(m => ({ default: m.YourPage })));

// In <Routes>:
<Route path="/your-feature" element={
  <RequireRole permissions={[PERMISSIONS.YOUR_PERMISSION]}>
    <Suspense fallback={<div>Loading...</div>}>
      <YourPage />
    </Suspense>
  </RequireRole>
} />
```

### 3. Add to sidebar (if needed)
```typescript
// In components/layout/sidebar.tsx, add to allNavItems:
{
  id: 'your-feature',
  label: 'Your Feature',
  href: '/your-feature',
  icon: (<svg>...</svg>),
  defaultRoles: ['SUPER_ADMIN', 'ADMIN'],
},
```

## How to Add a Rule Chain Node

### 1. Register node
```typescript
// In modules/rule-chain/nodes/index.ts
registerNode('your-node-type', 'ACTION', async (message, config, context) => {
  const result = doSomething(message, config);
  return {
    outputs: {
      Success: [result],
      Failure: [],
    },
  };
});
```

### 2. Add to frontend node palette
The rule chain editor reads node types from the API. Registered nodes auto-appear in the palette.

## How to Add a Config Module

### 1. Create definition
```typescript
// modules/config/defs/your-config.def.ts
export const yourConfigDef: ModuleConfigDefinition = {
  moduleKey: 'your-config',
  moduleName: 'Your Config',
  description: 'Description',
  icon: 'settings',
  category: 'display',
  sortOrder: 20,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  settings: [
    { key: 'enabled', type: 'boolean', label: 'Enable', default: false },
    { key: 'value', type: 'string', label: 'Value', default: '' },
  ],
};
```

### 2. Register in discovery
```typescript
// lib/config-discovery.ts - add import
import('../modules/config/defs/your-config.def.js'),
```

The config will auto-appear at `GET/PUT /api/config/dynamic/your-config`.

## How to Add Phase 2 Filter Features

### Adding a new pipeline stage type
1. Add to `PipelineNodeType` enum in `schema.prisma`
2. Run `npx prisma migrate dev --name add_stage_type`
3. Update `filter-operations.service.ts` to handle the new stage
4. Update the cleaning profile visual editor in frontend
5. Add corresponding FilterEventType if needed

### Adding a new checklist question type
1. Add to `ChecklistQuestionType` enum in `schema.prisma`
2. Run migration
3. Update checklist submission validation in `filter-operations.service.ts`
4. Update frontend checklist form rendering

## Build & Deploy
```bash
# Development (Windows local)
# API with hot reload:
cd apps/api && npx tsx watch src/app.ts
# Frontend with hot reload:
cd apps/web && npx vite

# Production build
npx tsc -p apps/api/tsconfig.json   # MUST compile before PM2 restart
pm2 restart digilog-api
cd apps/web && npx vite build

# Rebuild shared packages (when types change)
npx nx build shared && npx nx build db && npx nx build queue

# Check logs
pm2 logs digilog-api --lines 50
```

## Database Changes
```bash
# For development (with migrations)
cd apps/api
npx prisma migrate dev --name your_change

# For production (apply pending migrations)
cd apps/api
npx prisma migrate deploy
npx prisma generate

# Always test API after backend changes
curl http://localhost:3000/api/health
```

## Important Reminders
- Always run `npx tsc` before `pm2 restart` -- PM2 runs compiled JS, not TypeScript
- Always `curl` endpoints after backend changes -- compile clean does not mean it works
- Rebuild shared package (`npx nx build shared`) when shared types change
- Frontend uses light theme only -- no dark mode classes
- Input sanitization strips HTML from all text fields via `lib/sanitize.ts`
- The database is `digilog_tsdb`, NOT `digilog_db`
