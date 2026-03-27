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
├── routes.ts          # Fastify route handlers
├── feature.service.ts # Business logic
└── feature.repository.ts # Database queries (optional)
```

## How to Add a New API Endpoint

### 1. Create route in existing module
```typescript
// In modules/your-module/routes.ts
app.get(/your-endpoint, {
  preHandler: [app.requirePermission(YOUR_PERMISSION)],
  schema: {
    tags: [Your Module],
    summary: Description,
    response: { 200: { type: object, properties: { ... } } },
  },
}, async (req, reply) => {
  const result = await yourService.doSomething();
  return result;
});
```

### 2. Register route (if new module)
```typescript
// In app.ts
import yourRoutes from ./modules/your-module/routes.js;
await app.register(yourRoutes, { prefix: /api/your-prefix });
```

### 3. Add permission (if needed)
```sql
-- Update role permissions in DB
UPDATE roles SET permissions = permissions || [YOUR_PERMISSION] WHERE name = ADMIN;
```

## How to Add a New Frontend Page

### 1. Create page component
```typescript
// routes/your-feature/index.tsx
export function YourPage() {
  const { data } = useSWR(/api/your-endpoint);
  return <div>...</div>;
}
```

### 2. Add route in main.tsx
```typescript
const YourPage = lazy(() => import(./routes/your-feature).then(m => ({ default: m.YourPage })));

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
  id: your-feature,
  label: Your Feature,
  href: /your-feature,
  icon: (<svg>...</svg>),
  defaultRoles: [SUPER_ADMIN, ADMIN],
},
```

## How to Add a Rule Chain Node

### 1. Register node
```typescript
// In modules/rule-chain/nodes/index.ts
registerNode(your-node-type, ACTION, async (message, config, context) => {
  // Your logic here
  const result = doSomething(message, config);

  return {
    outputs: {
      Success: [result],
      Failure: [], // Empty = no messages on this output
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
  moduleKey: your-config,
  moduleName: Your Config,
  description: Description,
  icon: settings,
  category: display,
  sortOrder: 20,
  permissions: { read: CONFIG_READ, write: CONFIG_UPDATE },
  settings: [
    { key: enabled, type: boolean, label: Enable, default: false },
    { key: value, type: string, label: Value, default:  },
  ],
};
```

### 2. Register in discovery
```typescript
// lib/config-discovery.ts - add import
import(../modules/config/defs/your-config.def.js),
```

The config will auto-appear at `GET/PUT /api/config/dynamic/your-config`.

## Build & Deploy
```bash
# Development
npm run dev

# Production build
npm run build

# Deploy
pm2 restart digilog-api

# Check logs
pm2 logs digilog-api --lines 50
```

## Database Changes
```bash
# For development (with migrations)
cd apps/api
npx prisma migrate dev --name your_change

# For production (raw SQL + schema update)
psql -d digilog_db -c "ALTER TABLE ..."
# Then update schema.prisma and run:
npx prisma generate
```


## Phase 2: Digital Filter Management System (2026-03-27)

### Overview
Complete digital filter cleaning lifecycle management for pharmaceutical cleanrooms. Supports configurable cleaning pipelines with checklist gates, 8 cleaning stages, dual filter sets, PM scheduling, and full traceability.

### Key Components
- **5 backend modules**: cleaning-profiles, filter-profiles, filter-operations, pm-schedules, checklist-profiles
- **12+ frontend pages**: operations, profiles, cycles, checklists, PM, AHU dashboard, traceability, config
- **9 database tables**: filter_cleaning_profiles, filter_pipeline_stages, filter_pipeline_connections, filter_profiles, cleaning_cycles, filter_events, pm_schedules, pm_schedule_entries, pm_executions
- **Quality audit**: 43 issues found and 35 fixed (security, compliance, logic, UI)

