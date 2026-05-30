// contribute-worker.js — The Anonymous Service compute worker. Donates
// CPU cycles to the AstranoV collective. Runs ONLY when the user
// explicitly opts in. Reports back every ~5 seconds.
//
// What it actually computes today: SHA-256 hash chains of a server-
// issued target prefix. This is a proof-of-work BENCHMARK — measures
// how many hash ops the device contributes. Real work (collective
// inference, distributed index, etc.) lands once we have the mesh.
//
// The worker is visible, pausable, and never blocks the UI thread.

let running = false;
let cycles = 0;
let started = 0;

async function sha256Hex(buf) {
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function workChunk(target, difficulty) {
  // Hash chain: start from target + a counter, hash, take low 16 hex,
  // repeat `difficulty` times. Cheap, deterministic, easy to verify.
  const enc = new TextEncoder();
  let s = target;
  for (let i = 0; i < difficulty; i++) {
    s = (await sha256Hex(enc.encode(s + i))).slice(0, 32);
    cycles++;
    if (!running) break;
    // Yield every 5,000 iterations so a pause is fast.
    if ((i & 4095) === 0) await new Promise(r => setTimeout(r, 0));
  }
  return s;
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type === 'start') {
    if (running) return;
    running = true; cycles = 0; started = Date.now();
    self.postMessage({ type: 'started' });
    while (running) {
      const wu = msg.workUnit || { target: 'astranov', difficulty: 200_000 };
      try {
        await workChunk(wu.target, wu.difficulty);
      } catch (_) {}
      // Report every chunk.
      self.postMessage({
        type: 'tick',
        cycles, duration_ms: Date.now() - started,
      });
      // Brief breather so we don't peg the CPU at 100%.
      await new Promise(r => setTimeout(r, 200));
    }
  }
  if (msg.type === 'stop') {
    running = false;
    self.postMessage({ type: 'stopped', cycles, duration_ms: Date.now() - started });
  }
};
