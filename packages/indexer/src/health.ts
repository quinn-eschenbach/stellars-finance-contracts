import http from "node:http";

let lastPollLedger = 0;
let lastPollTime = 0;

export function updateHealth(ledger: number) {
  lastPollLedger = ledger;
  lastPollTime = Date.now();
}

export function startHealthServer(port: number) {
  const server = http.createServer((_req, res) => {
    const healthy = Date.now() - lastPollTime < 30_000;
    res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: healthy ? "ok" : "stale",
        last_ledger: lastPollLedger,
        last_poll_ms_ago: Date.now() - lastPollTime,
      }),
    );
  });

  server.listen(port, () => {
    console.log(`Health server listening on :${port}`);
  });

  return server;
}
