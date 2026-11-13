#!/usr/bin/env bun
/**
 * Michael's started Linear tickets (In Progress, In Review, QA…) with no open PR behind them.
 *
 * Linear's GitHub integration moves a ticket forward when a PR opens, but nothing moves it back
 * when that PR is closed unmerged, so tickets sit "In Review" for weeks with nothing to review
 * (BEE-26538: urgent and In Review from Oct 2 to Nov 12, PR closed, fix already in production).
 * Linear's copy of a PR's status can be stale, so every linked PR is checked live with `gh`.
 *
 *   stale-tickets.ts [--grace-days 7] [--all]
 *
 * Prints JSON, one entry per stale ticket:
 *   { identifier, title, url, state, priority, daysInState, prs: [{ url, state }], suggest }
 * suggest: "todo" (no PR, or only closed-unmerged ones) or "check" (merged PRs, none open: Done
 * if the ticket's work shipped, else Todo). Tickets that entered their state within the grace
 * period are skipped (just picked up, no PR yet); --all includes them.
 */

import { homedir } from "node:os";
import { join } from "node:path";

const SWARM = join(homedir(), "Projects/beehiiv/swarm"); // the gh wrapper picks the account by folder

const QUERY = `query {
  viewer {
    assignedIssues(first: 100, filter: { state: { type: { eq: "started" } } }) {
      pageInfo { hasNextPage }
      nodes {
        identifier title url priorityLabel startedAt
        state { name }
        attachments { nodes { url } }
      }
    }
  }
}`;

// Fetched only for tickets with no open PR: history on all 100 makes Linear reject the query
// as too complex.
const HISTORY = `query($id: String!) {
  issue(id: $id) { history(first: 50) { nodes { createdAt toState { name } } } }
}`;

interface Issue {
  identifier: string;
  title: string;
  url: string;
  priorityLabel: string;
  startedAt: string | null;
  state: { name: string };
  attachments: { nodes: { url: string }[] };
}

interface HistoryEntry {
  createdAt: string;
  toState: { name: string } | null;
}

function run(argv: string[]): string {
  const res = Bun.spawnSync(argv, { cwd: SWARM, stderr: "pipe", timeout: 60_000 });
  if (!res.success) throw new Error(`${argv[0]}: ${res.stderr.toString().trim().slice(0, 300)}`);
  return res.stdout.toString();
}

const args = process.argv.slice(2);
const graceIndex = args.indexOf("--grace-days");
const graceDays = graceIndex >= 0 ? Number(args[graceIndex + 1]) : 7;
const includeAll = args.includes("--all");

const parsed = JSON.parse(run(["lin", "gql", QUERY]));
const root = parsed.data ?? parsed;
const issues: Issue[] = root.viewer.assignedIssues.nodes;
if (root.viewer.assignedIssues.pageInfo.hasNextPage) {
  console.error("warning: more than 100 started tickets; only the first 100 were checked");
}

const PR_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;
const now = Date.now();
const out = [];

for (const issue of issues) {
  const urls = [
    ...new Set(
      issue.attachments.nodes.map((a) => a.url.match(PR_URL)?.[0]).filter(Boolean) as string[],
    ),
  ];
  const prs = urls.map((url) => {
    try {
      const view = JSON.parse(run(["gh", "pr", "view", url, "--json", "state"]));
      return { url, state: view.state as string }; // OPEN, CLOSED, MERGED
    } catch (error) {
      return { url, state: "UNKNOWN", error: String(error).slice(0, 200) };
    }
  });
  // An unreadable PR might be open: don't call the ticket stale on a guess.
  if (prs.some((pr) => pr.state === "OPEN" || pr.state === "UNKNOWN")) continue;

  const history = JSON.parse(run(["lin", "gql", HISTORY, JSON.stringify({ id: issue.identifier })]));
  const entries: HistoryEntry[] = (history.data ?? history).issue.history.nodes;
  const entered = entries
    .filter((h) => h.toState?.name === issue.state.name)
    .map((h) => h.createdAt)
    .sort()
    .at(-1);
  const since = entered ?? issue.startedAt;
  const daysInState = since ? Math.floor((now - Date.parse(since)) / 86_400_000) : null;
  if (!includeAll && daysInState !== null && daysInState < graceDays) continue;

  out.push({
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    state: issue.state.name,
    priority: issue.priorityLabel,
    daysInState,
    prs,
    suggest: prs.some((pr) => pr.state === "MERGED") ? "check" : "todo",
  });
}

console.log(JSON.stringify(out, null, 2));
