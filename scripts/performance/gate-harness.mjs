// Phase 3 gate: LoD and style changes on one large dataset, static against
// streamed, in a real Chromium, measured by the in-page probe
// (`src/features/debug/perfProbe.ts`). Results and method:
// `docs/performance/2026-10-22-phase-3-gate/`.
//
//   node scripts/performance/gate-harness.mjs --app http://127.0.0.1:5173 \
//     --data <dir> --scenario d9-seq --out run.jsonl [--shots <dir>] [--cam '<json>']
//
// Restart the dev server before each run: after a hot update, the harness's
// dynamic import of the layer store gets a second module instance, not the
// app's. `--data` is served on a local port with Range and CORS. Scenarios:
//   d9-seq  delft9.city.jsonl  (3x3 grid of the Delft tile, static layer)
//   d9-fcb  delft9.fcb         (the same grid, streamed through the worker)
// `scripts/performance/replicate-grid.py delft.city.jsonl delft9.city.jsonl 9 3`
// makes the grid; `fcb ser delft9.city.jsonl delft9.fcb` (flatcitybuf's CLI) makes the .fcb.
//
// After load and 20 s of quiet, each operation (four LoD switches, six
// colouring changes) waits for 8 s of quiet, writes the layer store, and
// waits for 4 s with no counter change and no stream fetching. Each writes
// one JSON line: the probe's counters for that operation, `settleMs` (to the
// last counter change), the main thread's heap and the stream's status.
// `PROFILE=<op,...>` also writes a CPU profile of the main thread and every
// worker over that operation, with a per-100 ms busy timeline.
// On a host without a GPU (SwiftShader) counts are comparable across runs;
// timings only within one run.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, i, all) => {
    if (value.startsWith("--")) pairs.push([value.slice(2), all[i + 1]]);
    return pairs;
  }, []),
);
const APP = args.app ?? "http://127.0.0.1:5173";
const DATA = args.data;
const SCENARIO = args.scenario ?? "d9-seq";
const OUT = args.out ?? `perf-${SCENARIO}.jsonl`;
const CHROME =
  args.chrome ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const CDP_PORT = Number(args.cdp ?? 9333);
const DATA_PORT = Number(args.dataPort ?? 8765);
const WIDTH = 1280;
const HEIGHT = 800;

const SCENARIOS = {
  "d9-seq": { file: "delft9.city.jsonl", name: "Delft9" },
  "d9-fcb": { file: "delft9.fcb", name: "Delft9" },
};
// Straight down over the grid's centre, low enough that the stream's
// footprint (T_MAX_M) reaches the grid's corners, so the streamed layer holds
// every object once its first LoD switch has run. `--cam '<json>'` replaces it.
const CAMERA = args.cam
  ? JSON.parse(args.cam)
  : { lng: 4.386, lat: 52.0123, height: 5000, heading: 0, pitch: -89, roll: 0 };

if (!DATA || !SCENARIOS[SCENARIO]) {
  console.error(
    `usage: --data <dir> --scenario ${Object.keys(SCENARIOS).join("|")}`,
  );
  process.exit(2);
}

// --- data server: Range, CORS and Timing-Allow-Origin, nothing else ---------
const dataServer = http.createServer((req, res) => {
  const file = path.join(
    DATA,
    decodeURIComponent(new URL(req.url, "http://x").pathname),
  );
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Range");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Length, Content-Range, Accept-Ranges",
  );
  res.setHeader("Timing-Allow-Origin", "*");
  res.setHeader("Accept-Ranges", "bytes");
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  if (!file.startsWith(path.resolve(DATA)) || !fs.existsSync(file))
    return res.writeHead(404).end();
  const size = fs.statSync(file).size;
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": end - start + 1,
    });
    if (req.method === "HEAD") return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { "Content-Length": size });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) =>
  dataServer.listen(DATA_PORT, "127.0.0.1", resolve),
);

// --- browser ---------------------------------------------------------------
const profile = fs.mkdtempSync(
  path.join(process.env.TMPDIR ?? "/tmp", "roofy-perf-"),
);
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--no-first-run",
    "--enable-precise-memory-info",
    // Root in a container has no sandbox; a proxied host passes its proxy on
    // for the basemap and terrain tiles, and never for the local servers.
    ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
    ...(process.env.HTTPS_PROXY
      ? [
          `--proxy-server=${process.env.HTTPS_PROXY}`,
          "--proxy-bypass-list=127.0.0.1;localhost",
        ]
      : []),
    "--no-default-browser-check",
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let version;
for (let i = 0; i < 50 && !version; i++) {
  await sleep(200);
  version = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
    .then((r) => r.json())
    .catch(() => null);
}
if (!version) throw new Error("Chromium did not start");
const tab = await (
  await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, {
    method: "PUT",
  })
).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let nextId = 0;
const pending = new Map();
const exceptions = [];
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== undefined) {
    const call = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) call?.reject(new Error(JSON.stringify(message.error)));
    else call?.resolve(message.result);
  } else if (
    message.method === "Runtime.consoleAPICalled" &&
    (message.params.type === "error" || message.params.type === "warning")
  ) {
    // The page's own errors and warnings, so a run that silently drops a
    // layer says why.
    console.error(
      `console.${message.params.type}: ${message.params.args
        .map((arg) => arg.value ?? arg.description ?? "")
        .join(" ")}`,
    );
  } else if (message.method === "Target.attachedToTarget") {
    workers.set(message.params.sessionId, message.params.targetInfo.url);
  } else if (message.method === "Runtime.exceptionThrown") {
    exceptions.push(
      message.params.exceptionDetails.exception?.description ??
        message.params.exceptionDetails.text,
    );
  }
};
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(
      JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }),
    );
  });
const workers = new Map();
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.exception?.description ?? "eval failed",
    );
  return result.result.value;
};
await send("Runtime.enable");
await send("Target.setAutoAttach", {
  autoAttach: true,
  waitForDebuggerOnStart: false,
  flatten: true,
});
await send("Emulation.setDeviceMetricsOverride", {
  width: WIDTH,
  height: HEIGHT,
  deviceScaleFactor: 1,
  mobile: false,
});

// --- the page --------------------------------------------------------------
const scenario = SCENARIOS[SCENARIO];
const share = {
  v: 3,
  layers: [
    {
      name: scenario.name,
      modelUrl: `http://127.0.0.1:${DATA_PORT}/${scenario.file}`,
      rules: [],
      rulesEnabled: false,
      visible: true,
    },
  ],
  cam: CAMERA,
  dt: "2026-06-21T12:00:00Z",
  pm: "object",
};
const hash = Buffer.from(JSON.stringify(share), "latin1").toString("base64url");
const started = Date.now();
await send("Page.navigate", { url: `${APP}/?perf#share=${hash}` });

const snapshot = () =>
  evaluate(
    "window.__roofyPerf ? { ...window.__roofyPerf.snapshot(), fetchedBytes: window.__roofyPerf.fetchedBytes() } : null",
  );
const reset = () =>
  evaluate("window.__roofyPerf && window.__roofyPerf.reset()");

// Ready = the probe exists and nothing has been uploaded or fetched for 5 s.
let last = null;
let quietSince = Date.now();
while (Date.now() - started < 240_000) {
  await sleep(1000);
  const now = await snapshot().catch(() => null);
  if (!now) continue;
  const key = `${now.uploadedBytes}:${now.fetchedBytes}`;
  if (key !== last) {
    last = key;
    quietSince = Date.now();
  } else if (Date.now() - quietSince >= 5000 && now.uploadedBytes > 0) break;
}
const lines = [];
// `--shots <dir>`: a PNG after load and after the last phase, to see that the
// frames the counters count are the right ones.
const SHOTS = args.shots;
const shot = async (name) => {
  if (!SHOTS) return;
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(
    path.join(SHOTS, `${SCENARIO}-${name}.png`),
    Buffer.from(data, "base64"),
  );
};
const record = async (phase, extra = {}) => {
  const counters = await snapshot();
  const line = {
    scenario: SCENARIO,
    phase,
    ...extra,
    ...counters,
    at: new Date().toISOString(),
  };
  lines.push(line);
  console.log(JSON.stringify(line));
};
await record("load", { loadMs: Date.now() - started });
await shot("load");
// A fresh profile opens the walkthrough's welcome dialog over the viewport.
await evaluate(
  "[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Explore on my own')?.click()",
);
await sleep(2000);

const STORE =
  "const m = await import('/src/features/layers/layerStore.ts'); const s = m.useLayerStore.getState(); const id = s.layers[0].id;";
// Fire and forget: the store write triggers the work, and the settle loop
// below watches for its end. An awaited promise can be collected mid-rebuild.
const run = (body) =>
  evaluate(
    `window.__gateErr = null; void (async () => { ${STORE} ${body} })().catch((e) => { window.__gateErr = String(e); }); true`,
  );
const streamState = () =>
  evaluate(
    `import("/src/features/streaming/streamStore.ts").then((m) => JSON.stringify(Object.values(m.useStreamStore.getState().streams).map((st) => [st.status, st.version, st.level])) + " " + (document.body.innerText.match(/[\\d.,]+K? loaded objects/) ?? [""])[0])`,
  ).catch(() => "[]");
const heapMB = () =>
  evaluate("Math.round(performance.memory.usedJSHeapSize / 1e6)").catch(
    () => null,
  );
await sleep(20000);
await record("loaded", { heapMB: await heapMB(), stream: await streamState() });
await shot("loaded");
// Quiet = no counter or stream-state change for `ms`, and no stream busy.
async function settle(ms, limit) {
  const t0 = Date.now();
  let last = null;
  let lastChange = Date.now();
  while (Date.now() - t0 < limit) {
    await sleep(100);
    const c = await snapshot().catch(() => null);
    if (!c) continue;
    const st = await streamState();
    const key = `${c.uploadedBytes}:${c.fetchedBytes}:${c.frames}:${st}`;
    if (key !== last) {
      last = key;
      lastChange = Date.now();
    } else if (
      Date.now() - lastChange >= ms &&
      !/"(probing|fetching)"/.test(st)
    )
      break;
  }
  return lastChange - t0;
}
async function op(label, body) {
  const preQuietMs = await settle(8000, 600_000);
  const profiling = (process.env.PROFILE ?? "").split(",").includes(label);
  if (profiling) {
    await send("Profiler.enable");
    await send("Profiler.setSamplingInterval", { interval: 1000 });
    await send("Profiler.start");
    for (const sid of workers.keys()) {
      await send("Profiler.enable", {}, sid).catch(() => {});
      await send("Profiler.setSamplingInterval", { interval: 1000 }, sid).catch(
        () => {},
      );
      await send("Profiler.start", {}, sid).catch(() => {});
    }
  }
  await reset();
  const t0 = Date.now();
  await run(body);
  const elapsed = await settle(4000, 300_000);
  if (profiling) {
    const profs = [["main", (await send("Profiler.stop")).profile]];
    for (const [sid, url] of workers) {
      const r = await send("Profiler.stop", {}, sid).catch(() => null);
      if (r) profs.push([url.split("/").pop().slice(0, 40), r.profile]);
    }
    const opStartMono = profs[0][1].startTime / 1000;
    for (const [tag, profile] of profs) {
      const keyOf = (f) =>
        (f.functionName || "(anon)") +
        " " +
        f.url.split("/").slice(-2).join("/") +
        ":" +
        f.lineNumber;
      const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      const counts = new Map();
      profile.samples.forEach((id, i) =>
        counts.set(id, (counts.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)),
      );
      const self = new Map();
      for (const [id, us] of counts) {
        const key = keyOf(byId.get(id).callFrame);
        self.set(key, (self.get(key) ?? 0) + us);
      }
      const parent = new Map();
      for (const n of profile.nodes)
        for (const c of n.children ?? []) parent.set(c, n.id);
      const incl = new Map();
      for (const [id, us] of counts) {
        const seen = new Set();
        for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
          const key = keyOf(byId.get(cur).callFrame);
          if (seen.has(key)) continue;
          seen.add(key);
          incl.set(key, (incl.get(key) ?? 0) + us);
        }
      }
      const fmt = (list) =>
        list
          .map(([k, us]) => (us / 1000).toFixed(0).padStart(7) + " ms  " + k)
          .join("\n");
      const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 30);
      const topIncl = [...incl].sort((a, b) => b[1] - a[1]).slice(0, 60);
      const span = (profile.endTime - profile.startTime) / 1000;
      // Timeline: non-idle sample time per 100 ms bucket from the op's start,
      // with the busiest leaf in each bucket.
      {
        let t = profile.startTime;
        const buckets = new Map();
        profile.samples.forEach((id, i) => {
          t += profile.timeDeltas[i] ?? 0;
          const f = byId.get(id).callFrame;
          if (f.functionName === "(idle)" || f.functionName === "(program)")
            return;
          const b = Math.floor((t / 1000 - opStartMono) / 100);
          const e = buckets.get(b) ?? { us: 0, fns: new Map() };
          const d = profile.timeDeltas[i + 1] ?? 1000;
          e.us += d;
          const k = keyOf(f);
          e.fns.set(k, (e.fns.get(k) ?? 0) + d);
          buckets.set(b, e);
        });
        const tl = [...buckets]
          .sort((a, b) => a[0] - b[0])
          .map(([b, e]) => {
            const top = [...e.fns].sort((x, y) => y[1] - x[1])[0];
            return `  ${String(b * 100).padStart(6)} ms  busy ${(e.us / 1000).toFixed(0).padStart(4)} ms  ${top[0]}`;
          });
        fs.appendFileSync(
          `${OUT}.${label}.profile.txt`,
          `#### ${tag} timeline\n` + tl.join("\n") + "\n",
        );
      }
      fs.appendFileSync(
        `${OUT}.${label}.profile.txt`,
        `#### ${tag} span ${span.toFixed(0)} ms\n-- self --\n` +
          fmt(top) +
          "\n-- inclusive --\n" +
          fmt(topIncl) +
          "\n",
      );
    }
  }
  const lastChange = t0 + elapsed;
  await record(label, {
    preQuietMs,
    error: await evaluate("window.__gateErr").catch(() => "eval failed"),
    settleMs: lastChange - t0,
    heapMB: await heapMB(),
    stream: await streamState(),
  });
  await shot(label);
}
const FLAT = JSON.stringify({
  id: "flat",
  name: "Flat",
  color: "#3b82f6",
  logic: "AND",
  enabled: true,
  conditions: [{ field: "inclinationDeg", operator: "<", value: 10 }],
});
const EXPR = JSON.stringify([
  "case",
  ["==", ["get", "$surface"], "RoofSurface"],
  [
    "interpolate",
    ["linear"],
    ["get", "inclinationDeg"],
    0,
    "#2b83ba",
    45,
    "#d7191c",
  ],
  ["get", "$base"],
]);
await op("lod-1.2", "s.setLodMode(id, 'manual'); s.setLayerLod(id, '1.2');");
await op("lod-2.2", "s.setLayerLod(id, '2.2');");
await op("lod-1.2b", "s.setLayerLod(id, '1.2');");
await op("lod-2.2b", "s.setLayerLod(id, '2.2');");
await op(
  "style-rules",
  `s.addRule(id, ${FLAT}); s.updateLayer(id, { colorBy: 'rules' });`,
);
await op("style-single", "s.updateLayer(id, { colorBy: 'single' });");
await op(
  "style-expression",
  `s.updateLayer(id, { colorBy: 'expression', styleExpression: ${EXPR} });`,
);
await op("style-surface", "s.updateLayer(id, { colorBy: 'surface' });");
await op("style-rules-b", "s.updateLayer(id, { colorBy: 'rules' });");
await op("style-surface-b", "s.updateLayer(id, { colorBy: 'surface' });");
await shot("end");
fs.writeFileSync(
  OUT,
  lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
);
if (exceptions.length)
  console.error(`page exceptions:\n${exceptions.join("\n")}`);
ws.close();
chrome.kill();
dataServer.closeAllConnections();
dataServer.close();
await sleep(500);
try {
  fs.rmSync(profile, { recursive: true, force: true });
} catch {
  // Chromium may still be flushing its profile; it lives under TMPDIR.
}
// Chromium's piped stderr and keep-alive sockets would hold the loop open.
process.exit(exceptions.length ? 1 : 0);
