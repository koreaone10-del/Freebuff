import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT) || 10000;

let workerModule;
try {
  workerModule = await import("./worker.js");
} catch (e) {
  console.error("[server] فشل تحميل worker.js:", e.message);
  process.exit(1);
}

const PUBLIC_DIR = join(__dirname, "public");
const STATIC_RE = /\.(js|css|png|jpg|jpeg|svg|woff|woff2|ico|webp|mp4|webm|txt|json)$/i;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    if (STATIC_RE.test(pathname) || pathname === "/") {
      let filePath = pathname === "/" ? join(PUBLIC_DIR, "index.html") : join(PUBLIC_DIR, pathname.slice(1));
      try {
        const fileBody = readFileSync(filePath);
        const ext = filePath.split(".").pop() || "html";
        const mime =
          ext === "html" ? "text/html" :
          ext === "css" ? "text/css" :
          ext === "js" ? "text/javascript" :
          ext === "json" ? "application/json" :
          ext === "png" ? "image/png" :
          ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
          ext === "svg" ? "image/svg+xml" :
          ext === "webp" ? "image/webp" :
          ext === "ico" ? "image/x-icon" :
          ext === "mp4" ? "video/mp4" :
          ext === "webm" ? "video/webm" : "application/octet-stream";
        res.writeHead(200, { "content-type": mime, "cache-control": "no-cache", "x-content-type-options": "nosniff" });
        return res.end(fileBody);
      } catch {
        res.writeHead(404, { "content-type": "text/plain" });
        return res.end("Not found");
      }
    }

    // API -> Worker (cloudflare)
    let bodyText = null;
    let parsed = null;
    if (req.method !== "GET" && req.method !== "HEAD") {
      try {
        const chunks = [];
        for await (const ch of req) chunks.push(ch);
        bodyText = Buffer.concat(chunks).toString("utf8");
        parsed = JSON.parse(bodyText);
        if (parsed && typeof parsed === "object") {
          if (parsed.stream === undefined) parsed.stream = false;
        }
      } catch (_) { /* no JSON / no body */ }
    }
    const workerBody = JSON.stringify(parsed);
    // نقل الترويسات مع تجاهل تلك التي يغيّرها إعادة التسلسل أو تحدّدها منصة Render
    const safeHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const key = k.toLowerCase();
      if (key === "host" || key === "content-length" || key === "transfer-encoding" || key === "connection") continue;
      if (typeof v === "string") safeHeaders[key] = v;
    }
    const workerReq = new Request(url, {
      method: req.method,
      headers: safeHeaders,
      body: req.method === "GET" || req.method === "HEAD" ? null : workerBody
    });

    const workerRes = await workerModule.default.fetch(workerReq);

    const outBody = workerRes.body;
    const ctype = workerRes.headers.get("content-type") || "text/plain";
    const headers = new Headers();
    workerRes.headers.forEach((v, k) => { headers.set(k, v); });
    res.writeHead(workerRes.status, { "content-type": ctype, ...Object.fromEntries(headers.entries()) });
    if (outBody) {
      const reader = outBody.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) res.write(value);
      }
    }
    // مهم: إغلاق الرد دائماً. بدون هذا يبقى الاتصال معلّقاً (chunked بلا نهاية)
    // فيبدو كل مسار /api/* «عالقاً» حتى مهلة العميل.
    res.end();
  } catch (e) {
    console.error("[server] error:", e);
    try { res.writeHead(500, { "content-type": "text/plain" }); res.end("Internal Server Error"); } catch (_) {}
  }
});

server.listen(PORT, () => {
  console.log(`[server] CHIBANI AI is running on http://0.0.0.0:${PORT}`);
});
