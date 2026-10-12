// Captures what each plugin's editor really looks like (macOS, via AU or VST3).
// Every plugin runs in its own helper process, so a crashing or hanging plugin can't take the app down.
const { execFile, spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const isMac = process.platform === 'darwin';
const { bin } = require('./paths');
const BIN = { au: bin('au-snapshot'), vst3: bin('vst3-snapshot') };
const TIMEOUT_MS = 30000;
const PARALLEL = 3;

const groupKey = (p) => `${p.name.toLowerCase()}|${p.vendor.toLowerCase()}`;

function available() {
  return isMac && (fs.existsSync(BIN.au) || fs.existsSync(BIN.vst3));
}

// Which capture methods a plugin offers, best first.
function methods(p) {
  const m = [];
  if (p.au && fs.existsSync(BIN.au)) m.push({ bin: BIN.au, job: p.au });
  if (p.format === 'VST3' && fs.existsSync(BIN.vst3)) m.push({ bin: BIN.vst3, job: { path: p.path } });
  return m;
}

function captureOne(bin, payload, out) {
  return new Promise((resolve) => {
    const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    let stdout = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += d; });
    child.on('close', () => {
      clearTimeout(timer);
      const line = stdout.split('\n').find((l) => l.startsWith('{'));
      let r = null;
      try { r = JSON.parse(line); } catch { /* crashed or killed */ }
      resolve(Boolean(r?.ok) && fs.existsSync(out));
    });
    child.on('error', () => resolve(false));
    child.stdin.end(JSON.stringify([{ ...payload, out }]));
  });
}

// Scales a capture down so the library stays light.
function shrink(file) {
  return new Promise((resolve) => execFile('sips', ['--resampleWidth', '720', file], () => resolve()));
}

class Snapshotter {
  constructor(dir, store, onUpdate) {
    this.dir = dir;
    this.store = store; // { [groupKey]: path | 'failed' }
    this.onUpdate = onUpdate;
    this.queue = [];
    this.running = 0;
    this.total = 0;
    this.done = 0;
  }

  // Adds plugins to the queue: one capture per name+vendor, trying AU first, then VST3.
  enqueue(plugins, force = false) {
    const queued = new Set(this.queue.map((j) => j.key));
    const groups = new Map();
    for (const p of plugins) {
      const key = groupKey(p);
      if (queued.has(key) || (!force && this.store[key])) continue;
      if (!groups.has(key)) groups.set(key, { key, name: p.name, methods: [] });
      groups.get(key).methods.push(...methods(p));
    }
    for (const g of groups.values()) {
      g.methods.sort((a, b) => (a.bin === BIN.au ? 0 : 1) - (b.bin === BIN.au ? 0 : 1));
      if (g.methods.length) this.queue.push(g);
    }
    this.total = this.done + this.queue.length + this.running;
    this.pump();
  }

  cancel() {
    this.queue = [];
    this.total = this.done + this.running;
    this.progress();
  }

  progress(current) {
    this.onUpdate({ done: this.done, total: this.total, running: this.running > 0 || this.queue.length > 0, current });
  }

  pump() {
    while (this.running < PARALLEL && this.queue.length) {
      const job = this.queue.shift();
      this.running++;
      this.progress(job.name);
      this.capture(job).finally(() => {
        this.running--;
        this.done++;
        this.progress();
        this.pump();
      });
    }
    if (!this.running && !this.queue.length) this.progress();
  }

  async capture(job) {
    fs.mkdirSync(this.dir, { recursive: true });
    const hash = crypto.createHash('md5').update(job.key).digest('hex');
    const out = path.join(this.dir, `${hash}-${Date.now()}.png`);
    let ok = false;
    for (const m of job.methods) {
      ok = await captureOne(m.bin, m.job, out);
      if (ok) break;
    }
    if (ok) await shrink(out);
    const old = this.store[job.key];
    if (ok && old && old !== 'failed' && old !== out) fs.rm(old, () => {});
    this.store[job.key] = ok ? out : 'failed';
    this.onUpdate({ shot: { key: job.key, path: this.store[job.key] } });
  }
}

module.exports = { Snapshotter, available, groupKey };
