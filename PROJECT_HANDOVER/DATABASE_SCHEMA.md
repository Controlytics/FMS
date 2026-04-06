# Database Schema

## Overview
- **PostgreSQL 18** (Port 5432) - Application data via Prisma ORM (57 models, 17 enums)
- **TimescaleDB** - Time-series telemetry data (same PostgreSQL instance, database `digilog_tsdb`)
- **Note:** The application database is `digilog_tsdb`, NOT `digilog_db`

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

### Phase 2: Filter Management System
| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `filter_cleaning_profiles` | Cleaning pipeline definitions | name, description, organizationId, flowMode, isActive |
| `filter_pipeline_stages` | Pipeline nodes | profileId, type (PipelineNodeType), label, position, config (JSONB) |
| `filter_pipeline_connections` | Pipeline edges | profileId, fromStageId, toStageId, label |
| `filter_profiles` | Filter-to-profile assignments | instrumentId, cleaningProfileId, filterSet (SET_A/SET_B), isActive |
| `cleaning_cycles` | Cleaning cycle instances | filterProfileId, status (CleaningCycleStatus), startedAt, completedAt, startedBy |
| `filter_events` | Audit trail for operations | cycleId, eventType (FilterEventType), stageId, userId, data (JSONB), timestamp |
| `equipment_groups` | AHU equipment groupings | name, organizationId, description |
| `equipment_group_instruments` | Group membership | groupId, instrumentId |
| `checklist_profiles` | Checklist templates | name, organizationId, description |
| `checklist_questions` | Template questions | profileId, question, type (ChecklistQuestionType), options (JSONB), sortOrder |
| `pm_schedules` | Preventive maintenance schedules | name, organizationId, frequency, status (PmScheduleStatus) |
| `pm_schedule_entries` | Schedule items | scheduleId, filterProfileId, description |
| `pm_executions` | Execution tracking | entryId, status (PmExecutionStatus), executedBy, executedAt, notes |

## Phase 2 Enums

| Enum | Values |
|------|--------|
| `PipelineNodeType` | START, END, WASH_IN, WASH_OUT, DRY_IN, DRY_OUT, STORAGE_IN, STORAGE_OUT, CHECKLIST |
| `PipelineFlowMode` | SEQUENTIAL, PARALLEL |
| `FilterSetLabel` | SET_A, SET_B |
| `CleaningCycleStatus` | IN_PROGRESS, COMPLETED, ABORTED |
| `FilterEventType` | CYCLE_STARTED, STAGE_ENTERED, STAGE_COMPLETED, CHECKLIST_SUBMITTED, STAGE_BYPASSED, CYCLE_COMPLETED, CYCLE_ABORTED |
| `BlockRestriction` | NONE, CHECKLIST_PENDING |
| `ChecklistQuestionType` | TEXT, YES_NO, NUMERIC, SELECT, MULTI_SELECT |
| `PmScheduleStatus` | ACTIVE, INACTIVE, COMPLETED |
| `PmExecutionStatus` | PENDING, IN_PROGRESS, COMPLETED, MISSED |

## Key Relationships

```
Organization 1--* User
Organization 1--* AssetInstance (via organizationId)
Organization 1--* FilterCleaningProfile
Organization 1--* EquipmentGroup
Organization 1--* ChecklistProfile
Organization 1--* PmSchedule
AssetTemplate 1--* AssetInstance
AssetInstance 1--* DataStream
AssetInstance 1--* Alarm
AssetInstance *--* AssetInstance (via AssetRelationship)
User 1--* Session
User 1--* AuditTrail
RuleChain 1--* RuleNode
RuleNode *--* RuleNode (via RuleNodeConnection)

FilterCleaningProfile 1--* FilterPipelineStage
FilterCleaningProfile 1--* FilterPipelineConnection
FilterCleaningProfile 1--* FilterProfile
FilterProfile 1--* CleaningCycle
CleaningCycle 1--* FilterEvent
EquipmentGroup *--* AssetInstance (via EquipmentGroupInstrument)
ChecklistProfile 1--* ChecklistQuestion
PmSchedule 1--* PmScheduleEntry
PmScheduleEntry 1--* PmExecution
```

## Data Isolation
- Queries filter by `organizationId` from JWT
- SUPER_ADMIN can query across all organizations
- ADMIN can query across assigned organizations
- Entity assignments provide fine-grained access within organizations
- Phase 2 tables (cleaning profiles, filter profiles, PM schedules) all scoped by organizationId
