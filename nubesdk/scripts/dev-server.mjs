import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const bundlePath = fileURLToPath(new URL("../dist/main.min.js", import.meta.url));
const port = 8080;

const server = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if ((request.method !== "GET" && request.method !== "HEAD") || request.url !== "/main.min.js") {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  try {
    const bundle = await stat(bundlePath);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": bundle.size,
      "Content-Type": "text/javascript; charset=utf-8",
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    createReadStream(bundlePath).pipe(response);
  } catch {
    response.writeHead(404);
    response.end("Bundle not found. Run the NubeSDK build first.");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`NubeSDK Local Mode: http://localhost:${port}/main.min.js`);
});
