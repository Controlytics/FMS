/**
 * Filter Operations Routes — Cycle management, advance, bypass, checklist, events, cycles.
 */
import type { FastifyInstance } from 'fastify';
import { FilterOperationsService } from './filter-operations.service.js';
import { buildContext } from '../../lib/build-context.js';
import { errorResponses } from '../../lib/error-schemas.js';
import { enforceReauth } from '../../lib/reauth-check.js';
import { getFilterStageRules, buildStageOptions } from './stage-rules.js';
import { getCleaningReasons } from './filter-resolver.js';

export default async function filterOperationsRoutes(app: FastifyInstance) {
  const service = new FilterOperationsService();

  // P1 (2026-06-03): valid cleaning-profile stage options for the web
  // "Edit Filter Status" dialog. Returns the profile's ordered stages + a
  // per-stage classification so the dialog only offers legal moves and can
  // show "Invalid stage movement…" for skips. Works with or without an active
  // cycle. Reuses getFilterStageRules → the SAME findReachable() the tablet
  // uses, so manual web moves run identical sequence rules to tablet cleaning.
  app.get('/:id/stage-options', {
    preHandler: [app.requirePermission('ASSET_READ')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'Valid next cleaning stages for a filter (web manual status update)',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            hasProfile: { type: 'boolean' },
            hasActiveCycle: { type: 'boolean' },
            profileName: { type: 'string', nullable: true },
            currentStage: { type: 'string', nullable: true },
            orderedStages: { type: 'array', items: { type: 'string' } },
            immediateNext: { type: 'array', items: { type: 'string' } },
            options: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  state: { type: 'string' },
                  classification: { type: 'string' },
                  allowed: { type: 'boolean' },
                  isCurrent: { type: 'boolean' },
                  startsCycle: { type: 'boolean' },
                },
              },
            },
            // P3: cleaning reasons for the move that starts a cycle. The dialog
            // shows this picker when the selected option has startsCycle=true.
            cleaningReasons: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const rules = await getFilterStageRules(id);
    const cleaningReasons = rules.hasProfile && rules.profileId
      ? await getCleaningReasons(rules.profileId)
      : [];
    return {
      hasProfile: rules.hasProfile,
      hasActiveCycle: rules.hasActiveCycle,
      profileName: rules.profileName,
      currentStage: rules.currentStage,
      orderedStages: rules.orderedStages,
      immediateNext: rules.immediateNext,
      options: buildStageOptions(rules),
      cleaningReasons,
    };
  });

  app.get('/:id/current-state', {
    preHandler: [app.requirePermission('ASSET_READ')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'Get filter current state and next actions',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      querystring: {
        type: 'object',
        properties: {
          cleaningAreaId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            filterId: { type: 'string' },
            filterName: { type: 'string', nullable: true },
            currentState: { type: 'string', nullable: true },
            currentCycle: { type: 'object', nullable: true, additionalProperties: true },
            nextBlocks: { type: 'array', items: { type: 'object', additionalProperties: true } },
            pipelineStages: { type: 'array', items: { type: 'object', additionalProperties: true } },
            pipelineGraph: { type: 'object', nullable: true, additionalProperties: true },
            profile: { type: 'object', nullable: true, additionalProperties: true },
            filterSet: { type: 'string', nullable: true },
            totalCycles: { type: 'integer' },
            equipmentGroup: { type: 'object', nullable: true, additionalProperties: true },
            blockEquipmentGroups: { type: 'array', items: { type: 'object', additionalProperties: true } },
            homeBlock: {
              type: 'object',
              nullable: true,
              properties: { id: { type: 'string' }, name: { type: 'string' } },
            },
            blockChangeStatus: { type: 'string', nullable: true, enum: ['MATCH', 'CONFIRM', 'APPROVED', 'REQUIRED'] },
            blockChangeMode: { type: 'string', enum: ['CONFIRM', 'APPROVAL'] },
            isPmDue: { type: 'boolean' },
            pmReasonKey: { type: 'string', nullable: true },
            profileSyncWarning: {
              type: 'object',
              nullable: true,
              additionalProperties: true,
              properties: {
                cycleProfileId: { type: 'string' },
                cycleProfileName: { type: 'string', nullable: true },
                expectedProfileId: { type: 'string' },
                expectedProfileName: { type: 'string', nullable: true },
                recommendation: { type: 'string' },
              },
            },
            // L3 (2026-05-02): advisory warning when admin has edited the
            // cycle's pinned EquipmentGroup. Readings still validate against
            // the pinned snapshot.
            equipmentGroupSyncWarning: {
              type: 'object',
              nullable: true,
              additionalProperties: true,
              properties: {
                groupId: { type: 'string' },
                pinnedVersion: { type: 'integer' },
                liveVersion: { type: 'integer' },
                recommendation: { type: 'string' },
              },
            },
            stageLookup: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                properties: {
                  nextStages: { type: 'array', items: { type: 'string' } },
                  pendingChecklistProfileIds: { type: 'array', items: { type: 'string' } },
                  leadsToEnd: { type: 'boolean' },
                },
              },
              description: 'Per-stage lookup for offline use: from a given stateKey, what comes next + which checklists fire',
            },
            // Phase 8.7 cutover (decision-tape architecture): the action tape
            // is now the authoritative server-emitted contract. The FE consumes
            // `actions[]` + `tapeVersion` directly; the old `nextAllowedStages`
            // and `pendingChecklist` fields have been removed. additionalProperties:true
            // on each action lets the per-type discriminated union shapes
            // (validations, params subtypes) flow through unchanged.
            actions: {
              type: 'array',
              items: { type: 'object', additionalProperties: true, properties: { type: { type: 'string' }, label: { type: 'string' } } },
              description: 'Decision-tape: ordered list of permitted next actions for the current cycle state',
            },
            tapeVersion: {
              type: 'integer',
              description: 'Monotonic per-cycle version derived from profileVersion + recent events; clients send this back with writes for staleness checks',
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    const { cleaningAreaId } = (req.query ?? {}) as { cleaningAreaId?: string };
    return service.getCurrentState(ctx, id, cleaningAreaId);
  });

  // Batch: get current-state for all filters in one call (for offline caching)
  app.get('/batch-states', {
    preHandler: [app.requirePermission('ASSET_READ')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'Get current state for all filters (for offline caching)',
      querystring: {
        type: 'object',
        properties: {
          cleaningAreaId: { type: 'string', format: 'uuid' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { cleaningAreaId } = (req.query ?? {}) as { cleaningAreaId?: string };
    return service.getBatchStates(ctx, cleaningAreaId);
  });

  app.post('/:id/start-cycle', {
    preHandler: [app.requirePermission('FILTER_OPERATE')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'Start a new cleaning cycle',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['cleaningReasonKey'],
        properties: {
          cleaningReasonKey: { type: 'string' },
          cleaningJustification: { type: 'string' },
          cleaningAreaId: { type: 'string', format: 'uuid' },
          equipmentGroupId: { type: 'string', format: 'uuid' },
          offlinePerformedAt: { type: 'string', format: 'date-time' },
          clientOpId: { type: 'string', description: 'Client-generated UUID for idempotent replay' },
          acknowledgeBlockChange: { type: 'boolean', description: 'Operator confirmed cleaning in a different block (Continue with cleaning)' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            cycleCode: { type: 'string' },
            filterId: { type: 'string' },
            status: { type: 'string' },
            sequenceNumber: { type: 'integer' },
          },
          additionalProperties: true,
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('START_CLEANING_CYCLE', req, reply);
    if (!ok) return;

    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    const result = await service.startCycle(ctx, id, req.body);
    return reply.code(201).send(result);
  });

  app.post('/:id/advance', {
    preHandler: [app.requirePermission('FILTER_OPERATE')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'Advance filter to next stage',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['targetState', 'tapeVersion'],
        properties: {
          targetState: { type: 'string' },
          parameters: { type: 'object' },
          equipmentId: { type: 'string', format: 'uuid' },
          cleaningAreaId: { type: 'string', format: 'uuid' },
          remarks: { type: 'string' },
          checklistData: { type: 'object' },
          equipmentGroupId: { type: 'string', format: 'uuid' },
          instrumentReadings: { type: 'object', additionalProperties: { type: 'number' } },
          dryerAction: { type: 'string', enum: ['SET_DURATION', 'SUBMIT_READINGS'] },
          dryerDurationMinutes: { type: 'integer', minimum: 1, maximum: 1440 },
          offlinePerformedAt: { type: 'string', format: 'date-time' },
          clientOpId: { type: 'string', description: 'Client-generated UUID for idempotent replay' },
          // Phase 8.7 cutover (decision-tape architecture): required staleness
          // guard. Server compares to the live tapeVersion derived from
          // (profileVersion, filterEventCount) and rejects with 409 STALE_TAPE
          // if mismatched. FE always reads tapeVersion from getCurrentState or
          // a prior write response and sends it back.
          tapeVersion: { type: 'integer', description: 'Required staleness guard; rejected with 409 STALE_TAPE on mismatch' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            filterId: { type: 'string' },
            filterName: { type: 'string', nullable: true },
            currentState: { type: 'string', nullable: true },
            currentCycle: { type: 'object', nullable: true, additionalProperties: true },
            nextBlocks: { type: 'array', items: { type: 'object', additionalProperties: true } },
            pipelineStages: { type: 'array', items: { type: 'object', additionalProperties: true } },
            profile: { type: 'object', nullable: true, additionalProperties: true },
            filterSet: { type: 'string', nullable: true },
            totalCycles: { type: 'integer' },
            equipmentGroup: { type: 'object', nullable: true, additionalProperties: true },
            // Phase 8.7 cutover: post-write tape so FE can consume next-action
            // state without a follow-up getCurrentState round-trip.
            actions: {
              type: 'array',
              items: { type: 'object', additionalProperties: true, properties: { type: { type: 'string' }, label: { type: 'string' } } },
              description: 'Decision-tape: ordered list of permitted next actions after this write',
            },
            tapeVersion: {
              type: 'integer',
              description: 'Monotonic per-cycle version after this write; send back as the staleness guard on the next write',
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('ADVANCE_FILTER_STAGE', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.advance(ctx, id, req.body);
  });

  app.post('/:id/submit-checklist', {
    preHandler: [app.requirePermission('FILTER_OPERATE')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'Submit checklist answers for current stage',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['answers', 'tapeVersion'],
        properties: {
          answers: {
            type: 'object',
            additionalProperties: true,
            description: 'Map of questionId -> answer value',
          },
          offlinePerformedAt: { type: 'string', format: 'date-time' },
          clientOpId: { type: 'string', description: 'Client-generated UUID for idempotent replay' },
          expectedProfileVersions: {
            type: 'object',
            additionalProperties: { type: 'integer' },
            description: 'Phase A.1: client-cached version per checklistProfileId. Server returns 409 SCHEMA_DRIFT if any version mismatches the cycle pin.',
          },
          // Phase 8.7 cutover (decision-tape architecture): required staleness
          // guard. See /advance route comment.
          tapeVersion: { type: 'integer', description: 'Required staleness guard; rejected with 409 STALE_TAPE on mismatch' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            filterId: { type: 'string' },
            filterName: { type: 'string', nullable: true },
            currentState: { type: 'string', nullable: true },
            currentCycle: { type: 'object', nullable: true, additionalProperties: true },
            nextBlocks: { type: 'array', items: { type: 'object', additionalProperties: true } },
            pipelineStages: { type: 'array', items: { type: 'object', additionalProperties: true } },
            profile: { type: 'object', nullable: true, additionalProperties: true },
            filterSet: { type: 'string', nullable: true },
            totalCycles: { type: 'integer' },
            equipmentGroup: { type: 'object', nullable: true, additionalProperties: true },
            // Phase 8.7 cutover: post-write tape.
            actions: {
              type: 'array',
              items: { type: 'object', additionalProperties: true, properties: { type: { type: 'string' }, label: { type: 'string' } } },
              description: 'Decision-tape: ordered list of permitted next actions after this write',
            },
            tapeVersion: {
              type: 'integer',
              description: 'Monotonic per-cycle version after this write; send back as the staleness guard on the next write',
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('SUBMIT_CHECKLIST_WITH_SIGNATURE', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.submitChecklist(ctx, id, req.body as any);
  });

  app.post('/:id/bypass', {
    preHandler: [app.requirePermission('FILTER_BYPASS')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'Bypass pipeline stage (deviation)',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['targetState', 'justification', 'tapeVersion'],
        properties: {
          targetState: { type: 'string' },
          justification: { type: 'string', minLength: 10 },
          parameters: { type: 'object' },
          offlinePerformedAt: { type: 'string', format: 'date-time' },
          clientOpId: { type: 'string', description: 'Client-generated UUID for idempotent replay' },
          // Phase 8.7 cutover (decision-tape architecture): required staleness guard.
          tapeVersion: { type: 'integer', description: 'Required staleness guard; rejected with 409 STALE_TAPE on mismatch' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            filterId: { type: 'string' },
            filterName: { type: 'string', nullable: true },
            currentState: { type: 'string', nullable: true },
            currentCycle: { type: 'object', nullable: true, additionalProperties: true },
            nextBlocks: { type: 'array', items: { type: 'object', additionalProperties: true } },
            pipelineStages: { type: 'array', items: { type: 'object', additionalProperties: true } },
            profile: { type: 'object', nullable: true, additionalProperties: true },
            filterSet: { type: 'string', nullable: true },
            totalCycles: { type: 'integer' },
            equipmentGroup: { type: 'object', nullable: true, additionalProperties: true },
            // Phase 8.7 cutover: post-write tape.
            actions: {
              type: 'array',
              items: { type: 'object', additionalProperties: true, properties: { type: { type: 'string' }, label: { type: 'string' } } },
              description: 'Decision-tape: ordered list of permitted next actions after this write',
            },
            tapeVersion: {
              type: 'integer',
              description: 'Monotonic per-cycle version after this write; send back as the staleness guard on the next write',
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('BYPASS_FILTER_STAGE', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.bypass(ctx, id, req.body);
  });

  // ── Retire a filter ──
  app.post('/:id/retire', {
    preHandler: [app.requireAnyPermission('FILTER_OPERATE', 'FILTER_RETIRE')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'Retire a filter permanently',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['remarks'],
        properties: { remarks: { type: 'string', minLength: 1 } },
      },
      response: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' } },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('RETIRE_FILTER', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    const { remarks } = req.body as { remarks: string };
    return service.retire(ctx, id, remarks);
  });

  // ── Replace a filter ──
  app.post('/:id/replace', {
    preHandler: [app.requireAnyPermission('FILTER_OPERATE', 'FILTER_REPLACE')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'Replace a filter (retire old + create new)',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['remarks'],
        properties: { remarks: { type: 'string', minLength: 1 } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            oldFilterId: { type: 'string' },
            newFilterId: { type: 'string' },
            newFilterName: { type: 'string' },
            identifiersMoved: { type: 'integer' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('REPLACE_FILTER', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    const { remarks } = req.body as { remarks: string };
    return service.replace(ctx, id, remarks);
  });

  // ── List retired filters ──
  app.get('/retirements', {
    preHandler: [app.requirePermission('ASSET_READ')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'List all retired filters',
      response: {
        200: { type: 'array', items: { type: 'object', additionalProperties: true } },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    return service.getRetirements(ctx);
  });

  // ── List replacements ──
  app.get('/replacements', {
    preHandler: [app.requirePermission('ASSET_READ')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'List filter replacement history',
      response: {
        200: { type: 'array', items: { type: 'object', additionalProperties: true } },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    return service.getReplacements(ctx);
  });

  app.post('/:id/terminate-cycle', {
    preHandler: [app.requirePermission('FILTER_BYPASS')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'Terminate active cleaning cycle',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['justification', 'tapeVersion'],
        properties: {
          justification: { type: 'string', minLength: 10 },
          offlinePerformedAt: { type: 'string', format: 'date-time' },
          clientOpId: { type: 'string', description: 'Client-generated UUID for idempotent replay' },
          // Phase 8.7 cutover (decision-tape architecture): required staleness guard.
          tapeVersion: { type: 'integer', description: 'Required staleness guard; rejected with 409 STALE_TAPE on mismatch' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            filterId: { type: 'string' },
            filterName: { type: 'string', nullable: true },
            currentState: { type: 'string', nullable: true },
            currentCycle: { type: 'object', nullable: true, additionalProperties: true },
            nextBlocks: { type: 'array', items: { type: 'object', additionalProperties: true } },
            pipelineStages: { type: 'array', items: { type: 'object', additionalProperties: true } },
            profile: { type: 'object', nullable: true, additionalProperties: true },
            filterSet: { type: 'string', nullable: true },
            totalCycles: { type: 'integer' },
            equipmentGroup: { type: 'object', nullable: true, additionalProperties: true },
            // Phase 8.7 cutover: post-write tape.
            actions: {
              type: 'array',
              items: { type: 'object', additionalProperties: true, properties: { type: { type: 'string' }, label: { type: 'string' } } },
              description: 'Decision-tape: ordered list of permitted next actions after this write',
            },
            tapeVersion: {
              type: 'integer',
              description: 'Monotonic per-cycle version after this write; send back as the staleness guard on the next write',
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('TERMINATE_CLEANING_CYCLE', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.terminateCycle(ctx, id, req.body as { justification: string; clientOpId?: string; tapeVersion?: number });
  });
}
