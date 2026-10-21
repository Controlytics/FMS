import { raw, tok, sql } from './lib5.mjs';
const id = 'be6f1e6e-9f3c-49b3-869e-dd2c979d778b';
const t = (await tok('SHIFTOFFICER')).token;
const list = await raw('GET', '/api/filters/retirements', { token: t });
const arr = Array.isArray(list.json) ? list.json : list.json?.data ?? [];
console.log('retirements list size', arr.length, 'contains M7 filter:', JSON.stringify(arr).includes(id));
const st = await raw('GET', `/api/filters/${id}/current-state`, { token: t });
console.log('current-state', st.status, JSON.stringify(st.json)?.slice(0, 300));
if (process.argv[2] === 'restore') {
  for (const [fid, s] of [[id, 'Retired'], ['f1e82ef3-2eb4-44a7-aa36-781d14a53775', 'Active']]) {
    const r = await raw('PUT', `/api/assets/instances/${fid}`, { token: t, body: { status: s } });
    console.log('restore', fid, s, r.status);
  }
  const l2 = await raw('GET', '/api/filters/retirements', { token: t });
  console.log('after restore contains:', JSON.stringify(l2.json).includes(id), sql(`select id,status,is_active from asset_instances where id in ('${id}','f1e82ef3-2eb4-44a7-aa36-781d14a53775')`));
}
