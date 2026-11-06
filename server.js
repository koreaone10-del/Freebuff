// CHIBANI AI — خادم Render بسيط يجمع بين static (public/) و Worker (worker.js)
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

    // 1) Assets ثابتة من public/
    if (STATIC_RE.test(pathname) || pathname === "/") {
      let filePath;
      if (pathname === "/") filePath = join(PUBLIC_DIR, "index.html");
      else filePath = join(PUBLIC_DIR, pathname.slice(1));

      try {
        const body = readFileSync(filePath);
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

        res.writeHead(200, {
          "content-type": mime,
          "cache-control": "no-cache",
          "x-content-type-options": "nosniff"
        });
        return res.end(body);
      } catch {
        res.writeHead(404, { "content-type": "text/plain" });
        return res.end("Not found");
      }
    }

    // 2) الطلبات API → Worker (cloudflare)
    const workerReq = new Request(url, req);
    const workerRes = await workerModule.default.fetch(workerReq);

    const body = workerRes.body;
    const ctype = workerRes.headers.get("content-type") || "text/plain";
    const headers = new Headers();
    workerRes.headers.forEach((v, k) => { headers.set(k, v); });
    res.writeHead(workerRes.status, {
      "content-type": ctype,
      ...Object.fromEntries(headers.entries())
    });

    if (body) {
      const reader = body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } else {
      res.end();
    }
  } catch (e) {
    console.error("[server] error:", e);
    try {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("Internal Server Error");
    } catch (_) {}
  }
});

server.listen(PORT, () => {
  console.log(`[server] CHIBANI AI is running on http://0.0.0.0:${PORT}`);
});
