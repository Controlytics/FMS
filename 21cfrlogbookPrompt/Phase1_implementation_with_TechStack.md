# DigiLog — Phase 1 Tech Stack

---

## Stack

```
┌─────────────────────────────────────────────────────┐
│  FRONTEND         React 19 · Vite · TypeScript      │
│                   Tailwind CSS · Shadcn/ui           │
│                   SWR · React Router 7               │
│                   React Hook Form                    │
├─────────────────────────────────────────────────────┤
│  VALIDATION       Zod (shared frontend ↔ backend)   │
├─────────────────────────────────────────────────────┤
│  BACKEND          Fastify · TypeScript               │
│                   Prisma ORM · raw SQL for ltree     │
├─────────────────────────────────────────────────────┤
│  AUTH             Self-built: bcrypt · jose (JWT)    │
├─────────────────────────────────────────────────────┤
│  DATABASE         PostgreSQL 16+                     │
│                   Extensions: ltree · pgcrypto       │
├─────────────────────────────────────────────────────┤
│  PDF GENERATION   @react-pdf/renderer                │
├─────────────────────────────────────────────────────┤
│  FILE STORAGE     Local filesystem (abstracted)      │
├─────────────────────────────────────────────────────┤
│  LOGGING          Pino                               │
├─────────────────────────────────────────────────────┤
│  PROJECT          Turborepo monorepo                 │
├─────────────────────────────────────────────────────┤
│  INFRA            Docker Compose                     │
└─────────────────────────────────────────────────────┘
```

---

## Project Structure

```
digilog/
├── apps/
│   ├── api/                      ← Fastify backend
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── users/
│   │   │   │   ├── hierarchy/
│   │   │   │   ├── templates/
│   │   │   │   ├── audit/
│   │   │   │   └── signatures/
│   │   │   ├── plugins/
│   │   │   │   ├── auth.ts
│   │   │   │   ├── audit-logger.ts
│   │   │   │   └── rbac.ts
│   │   │   ├── lib/
│   │   │   │   ├── hash-chain.ts
│   │   │   │   ├── file-storage.ts
│   │   │   │   └── pdf.ts
│   │   │   └── app.ts
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   └── package.json
│   └── web/                      ← React frontend
│       ├── src/
│       │   ├── routes/
│       │   │   ├── auth/
│       │   │   ├── users/
│       │   │   ├── hierarchy/
│       │   │   ├── templates/
│       │   │   ├── audit/
│       │   │   └── signatures/
│       │   ├── components/
│       │   │   ├── ui/           ← Shadcn components
│       │   │   ├── tree/
│       │   │   ├── forms/
│       │   │   └── layout/
│       │   ├── hooks/
│       │   │   ├── use-auth.ts
│       │   │   ├── use-session.ts
│       │   │   └── use-api.ts
│       │   ├── lib/
│       │   │   ├── api-client.ts
│       │   │   └── swr-config.ts
│       │   └── main.tsx
│       └── package.json
├── packages/
│   ├── shared-schemas/           ← Zod schemas
│   │   └── src/
│   │       ├── auth.ts
│   │       ├── users.ts
│   │       ├── hierarchy.ts
│   │       ├── templates.ts
│   │       ├── audit.ts
│   │       └── signatures.ts
│   ├── shared-types/             ← Enums and pure types
│   │   └── src/
│   │       ├── roles.ts
│   │       ├── permissions.ts
│   │       ├── audit-actions.ts
│   │       └── signature-meanings.ts
│   └── pdf-templates/            ← @react-pdf documents
│       └── src/
│           ├── audit-report.tsx
│           ├── user-record.tsx
│           └── hierarchy-export.tsx
├── docker-compose.yml
├── turbo.json
└── package.json
```

---

## Database Schema

### Extensions

```sql
CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### Users & Auth

```sql
CREATE TABLE users (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username              VARCHAR(100) UNIQUE NOT NULL,
    full_name             VARCHAR(255) NOT NULL,
    email                 VARCHAR(255) UNIQUE NOT NULL,
    password_hash         TEXT NOT NULL,
    signature_mode        VARCHAR(20) NOT NULL DEFAULT 'login_id',
    signature_image       BYTEA,
    status                VARCHAR(20) NOT NULL DEFAULT 'pending',
    force_password_change BOOLEAN DEFAULT true,
    failed_login_attempts INT DEFAULT 0,
    locked_at             TIMESTAMPTZ,
    password_changed_at   TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    deactivated_at        TIMESTAMPTZ,
    created_by            UUID REFERENCES users(id)
);

CREATE TABLE password_history (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id),
    hash       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pw_history_user ON password_history(user_id);
```

### Roles & Permissions

```sql
CREATE TABLE roles (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         VARCHAR(100) UNIQUE NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    description  TEXT,
    is_system    BOOLEAN DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(100) UNIQUE NOT NULL,
    module      VARCHAR(50) NOT NULL,
    description TEXT
);

CREATE TABLE role_permissions (
    role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id     UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    assigned_by UUID REFERENCES users(id),
    PRIMARY KEY (user_id, role_id)
);
```

### Sessions

```sql
CREATE TABLE sessions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES users(id),
    token_hash         TEXT NOT NULL,
    device_type        VARCHAR(50),
    device_ip          INET,
    browser            VARCHAR(255),
    is_active          BOOLEAN DEFAULT true,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expired_at         TIMESTAMPTZ,
    termination_reason VARCHAR(50)
);
CREATE INDEX idx_sessions_active ON sessions(user_id) WHERE is_active = true;
```

### Plant Hierarchy

```sql
CREATE TABLE hierarchy_nodes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id   UUID REFERENCES hierarchy_nodes(id),
    name        VARCHAR(255) NOT NULL,
    node_type   VARCHAR(50) NOT NULL,
    uns_path    ltree NOT NULL,
    template_id UUID REFERENCES asset_templates(id),
    attributes  JSONB DEFAULT '{}',
    status      VARCHAR(20) DEFAULT 'active',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID REFERENCES users(id)
);
CREATE INDEX idx_hier_uns    ON hierarchy_nodes USING GIST (uns_path);
CREATE INDEX idx_hier_parent ON hierarchy_nodes(parent_id);
CREATE INDEX idx_hier_type   ON hierarchy_nodes(node_type);
CREATE INDEX idx_hier_attrs  ON hierarchy_nodes USING GIN (attributes);

CREATE TABLE asset_links (
    source_id  UUID NOT NULL REFERENCES hierarchy_nodes(id),
    target_id  UUID NOT NULL REFERENCES hierarchy_nodes(id),
    link_type  VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),
    PRIMARY KEY (source_id, target_id, link_type)
);
```

### Asset Templates

```sql
CREATE TABLE asset_templates (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name             VARCHAR(255) NOT NULL,
    node_type        VARCHAR(50) NOT NULL,
    description      TEXT,
    attribute_schema JSONB NOT NULL DEFAULT '[]',
    telemetry_schema JSONB NOT NULL DEFAULT '[]',
    linked_slots     JSONB DEFAULT '[]',
    version          INT NOT NULL DEFAULT 1,
    status           VARCHAR(20) DEFAULT 'active',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by       UUID REFERENCES users(id)
);

CREATE TABLE template_versions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES asset_templates(id),
    version     INT NOT NULL,
    snapshot    JSONB NOT NULL,
    changed_by  UUID NOT NULL REFERENCES users(id),
    reason      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Physical Identifiers

```sql
CREATE TABLE physical_identifiers (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id    UUID NOT NULL REFERENCES hierarchy_nodes(id),
    type       VARCHAR(20) NOT NULL,
    value      VARCHAR(500) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),
    UNIQUE(type, value)
);
```

### Audit Trail

```sql
CREATE TABLE audit_trail (
    id              BIGSERIAL PRIMARY KEY,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id         UUID REFERENCES users(id),
    user_name       VARCHAR(100),
    user_role       VARCHAR(100),
    action          VARCHAR(100) NOT NULL,
    target_type     VARCHAR(50),
    target_id       UUID,
    target_uns_path ltree,
    before_value    JSONB,
    after_value     JSONB,
    reason          TEXT,
    ip_address      INET,
    device_type     VARCHAR(50),
    device_id       VARCHAR(255),
    browser         VARCHAR(255),
    session_id      UUID,
    hash            TEXT NOT NULL
);
CREATE INDEX idx_audit_ts     ON audit_trail(timestamp);
CREATE INDEX idx_audit_user   ON audit_trail(user_id);
CREATE INDEX idx_audit_action ON audit_trail(action);
CREATE INDEX idx_audit_target ON audit_trail(target_type, target_id);
CREATE INDEX idx_audit_uns    ON audit_trail USING GIST (target_uns_path);

-- Immutability trigger
CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit trail records cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_immutable
    BEFORE UPDATE OR DELETE ON audit_trail
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
```

### Electronic Signatures

```sql
CREATE TABLE electronic_signatures (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id),
    record_type    VARCHAR(50) NOT NULL,
    record_id      UUID NOT NULL,
    tier           VARCHAR(20) NOT NULL,
    meaning        TEXT NOT NULL,
    record_hash    TEXT NOT NULL,
    signature_data TEXT,
    signed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip_address     INET,
    device_type    VARCHAR(50),
    session_id     UUID
);
CREATE INDEX idx_esig_record ON electronic_signatures(record_type, record_id);
CREATE INDEX idx_esig_user   ON electronic_signatures(user_id);

CREATE TRIGGER esig_immutable
    BEFORE UPDATE OR DELETE ON electronic_signatures
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
```

### System Configuration

```sql
CREATE TABLE system_config (
    key        VARCHAR(100) PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES users(id)
);
```

---

## Backend Implementation

### Dependencies

```json
{
  "dependencies": {
    "fastify": "^5.x",
    "@fastify/cors": "^10.x",
    "@fastify/helmet": "^13.x",
    "@fastify/rate-limit": "^10.x",
    "fastify-type-provider-zod": "^4.x",
    "@prisma/client": "^6.x",
    "bcrypt": "^5.x",
    "jose": "^6.x",
    "zod": "^3.x",
    "pino": "^9.x",
    "@react-pdf/renderer": "^4.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "prisma": "^6.x",
    "tsx": "^4.x",
    "vitest": "^3.x"
  }
}
```

### Fastify App

```typescript
// apps/api/src/app.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

const app = Fastify({ logger: true });

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

await app.register(cors);
await app.register(helmet);
await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });

await app.register(import("./plugins/auth"));
await app.register(import("./plugins/audit-logger"));
await app.register(import("./plugins/rbac"));

await app.register(import("./modules/auth/routes"), { prefix: "/api/auth" });
await app.register(import("./modules/users/routes"), { prefix: "/api/users" });
await app.register(import("./modules/hierarchy/routes"), { prefix: "/api/hierarchy" });
await app.register(import("./modules/templates/routes"), { prefix: "/api/templates" });
await app.register(import("./modules/audit/routes"), { prefix: "/api/audit" });
await app.register(import("./modules/signatures/routes"), { prefix: "/api/signatures" });

await app.listen({ port: 3000, host: "0.0.0.0" });
```

### Auth Plugin

```typescript
// apps/api/src/plugins/auth.ts
import fp from "fastify-plugin";
import * as jose from "jose";
import { prisma } from "../lib/prisma";

export default fp(async (app) => {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);

  app.decorate("verifyToken", async (token: string) => {
    const { payload } = await jose.jwtVerify(token, secret);
    return payload;
  });

  app.addHook("onRequest", async (req, reply) => {
    const publicPaths = ["/api/auth/login"];
    if (publicPaths.some((p) => req.url.startsWith(p))) return;

    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "Missing token" });
    }

    try {
      req.user = await app.verifyToken(header.slice(7));

      const session = await prisma.sessions.findFirst({
        where: { id: req.user.sessionId, is_active: true },
      });
      if (!session) {
        return reply.code(401).send({ error: "Session terminated" });
      }

      await prisma.sessions.update({
        where: { id: session.id },
        data: { last_active_at: new Date() },
      });
    } catch {
      return reply.code(401).send({ error: "Invalid token" });
    }
  });
});
```

### Audit Logger Plugin

```typescript
// apps/api/src/plugins/audit-logger.ts
import fp from "fastify-plugin";
import { computeHash } from "../lib/hash-chain";
import { prisma } from "../lib/prisma";

export default fp(async (app) => {
  app.decorate("auditLog", async (entry: AuditInput) => {
    const last = await prisma.$queryRaw<[{ hash: string }]>`
      SELECT hash FROM audit_trail ORDER BY id DESC LIMIT 1
    `;
    const previousHash = last[0]?.hash ?? "GENESIS";
    const hash = computeHash({ ...entry, previousHash });

    await prisma.audit_trail.create({
      data: { ...entry, hash },
    });
  });
});
```

### Hash Chain

```typescript
// apps/api/src/lib/hash-chain.ts
import { createHash } from "node:crypto";

export function computeHash(data: Record<string, unknown>): string {
  const payload = JSON.stringify(data, Object.keys(data).sort());
  return createHash("sha256").update(payload).digest("hex");
}

export async function verifyChain(
  entries: Array<{ id: number; hash: string; [key: string]: unknown }>
): Promise<{ valid: boolean; brokenAt?: number }> {
  let previousHash = "GENESIS";

  for (const entry of entries) {
    const { hash, ...data } = entry;
    const expected = computeHash({ ...data, previousHash });
    if (expected !== hash) {
      return { valid: false, brokenAt: entry.id };
    }
    previousHash = hash;
  }

  return { valid: true };
}
```

### File Storage Abstraction

```typescript
// apps/api/src/lib/file-storage.ts
import fs from "node:fs/promises";
import path from "node:path";

export interface FileStorage {
  save(filePath: string, data: Buffer): Promise<string>;
  retrieve(filePath: string): Promise<Buffer>;
  delete(filePath: string): Promise<void>;
}

export class LocalFileStorage implements FileStorage {
  constructor(private basePath: string = "/data/files") {}

  async save(filePath: string, data: Buffer): Promise<string> {
    const full = path.join(this.basePath, filePath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    return filePath;
  }

  async retrieve(filePath: string): Promise<Buffer> {
    return fs.readFile(path.join(this.basePath, filePath));
  }

  async delete(filePath: string): Promise<void> {
    await fs.unlink(path.join(this.basePath, filePath));
  }
}
```

### Hierarchy ltree Queries

```typescript
// apps/api/src/modules/hierarchy/queries.ts
import { prisma } from "../../lib/prisma";

export async function getDescendants(unsPath: string) {
  return prisma.$queryRaw`
    SELECT * FROM hierarchy_nodes
    WHERE uns_path <@ ${unsPath}::ltree
    ORDER BY uns_path
  `;
}

export async function getAncestors(unsPath: string) {
  return prisma.$queryRaw`
    SELECT * FROM hierarchy_nodes
    WHERE uns_path @> ${unsPath}::ltree
    ORDER BY uns_path
  `;
}

export async function getChildren(unsPath: string) {
  return prisma.$queryRaw`
    SELECT * FROM hierarchy_nodes
    WHERE uns_path ~ ${unsPath + ".*{1}"}::lquery
    ORDER BY name
  `;
}

export async function searchByAttribute(key: string, value: string) {
  return prisma.$queryRaw`
    SELECT * FROM hierarchy_nodes
    WHERE attributes ->> ${key} = ${value}
  `;
}
```

---

## Frontend Implementation

### Dependencies

```json
{
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-router": "^7.x",
    "swr": "^2.x",
    "react-hook-form": "^7.x",
    "@hookform/resolvers": "^5.x",
    "zod": "^3.x",
    "tailwindcss": "^4.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "@types/react": "^19.x",
    "@types/react-dom": "^19.x",
    "vite": "^6.x",
    "@vitejs/plugin-react": "^4.x"
  }
}
```

### SWR Configuration

```typescript
// apps/web/src/lib/swr-config.ts
import { SWRConfiguration } from "swr";
import { apiClient } from "./api-client";

export const swrConfig: SWRConfiguration = {
  fetcher: (url: string) => apiClient.get(url),
  revalidateOnFocus: false,
  shouldRetryOnError: false,
  dedupingInterval: 5000,
};
```

### API Client

```typescript
// apps/web/src/lib/api-client.ts
const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

class ApiClient {
  private getToken(): string | null {
    return localStorage.getItem("access_token");
  }

  private async request<T>(url: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const res = await fetch(`${BASE_URL}${url}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
      },
    });

    if (res.status === 401) {
      localStorage.removeItem("access_token");
      window.location.href = "/login";
      throw new Error("Unauthorized");
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message ?? `Request failed: ${res.status}`);
    }

    return res.json();
  }

  get<T>(url: string) { return this.request<T>(url); }
  post<T>(url: string, body: unknown) { return this.request<T>(url, { method: "POST", body: JSON.stringify(body) }); }
  put<T>(url: string, body: unknown) { return this.request<T>(url, { method: "PUT", body: JSON.stringify(body) }); }
  patch<T>(url: string, body: unknown) { return this.request<T>(url, { method: "PATCH", body: JSON.stringify(body) }); }
  delete<T>(url: string) { return this.request<T>(url, { method: "DELETE" }); }
}

export const apiClient = new ApiClient();
```

### Auth Hook

```typescript
// apps/web/src/hooks/use-auth.ts
import useSWR from "swr";
import { useNavigate } from "react-router";
import { apiClient } from "../lib/api-client";

export function useAuth() {
  const navigate = useNavigate();
  const { data: user, error, isLoading, mutate } = useSWR("/api/auth/me");

  const login = async (username: string, password: string) => {
    const res = await apiClient.post<{ token: string }>("/api/auth/login", { username, password });
    localStorage.setItem("access_token", res.token);
    await mutate();
    navigate("/");
  };

  const logout = async () => {
    await apiClient.post("/api/auth/logout", {});
    localStorage.removeItem("access_token");
    navigate("/login");
  };

  return { user, isLoading, isAuthenticated: !!user && !error, login, logout };
}
```

---

## Shared Schemas

```typescript
// packages/shared-schemas/src/auth.ts
import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(8),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/),
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: "Passwords must match",
  path: ["confirmPassword"],
});

export const reAuthSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  reason: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
export type ReAuthInput = z.infer<typeof reAuthSchema>;
```

```typescript
// packages/shared-schemas/src/hierarchy.ts
import { z } from "zod";

export const nodeTypes = ["site", "area", "line", "asset", "sub_asset", "device"] as const;

export const createNodeSchema = z.object({
  parentId: z.string().uuid().nullable(),
  name: z.string().min(1).max(255),
  nodeType: z.enum(nodeTypes),
  templateId: z.string().uuid().optional(),
  attributes: z.record(z.unknown()).default({}),
});

export const updateNodeSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  attributes: z.record(z.unknown()).optional(),
  status: z.enum(["active", "inactive", "decommissioned"]).optional(),
  reason: z.string().min(1),
});

export type CreateNodeInput = z.infer<typeof createNodeSchema>;
export type UpdateNodeInput = z.infer<typeof updateNodeSchema>;
```

---

## Docker Compose

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: digilog
      POSTGRES_USER: digilog
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./apps/api/prisma/sql/extensions.sql:/docker-entrypoint-initdb.d/01-extensions.sql

  api:
    build: ./apps/api
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://digilog:${DB_PASSWORD}@db:5432/digilog
      JWT_SECRET: ${JWT_SECRET}
      FILE_STORAGE_PATH: /data/files
    volumes:
      - filedata:/data/files
    depends_on:
      - db

  web:
    build: ./apps/web
    ports:
      - "8080:80"
    depends_on:
      - api

volumes:
  pgdata:
  filedata:
```

---

## Deferred to Later Phases

| Technology | Phase |
|---|---|
| TimescaleDB | 2–3 |
| Redis | 2–3 |
| MQTT broker | 2–3 |
| Socket.io | 2 |
| Keycloak | 6 |
| MinIO / S3 | 5+ |
| Kubernetes | 5+ |
| Prometheus + Grafana | 3–4 |

---

*Last updated: February 2026*
