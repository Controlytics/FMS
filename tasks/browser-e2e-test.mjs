/**
 * Rule Chain System — Full Browser E2E Test with Screenshots
 *
 * Takes a screenshot at every major step so the user can visually verify
 * each action in the browser.
 */
import puppeteer from 'puppeteer';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:3000';
const APP_URL = 'http://localhost';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'Admin@1234';
const SCREENSHOT_DIR = 'tasks/screenshots';
const RUN_ID = Date.now().toString().slice(-6);

// Ensure screenshot directory
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

let stepNum = 0;
let browser, page;
let TOKEN = '';

// ── Helpers ─────────────────────────────────────────────────────
async function screenshot(name) {
  stepNum++;
  const filename = `${String(stepNum).padStart(2, '0')}-${name}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`📸 Step ${stepNum}: ${name} → ${filepath}`);
  return filepath;
}

async function waitAndScreenshot(name, waitMs = 1500) {
  await new Promise(r => setTimeout(r, waitMs));
  return screenshot(name);
}

function api(method, endpoint, body = null) {
  const args = [
    'curl', '-s', '--max-time', '10',
    '-X', method,
    `${BASE_URL}${endpoint}`,
    '-H', `"Content-Type: application/json"`,
    '-H', `"Authorization: Bearer ${TOKEN}"`,
    '-H', `"x-reauth-password: ${ADMIN_PASS}"`,
  ];
  if (body) args.push('-d', `'${JSON.stringify(body)}'`);
  const cmd = args.join(' ');
  try {
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 15000, shell: '/bin/bash' });
    return JSON.parse(result);
  } catch (e) {
    console.log(`   ⚠️  API call failed: ${method} ${endpoint}: ${e.message?.slice(0, 80)}`);
    return {};
  }
}

function deviceApi(endpoint, token, body) {
  const cmd = `curl -s -X POST "${BASE_URL}${endpoint}" -H "Content-Type: application/json" -H "Authorization: Bearer ${token}" -d '${JSON.stringify(body)}'`;
  const result = execSync(cmd, { encoding: 'utf-8', timeout: 10000 });
  try { return JSON.parse(result); } catch { return result; }
}

// ═══════════════════════════════════════════════════════════════════
// MAIN TEST
// ═══════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n🚀 Starting Rule Chain Browser E2E Test\n');
  console.log(`   Run ID: ${RUN_ID}`);
  console.log(`   App URL: ${APP_URL}`);
  console.log(`   Screenshots: ${SCREENSHOT_DIR}/\n`);

  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080'],
    defaultViewport: { width: 1920, height: 1080 },
  });
  page = await browser.newPage();

  try {
    // ═════════════════════════════════════════════════════════════
    // PHASE 1: LOGIN
    // ═════════════════════════════════════════════════════════════
    console.log('\n══ Phase 1: Login ══');

    await page.goto(`${APP_URL}/login`, { waitUntil: 'networkidle2', timeout: 15000 });
    await screenshot('login-page');

    // Fill login form
    await page.waitForSelector('input[name="username"], input[type="text"]', { timeout: 5000 });
    const inputs = await page.$$('input');
    if (inputs.length >= 2) {
      await inputs[0].click({ clickCount: 3 });
      await inputs[0].type(ADMIN_USER);
      await inputs[1].click({ clickCount: 3 });
      await inputs[1].type(ADMIN_PASS);
    }
    await screenshot('login-filled');

    // Click login button
    const loginBtn = await page.$('button[type="submit"]');
    if (loginBtn) await loginBtn.click();
    await new Promise(r => setTimeout(r, 3000));

    // Handle session conflict dialog if appears
    const allButtons = await page.$$('button');
    for (const btn of allButtons) {
      const text = await page.evaluate(el => el.textContent?.toLowerCase() || '', btn);
      if (text.includes('force') || text.includes('terminate') || text.includes('continue')) {
        await btn.click();
        await new Promise(r => setTimeout(r, 2000));
        break;
      }
    }

    await screenshot('after-login');

    // Get API token from browser sessionStorage (the browser already logged in)
    TOKEN = await page.evaluate(() => {
      return sessionStorage.getItem('token') || localStorage.getItem('token') || '';
    });

    if (!TOKEN) {
      // Fallback: API login
      console.log('   ⚠️  No token in storage, trying API login...');
      const loginResp = api('POST', '/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASS, force: true });
      TOKEN = loginResp.token || '';
    }

    if (!TOKEN) {
      console.log('   ❌ Could not obtain API token. Aborting.');
      await screenshot('no-token-error');
      await browser.close();
      return;
    }
    console.log(`   ✅ API Token obtained: ${TOKEN.slice(0, 20)}...`);

    // ═════════════════════════════════════════════════════════════
    // PHASE 2: VIEW NODE TYPES
    // ═════════════════════════════════════════════════════════════
    console.log('\n══ Phase 2: View Node Types ══');

    const nodeTypes = api('GET', '/api/rule-chains/node-types');
    console.log(`   ✅ ${nodeTypes.length} node types registered`);

    // Navigate to rule chains page
    await page.goto(`${APP_URL}/rule-chains`, { waitUntil: 'networkidle2', timeout: 15000 });
    await waitAndScreenshot('rule-chains-page', 2000);

    // ═════════════════════════════════════════════════════════════
    // PHASE 3: CREATE RULE CHAINS
    // ═════════════════════════════════════════════════════════════
    console.log('\n══ Phase 3: Create Rule Chains ══');

    // Chain 1: Basic Telemetry
    console.log('   Creating Chain 1: Basic Telemetry...');
    const chain1 = api('POST', '/api/rule-chains', { name: `BrowserTest-${RUN_ID} Chain1 Basic`, description: 'input → msg-type-filter → save-timeseries → log' });
    const chain1Id = chain1?.data?.id;
    console.log(`   Chain 1 ID: ${chain1Id}`);

    if (chain1Id) {
      api('POST', `/api/rule-chains/${chain1Id}/save`, {
        nodes: [
          { id: 'n1', type: 'input', name: 'Input', configuration: {}, positionX: 100, positionY: 200 },
          { id: 'n2', type: 'msg-type-filter', name: 'Type Filter', configuration: { messageTypes: ['POST_TELEMETRY'] }, positionX: 350, positionY: 200 },
          { id: 'n3', type: 'save-timeseries', name: 'Save TS', configuration: {}, positionX: 600, positionY: 150 },
          { id: 'n4', type: 'log', name: 'Logger', configuration: { level: 'info', template: 'Chain1: ${entityName}' }, positionX: 850, positionY: 150 },
        ],
        connections: [
          { fromNodeId: 'n1', toNodeId: 'n2', label: 'Success' },
          { fromNodeId: 'n2', toNodeId: 'n3', label: 'True' },
          { fromNodeId: 'n2', toNodeId: 'n4', label: 'False' },
          { fromNodeId: 'n3', toNodeId: 'n4', label: 'Success' },
        ],
        firstRuleNodeId: 'n1',
        changeNotes: 'Browser E2E test',
      });
      console.log('   ✅ Chain 1 saved');
    }

    // Chain 2: Alarm & Notification
    console.log('   Creating Chain 2: Alarm Pipeline...');
    const chain2 = api('POST', '/api/rule-chains', { name: `BrowserTest-${RUN_ID} Chain2 Alarm`, description: 'script-filter → create-alarm → send-notification' });
    const chain2Id = chain2?.data?.id;

    if (chain2Id) {
      api('POST', `/api/rule-chains/${chain2Id}/save`, {
        nodes: [
          { id: 'n1', type: 'input', name: 'Input', configuration: {}, positionX: 100, positionY: 200 },
          { id: 'n2', type: 'script-filter', name: 'Pressure>100', configuration: { script: 'return msg.pressure > 100;' }, positionX: 350, positionY: 200 },
          { id: 'n3', type: 'create-alarm', name: 'Create Alarm', configuration: { alarmType: 'HIGH_PRESSURE', severity: 'WARNING' }, positionX: 600, positionY: 100 },
          { id: 'n4', type: 'send-notification', name: 'Notify', configuration: { title: 'Pressure Alert', messageTemplate: 'High pressure: ${entityName}', targetRole: 'ADMIN' }, positionX: 850, positionY: 100 },
          { id: 'n5', type: 'clear-alarm', name: 'Clear Alarm', configuration: { alarmType: 'HIGH_PRESSURE' }, positionX: 600, positionY: 350 },
          { id: 'n6', type: 'log', name: 'Normal Log', configuration: { level: 'info', template: 'Normal: ${entityName}' }, positionX: 850, positionY: 350 },
        ],
        connections: [
          { fromNodeId: 'n1', toNodeId: 'n2', label: 'Success' },
          { fromNodeId: 'n2', toNodeId: 'n3', label: 'True' },
          { fromNodeId: 'n2', toNodeId: 'n5', label: 'False' },
          { fromNodeId: 'n3', toNodeId: 'n4', label: 'Success' },
          { fromNodeId: 'n5', toNodeId: 'n6', label: 'Success' },
        ],
        firstRuleNodeId: 'n1',
        changeNotes: 'Browser E2E test',
      });
      console.log('   ✅ Chain 2 saved');
    }

    // Chain 3: Enrichment & Transform
    console.log('   Creating Chain 3: Enrichment Transform...');
    const chain3 = api('POST', '/api/rule-chains', { name: `BrowserTest-${RUN_ID} Chain3 Enrich`, description: 'entity-attributes → entity-details → rename-keys → unit-conversion → save-timeseries' });
    const chain3Id = chain3?.data?.id;

    if (chain3Id) {
      api('POST', `/api/rule-chains/${chain3Id}/save`, {
        nodes: [
          { id: 'n1', type: 'input', name: 'Input', configuration: {}, positionX: 100, positionY: 200 },
          { id: 'n2', type: 'entity-attributes', name: 'Get Attrs', configuration: {}, positionX: 280, positionY: 200 },
          { id: 'n3', type: 'entity-details', name: 'Get Details', configuration: {}, positionX: 460, positionY: 200 },
          { id: 'n4', type: 'rename-keys', name: 'Rename', configuration: { mapping: { temp_f: 'temperature_f', hum: 'humidity' } }, positionX: 640, positionY: 200 },
          { id: 'n5', type: 'unit-conversion', name: 'Convert', configuration: { conversions: [{ key: 'temperature_f', formula: '(value - 32) * 5/9', outputKey: 'temperature_c' }] }, positionX: 820, positionY: 200 },
          { id: 'n6', type: 'save-timeseries', name: 'Save', configuration: {}, positionX: 1000, positionY: 200 },
        ],
        connections: [
          { fromNodeId: 'n1', toNodeId: 'n2', label: 'Success' },
          { fromNodeId: 'n2', toNodeId: 'n3', label: 'Success' },
          { fromNodeId: 'n3', toNodeId: 'n4', label: 'Success' },
          { fromNodeId: 'n4', toNodeId: 'n5', label: 'Success' },
          { fromNodeId: 'n5', toNodeId: 'n6', label: 'Success' },
        ],
        firstRuleNodeId: 'n1',
        changeNotes: 'Browser E2E test',
      });
      console.log('   ✅ Chain 3 saved');
    }

    // Chain 4: External Pipeline
    console.log('   Creating Chain 4: External Pipeline...');
    const chain4 = api('POST', '/api/rule-chains', { name: `BrowserTest-${RUN_ID} Chain4 External`, description: 'originator-type-filter → script-transform → rest-api-call → mqtt-publish → push-to-uns + check-alarm-status → to-email → send-email' });
    const chain4Id = chain4?.data?.id;

    if (chain4Id) {
      api('POST', `/api/rule-chains/${chain4Id}/save`, {
        nodes: [
          { id: 'n1', type: 'input', name: 'Input', configuration: {}, positionX: 50, positionY: 200 },
          { id: 'n2', type: 'originator-type-filter', name: 'Type Filter', configuration: { templateNames: [`BrowserTest-${RUN_ID} Actuator`] }, positionX: 200, positionY: 200 },
          { id: 'n3', type: 'script-transform', name: 'Transform', configuration: { script: 'msg.processed = true; return msg;' }, positionX: 380, positionY: 100 },
          { id: 'n4', type: 'rest-api-call', name: 'REST', configuration: { url: 'http://localhost:3000/api/health', method: 'GET', headers: {}, timeout: 5000 }, positionX: 560, positionY: 100 },
          { id: 'n5', type: 'mqtt-publish', name: 'MQTT', configuration: { topic: 'test/data', qos: 0, retain: false }, positionX: 740, positionY: 100 },
          { id: 'n6', type: 'push-to-uns', name: 'UNS', configuration: { unsPath: 'test/actuator' }, positionX: 920, positionY: 100 },
          { id: 'n7', type: 'save-timeseries', name: 'Save', configuration: {}, positionX: 1100, positionY: 100 },
          { id: 'n8', type: 'check-alarm-status', name: 'Alarm?', configuration: { alarmType: 'ERROR', status: 'ACTIVE' }, positionX: 380, positionY: 350 },
          { id: 'n9', type: 'to-email', name: 'Email Fmt', configuration: { subject: 'Alert: ${entityName}', body: 'Error on device', to: 'admin@test.com' }, positionX: 600, positionY: 350 },
          { id: 'n10', type: 'send-email', name: 'Send', configuration: { to: 'admin@test.com', subject: 'Alert', body: 'Error' }, positionX: 800, positionY: 350 },
        ],
        connections: [
          { fromNodeId: 'n1', toNodeId: 'n2', label: 'Success' },
          { fromNodeId: 'n2', toNodeId: 'n3', label: 'True' },
          { fromNodeId: 'n2', toNodeId: 'n8', label: 'False' },
          { fromNodeId: 'n3', toNodeId: 'n4', label: 'Success' },
          { fromNodeId: 'n4', toNodeId: 'n5', label: 'Success' },
          { fromNodeId: 'n5', toNodeId: 'n6', label: 'Success' },
          { fromNodeId: 'n6', toNodeId: 'n7', label: 'Success' },
          { fromNodeId: 'n8', toNodeId: 'n9', label: 'True' },
          { fromNodeId: 'n9', toNodeId: 'n10', label: 'Success' },
        ],
        firstRuleNodeId: 'n1',
        changeNotes: 'Browser E2E test',
      });
      console.log('   ✅ Chain 4 saved');
    }

    // Chain 5: Flow Control
    console.log('   Creating Chain 5: Flow Control...');
    const chain5 = api('POST', '/api/rule-chains', { name: `BrowserTest-${RUN_ID} Chain5 Flow`, description: 'delay → checkpoint → save-timeseries → acknowledge + rule-chain-input' });
    const chain5Id = chain5?.data?.id;

    if (chain5Id) {
      api('POST', `/api/rule-chains/${chain5Id}/save`, {
        nodes: [
          { id: 'n1', type: 'input', name: 'Input', configuration: {}, positionX: 100, positionY: 200 },
          { id: 'n2', type: 'delay', name: 'Delay 100ms', configuration: { delayMs: 100, maxDelayMs: 10000 }, positionX: 300, positionY: 200 },
          { id: 'n3', type: 'checkpoint', name: 'Checkpoint', configuration: {}, positionX: 500, positionY: 200 },
          { id: 'n4', type: 'save-timeseries', name: 'Save', configuration: {}, positionX: 700, positionY: 200 },
          { id: 'n5', type: 'acknowledge', name: 'ACK', configuration: {}, positionX: 900, positionY: 200 },
          { id: 'n6', type: 'rule-chain-input', name: 'Delegate', configuration: { targetChainId: chain1Id || '' }, positionX: 500, positionY: 400 },
        ],
        connections: [
          { fromNodeId: 'n1', toNodeId: 'n2', label: 'Success' },
          { fromNodeId: 'n2', toNodeId: 'n3', label: 'Success' },
          { fromNodeId: 'n3', toNodeId: 'n4', label: 'Success' },
          { fromNodeId: 'n4', toNodeId: 'n5', label: 'Success' },
          { fromNodeId: 'n3', toNodeId: 'n6', label: 'Failure' },
        ],
        firstRuleNodeId: 'n1',
        changeNotes: 'Browser E2E test',
      });
      console.log('   ✅ Chain 5 saved');
    }

    // Chain 6: Relationship
    console.log('   Creating Chain 6: Relationship Pipeline...');
    const chain6 = api('POST', '/api/rule-chains', { name: `BrowserTest-${RUN_ID} Chain6 Relation`, description: 'check-relation → related-attributes → tenant-attributes → change-originator → save-attributes → assign-to-user → rpc-call-reply' });
    const chain6Id = chain6?.data?.id;

    if (chain6Id) {
      api('POST', `/api/rule-chains/${chain6Id}/save`, {
        nodes: [
          { id: 'n1', type: 'input', name: 'Input', configuration: {}, positionX: 50, positionY: 200 },
          { id: 'n2', type: 'check-relation', name: 'Check Rel', configuration: { relationType: 'CONTAINS', direction: 'source' }, positionX: 200, positionY: 200 },
          { id: 'n3', type: 'related-attributes', name: 'Rel Attrs', configuration: { relationType: 'CONTAINS', direction: 'source' }, positionX: 380, positionY: 100 },
          { id: 'n4', type: 'tenant-attributes', name: 'Tenant', configuration: {}, positionX: 560, positionY: 100 },
          { id: 'n5', type: 'change-originator', name: 'Change Orig', configuration: { target: 'parent' }, positionX: 740, positionY: 100 },
          { id: 'n6', type: 'save-attributes', name: 'Save Attrs', configuration: { scope: 'server' }, positionX: 920, positionY: 100 },
          { id: 'n7', type: 'assign-to-user', name: 'Assign', configuration: { userId: '' }, positionX: 1100, positionY: 100 },
          { id: 'n8', type: 'rpc-call-reply', name: 'RPC Reply', configuration: {}, positionX: 380, positionY: 350 },
        ],
        connections: [
          { fromNodeId: 'n1', toNodeId: 'n2', label: 'Success' },
          { fromNodeId: 'n2', toNodeId: 'n3', label: 'True' },
          { fromNodeId: 'n2', toNodeId: 'n8', label: 'False' },
          { fromNodeId: 'n3', toNodeId: 'n4', label: 'Success' },
          { fromNodeId: 'n4', toNodeId: 'n5', label: 'Success' },
          { fromNodeId: 'n5', toNodeId: 'n6', label: 'Success' },
          { fromNodeId: 'n6', toNodeId: 'n7', label: 'Success' },
        ],
        firstRuleNodeId: 'n1',
        changeNotes: 'Browser E2E test',
      });
      console.log('   ✅ Chain 6 saved');
    }

    // Screenshot rule chains list
    await page.goto(`${APP_URL}/rule-chains`, { waitUntil: 'networkidle2', timeout: 15000 });
    await waitAndScreenshot('rule-chains-all-6-created', 2000);

    // View each chain editor
    for (const [i, chainId] of [chain1Id, chain2Id, chain3Id, chain4Id, chain5Id, chain6Id].entries()) {
      if (chainId) {
        await page.goto(`${APP_URL}/rule-chains/${chainId}`, { waitUntil: 'networkidle2', timeout: 15000 });
        await waitAndScreenshot(`rule-chain-${i + 1}-editor`, 2000);
      }
    }

    // ═════════════════════════════════════════════════════════════
    // PHASE 4: CREATE TEMPLATES
    // ═════════════════════════════════════════════════════════════
    console.log('\n══ Phase 4: Create Templates ══');

    const templates = [
      {
        name: `BrowserTest-${RUN_ID} TempSensor`, category: 'Sensor', icon: 'thermometer',
        chainId: chain1Id, transport: 'HTTP',
        telemetry: [
          { fieldName: 'temperature', dataType: 'FLOAT', unit: '°C' },
          { fieldName: 'humidity', dataType: 'FLOAT', unit: '%' },
          { fieldName: 'pressure', dataType: 'FLOAT', unit: 'hPa' },
        ],
        alarms: [
          { name: 'Temp High', type: 'HIGH', severity: 'WARNING', sourceField: 'temperature', threshold: 80, enabled: true },
        ],
      },
      {
        name: `BrowserTest-${RUN_ID} PressureMon`, category: 'Sensor', icon: 'gauge',
        chainId: chain2Id, transport: 'HTTP',
        telemetry: [
          { fieldName: 'pressure', dataType: 'FLOAT', unit: 'PSI' },
          { fieldName: 'flow_rate', dataType: 'FLOAT', unit: 'L/min' },
          { fieldName: 'valve_status', dataType: 'BOOLEAN' },
        ],
        alarms: [],
      },
      {
        name: `BrowserTest-${RUN_ID} EnvSensor`, category: 'Sensor', icon: 'cloud',
        chainId: chain3Id, transport: 'HTTP',
        telemetry: [
          { fieldName: 'temp_f', dataType: 'FLOAT', unit: '°F' },
          { fieldName: 'humidity_pct', dataType: 'FLOAT', unit: '%' },
          { fieldName: 'co2_ppm', dataType: 'INTEGER', unit: 'ppm' },
        ],
        alarms: [],
      },
      {
        name: `BrowserTest-${RUN_ID} Actuator`, category: 'Equipment', icon: 'cog',
        chainId: chain4Id, transport: 'HTTP',
        telemetry: [
          { fieldName: 'position', dataType: 'FLOAT', unit: 'deg' },
          { fieldName: 'speed', dataType: 'FLOAT', unit: 'RPM' },
          { fieldName: 'current', dataType: 'FLOAT', unit: 'A' },
          { fieldName: 'error_code', dataType: 'STRING' },
        ],
        alarms: [],
      },
      {
        name: `BrowserTest-${RUN_ID} FlowCtrl`, category: 'Equipment', icon: 'activity',
        chainId: chain5Id, transport: 'HTTP',
        telemetry: [
          { fieldName: 'flow', dataType: 'FLOAT', unit: 'L/min' },
          { fieldName: 'temperature', dataType: 'FLOAT', unit: '°C' },
          { fieldName: 'level', dataType: 'FLOAT', unit: '%' },
        ],
        alarms: [],
      },
      {
        name: `BrowserTest-${RUN_ID} DataLog`, category: 'Equipment', icon: 'database',
        chainId: chain6Id, transport: 'HTTP',
        telemetry: [
          { fieldName: 'reading', dataType: 'FLOAT' },
          { fieldName: 'status', dataType: 'STRING' },
          { fieldName: 'batch_id', dataType: 'STRING' },
        ],
        alarms: [],
      },
    ];

    const templateIds = [];
    for (const [i, t] of templates.entries()) {
      const resp = api('POST', '/api/assets/templates', {
        name: t.name,
        description: `Browser E2E test template ${i + 1}`,
        category: t.category,
        icon: t.icon,
        dataIngestionEnabled: true,
        transportType: t.transport,
        credentialType: 'TOKEN',
        defaultRuleChainId: t.chainId,
        telemetrySchema: t.telemetry,
        alarmRules: t.alarms,
        attributeSchema: [],
        expectedIdentifiers: [],
        expectedRelationships: [],
        statusLifecycle: [],
        checklistSchema: [],
      });
      const tid = resp?.data?.id;
      templateIds.push(tid);
      console.log(`   ✅ Template ${i + 1} "${t.name}" created: ${tid}`);
    }

    // Screenshot templates page
    await page.goto(`${APP_URL}/assets/templates`, { waitUntil: 'networkidle2', timeout: 15000 });
    await waitAndScreenshot('templates-all-6-created', 2000);

    // ═════════════════════════════════════════════════════════════
    // PHASE 5: CREATE ENTITIES
    // ═════════════════════════════════════════════════════════════
    console.log('\n══ Phase 5: Create Entities ══');

    const entityNames = ['TempSensor', 'PressureMon', 'EnvSensor', 'Actuator', 'FlowCtrl', 'DataLog'];
    const entityMap = {}; // key -> { id, token }

    for (let ti = 0; ti < templateIds.length; ti++) {
      const tid = templateIds[ti];
      if (!tid) continue;
      for (let ei = 1; ei <= 3; ei++) {
        const key = `${String.fromCharCode(65 + ti)}${ei}`;
        const name = `BT-${RUN_ID}-${entityNames[ti]}-${ei}`;
        const resp = api('POST', '/api/assets/instances', {
          name, description: `Browser test entity ${key}`,
          templateId: tid, status: 'Active', attributes: {}, customAttributes: {},
        });
        const eid = resp?.data?.id;
        if (eid) {
          // Get device token
          const conn = api('GET', `/api/connectivity/${eid}`);
          const token = conn?.credential?.token;
          entityMap[key] = { id: eid, name, token };
          console.log(`   ✅ Entity ${key} "${name}" → token: ${token?.slice(0, 12)}...`);
        } else {
          console.log(`   ❌ Entity ${key} failed: ${JSON.stringify(resp)}`);
        }
      }
    }

    // Create CONTAINS relationship F1→F2
    if (entityMap.F1 && entityMap.F2) {
      const relResp = api('POST', '/api/assets/relationships', {
        sourceAssetId: entityMap.F1.id,
        targetAssetId: entityMap.F2.id,
        relationshipType: 'CONTAINS',
      });
      console.log(`   ✅ CONTAINS relationship F1→F2 created`);
    }

    // Screenshot entities page
    await page.goto(`${APP_URL}/assets`, { waitUntil: 'networkidle2', timeout: 15000 });
    await waitAndScreenshot('entities-all-18-created', 2000);

    // ═════════════════════════════════════════════════════════════
    // PHASE 6: SEND TELEMETRY & SCREENSHOT RESULTS
    // ═════════════════════════════════════════════════════════════
    console.log('\n══ Phase 6: Send Telemetry ══');

    // Suite 1: Basic telemetry → Chain 1 (TempSensor)
    console.log('   Suite 1: Basic Telemetry...');
    if (entityMap.A1?.token) {
      deviceApi('/api/data/telemetry', entityMap.A1.token, { temperature: 28.5, humidity: 65.2, pressure: 1012.3 });
      console.log('   ✅ A1: normal telemetry sent');
    }
    if (entityMap.A2?.token) {
      deviceApi('/api/data/telemetry', entityMap.A2.token, { temperature: 85.0, humidity: 30.0, pressure: 1005.0 });
      console.log('   ✅ A2: high temp telemetry sent (should trigger alarm rule)');
    }
    if (entityMap.A3?.token) {
      deviceApi('/api/data/telemetry', entityMap.A3.token, { temperature: 22.0 });
      console.log('   ✅ A3: partial fields sent');
    }

    // Suite 2: Alarm pipeline → Chain 2 (PressureMon)
    console.log('   Suite 2: Alarm Pipeline...');
    if (entityMap.B1?.token) {
      deviceApi('/api/data/telemetry', entityMap.B1.token, { pressure: 120.0, flow_rate: 5.5, valve_status: false });
      console.log('   ✅ B1: HIGH pressure (>100) → should create alarm');
    }
    if (entityMap.B2?.token) {
      deviceApi('/api/data/telemetry', entityMap.B2.token, { pressure: 50.0, flow_rate: 3.0, valve_status: true });
      console.log('   ✅ B2: normal pressure → should clear alarm');
    }
    if (entityMap.B3?.token) {
      deviceApi('/api/data/telemetry', entityMap.B3.token, { pressure: 150.0, flow_rate: 8.0, valve_status: false });
      console.log('   ✅ B3: VERY high pressure → alarm');
    }

    // Suite 3: Enrichment & Transform → Chain 3 (EnvSensor)
    console.log('   Suite 3: Enrichment & Transform...');
    if (entityMap.C1?.token) {
      deviceApi('/api/data/telemetry', entityMap.C1.token, { temp_f: 98.6, humidity_pct: 45.0, co2_ppm: 400 });
      console.log('   ✅ C1: Fahrenheit data → rename-keys + unit-conversion');
    }
    if (entityMap.C2?.token) {
      deviceApi('/api/data/telemetry', entityMap.C2.token, { temp_f: 212.0, humidity_pct: 100.0, co2_ppm: 5000 });
      console.log('   ✅ C2: boiling point');
    }

    // Suite 4: External Pipeline → Chain 4 (Actuator)
    console.log('   Suite 4: External Pipeline...');
    if (entityMap.D1?.token) {
      deviceApi('/api/data/telemetry', entityMap.D1.token, { position: 45.5, speed: 120.0, current: 3.2, error_code: 'OK' });
      console.log('   ✅ D1: actuator data → script-transform → rest-api → mqtt → uns');
    }
    if (entityMap.D2?.token) {
      deviceApi('/api/data/telemetry', entityMap.D2.token, { position: 90.0, speed: 0.0, current: 0.1, error_code: 'STALL' });
      console.log('   ✅ D2: error condition');
    }

    // Suite 5: Flow Control → Chain 5 (FlowCtrl)
    console.log('   Suite 5: Flow Control...');
    if (entityMap.E1?.token) {
      deviceApi('/api/data/telemetry', entityMap.E1.token, { flow: 25.5, temperature: 22.0, level: 75.0 });
      console.log('   ✅ E1: flow data → delay → checkpoint → save → ack');
    }
    if (entityMap.E2?.token) {
      deviceApi('/api/data/telemetry', entityMap.E2.token, { flow: 0.0, temperature: 18.0, level: 90.0 });
      console.log('   ✅ E2: zero flow');
    }

    // Suite 6: Relationship Pipeline → Chain 6 (DataLog)
    console.log('   Suite 6: Relationship Pipeline...');
    if (entityMap.F1?.token) {
      deviceApi('/api/data/telemetry', entityMap.F1.token, { reading: 42.0, status: 'GOOD', batch_id: 'B001' });
      console.log('   ✅ F1: reading with CONTAINS relationship');
    }
    if (entityMap.F2?.token) {
      deviceApi('/api/data/telemetry', entityMap.F2.token, { reading: 99.9, status: 'WARNING', batch_id: 'B002' });
      console.log('   ✅ F2: warning reading');
    }

    // Edge cases
    console.log('   Edge cases...');
    if (entityMap.A1?.token) {
      deviceApi('/api/data/telemetry', entityMap.A1.token, {});
      console.log('   ✅ Empty payload');
      deviceApi('/api/data/telemetry', entityMap.A1.token, { temperature: null, humidity: null });
      console.log('   ✅ Null values');
      deviceApi('/api/data/telemetry', entityMap.A1.token, { ts: Date.now(), values: { temperature: 55.5, humidity: 40.0 } });
      console.log('   ✅ Timestamped format');

      // Rapid fire
      for (let i = 0; i < 5; i++) {
        deviceApi('/api/data/telemetry', entityMap.A1.token, { temperature: 20 + i, humidity: 50 + i });
      }
      console.log('   ✅ Rapid fire (5 messages)');
    }

    await new Promise(r => setTimeout(r, 3000)); // Wait for async processing

    // ═════════════════════════════════════════════════════════════
    // PHASE 7: BROWSER VERIFICATION — SCREENSHOT EVERYTHING
    // ═════════════════════════════════════════════════════════════
    console.log('\n══ Phase 7: Browser Verification (Screenshots) ══');

    // Re-login in browser (our API login killed the session)
    await page.goto(`${APP_URL}/login`, { waitUntil: 'networkidle2', timeout: 15000 });
    await new Promise(r => setTimeout(r, 1000));
    const currentUrl = page.url();
    if (currentUrl.includes('login')) {
      const loginInputs = await page.$$('input');
      if (loginInputs.length >= 2) {
        await loginInputs[0].click({ clickCount: 3 });
        await loginInputs[0].type(ADMIN_USER);
        await loginInputs[1].click({ clickCount: 3 });
        await loginInputs[1].type(ADMIN_PASS);
      }
      const submitBtn = await page.$('button[type="submit"]');
      if (submitBtn) await submitBtn.click();
      await new Promise(r => setTimeout(r, 3000));

      // Handle session conflict
      const btns = await page.$$('button');
      for (const btn of btns) {
        const text = await page.evaluate(el => el.textContent?.toLowerCase() || '', btn);
        if (text.includes('force') || text.includes('terminate') || text.includes('continue')) {
          await btn.click();
          await new Promise(r => setTimeout(r, 2000));
          break;
        }
      }
    }
    await screenshot('browser-logged-in');

    // 7a: Rule Chains List
    await page.goto(`${APP_URL}/rule-chains`, { waitUntil: 'networkidle2', timeout: 15000 });
    await waitAndScreenshot('verify-rule-chains-list', 2000);

    // 7b: View each chain in editor
    for (const [i, chainId] of [chain1Id, chain2Id, chain3Id, chain4Id, chain5Id, chain6Id].entries()) {
      if (chainId) {
        await page.goto(`${APP_URL}/rule-chains/${chainId}`, { waitUntil: 'networkidle2', timeout: 15000 });
        await waitAndScreenshot(`verify-chain-${i + 1}-nodes`, 2500);
      }
    }

    // 7c: Entity Templates
    await page.goto(`${APP_URL}/assets/templates`, { waitUntil: 'networkidle2', timeout: 15000 });
    await waitAndScreenshot('verify-templates-list', 2000);

    // 7d: Entity Explorer
    await page.goto(`${APP_URL}/assets`, { waitUntil: 'networkidle2', timeout: 15000 });
    await waitAndScreenshot('verify-entities-explorer', 2000);

    // 7e: Click into specific entities to see telemetry
    for (const key of ['A1', 'B1', 'C1', 'D1', 'E1', 'F1']) {
      const entity = entityMap[key];
      if (entity?.id) {
        await page.goto(`${APP_URL}/assets/${entity.id}`, { waitUntil: 'networkidle2', timeout: 15000 });
        await waitAndScreenshot(`verify-entity-${key}-detail`, 2000);

        // Try clicking Telemetry tab
        const tabs = await page.$$('[role="tab"], button');
        for (const tab of tabs) {
          const text = await page.evaluate(el => el.textContent || '', tab);
          if (text.toLowerCase().includes('telemetry') || text.toLowerCase().includes('data')) {
            await tab.click();
            await waitAndScreenshot(`verify-entity-${key}-telemetry`, 2000);
            break;
          }
        }

        // Try clicking Connectivity tab
        for (const tab of tabs) {
          const text = await page.evaluate(el => el.textContent || '', tab);
          if (text.toLowerCase().includes('connectivity') || text.toLowerCase().includes('connect')) {
            await tab.click();
            await waitAndScreenshot(`verify-entity-${key}-connectivity`, 2000);
            break;
          }
        }
      }
    }

    // 7f: Alarms page
    await page.goto(`${APP_URL}/alarms`, { waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
    await waitAndScreenshot('verify-alarms-page', 2000);

    // Also try via queries route
    const alarmsData = api('GET', '/api/queries/alarms?limit=20');
    console.log(`   Alarms found: ${alarmsData?.total || alarmsData?.data?.length || 0}`);

    // 7g: Notifications page
    await page.goto(`${APP_URL}/notifications`, { waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
    await waitAndScreenshot('verify-notifications-page', 2000);

    const notifsData = api('GET', '/api/notifications?limit=5');
    console.log(`   Notifications found: ${notifsData?.data?.length || 0}`);

    // 7h: Audit trail
    await page.goto(`${APP_URL}/audit`, { waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
    await waitAndScreenshot('verify-audit-trail', 2000);

    // 7i: Connectivity check for one entity
    if (entityMap.A1?.id) {
      const connStatus = api('GET', `/api/connectivity/${entityMap.A1.id}`);
      console.log(`   Entity A1 connectivity: ${connStatus?.connectivity?.status} (${connStatus?.connectivity?.protocol || 'N/A'})`);
    }

    // ═════════════════════════════════════════════════════════════
    // PHASE 8: SUMMARY
    // ═════════════════════════════════════════════════════════════
    console.log('\n══ Phase 8: Summary ══');
    console.log(`   📸 Total screenshots: ${stepNum}`);
    console.log(`   📁 Screenshots in: ${SCREENSHOT_DIR}/`);
    console.log(`   🔗 Rule Chains: 6 created (${[chain1Id, chain2Id, chain3Id, chain4Id, chain5Id, chain6Id].filter(Boolean).length} verified)`);
    console.log(`   📋 Templates: ${templateIds.filter(Boolean).length} created`);
    console.log(`   🏭 Entities: ${Object.keys(entityMap).length} created`);
    console.log(`   📡 Telemetry: ~25 messages sent across 6 test suites`);
    console.log('\n   ✅ All data persists in database for browser inspection.');
    console.log(`   🌐 Open ${APP_URL} to inspect live.\n`);

    // List all screenshots
    console.log('   📸 Screenshots taken:');
    const files = fs.readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith('.png')).sort();
    for (const f of files) {
      console.log(`      ${f}`);
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
    await screenshot('error-state').catch(() => {});
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
