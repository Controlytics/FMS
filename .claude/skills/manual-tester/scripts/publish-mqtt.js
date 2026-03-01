/**
 * Publish telemetry + attributes for MQTT entities using correct UNS topics.
 * Usage: node publish-mqtt.js [count]
 *   count: number of telemetry and attribute messages to publish (default: 100)
 *
 * Publishes to Pipeline-Sensor-001 via MQTT.
 * Copy to EC2 and run: scp publish-mqtt.js ubuntu@host:/tmp/ && ssh ubuntu@host "node /tmp/publish-mqtt.js"
 */
const mqtt = require('/home/ubuntu/21cfrlogbook/node_modules/mqtt');

const COUNT = parseInt(process.argv[2] || '100', 10);

const ENTITIES = [
  {
    name: 'Pipeline-Sensor-001',
    token: 'a25a3b98edbcbf3ceb47e5aa318fae8820b9394883dcee21c551e2eb6b1e01df',
    unsPath: 'digilog/v1/pipeline-sensor-001',
    telemetry: () => ({
      pressure: +(80 + Math.random() * 40).toFixed(2),
      temperature: +(20 + Math.random() * 30).toFixed(2),
    }),
    attributes: (i) => ({
      serialNumber: `PS-${String(i + 1).padStart(4, '0')}`,
      maxPressure: +(100 + Math.random() * 100).toFixed(2),
    }),
  },
  // Add TemperatureSensor here if needed:
  // {
  //   name: 'TemperatureSensor',
  //   token: 'Welcome@123',
  //   unsPath: 'digilog/v1/temperaturesensor',
  //   telemetry: () => ({ temperature: +(15 + Math.random() * 25).toFixed(2), humidity: +(30 + Math.random() * 50).toFixed(2) }),
  //   attributes: (i) => ({ firmwareVersion: `v1.${i % 10}.0`, location: `Zone-${(i % 5) + 1}` }),
  // },
];

async function publishEntity(entity) {
  console.log(`\n=== MQTT: ${entity.name} ===`);
  const client = mqtt.connect('mqtt://localhost:1883', {
    username: entity.token,
    password: '',
    clientId: `test-${entity.name}-${Date.now()}`,
  });

  await new Promise((resolve, reject) => {
    client.on('connect', resolve);
    client.on('error', reject);
    setTimeout(() => reject(new Error('MQTT connect timeout')), 5000);
  });
  console.log('  Connected');

  for (let i = 0; i < COUNT; i++) {
    client.publish(`${entity.unsPath}/telemetry`, JSON.stringify(entity.telemetry()), { qos: 1 });
    if ((i + 1) % 25 === 0) console.log(`  Telemetry: ${i + 1}/${COUNT}`);
  }
  await new Promise(r => setTimeout(r, 2000));

  for (let i = 0; i < COUNT; i++) {
    client.publish(`${entity.unsPath}/attributes`, JSON.stringify(entity.attributes(i)), { qos: 1 });
    if ((i + 1) % 25 === 0) console.log(`  Attributes: ${i + 1}/${COUNT}`);
  }
  await new Promise(r => setTimeout(r, 3000));

  client.end();
  console.log(`  Done: ${entity.name}`);
}

async function main() {
  console.log(`Publishing ${COUNT} telemetry + ${COUNT} attributes per entity via MQTT`);
  for (const entity of ENTITIES) {
    await publishEntity(entity);
  }

  console.log('\nWaiting 5s for ingestion...');
  await new Promise(r => setTimeout(r, 5000));

  const { execSync } = require('child_process');
  const counts = execSync(
    `PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db -t -A -c "` +
    `SELECT 'ts_telemetry', COUNT(*) FROM ts_telemetry UNION ALL SELECT 'ts_attributes', COUNT(*) FROM ts_attributes"`
  ).toString().trim();
  console.log('\n=== DB Counts ===');
  console.log(counts);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
