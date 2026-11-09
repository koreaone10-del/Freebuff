import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve, sep, extname } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = resolve(__dirname, "public");
const PORT = Number(process.env.PORT) || 10000;
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES) || 20 * 1024 * 1024;

let workerModule;
try {
  workerModule = await import("./worker.js");
} catch (error) {
  console.error("[server] فشل تحميل worker.js:", error?.stack || error);
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};
const STATIC_EXTENSIONS = new Set(Object.keys(MIME));
const BASE_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "SAMEORIGIN"
};

function send(res, status, body, headers = {}) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { ...BASE_HEADERS, ...headers });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("BODY_TOO_LARGE");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!size) return null;
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("INVALID_JSON");
    error.status = 400;
    throw error;
  }
}

function serveStatic(pathname, method, res) {
  if (method !== "GET" && method !== "HEAD") return false;
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const filePath = resolve(PUBLIC_DIR, relative);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + sep)) {
    send(res, 403, "Forbidden", { "content-type": "text/plain; charset=utf-8" });
    return true;
  }
  const ext = extname(filePath).toLowerCase();
  if (!STATIC_EXTENSIONS.has(ext)) return false;
  try {
    const body = readFileSync(filePath);
    res.writeHead(200, {
      ...BASE_HEADERS,
      "content-type": MIME[ext],
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600"
    });
    res.end(method === "HEAD" ? undefined : body);
  } catch {
    send(res, 404, "Not found", { "content-type": "text/plain; charset=utf-8" });
  }
  return true;
}

const server = createServer(async (req, res) => {
  try {
    let url;
    try {
      url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    } catch {
      return send(res, 400, "Bad Request", { "content-type": "text/plain; charset=utf-8" });
    }

    if (serveStatic(url.pathname, req.method || "GET", res)) return;

    let parsed = null;
    if (req.method !== "GET" && req.method !== "HEAD") {
      try {
        parsed = await readJsonBody(req);
      } catch (error) {
        const status = error.status || 400;
        const message = status === 413 ? "حجم الطلب أكبر من الحد المسموح." : "يجب إرسال JSON صالح.";
        return send(res, status, JSON.stringify({ error: message }), {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store"
        });
      }
      if (parsed && typeof parsed === "object" && parsed.stream === undefined) parsed.stream = false;
    }

    const safeHeaders = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const name = key.toLowerCase();
      if (["host", "content-length", "transfer-encoding", "connection"].includes(name)) continue;
      if (typeof value === "string") safeHeaders[name] = value;
    }

    const workerReq = new Request(url, {
      method: req.method,
      headers: safeHeaders,
      body: req.method === "GET" || req.method === "HEAD" ? null : JSON.stringify(parsed)
    });
    const workerRes = await workerModule.default.fetch(workerReq, process.env);
    const headers = {};
    workerRes.headers.forEach((value, key) => {
      if (!["connection", "transfer-encoding", "keep-alive", "upgrade"].includes(key.toLowerCase())) headers[key] = value;
    });
    res.writeHead(workerRes.status, { ...BASE_HEADERS, ...headers });

    if (!workerRes.body || req.method === "HEAD") return res.end();
    const reader = workerRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done || res.destroyed) break;
      if (value && !res.write(value)) {
        await new Promise((resolveDrain) => res.once("drain", resolveDrain));
      }
    }
    res.end();
  } catch (error) {
    console.error("[server] request error:", error?.stack || error);
    send(res, 500, JSON.stringify({ error: "Internal Server Error" }), {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
  }
});

server.requestTimeout = 120_000;
server.headersTimeout = 30_000;
server.keepAliveTimeout = 5_000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] CHIBANI AI listening on 0.0.0.0:${PORT}`);
});

function shutdown(signal) {
  console.log(`[server] ${signal}: graceful shutdown`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
