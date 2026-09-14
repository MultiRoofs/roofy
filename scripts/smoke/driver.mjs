// Persistent CDP driver with a tiny HTTP command port.
//   node driver.mjs <cdpPort> <httpPort> <appUrl>
// Commands (POST unless noted):
//   /eval   body = JS expression        -> { value } | { err }
//   /click  body = {"x":..,"y":..}      -> mouse press+release at x,y
//   /key    body = {"key":"Escape"}     -> keydown+keyup
//   /shot   body = {"path":"..."}       -> screenshot png to path
//   /dump   (GET)                       -> console + exceptions + network
//   /clearlog (GET)                     -> reset console/exception buffers
//   /quit   (GET)                       -> Browser.close, exit
import fs from "node:fs";
import http from "node:http";

const CDP = Number(process.argv[2]);
const HTTP = Number(process.argv[3]);
const APP = process.argv[4];

const j = async (p, init) =>
  await (await fetch(`http://127.0.0.1:${CDP}${p}`, init)).json();

const version = await j("/json/version");
console.error("browser:", version.Browser);

const tab = await j(`/json/new?about:blank`, { method: "PUT" });
console.error("tab:", tab.id);

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let id = 0;
const pending = new Map();
let consoleMsgs = [];
let exceptions = [];
const network = [];

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id !== undefined) {
    const p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
    return;
  }
  if (m.method === "Runtime.consoleAPICalled") {
    consoleMsgs.push({
      t: Date.now(),
      type: m.params.type,
      text: m.params.args
        .map((a) =>
          a.value !== undefined ? String(a.value) : a.description || a.type,
        )
        .join(" "),
    });
  } else if (m.method === "Runtime.exceptionThrown") {
    exceptions.push({
      t: Date.now(),
      text:
        m.params.exceptionDetails.exception?.description ||
        m.params.exceptionDetails.text,
    });
  } else if (m.method === "Network.responseReceived") {
    network.push({
      url: m.params.response.url,
      status: m.params.response.status,
      type: m.params.type,
    });
  } else if (m.method === "Log.entryAdded") {
    const e = m.params.entry;
    if (e.level === "error" || e.level === "warning") {
      consoleMsgs.push({
        t: Date.now(),
        type: `log:${e.level}`,
        text: `${e.text} ${e.url ?? ""}`,
      });
    }
  }
};

const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");
await send("Log.enable").catch(() => {});
await send("Emulation.setDeviceMetricsOverride", {
  width: 1600,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});

// Download capture: the app hands a Blob to an <a download>. Record it and
// SUPPRESS the real click so Chrome's download machinery never runs.
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
(() => {
  window.__downloads = [];
  const blobs = new Map();
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (obj) => { const u = create(obj); try { blobs.set(u, obj); } catch (e) {} return u; };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) {
      const b = blobs.get(this.href) || null;
      window.__downloads.push({ name: this.download, blob: b, size: b ? b.size : -1, type: b ? b.type : null });
      return;
    }
    return click.apply(this, arguments);
  };
  window.__blobBase64 = async (i) => {
    const d = window.__downloads[i];
    if (!d || !d.blob) return null;
    const buf = new Uint8Array(await d.blob.arrayBuffer());
    let s = "";
    for (let k = 0; k < buf.length; k += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(k, k + 0x8000));
    return btoa(s);
  };
})();
`,
});

await send("Page.navigate", { url: APP });

const evalExpr = async (expr) => {
  try {
    const r = await send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (r.exceptionDetails)
      return {
        err:
          r.exceptionDetails.exception?.description || r.exceptionDetails.text,
      };
    return { value: r.result.value };
  } catch (e) {
    return { err: String(e) };
  }
};

const readBody = (req) =>
  new Promise((res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => res(b));
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const body = await readBody(req);
  const reply = (o) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(o));
  };
  try {
    if (url.pathname === "/eval") return reply(await evalExpr(body));
    if (url.pathname === "/click") {
      const { x, y } = JSON.parse(body);
      for (const type of ["mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", {
          type,
          x,
          y,
          button: "left",
          clickCount: 1,
          buttons: type === "mousePressed" ? 1 : 0,
          pointerType: "mouse",
        });
      }
      return reply({ ok: true });
    }
    if (url.pathname === "/key") {
      const { key, code, windowsVirtualKeyCode } = JSON.parse(body);
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key,
        code: code ?? key,
        windowsVirtualKeyCode,
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        code: code ?? key,
        windowsVirtualKeyCode,
      });
      return reply({ ok: true });
    }
    if (url.pathname === "/shot") {
      const { path } = JSON.parse(body);
      const r = await send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path, Buffer.from(r.data, "base64"));
      return reply({
        ok: true,
        path,
        bytes: Buffer.from(r.data, "base64").length,
      });
    }
    if (url.pathname === "/dump") {
      return reply({
        console: consoleMsgs,
        exceptions,
        network: network.map((n) => n.url),
      });
    }
    if (url.pathname === "/clearlog") {
      consoleMsgs = [];
      exceptions = [];
      return reply({ ok: true });
    }
    if (url.pathname === "/quit") {
      reply({ ok: true });
      fs.writeFileSync(
        process.argv[5] ?? "/dev/null",
        JSON.stringify({ console: consoleMsgs, exceptions, network }, null, 2),
      );
      await send("Browser.close").catch(() => {});
      setTimeout(() => process.exit(0), 500);
      return;
    }
    reply({ err: "unknown command" });
  } catch (e) {
    reply({ err: String(e) });
  }
});
server.listen(HTTP, "127.0.0.1", () => console.error("driver on", HTTP));
