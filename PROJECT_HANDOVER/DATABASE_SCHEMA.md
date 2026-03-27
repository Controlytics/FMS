# Database Schema

## Overview
- **PostgreSQL** (Port 5432) - Application data via Prisma ORM
- **TimescaleDB** (Port 5433) - Time-series telemetry data

## Tables

### Authentication & Users
| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `users` | User accounts | username, email, passwordHash, role, organizationId, authSource (local/ldap), status |
| `roles` | Role definitions | name, displayName, hierarchyLevel, scope, permissions (JSONB array), color |
| `sessions` | Active login sessions | userId, tokenHash, expiresAt, ipAddress, userAgent, isActive |
| `password_history` | Password reuse prevention | userId, passwordHash, createdAt |
| `password_reset_requests` | Reset workflow | userId, status (PENDING/APPROVED/REJECTED), notes |

### Organizations
| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `organizations` | Company/group entities | name, slug, parentOrgId, isActive, maxUsers, maxDevices |

### Asset Management
| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `asset_templates` | Reusable blueprints | name, category, attributes, telemetryKeys, alarmRules, transportConfig |
| `asset_template_versions` | Version history | templateId, version, snapshot (JSONB), status |
| `asset_instances` | Actual entities | templateId, name, organizationId, parentId, isActive |
| `asset_relationships` | Entity connections | sourceId, targetId, type (CONTAINS/CONNECTED_TO/etc.) |
| `asset_identifiers` | Physical IDs | entityId, type (QR/RFID/NFC/BARCODE), identifierValue (UNIQUE) |
| `device_credentials` | API tokens | entityId, accessToken, maxDataRatePerMin |

### Data & Telemetry
| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `data_streams` | Telemetry key registry | entityId, key, dataType, unit, source |
| `latest_telemetry` | Current value cache | entityId, key, value, lastUpdated |
| `dead_letter_queue` | Failed messages | payload, error, retryCount, status |
| `ingestion_system_config` | Pipeline config | key, value (JSONB) |

### Rules & Automation
| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `rule_chains` | Rule chain definitions | name, organizationId, firstNodeId, isRoot, isSystem |
| `rule_chain_versions` | Version snapshots | ruleChainId, version, snapshot, status |
| `rule_nodes` | Individual nodes | ruleChainId, type, name, configuration (JSONB), debugMode |
| `rule_node_connections` | Node connections | fromNodeId, toNodeId, label |

### Alarms & Monitoring
| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `alarms` | Alarm lifecycle | entityId, type, severity, status (ACTIVE/ACK/CLEARED), details |
| `connectivity_status` | Device online/offline | entityId, isOnline, lastActivityAt, protocol |

### Notifications
| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `notifications` | In-app notifications | targetUserId, type, title, message, isRead |
| `notification_logs` | Delivery tracking | channel, recipient, status, retryCount |
| `notification_templates` | Email/SMS templates | name, channel, subject, body |
| `notification_rules` | Event triggers | name, eventTypes, conditions, channels |
| `notification_rule_recipients` | Rule recipients | ruleId, recipientType (ROLE/GROUP/USER), recipientId |

### Compliance
| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `audit_trail` | Immutable audit log | userId, action, targetType, targetId, beforeValue, afterValue, ipAddress, checksum |
| `checklist_reviews` | 3-step approval | entityId, templateId, status (PERFORMED/CHECKED/VERIFIED), signatures |
| `electronic_signatures` | 21 CFR Part 11 | signerName, timestamp, meaning, recordHash, signatureHash |

### Configuration
| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `system_config` | Key-value configs | configKey (UNIQUE), configValue (JSONB), configType |
| `role_configs` | Role UI defaults | role, permissions (JSONB), sidebarItems, widgets |
| `user_configs` | Per-user overrides | userId, sidebarItems, widgets, preferences |
| `field_id_config` | Custom field labels | organizationId, module, fieldMappings (JSONB) |

### Utilities
| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `qr_codes` | Generated QR codes | entityId, identifierValue, imageData |
| `uns_mappings` | ISA-95 UNS paths | entityId, unsPath, isOverride |
| `help_articles` | Help docs | slug, title, content, category |
| `help_article_versions` | Version history | articleId, version, content |
| `user_groups` | Notification groups | name, organizationId |
| `user_group_members` | Group membership | groupId, userId |

## Key Relationships

```
Organization 1──* User
Organization 1──* AssetInstance (via organizationId)
AssetTemplate 1──* AssetInstance
AssetInstance 1──* DataStream
AssetInstance 1──* Alarm
AssetInstance *──* AssetInstance (via AssetRelationship)
User 1──* Session
User 1──* AuditTrail
RuleChain 1──* RuleNode
RuleNode *──* RuleNode (via RuleNodeConnection)
```

## Data Isolation
- Queries filter by `organizationId` from JWT
- SUPER_ADMIN can query across all organizations
- ADMIN can query across assigned organizations
- Entity assignments provide fine-grained access within organizations


## Phase 2: Digital Filter Management System (2026-03-27)

### Overview
Complete digital filter cleaning lifecycle management for pharmaceutical cleanrooms. Supports configurable cleaning pipelines with checklist gates, 8 cleaning stages, dual filter sets, PM scheduling, and full traceability.

### Key Components
- **5 backend modules**: cleaning-profiles, filter-profiles, filter-operations, pm-schedules, checklist-profiles
- **12+ frontend pages**: operations, profiles, cycles, checklists, PM, AHU dashboard, traceability, config
- **9 database tables**: filter_cleaning_profiles, filter_pipeline_stages, filter_pipeline_connections, filter_profiles, cleaning_cycles, filter_events, pm_schedules, pm_schedule_entries, pm_executions
- **Quality audit**: 43 issues found and 35 fixed (security, compliance, logic, UI)

