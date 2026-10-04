// A stand-in for the artifact room capability: pages of one browser context share presence over BroadcastChannel,
// with a small delivery delay and the 4 KiB presence limit.
(() => {
  const me = 'p' + Math.random().toString(36).slice(2, 10);
  const DELAY = 35;
  const mkNamed = (name) => {
    const bc = new BroadcastChannel('mock-' + name);
    let mine = {}; const others = new Map(), listeners = new Set(); let snap = Object.freeze([]);
    const rebuild = (joined, left, updated) => {
      const meP = Object.freeze({ peer: me, by: null, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: Object.freeze(JSON.parse(JSON.stringify(mine))), updatedAt: Date.now() });
      snap = Object.freeze([meP, ...others.values()]);
      const ch = { peers: snap, joined: joined || [], left: left || [], updated: updated || [] };
      listeners.forEach(fn => { try { fn(ch); } catch (e) { console.error('onPeers handler', e); } });
    };
    const send = (m) => { try { bc.postMessage(m); } catch (e) { /* closed */ } };
    bc.onmessage = (e) => { const m = e.data; setTimeout(() => {
      if (m.t === 'p') { const had = others.has(m.peer); const p = Object.freeze({ peer: m.peer, by: null, isMe: false, sameTab: false, kind: 'viewer', guest: false, presence: Object.freeze(m.presence), updatedAt: Date.now() }); others.set(m.peer, p); rebuild(had ? [] : [p], [], had ? [p] : []); }
      else if (m.t === 'hello') send({ t: 'p', peer: me, presence: mine });
      else if (m.t === 'bye') { const p = others.get(m.peer); others.delete(m.peer); if (p) rebuild([], [p], []); }
    }, DELAY); };
    send({ t: 'hello' }); rebuild();
    return {
      name,
      presence: async (patch) => {
        const next = Object.assign({}, mine, patch); for (const k in patch) if (patch[k] === null) delete next[k];
        const n = new TextEncoder().encode(JSON.stringify(next)).length;
        if (n > 4096) { window.__tooBig = (window.__tooBig || 0) + 1; throw { code: 'invalid_argument', message: 'presence over 4 KiB: ' + n }; }
        window.__maxPres = Math.max(window.__maxPres || 0, n); window.__presN = (window.__presN || 0) + 1;
        mine = next; send({ t: 'p', peer: me, presence: mine }); rebuild();
      },
      peers: () => snap,
      onPeers: (fn) => { listeners.add(fn); setTimeout(() => fn({ peers: snap, joined: snap, left: [], updated: [] }), 0); return () => listeners.delete(fn); },
      connected: () => true,
      onConnection: (fn) => { setTimeout(() => fn(true), 0); return () => {}; },
      leave: async () => { send({ t: 'bye', peer: me }); delete rooms[name]; setTimeout(() => bc.close(), 100); },
      emit: async () => {}, on: () => () => {},
    };
  };
  const rooms = {};
  const lobby = { join: async (name) => rooms[name] || (rooms[name] = mkNamed(name)), connected: () => true, onConnection: (fn) => { setTimeout(() => fn(true)); return () => {}; },
    presence: async () => {}, peers: () => [], onPeers: () => () => {}, emit: async () => {}, on: () => () => {} };
  window.claude = { use: async (n) => (n === 'room' ? lobby : null) };
})();
