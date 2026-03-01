import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp, loginAs, authGet, authPost, authPut, authDelete, ADMIN_PASSWORD } from './test-helper.js';

const SUFFIX = Date.now().toString(36);

describe('Checklist Template E2E', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let templateId: string;

  beforeAll(async () => {
    app = await buildApp();
    adminToken = await loginAs(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // =============================================
  // Create template with checklist
  // =============================================
  describe('Create template with checklistSchema', () => {
    it('creates a template with checklist items', async () => {
      const res = await authPost(app, '/api/assets/templates', adminToken, {
        name: `Checklist Template ${SUFFIX}`,
        description: 'Template with checklist questions',
        category: 'Equipment',
        attributeSchema: [
          { fieldName: 'serialNumber', dataType: 'TEXT' },
        ],
        checklistSchema: [
          {
            question: 'Is the equipment clean?',
            questionType: 'YES_NO',
            required: true,
            section: 'Pre-check',
            description: 'Verify cleanliness before operation',
          },
          {
            question: 'Rate the condition',
            questionType: 'MCQ',
            options: ['Good', 'Fair', 'Poor'],
            section: 'Inspection',
          },
          {
            question: 'Measure temperature',
            questionType: 'NUMERIC',
            numericUnit: 'C',
            numericMin: 10,
            numericMax: 80,
            required: true,
            section: 'Measurements',
          },
          {
            question: 'Visual inspection pass/fail',
            questionType: 'PASS_FAIL',
            passCriteria: 'No visible damage',
            section: 'Inspection',
          },
          {
            question: 'Additional notes',
            questionType: 'TEXT',
          },
        ],
        maxParentConnections: 1,
        maxConnections: 5,
      }, ADMIN_PASSWORD);

      expect([200, 201]).toContain(res.statusCode);
      const body = JSON.parse(res.body);
      const data = body.data || body;
      expect(data.name).toBe(`Checklist Template ${SUFFIX}`);
      expect(data.id).toBeTruthy();
      expect(data.checklistSchema).toBeDefined();
      expect(data.checklistSchema).toHaveLength(5);
      templateId = data.id;
    });

    it('creates a template with empty checklist', async () => {
      const res = await authPost(app, '/api/assets/templates', adminToken, {
        name: `No Checklist ${SUFFIX}`,
        checklistSchema: [],
      }, ADMIN_PASSWORD);

      expect([200, 201]).toContain(res.statusCode);
      const body = JSON.parse(res.body);
      const data = body.data || body;
      expect(data.checklistSchema).toEqual([]);
    });

    it('creates a template without specifying checklist (defaults to empty)', async () => {
      const res = await authPost(app, '/api/assets/templates', adminToken, {
        name: `Default Checklist ${SUFFIX}`,
      }, ADMIN_PASSWORD);

      expect([200, 201]).toContain(res.statusCode);
      const body = JSON.parse(res.body);
      const data = body.data || body;
      expect(data.checklistSchema).toEqual([]);
    });
  });

  // =============================================
  // Read template with checklist
  // =============================================
  describe('Read template with checklistSchema', () => {
    it('GET by ID returns checklistSchema', async () => {
      expect(templateId).toBeTruthy();
      const res = await authGet(app, `/api/assets/templates/${templateId}`, adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.checklistSchema).toHaveLength(5);

      // Verify first item
      const q1 = body.checklistSchema[0];
      expect(q1.question).toBe('Is the equipment clean?');
      expect(q1.questionType).toBe('YES_NO');
      expect(q1.required).toBe(true);
      expect(q1.section).toBe('Pre-check');

      // Verify MCQ item has options
      const q2 = body.checklistSchema[1];
      expect(q2.questionType).toBe('MCQ');
      expect(q2.options).toEqual(['Good', 'Fair', 'Poor']);

      // Verify NUMERIC item has constraints
      const q3 = body.checklistSchema[2];
      expect(q3.questionType).toBe('NUMERIC');
      expect(q3.numericUnit).toBe('C');
      expect(q3.numericMin).toBe(10);
      expect(q3.numericMax).toBe(80);
    });

    it('GET templates list includes checklistSchema', async () => {
      const res = await authGet(app, `/api/assets/templates?search=Checklist+Template+${SUFFIX}`, adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      const found = body.data.find((t: any) => t.id === templateId);
      expect(found).toBeTruthy();
      expect(found.checklistSchema).toHaveLength(5);
    });
  });

  // =============================================
  // Update template checklist
  // =============================================
  describe('Update template checklistSchema', () => {
    it('updates checklistSchema with new items', async () => {
      expect(templateId).toBeTruthy();
      const res = await authPut(app, `/api/assets/templates/${templateId}`, adminToken, {
        checklistSchema: [
          {
            question: 'Sign-off by supervisor',
            questionType: 'SIGNATURE',
            required: true,
            section: 'Completion',
          },
          {
            question: 'Upload photo evidence',
            questionType: 'PHOTO',
            section: 'Documentation',
          },
          {
            question: 'Select all applicable',
            questionType: 'MULTI_SELECT',
            options: ['A', 'B', 'C', 'D'],
          },
        ],
      }, ADMIN_PASSWORD);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const data = body.data || body;
      expect(data.checklistSchema).toHaveLength(3);
      expect(data.checklistSchema[0].questionType).toBe('SIGNATURE');
    });

    it('clears checklistSchema by setting to empty array', async () => {
      expect(templateId).toBeTruthy();
      const res = await authPut(app, `/api/assets/templates/${templateId}`, adminToken, {
        checklistSchema: [],
      }, ADMIN_PASSWORD);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const data = body.data || body;
      expect(data.checklistSchema).toEqual([]);
    });

    it('restores checklistSchema for version test', async () => {
      expect(templateId).toBeTruthy();
      const res = await authPut(app, `/api/assets/templates/${templateId}`, adminToken, {
        checklistSchema: [
          { question: 'Final check', questionType: 'YES_NO_NA', required: true },
        ],
      }, ADMIN_PASSWORD);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const data = body.data || body;
      expect(data.checklistSchema).toHaveLength(1);
    });
  });

  // =============================================
  // Version snapshots include checklist
  // =============================================
  describe('Version snapshots include checklistSchema', () => {
    it('versions contain checklistSchema in snapshot', async () => {
      expect(templateId).toBeTruthy();
      const res = await authGet(app, `/api/assets/templates/${templateId}/versions`, adminToken);
      expect(res.statusCode).toBe(200);
      const versions = JSON.parse(res.body);
      expect(Array.isArray(versions)).toBe(true);
      expect(versions.length).toBeGreaterThanOrEqual(1);

      // Most recent version should have checklistSchema in its snapshot
      const latest = versions[0];
      expect(latest.snapshot).toBeDefined();
      const snapshot = typeof latest.snapshot === 'string' ? JSON.parse(latest.snapshot) : latest.snapshot;
      expect(snapshot.checklistSchema).toBeDefined();
    });
  });

  // =============================================
  // Validation: bad checklist data
  // =============================================
  describe('Validation', () => {
    it('rejects template with invalid questionType', async () => {
      const res = await authPost(app, '/api/assets/templates', adminToken, {
        name: `Bad QType ${SUFFIX}`,
        checklistSchema: [
          { question: 'Test', questionType: 'NOT_A_REAL_TYPE' },
        ],
      }, ADMIN_PASSWORD);
      expect(res.statusCode).toBe(400);
    });

    it('rejects template with empty question', async () => {
      const res = await authPost(app, '/api/assets/templates', adminToken, {
        name: `Bad Empty Q ${SUFFIX}`,
        checklistSchema: [
          { question: '', questionType: 'TEXT' },
        ],
      }, ADMIN_PASSWORD);
      expect(res.statusCode).toBe(400);
    });

    it('rejects template with missing questionType', async () => {
      const res = await authPost(app, '/api/assets/templates', adminToken, {
        name: `Bad No QType ${SUFFIX}`,
        checklistSchema: [
          { question: 'Only a question with no type' },
        ],
      }, ADMIN_PASSWORD);
      expect(res.statusCode).toBe(400);
    });
  });

  // =============================================
  // All 14 question types via API
  // =============================================
  describe('All 14 question types', () => {
    const QUESTION_TYPES = [
      'PASS_FAIL', 'YES_NO', 'YES_NO_NA', 'MCQ', 'MULTI_SELECT',
      'TEXT', 'NUMERIC', 'DROPDOWN', 'PHOTO', 'DATE_TIME',
      'SIGNATURE', 'YES_NO_COMMENT', 'CALCULATED', 'CONDITIONAL',
    ];

    it('creates template with all 14 types', async () => {
      const checklist = QUESTION_TYPES.map((qt, i) => ({
        question: `Question ${i + 1} for ${qt}`,
        questionType: qt,
        section: `Section ${Math.floor(i / 3) + 1}`,
      }));

      const res = await authPost(app, '/api/assets/templates', adminToken, {
        name: `All Types ${SUFFIX}`,
        checklistSchema: checklist,
      }, ADMIN_PASSWORD);

      expect([200, 201]).toContain(res.statusCode);
      const body = JSON.parse(res.body);
      const data = body.data || body;
      expect(data.checklistSchema).toHaveLength(14);

      // Verify each type is stored correctly
      for (let i = 0; i < QUESTION_TYPES.length; i++) {
        expect(data.checklistSchema[i].questionType).toBe(QUESTION_TYPES[i]);
      }
    });
  });

  // =============================================
  // Cleanup
  // =============================================
  describe('Cleanup', () => {
    it('soft-deletes the checklist template', async () => {
      expect(templateId).toBeTruthy();
      const res = await authDelete(app, `/api/assets/templates/${templateId}`, adminToken, ADMIN_PASSWORD);
      expect(res.statusCode).toBe(200);
    });
  });
});
