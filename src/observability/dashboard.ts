import { ActivityEntry, Metrics } from "./metrics";

type DisplayState = "active" | "complete" | "blocked" | "failed";

export interface TaskSummary extends ActivityEntry {
  displayState: DisplayState;
}

const displayStates: Record<ActivityEntry["status"], DisplayState> = {
  started: "active",
  completed: "complete",
  pr_ready: "complete",
  blocked: "blocked",
  failed: "failed",
};

export function summarizeTasks(activity: ActivityEntry[]): TaskSummary[] {
  const latestByIssue = new Map<number, TaskSummary>();
  for (const entry of activity) {
    if (!latestByIssue.has(entry.issueNumber)) {
      latestByIssue.set(entry.issueNumber, {
        ...entry,
        displayState: displayStates[entry.status],
      });
    }
  }
  return [...latestByIssue.values()];
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function link(url: string | undefined, label: string): string {
  if (!url?.startsWith("https://")) return '<span class="muted">—</span>';
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

function duration(milliseconds?: number): string {
  if (milliseconds === undefined) return "—";
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function stateLabel(task: TaskSummary): string {
  if (task.status === "pr_ready") return "PR ready";
  return task.displayState[0].toUpperCase() + task.displayState.slice(1);
}

export function renderDashboard(
  metrics: Metrics,
  repoOwner: string,
  repoName: string,
): string {
  const tasks = summarizeTasks(metrics.recentActivity);
  const rows = tasks
    .map((task) => {
      const issueUrl = `https://github.com/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/issues/${task.issueNumber}`;
      const detail = task.reason || (task.status === "pr_ready" ? "Ready for human review" : "—");
      return `<tr>
        <td><a href="${escapeHtml(issueUrl)}" target="_blank" rel="noopener noreferrer">#${task.issueNumber}</a><span class="task-title">${escapeHtml(task.issueTitle)}</span></td>
        <td><span class="badge ${task.displayState}">${escapeHtml(stateLabel(task))}</span></td>
        <td>${link(task.sessionUrl, "Open session")}</td>
        <td>${link(task.prUrl, "Open PR")}</td>
        <td>${escapeHtml(task.validation || "—")}</td>
        <td>${escapeHtml(duration(task.duration))}</td>
        <td>${escapeHtml(new Date(task.timestamp).toLocaleString("en-US", { timeZone: "UTC" }))} UTC</td>
        <td>${escapeHtml(detail)}</td>
      </tr>`;
    })
    .join("");

  const taskRows =
    rows || '<tr><td colspan="8" class="empty">No automation tasks recorded yet.</td></tr>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="10">
  <title>Devin Automation Dashboard</title>
  <style>
    :root { color-scheme: dark; --bg:#0b1020; --panel:#151c2f; --line:#28324b; --text:#eef2ff; --muted:#9aa7c2; --accent:#7c9cff; }
    * { box-sizing: border-box; }
    body { margin:0; background:linear-gradient(135deg,#080c18,#111a31); color:var(--text); font:14px/1.5 ui-sans-serif,system-ui,sans-serif; min-height:100vh; }
    main { width:min(1200px,calc(100% - 32px)); margin:0 auto; padding:42px 0; }
    header { display:flex; justify-content:space-between; align-items:flex-end; gap:24px; margin-bottom:24px; }
    h1 { margin:0; font-size:clamp(26px,4vw,40px); letter-spacing:-.03em; }
    header p { color:var(--muted); margin:6px 0 0; }
    .operational { color:#78e6ad; border:1px solid #266f51; background:#123728; padding:6px 10px; border-radius:999px; white-space:nowrap; }
    .cards { display:grid; grid-template-columns:repeat(5,minmax(120px,1fr)); gap:12px; margin-bottom:24px; }
    .card,.table-wrap { background:rgba(21,28,47,.94); border:1px solid var(--line); border-radius:14px; box-shadow:0 16px 50px rgba(0,0,0,.2); }
    .card { padding:18px; }
    .card span { color:var(--muted); display:block; }
    .card strong { display:block; font-size:30px; margin-top:4px; }
    .table-wrap { overflow-x:auto; }
    table { width:100%; border-collapse:collapse; min-width:920px; }
    caption { text-align:left; padding:18px 20px; font-size:18px; font-weight:700; }
    th,td { padding:13px 16px; border-top:1px solid var(--line); text-align:left; vertical-align:top; }
    th { color:var(--muted); font-size:11px; letter-spacing:.08em; text-transform:uppercase; }
    a { color:#9db2ff; text-decoration:none; }
    a:hover { text-decoration:underline; }
    .task-title { display:block; color:var(--muted); max-width:260px; }
    .badge { display:inline-block; padding:3px 9px; border-radius:999px; font-size:12px; font-weight:700; white-space:nowrap; }
    .active { color:#bcd0ff; background:#263d75; }
    .complete { color:#8df0bc; background:#1b5037; }
    .blocked { color:#ffe0a0; background:#654a17; }
    .failed { color:#ffb1b1; background:#642a33; }
    .muted,.empty,footer { color:var(--muted); }
    .empty { text-align:center; padding:36px; }
    footer { margin-top:14px; display:flex; justify-content:space-between; gap:16px; flex-wrap:wrap; }
    @media (max-width:760px) { .cards { grid-template-columns:repeat(2,1fr); } header { align-items:flex-start; flex-direction:column; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div><h1>Devin Automation</h1><p>${escapeHtml(repoOwner)}/${escapeHtml(repoName)} · issue remediation control plane</p></div>
      <span class="operational">● Operational</span>
    </header>
    <section class="cards" aria-label="Workflow metrics">
      <div class="card"><span>Issues processed</span><strong>${escapeHtml(metrics.totalIssuesProcessed)}</strong></div>
      <div class="card"><span>Active</span><strong>${escapeHtml(metrics.activeSessions)}</strong></div>
      <div class="card"><span>PR ready</span><strong>${escapeHtml(metrics.successfulSessions)}</strong></div>
      <div class="card"><span>Blocked</span><strong>${escapeHtml(metrics.blockedSessions)}</strong></div>
      <div class="card"><span>Failed</span><strong>${escapeHtml(metrics.failedSessions)}</strong></div>
    </section>
    <section class="table-wrap">
      <table>
        <caption>Current and completed tasks</caption>
        <thead><tr><th>Issue</th><th>State</th><th>Devin</th><th>Output</th><th>Validation</th><th>Duration</th><th>Updated</th><th>Detail</th></tr></thead>
        <tbody>${taskRows}</tbody>
      </table>
    </section>
    <footer><span>Auto-refreshes every 10 seconds</span><span>Last metrics update: ${escapeHtml(metrics.lastUpdateTime)}</span></footer>
  </main>
</body>
</html>`;
}
