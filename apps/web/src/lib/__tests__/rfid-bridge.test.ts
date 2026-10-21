import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * rfid-bridge.ts — React-side wrapper for the native RfidPlugin.
 *
 * Narrowest boundary: `window.Capacitor.isNativePlatform` (stubbed per test)
 * and `@capacitor/core`'s `registerPlugin` (vi.mock below), which hands back
 * a fake plugin object recording connect / startInventory / listeners. The
 * module keeps `pluginPromise` + `started` at module level, so every test
 * re-imports it after `vi.resetModules()`.
 */

// A fresh dynamic import per test takes ~90 ms alone but timed out at the 5 s
// default once in a full run on a heavily loaded machine (2026-10-21). The
// assertions are unchanged; only the time allowed per test is.
vi.setConfig({ testTimeout: 20_000 });

const h = vi.hoisted(() => ({
  registerPlugin: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({ registerPlugin: h.registerPlugin }));

type Listener = (e: any) => void;
function makePlugin(over: Partial<Record<'addListener' | 'connect' | 'startInventory' | 'disconnect', any>> = {}) {
  const listeners: Listener[] = [];
  const remove = vi.fn(async () => {});
  const plugin = {
    listeners,
    remove,
    addListener: vi.fn(async (_evt: string, cb: Listener) => { listeners.push(cb); return { remove }; }),
    connect: vi.fn(async () => {}),
    startInventory: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    ...over,
  };
  return plugin;
}

async function load() {
  vi.resetModules();
  return import('../rfid-bridge');
}

function setNative(native: boolean | 'none') {
  if (native === 'none') delete (window as any).Capacitor;
  else (window as any).Capacitor = { isNativePlatform: () => native };
}

beforeEach(() => {
  h.registerPlugin.mockReset();
});
afterEach(() => {
  delete (window as any).Capacitor;
});

describe('rfid-bridge on the web (no native platform)', () => {
  it.each([['no Capacitor global', 'none'], ['Capacitor present but not native', false]] as const)(
    '%s: subscribe is a no-op and reconnect reports unavailable',
    async (_l, native) => {
      setNative(native);
      const { subscribeRfidTags, reconnectRfid } = await load();
      const unsub = await subscribeRfidTags(vi.fn());
      expect(typeof unsub).toBe('function');
      expect(() => unsub()).not.toThrow();
      expect(await reconnectRfid()).toEqual({ ok: false, error: 'RFID plugin not available on this platform' });
      expect(h.registerPlugin).not.toHaveBeenCalled();
    },
  );
});

describe('rfid-bridge on the tablet', () => {
  it('registers the Rfid plugin, listens BEFORE connecting, and forwards tag events', async () => {
    setNative(true);
    const plugin = makePlugin();
    const order: string[] = [];
    plugin.addListener.mockImplementation(async (_e: string, cb: Listener) => { order.push('listen'); plugin.listeners.push(cb); return { remove: plugin.remove }; });
    plugin.connect.mockImplementation(async () => { order.push('connect'); });
    plugin.startInventory.mockImplementation(async () => { order.push('start'); });
    h.registerPlugin.mockReturnValue(plugin);
    const { subscribeRfidTags } = await load();

    const onTag = vi.fn();
    await subscribeRfidTags(onTag);

    expect(h.registerPlugin).toHaveBeenCalledWith('Rfid');
    expect(plugin.addListener).toHaveBeenCalledWith('tag', expect.any(Function));
    expect(order).toEqual(['listen', 'connect', 'start']);

    const tag = { epc: 'E200001', ts: 1 };
    plugin.listeners[0](tag);
    expect(onTag).toHaveBeenCalledWith(tag);
  });

  it('a consumer that throws does not break the native listener', async () => {
    setNative(true);
    const plugin = makePlugin();
    h.registerPlugin.mockReturnValue(plugin);
    const { subscribeRfidTags } = await load();
    await subscribeRfidTags(() => { throw new Error('consumer bug'); });
    expect(() => plugin.listeners[0]({ epc: 'X', ts: 1 })).not.toThrow();
  });

  it('second subscriber reuses the connection (connect/startInventory run once) and the plugin is registered once', async () => {
    setNative(true);
    const plugin = makePlugin();
    h.registerPlugin.mockReturnValue(plugin);
    const { subscribeRfidTags } = await load();
    await subscribeRfidTags(vi.fn());
    await subscribeRfidTags(vi.fn());
    expect(plugin.addListener).toHaveBeenCalledTimes(2);
    expect(plugin.connect).toHaveBeenCalledTimes(1);
    expect(plugin.startInventory).toHaveBeenCalledTimes(1);
    expect(h.registerPlugin).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe removes the native handle; a throwing remove is swallowed', async () => {
    setNative(true);
    const plugin = makePlugin();
    h.registerPlugin.mockReturnValue(plugin);
    const { subscribeRfidTags } = await load();
    const unsub = await subscribeRfidTags(vi.fn());
    unsub();
    expect(plugin.remove).toHaveBeenCalledTimes(1);

    plugin.remove.mockImplementation(() => { throw new Error('already removed'); });
    const unsub2 = await subscribeRfidTags(vi.fn());
    expect(() => unsub2()).not.toThrow();
  });

  it('addListener failure is reported to onError, never thrown, and the reader is not connected', async () => {
    setNative(true);
    const plugin = makePlugin({ addListener: vi.fn(async () => { throw new Error('no such event'); }) });
    h.registerPlugin.mockReturnValue(plugin);
    const { subscribeRfidTags } = await load();
    const onError = vi.fn();
    const unsub = await subscribeRfidTags(vi.fn(), onError);
    expect(onError).toHaveBeenCalledWith('addListener failed: no such event');
    expect(plugin.connect).not.toHaveBeenCalled();
    expect(() => unsub()).not.toThrow();
  });

  it('addListener rejecting with a non-Error value still produces a readable message', async () => {
    setNative(true);
    const plugin = makePlugin({ addListener: vi.fn(async () => { throw 'plain string'; }) });
    h.registerPlugin.mockReturnValue(plugin);
    const { subscribeRfidTags } = await load();
    const onError = vi.fn();
    await subscribeRfidTags(vi.fn(), onError);
    expect(onError).toHaveBeenCalledWith('addListener failed: plain string');
  });

  it('connect failure goes to onError, keeps the listener, and the NEXT subscriber tries to connect again', async () => {
    setNative(true);
    const plugin = makePlugin();
    plugin.connect.mockRejectedValueOnce(new Error('USB permission denied'));
    h.registerPlugin.mockReturnValue(plugin);
    const { subscribeRfidTags } = await load();
    const onError = vi.fn();
    const onTag = vi.fn();
    await subscribeRfidTags(onTag, onError);
    expect(onError).toHaveBeenCalledWith('USB permission denied');
    expect(plugin.remove).not.toHaveBeenCalled();
    plugin.listeners[0]({ epc: 'LATE', ts: 2 });
    expect(onTag).toHaveBeenCalledWith({ epc: 'LATE', ts: 2 });

    await subscribeRfidTags(vi.fn());
    expect(plugin.connect).toHaveBeenCalledTimes(2);
    expect(plugin.startInventory).toHaveBeenCalledTimes(1);
  });

  it('startInventory rejecting with a non-Error is stringified for onError; no onError handler is fine too', async () => {
    setNative(true);
    const plugin = makePlugin({ startInventory: vi.fn(async () => { throw 42; }) });
    h.registerPlugin.mockReturnValue(plugin);
    const { subscribeRfidTags } = await load();
    const onError = vi.fn();
    await subscribeRfidTags(vi.fn(), onError);
    expect(onError).toHaveBeenCalledWith('42');
    await expect(subscribeRfidTags(vi.fn())).resolves.toEqual(expect.any(Function));
  });

  it('registerPlugin throwing → treated as plugin unavailable', async () => {
    setNative(true);
    h.registerPlugin.mockImplementation(() => { throw new Error('plugin not implemented'); });
    const { subscribeRfidTags, reconnectRfid } = await load();
    const onError = vi.fn();
    await subscribeRfidTags(vi.fn(), onError);
    expect(onError).not.toHaveBeenCalled();
    expect(await reconnectRfid()).toEqual({ ok: false, error: 'RFID plugin not available on this platform' });
  });
});

describe('reconnectRfid', () => {
  it('disconnects (ignoring a disconnect error), connects and restarts inventory', async () => {
    setNative(true);
    const plugin = makePlugin({ disconnect: vi.fn(async () => { throw new Error('not connected'); }) });
    h.registerPlugin.mockReturnValue(plugin);
    const { reconnectRfid, subscribeRfidTags } = await load();
    expect(await reconnectRfid()).toEqual({ ok: true });
    expect(plugin.disconnect).toHaveBeenCalledTimes(1);
    expect(plugin.connect).toHaveBeenCalledTimes(1);
    expect(plugin.startInventory).toHaveBeenCalledTimes(1);
    // started=true now: a new subscriber does not connect again.
    await subscribeRfidTags(vi.fn());
    expect(plugin.connect).toHaveBeenCalledTimes(1);
  });

  it('a failed reconnect reports the error and resets "started" so the next subscriber reconnects', async () => {
    setNative(true);
    const plugin = makePlugin();
    h.registerPlugin.mockReturnValue(plugin);
    const { reconnectRfid, subscribeRfidTags } = await load();
    await subscribeRfidTags(vi.fn());            // started = true
    plugin.connect.mockRejectedValueOnce(new Error('device unplugged'));
    expect(await reconnectRfid()).toEqual({ ok: false, error: 'device unplugged' });
    await subscribeRfidTags(vi.fn());
    expect(plugin.connect).toHaveBeenCalledTimes(3); // initial, failed reconnect, new subscriber
  });

  it('a non-Error rejection is stringified', async () => {
    setNative(true);
    const plugin = makePlugin({ connect: vi.fn(async () => { throw 'EBUSY'; }) });
    h.registerPlugin.mockReturnValue(plugin);
    const { reconnectRfid } = await load();
    expect(await reconnectRfid()).toEqual({ ok: false, error: 'EBUSY' });
  });
});
