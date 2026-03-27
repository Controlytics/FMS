# DigiLog Shared — CLAUDE.md

## Overview
Shared TypeScript types, Zod schemas, and constants used by both API and Web apps.

## Build
```bash
npx nx build shared
# or: cd packages/shared && npx tsc
```

## Key Exports
- `schemas/` — Zod validation schemas (login, user, config, etc.)
- `types/` — TypeScript interfaces and enums
- `constants/` — PERMISSIONS enum, role hierarchy, field definitions
- `index.ts` — Barrel export

## Usage
```typescript
import { PERMISSIONS, loginSchema, createUserSchema } from '@digilog/shared';
```


## Phase 2 Notes
- No new shared types added for Phase 2 (types are co-located in API modules)
- Prisma schema extended with 9 new models and 9 new enums in `apps/api/prisma/schema.prisma`

