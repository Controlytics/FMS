/**
 * Publish telemetry + attributes for HTTP entities.
 * Usage: node publish-http.js [count]
 *   count: number of telemetry and attribute messages to publish (default: 100)
 *
 * Publishes to FlowMeter-WTP-001 and VibSensor-Motor-001 via HTTP.
 * Copy to EC2 and run: scp publish-http.js ubuntu@host:/tmp/ && ssh ubuntu@host "node /tmp/publish-http.js"
 */
const http = require('http');

const COUNT = parseInt(process.argv[2] || '100', 10);

const ENTITIES = [
  {
    name: 'FlowMeter-WTP-001',
    token: 'bdadb00c06fd4e76a2be212d0e833136148e5a99ee2e1fcce8277780593f69e5',
    telemetry: () => ({
      flowRate: +(5 + Math.random() * 20).toFixed(2),
      totalVolume: +(1000 + Math.random() * 5000).toFixed(2),
    }),
    attributes: (i) => ({
      meterModel: `FlowMeter-${String(i + 1).padStart(3, '0')}`,
      calibrationDate: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
    }),
  },
  {
    name: 'VibSensor-Motor-001',
    token: '96a1101195525160a83e761d33a66a041523b36c319b11e43025599092c95f5d',
    telemetry: () => ({
      vibrationX: +(5 + Math.random() * 20).toFixed(2),
      vibrationY: +(1000 + Math.random() * 5000).toFixed(2),
    }),
    attributes: (i) => ({
      motorId: `VibSensor-${String(i + 1).padStart(3, '0')}`,
      installDate: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
    }),
  },
];

function httpPost(path, body, token) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = {
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Authorization': `Bearer ${token}`,
      },
    };
    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function publishEntity(entity) {
  console.log(`\n=== HTTP: ${entity.name} ===`);

  for (let i = 0; i < COUNT; i++) {
    const res = await httpPost('/api/data/telemetry', entity.telemetry(), entity.token);
    if (i === 0) console.log(`  First response: ${res.status}`);
    if ((i + 1) % 25 === 0) console.log(`  Telemetry: ${i + 1}/${COUNT} (${res.status})`);
  }

  for (let i = 0; i < COUNT; i++) {
    const res = await httpPost('/api/data/attributes', entity.attributes(i), entity.token);
    if ((i + 1) % 25 === 0) console.log(`  Attributes: ${i + 1}/${COUNT} (${res.status})`);
  }

  console.log(`  Done: ${entity.name}`);
}

async function main() {
  console.log(`Publishing ${COUNT} telemetry + ${COUNT} attributes per entity via HTTP`);
  for (const entity of ENTITIES) {
    await publishEntity(entity);
  }

  console.log('\nWaiting 3s for ingestion...');
  await new Promise(r => setTimeout(r, 3000));

  const { execSync } = require('child_process');
  const counts = execSync(
    `PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db -t -A -c "` +
    `SELECT 'ts_telemetry', COUNT(*) FROM ts_telemetry UNION ALL SELECT 'ts_attributes', COUNT(*) FROM ts_attributes"`
  ).toString().trim();
  console.log('\n=== DB Counts ===');
  console.log(counts);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
