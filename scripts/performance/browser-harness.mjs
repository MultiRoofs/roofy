// Browser performance harness: a fixed camera path over one dataset, in a
// real Chromium, measured by the in-page probe (`src/features/debug/perfProbe.ts`).
//
//   node scripts/performance/browser-harness.mjs \
//     --app http://127.0.0.1:5173 --data <dir> --scenario delft-seq --out run.jsonl
//
// Start the dev server first (`npm run dev`). `--data` is served on a local
// port with Range and CORS, so streamed formats read it the way they read a
// remote host. Scenarios name a file in that directory:
//   delft-seq   delft.city.jsonl   (3DBAG Delft tile, static layer)
//   delft-fcb   delft.fcb          (the same tile, streamed)
//   delft-json  delft.city.json    (the tile as one CityJSON document, static)
// The opening camera frames the whole tile; `--cam '<json>'` overrides it.
//
// Each phase writes one JSON line: the probe's counters for that phase alone
// (draw calls, frames, bytes uploaded, readbacks, long tasks, bytes fetched).
// On a host without a GPU (SwiftShader) counts and bytes are comparable across
// runs; timings are not.

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
const SCENARIO = args.scenario ?? "delft-seq";
const OUT = args.out ?? `perf-${SCENARIO}.jsonl`;
const CHROME =
  args.chrome ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const CDP_PORT = Number(args.cdp ?? 9333);
const DATA_PORT = Number(args.dataPort ?? 8765);
const WIDTH = 1280;
const HEIGHT = 800;

const SCENARIOS = {
  "delft-seq": { file: "delft.city.jsonl", name: "Delft" },
  "delft-fcb": { file: "delft.fcb", name: "Delft" },
  "delft-json": { file: "delft.city.json", name: "Delft" },
};
// South of the tile, looking north over all of it: the tile spans
// EPSG:7415 x 84501-85675, y 445805-446983 (about lat 51.996-52.007).
// `--cam '<json>'` replaces it for one run.
const CAMERA = args.cam
  ? JSON.parse(args.cam)
  : {
      lng: 4.3691,
      lat: 51.9895,
      height: 1000,
      heading: 0,
      pitch: -45,
      roll: 0,
    };

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
  } else if (message.method === "Runtime.exceptionThrown") {
    exceptions.push(
      message.params.exceptionDetails.exception?.description ??
        message.params.exceptionDetails.text,
    );
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
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
// A fresh profile opens the walkthrough's welcome dialog over the viewport;
// close it so the gestures and the hover sweep reach the canvas.
await evaluate(
  "[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Explore on my own')?.click()",
);
await sleep(2000);

// --- input helpers: pressed/released pointer events over the canvas --------
const mouse = (type, x, y, extra = {}) =>
  send("Input.dispatchMouseEvent", { type, x, y, button: "none", ...extra });
async function drag(from, to, button = "left", steps = 20) {
  await mouse("mouseMoved", from[0], from[1]);
  await mouse("mousePressed", from[0], from[1], {
    button,
    buttons: button === "left" ? 1 : 2,
    clickCount: 1,
  });
  for (let i = 1; i <= steps; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / steps;
    const y = from[1] + ((to[1] - from[1]) * i) / steps;
    await mouse("mouseMoved", x, y, {
      button,
      buttons: button === "left" ? 1 : 2,
    });
    await sleep(30);
  }
  await mouse("mouseReleased", to[0], to[1], {
    button,
    buttons: 0,
    clickCount: 1,
  });
}
async function wheel(deltaY, times) {
  for (let i = 0; i < times; i++) {
    await mouse("mouseWheel", WIDTH / 2, HEIGHT / 2, { deltaX: 0, deltaY });
    await sleep(80);
  }
}
const cx = WIDTH / 2;
const cy = HEIGHT / 2;

const phases = [
  ["still", async () => sleep(10_000)],
  ["orbit", async () => drag([cx, cy], [cx + 300, cy], "right")],
  ["zoom-in", async () => wheel(-240, 8)],
  ["pan", async () => drag([cx - 200, cy], [cx + 200, cy + 100])],
  ["zoom-out", async () => wheel(240, 8)],
  [
    "hover",
    async () => {
      for (let i = 0; i <= 120; i++) {
        await mouse(
          "mouseMoved",
          200 + (880 * i) / 120,
          250 + 300 * Math.sin(i / 10),
        );
        await sleep(25);
      }
    },
  ],
  ["still-after", async () => sleep(10_000)],
];
for (const [phase, act] of phases) {
  await reset();
  const t0 = Date.now();
  await act();
  // Let the engine and any streaming commit settle before reading.
  await sleep(phase.startsWith("still") ? 0 : 4000);
  await record(phase, { phaseMs: Date.now() - t0 });
}

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
