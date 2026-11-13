#!/usr/bin/env python3
"""Query CodeGraph the way a Claude session does: start `codegraph serve --mcp` in a folder
(the proxy spawns or reuses that folder's daemon), then call codegraph_explore once.

Usage: python3 -I mcp-query.py <worktree> "<query>"
Prints the elapsed time and the first lines of the answer. Uses the same env as ~/.claude.json.
"""
import json, os, subprocess, sys, time

root, query = sys.argv[1], sys.argv[2]
env = dict(os.environ)
env.update({
    "CODEGRAPH_DAEMON_IDLE_TIMEOUT_MS": "3600000",
    "CODEGRAPH_DAEMON_MAX_IDLE_MS": "0",
    "CODEGRAPH_QUERY_POOL_SIZE": "2",
    "CODEGRAPH_CATCHUP_GATE_TIMEOUT_MS": "0",
})
start = time.time()
proc = subprocess.Popen(["codegraph", "serve", "--mcp"], cwd=root, env=env,
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=sys.stderr, text=True)

def send(msg):
    proc.stdin.write(json.dumps(msg) + "\n"); proc.stdin.flush()

def recv(want_id):
    for line in proc.stdout:
        msg = json.loads(line)
        if msg.get("id") == want_id:
            return msg
    raise SystemExit("server closed")

send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": "2025-06-18", "capabilities": {},
    "clientInfo": {"name": "mcp-query", "version": "0"},
    "rootUri": "file://" + root}})
recv(1)
send({"jsonrpc": "2.0", "method": "notifications/initialized"})
if query.startswith("hold:"):
    # Session that never calls a tool: does the daemon start and catch up on its own?
    time.sleep(float(query[5:]))
    print(f"[{time.time() - start:.1f}s] held without tool calls")
    proc.stdin.close(); proc.wait(timeout=10)
    raise SystemExit(0)
send({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
      "params": {"name": "codegraph_explore", "arguments": {"query": query, "projectPath": root}}})
res = recv(2)
elapsed = time.time() - start
text = "".join(c.get("text", "") for c in res.get("result", {}).get("content", []))
print(f"[{elapsed:.1f}s] isError={res.get('result', {}).get('isError')} error={res.get('error')}")
print("\n".join(text.splitlines()[:8]))
proc.stdin.close()
proc.wait(timeout=10)
