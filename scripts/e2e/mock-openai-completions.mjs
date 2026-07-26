#!/usr/bin/env node
/**
 * mock-openai-completions.mjs — Local OpenAI-completions mock for E2E proof
 * (008.1 Story D).
 *
 * Serves POST /v1/chat/completions with SSE chunks containing DATETIME-OK.
 * Prints the base URL (http://127.0.0.1:<port>/v1) to stdout on listen.
 * Cleans up on SIGTERM/SIGINT.
 */
import { createServer } from "node:http";

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const chunks = [
      `data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n`,
      `data: {"choices":[{"delta":{"content":"DATETIME-OK 2026-07-24"}}]}\n\n`,
      `data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":3,"total_tokens":4}}\n\n`,
      `data: [DONE]\n\n`,
    ];

    let idx = 0;
    function writeNext() {
      if (idx >= chunks.length) {
        res.end();
        return;
      }
      res.write(chunks[idx++]);
      setImmediate(writeNext);
    }
    writeNext();
    return;
  }

  // Any other request → 404
  res.writeHead(404);
  res.end();
});

server.listen(0, "127.0.0.1", () => {
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  process.stdout.write(`http://127.0.0.1:${port}/v1\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
