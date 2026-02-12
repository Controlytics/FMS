# DigiLog Shared — Types & Schemas

## Purpose
Shared Zod schemas and TypeScript types used by both API and Web apps. Single source of truth for validation rules and type definitions.

## Structure
- `src/types/roles.ts` — Role enum, hierarchy, creatable roles map
- `src/types/permissions.ts` — Permission constants, role-permission matrix
- `src/types/audit-actions.ts` — Audit action enum
- `src/schemas/` — Zod schemas for auth, users, hierarchy, templates, config, audit

## Usage
Import from `@digilog/shared` in either app:
```ts
import { loginSchema, ROLES, ROLE_PERMISSIONS } from '@digilog/shared';
```
