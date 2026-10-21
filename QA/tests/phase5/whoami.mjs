import { tok, raw, ROLES, save } from './lib5.mjs';
const out = {};
for (const r of ROLES) {
  const t = await tok(r);
  const me = await raw('GET', '/api/auth/me', { token: t.token });
  out[r] = { username: t.username, userId: me.json?.id ?? me.json?.user?.id, keys: Object.keys(me.json ?? {}), perms: me.json?.permissions ?? me.json?.user?.permissions };
  console.log(r, t.username, out[r].userId, JSON.stringify(out[r].keys), (out[r].perms ?? []).length);
}
save('whoami', out);
