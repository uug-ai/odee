import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { acquireLock, runCommand, validateBacklog } from "./loop.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(directory, "loop.mjs");
const sha = (number) => number.toString(16).padStart(40, "0");
const evidence = "Synthetic fixture; node --test; expected behavior and regression PASS.";
function spec(id, extra = {}) {
  return { id, revision: 1, title: `Synthetic ${id}`, owner: "platform", priority: 10,
    dependsOn: [], paths: [`src/${id}`], acceptance: ["Given synthetic input, preserve the declared invariant."],
    requiredQa: ["qa-api-data"], ...extra };
}
function fixture(t, tickets = [spec("A"), spec("B")]) {
  // Fixtures live only under this project, never a shared OS temporary directory.
  const root = fs.mkdtempSync(path.join(directory, ".loop-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "docs/roadmap"), { recursive: true });
  let backlog = { version: 1, tickets };
  const writeBacklog = (value) => {
    backlog = value;
    fs.writeFileSync(path.join(root, "docs/roadmap/backlog.json"), JSON.stringify(value));
  };
  writeBacklog(backlog);
  const run = (command, args = {}) => runCommand({ root }, command, args);
  const subprocess = (...args) => spawnSync(process.execPath, [cli, "--root", root, ...args], { encoding: "utf8", env: { PATH: process.env.PATH } });
  const statePath = path.join(root, ".odee/loop.json");
  return { root, run, subprocess, statePath, writeBacklog,
    backlog: () => structuredClone(backlog),
    state: () => JSON.parse(fs.readFileSync(statePath, "utf8")),
    entry: (id) => run("status").tickets[id] };
}
function code(expected, fn) {
  assert.throws(fn, (error) => error.code === expected, `expected ${expected}`);
}
function claim(f, id, worker = `feature-${id}`, revision = 1) {
  return f.run("claim", { ticket: id, worker, revision });
}
function submit(f, id, number, worker = `feature-${id}`, revision = 1) {
  return f.run("submit", { ticket: id, worker, revision, sha: sha(number), evidence });
}
function qa(f, id, number, result = "PASS", role = "qa-api-data", worker = `tester-${id}`, revision = 1) {
  f.run("claim", { ticket: id, worker, revision, sha: sha(number), role, kind: "qa" });
  return f.run("verdict", { ticket: id, worker, revision, sha: sha(number), role, result, evidence });
}
function merge(f, id, number, revision = 1) {
  f.run("gate", { ticket: id, sha: sha(number), revision });
  return f.run("merged", { ticket: id, sha: sha(number), revision, "merged-sha": sha(number + 1000), evidence });
}
function pausedClaimOwner(f) {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e",
    `import { acquireLock } from ${JSON.stringify(new URL("./loop.mjs", import.meta.url).href)};
     const lock = acquireLock(${JSON.stringify(f.statePath)});
     process.stdout.write(JSON.stringify(lock.owner));`], { encoding: "utf8", env: {} });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

test("happy build/fail/fix/retest/merged across two independent tickets, with durable audit", (t) => {
  const f = fixture(t);
  f.run("init");
  claim(f, "A");
  claim(f, "B");
  submit(f, "A", 1);
  submit(f, "B", 2);
  qa(f, "A", 1, "FAIL");
  qa(f, "B", 2);
  assert.equal(f.entry("A").status, "changes-requested");
  assert.equal(f.entry("B").status, "verified");
  code("QA_GATE", () => f.run("gate", { ticket: "A", sha: sha(1), revision: 1 }));
  merge(f, "B", 2);
  claim(f, "A");
  submit(f, "A", 3);
  code("QA_GATE", () => f.run("gate", { ticket: "A", sha: sha(3), revision: 1 }));
  qa(f, "A", 3);
  merge(f, "A", 3);
  const status = f.run("status");
  assert.equal(status.counts.merged, 2);
  assert.equal(status.next, null);
  assert.deepEqual(status.active, { feature: 0, qa: 0 });
  assert.equal(status.tickets.A.failureCount, 1);
  assert.equal(status.tickets.A.lease, null);
  assert.equal(status.tickets.A.verdicts.length, 2);
  assert.equal(status.tickets.A.merged.candidateSha, sha(3));
  assert.deepEqual(status.history.map((item) => item.sequence), Array.from({ length: status.sequence }, (_, index) => index + 1));
  assert.equal(f.subprocess("status").status, 0, "another CLI process can read persisted completion");
});

test("dependency ordering, stable priorities and nondispatchable epics", (t) => {
  const f = fixture(t, [
    spec("child", { priority: 0, dependsOn: ["parent"] }),
    spec("parent", { priority: 2 }),
    spec("other", { priority: 3 }),
    spec("roadmap", { kind: "epic", status: "proposed", priority: -1, paths: [], acceptance: [], requiredQa: [] }),
  ]);
  f.run("init");
  assert.equal(f.run("next").next.ticket.id, "parent");
  code("DEPENDENCIES_UNMET", () => claim(f, "child"));
  code("NOT_DISPATCHABLE", () => claim(f, "roadmap"));
  claim(f, "parent");
  submit(f, "parent", 1);
  qa(f, "parent", 1);
  merge(f, "parent", 1);
  assert.equal(f.run("next").next.ticket.id, "child");
  claim(f, "child");
  assert.equal(f.run("next").next.ticket.id, "other");
});

test("schema rejects unknown dependencies, cycles, duplicate IDs and invalid values", (t) => {
  const f = fixture(t);
  const valid = () => ({ version: 1, tickets: [spec("A"), spec("B")] });
  const cases = [
    [{ version: 2, tickets: [] }, "INVALID_BACKLOG"],
    [{ version: 1, tickets: [spec("A"), spec("A")] }, "INVALID_BACKLOG"],
    [{ version: 1, tickets: [spec("A", { dependsOn: ["missing"] })] }, "INVALID_BACKLOG"],
    [{ version: 1, tickets: [spec("A", { dependsOn: ["B"] }), spec("B", { dependsOn: ["A"] })] }, "DEPENDENCY_CYCLE"],
    [{ version: 1, tickets: [spec("A", { dependsOn: ["A"] })] }, "DEPENDENCY_CYCLE"],
    [{ version: 1, tickets: [spec("A", { status: "merged" })] }, "INVALID_BACKLOG"],
    [{ version: 1, tickets: [spec("A", { requiredQa: [] })] }, "INVALID_BACKLOG"],
    [{ version: 1, tickets: [spec("A", { acceptance: [null] })] }, "INVALID_INPUT"],
    [{ version: 1, tickets: [spec("A", { revision: "1" })] }, "INVALID_INPUT"],
    [{ version: 1, tickets: [spec("A", { priority: 1.5 })] }, "INVALID_BACKLOG"],
    [{ version: 1, tickets: [spec("A", { dependsOn: ["B", "B"] }), spec("B")] }, "INVALID_BACKLOG"],
    [{ version: 1, tickets: [spec("A", { requiredQa: ["qa", "qa"] })] }, "INVALID_BACKLOG"],
  ];
  assert.equal(validateBacklog(valid(), f.root).tickets.length, 2);
  for (const [backlog, expected] of cases) code(expected, () => validateBacklog(backlog, f.root));
  f.writeBacklog({ version: 1, tickets: [spec("bad", { priority: "high" })] });
  code("INVALID_BACKLOG", () => f.run("init"));
  assert.equal(fs.existsSync(f.statePath), false, "failed init leaves no success-shaped state");
  assert.equal(fs.existsSync(`${f.statePath}.lock`), false);
  code("NOT_INITIALIZED", () => f.run("status"));
});

test("safe repository paths reject traversal, aliases and coordinator state", (t) => {
  const f = fixture(t);
  for (const prefix of ["../outside", "/absolute", "C:\\outside", "a\\b", "src/../other", "./src", "src//x", ".git/config", ".odee/loop.json", "src//", "a\u0000b"]) {
    code("UNSAFE_PATH", () => validateBacklog({ version: 1, tickets: [spec("A", { paths: [prefix] })] }, f.root));
  }
  fs.mkdirSync(path.join(f.root, "actual"));
  fs.symlinkSync("actual", path.join(f.root, "alias"));
  code("UNSAFE_PATH", () => validateBacklog({ version: 1, tickets: [spec("A", { paths: ["alias/file"] })] }, f.root));
  code("UNSAFE_PATH", () => runCommand({ root: f.root, state: "../escape.json" }, "init"));
  code("UNSAFE_PATH", () => runCommand({ root: f.root, state: ".git/config" }, "init"));
});

test("overlapping directory/file leases survive QA; segment neighbors do not collide", (t) => {
  const f = fixture(t, [
    spec("A", { paths: ["src/shared/"] }), spec("B", { paths: ["src/shared/file.mjs"] }),
    spec("C", { paths: ["src/shared-neighbor"] }), spec("D", { paths: ["src"] }),
  ]);
  f.run("init");
  claim(f, "A");
  code("PATH_COLLISION", () => claim(f, "B"));
  code("PATH_COLLISION", () => claim(f, "D"));
  claim(f, "C");
  submit(f, "A", 1);
  code("PATH_COLLISION", () => claim(f, "B"));
  qa(f, "A", 1);
  code("PATH_COLLISION", () => claim(f, "B"), "verified work still holds its write lease");
  merge(f, "A", 1);
  claim(f, "B");
});

test("caps of three features and two QA claims, one assignment per worker and ticket", (t) => {
  const f = fixture(t, ["A", "B", "C", "D"].map((id) => spec(id, { requiredQa: ["qa-api-data", "qa-integration"] })));
  f.run("init");
  claim(f, "A");
  claim(f, "B");
  claim(f, "C");
  assert.equal(f.run("next").next, null);
  code("CAPACITY", () => claim(f, "D"));
  code("WORKER_BUSY", () => claim(f, "D", "feature-A"));
  submit(f, "A", 1);
  code("NOT_READY", () => claim(f, "A", "another-feature"));
  claim(f, "D");
  submit(f, "B", 2);
  for (const [id, number] of [["A", 1], ["B", 2]]) {
    f.run("claim", { ticket: id, worker: `qa-${id}`, revision: 1, kind: "qa", role: "qa-api-data", sha: sha(number) });
  }
  assert.equal(f.run("next", { kind: "qa" }).next, null);
  code("CAPACITY", () => f.run("claim", { ticket: "A", worker: "third-qa", revision: 1, kind: "qa", role: "qa-integration", sha: sha(1) }));
  f.run("verdict", { ticket: "A", worker: "qa-A", role: "qa-api-data", revision: 1, sha: sha(1), result: "PASS", evidence });
  const next = f.run("next", { kind: "qa", role: "qa-integration", worker: "qa-A" }).next;
  assert.equal(next.ticket.id, "A");
  assert.equal(next.role, "qa-integration");
  code("QA_GATE", () => f.run("gate", { ticket: "A", revision: 1, sha: sha(1) }));
});

test("independent exact-SHA and revision verdict contract", (t) => {
  const f = fixture(t);
  f.run("init");
  code("STALE_REVISION", () => claim(f, "A", "feature-A", 2));
  claim(f, "A");
  code("INVALID_INPUT", () => f.run("submit", { ticket: "A", worker: "feature-A", revision: 1, sha: sha(1), evidence: "" }));
  code("INVALID_INPUT", () => f.run("submit", { ticket: "A", worker: "feature-A", revision: 1, sha: "abc", evidence }));
  code("NO_CLAIM", () => submit(f, "A", 1, "impostor"));
  submit(f, "A", 1);
  const qaClaim = { ticket: "A", worker: "tester-A", revision: 1, kind: "qa", role: "qa-api-data", sha: sha(1) };
  code("SELF_QA", () => f.run("claim", { ...qaClaim, worker: "feature-A" }));
  code("QA_NOT_READY", () => f.run("claim", { ...qaClaim, role: "not-required" }));
  code("STALE_SHA", () => f.run("claim", { ...qaClaim, sha: sha(2) }));
  f.run("claim", qaClaim);
  const verdict = { ...qaClaim, result: "PASS", evidence };
  code("NO_CLAIM", () => f.run("verdict", { ...verdict, worker: "impostor" }));
  code("SELF_QA", () => f.run("verdict", { ...verdict, worker: "feature-A" }));
  code("STALE_SHA", () => f.run("verdict", { ...verdict, sha: sha(2) }));
  code("STALE_REVISION", () => f.run("verdict", { ...verdict, revision: 2 }));
  f.run("verdict", verdict);
  code("DUPLICATE_VERDICT", () => f.run("verdict", verdict));
  code("GATE_REQUIRED", () => f.run("merged", { ticket: "A", revision: 1, sha: sha(1), "merged-sha": sha(100), evidence }));
  merge(f, "A", 1);
});

test("every required role must independently retest a repaired SHA, including previously passing roles", (t) => {
  const f = fixture(t, [spec("A", { requiredQa: ["qa-api-data", "qa-integration"] })]);
  f.run("init");
  claim(f, "A");
  submit(f, "A", 1);
  qa(f, "A", 1, "PASS");
  qa(f, "A", 1, "FAIL", "qa-integration", "integration-tester");
  claim(f, "A", "fixer-A");
  submit(f, "A", 2, "fixer-A");
  qa(f, "A", 2, "PASS", "qa-integration", "integration-tester");
  code("QA_GATE", () => f.run("gate", { ticket: "A", revision: 1, sha: sha(2) }));
  code("SELF_QA", () => f.run("claim", { ticket: "A", worker: "feature-A", revision: 1,
    sha: sha(2), kind: "qa", role: "qa-api-data" }));
  qa(f, "A", 2);
  merge(f, "A", 2);
  assert.equal(f.entry("A").verdicts.length, 4);
});

test("three unsuccessful candidate rounds block only that ticket, never spin or reset on requeue", (t) => {
  const f = fixture(t, [spec("A", { requiredQa: ["qa-api-data", "qa-integration"] }), spec("B")]);
  f.run("init");
  for (let round = 1; round <= 3; round += 1) {
    claim(f, "A");
    submit(f, "A", round);
    for (const role of ["qa-api-data", "qa-integration"]) {
      f.run("claim", { ticket: "A", worker: role, revision: 1, sha: sha(round), role, kind: "qa" });
    }
    f.run("verdict", { ticket: "A", worker: "qa-api-data", revision: 1, sha: sha(round), role: "qa-api-data", result: "FAIL", evidence });
    code("NOT_READY", () => claim(f, "A"), "another tester remains active, despite first failure");
    f.run("verdict", { ticket: "A", worker: "qa-integration", revision: 1, sha: sha(round), role: "qa-integration", result: "FAIL", evidence });
    assert.equal(f.entry("A").failureCount, round, "two roles failing one candidate count as one repair round");
  }
  assert.equal(f.entry("A").status, "blocked");
  code("NOT_READY", () => claim(f, "A"));
  assert.equal(f.run("next").next.ticket.id, "B");
  f.run("requeue", { ticket: "A", evidence: "Explicit PM decision: retain blocker and split follow-up." });
  assert.equal(f.entry("A").status, "blocked");
  code("NOT_READY", () => claim(f, "A"));
});

test("BLOCKED infra verdict needs explicit recovery and new SHA; failed SHAs cannot be recycled", (t) => {
  const f = fixture(t);
  f.run("init");
  claim(f, "A");
  submit(f, "A", 1);
  qa(f, "A", 1, "BLOCKED");
  assert.equal(f.entry("A").status, "blocked");
  code("NOT_READY", () => claim(f, "A"));
  f.run("requeue", { ticket: "A", evidence: "Synthetic infrastructure repaired, preserve original failure." });
  claim(f, "A");
  code("DUPLICATE_SHA", () => submit(f, "A", 1));
  submit(f, "A", 2);
  qa(f, "A", 2);
  merge(f, "A", 2);
});

test("reconcile rejects unrevisioned acceptance/source/path/dependency/role changes atomically", (t) => {
  const f = fixture(t);
  f.run("init");
  const before = fs.readFileSync(f.statePath, "utf8");
  for (const delta of [
    { acceptance: ["Changed requirement"] }, { sources: [{ url: "https://example.invalid/synthetic", version: "2" }] },
    { paths: ["other/path"] }, { dependsOn: ["B"] }, { requiredQa: ["qa-integration"] }, { title: "Different outcome" },
  ]) {
    const backlog = f.backlog();
    backlog.tickets[0] = { ...spec("A"), ...delta };
    f.writeBacklog(backlog);
    code("RECONCILE_REQUIRED", () => claim(f, "A"));
    code("REVISION_REQUIRED", () => f.run("reconcile"));
    assert.equal(fs.readFileSync(f.statePath, "utf8"), before, "invalid reconcile never partially applies");
  }
  f.writeBacklog({ version: 1, tickets: [spec("A", { priority: -5 }), spec("B")] });
  f.run("reconcile");
  assert.equal(f.run("next").next.ticket.priority, -5, "priority-only PM updates need no acceptance revision");
});

test("spec changes invalidate approval/gate and preserve incompatible active work until explicit requeue", (t) => {
  const f = fixture(t);
  f.run("init");
  claim(f, "A");
  submit(f, "A", 1);
  qa(f, "A", 1);
  f.run("gate", { ticket: "A", revision: 1, sha: sha(1) });
  claim(f, "B");
  const backlog = f.backlog();
  for (const ticket of backlog.tickets) {
    ticket.revision = 2;
    ticket.acceptance.push("New independently testable synthetic edge case");
  }
  f.writeBacklog(backlog);
  f.run("reconcile");
  const a = f.entry("A");
  const b = f.entry("B");
  assert.equal(a.status, "paused");
  assert.equal(a.candidate, null);
  assert.equal(a.gate, null);
  assert.equal(a.verdicts.length, 1, "old evidence remains audit history, not current approval");
  assert.equal(b.feature.revision, 1, "never silently abandon a running worker");
  assert.equal(b.status, "paused");
  code("STALE_REVISION", () => f.run("gate", { ticket: "A", revision: 1, sha: sha(1) }));
  code("STALE_SHA", () => f.run("gate", { ticket: "A", revision: 2, sha: sha(1) }));
  code("NO_CLAIM", () => submit(f, "B", 2, "feature-B", 2));
  f.run("checkpoint", { ticket: "B", worker: "feature-B", evidence: "Stopped at synthetic worktree checkpoint; no subprocess." });
  f.run("recover", { ticket: "B", worker: "feature-B", evidence: "Worker has exited; preserve branch." });
  assert.equal(f.entry("B").status, "paused");
  f.run("resume");
  code("NOT_READY", () => claim(f, "B", "feature-B", 2));
  for (const id of ["A", "B"]) f.run("requeue", { ticket: id, evidence: "PM revision acknowledged; all workers safely stopped." });
  claim(f, "A", "new-feature", 2);
  submit(f, "A", 1, "new-feature", 2);
  code("STALE_REVISION", () => qa(f, "A", 1, "PASS", "qa-api-data", "new-tester", 1));
  qa(f, "A", 1, "PASS", "qa-api-data", "new-tester", 2);
  merge(f, "A", 1, 2);
});

test("dependency revision cascades to in-flight and delivered dependents; retired work keeps leases", (t) => {
  const f = fixture(t, [spec("A"), spec("B", { dependsOn: ["A"] }), spec("C", { dependsOn: ["B"] })]);
  f.run("init");
  for (const [id, number] of [["A", 1], ["B", 2]]) {
    claim(f, id); submit(f, id, number); qa(f, id, number); merge(f, id, number);
  }
  claim(f, "C");
  const backlog = f.backlog();
  backlog.tickets[0].revision = 2;
  f.writeBacklog(backlog);
  f.run("reconcile");
  assert.equal(f.entry("B").status, "ready", "delivered dependent must no longer unlock downstream work under a revised prerequisite");
  assert.equal(f.entry("C").status, "paused");
  assert.equal(f.entry("C").feature.worker, "feature-C");
  code("DEPENDENCIES_UNMET", () => claim(f, "B"));
  const removed = f.backlog();
  removed.tickets = removed.tickets.filter((ticket) => ticket.id !== "C");
  f.writeBacklog(removed);
  f.run("reconcile");
  assert.equal(f.entry("C").retired, true);
  assert.ok(f.entry("C").lease);
  code("NOT_DISPATCHABLE", () => claim(f, "C", "other-worker"));
  f.run("requeue", { ticket: "C", evidence: "Removed worker has stopped; preserve synthetic handoff." });
  assert.equal(f.entry("C").status, "cancelled");
  assert.equal(f.entry("C").lease, null);
});

test("PM revision preserves interrupted QA claim but rejects its now-stale result", (t) => {
  const f = fixture(t);
  f.run("init");
  claim(f, "A");
  submit(f, "A", 1);
  f.run("claim", { ticket: "A", worker: "tester-A", revision: 1, kind: "qa", role: "qa-api-data", sha: sha(1) });
  const backlog = f.backlog();
  backlog.tickets[0].revision = 2;
  backlog.tickets[0].requiredQa.push("qa-integration");
  f.writeBacklog(backlog);
  f.run("reconcile");
  assert.equal(f.entry("A").qa["qa-api-data"].worker, "tester-A");
  code("STALE_REVISION", () => f.run("verdict", { ticket: "A", worker: "tester-A", revision: 1, role: "qa-api-data",
    sha: sha(1), result: "PASS", evidence }));
  f.run("stop");
  f.run("checkpoint", { ticket: "A", worker: "tester-A", kind: "qa", role: "qa-api-data", evidence });
  f.run("recover", { ticket: "A", worker: "tester-A", kind: "qa", role: "qa-api-data", evidence });
  assert.equal(f.entry("A").status, "paused");
  f.run("requeue", { ticket: "A", evidence });
  f.run("resume");
  claim(f, "A", "feature-A", 2);
  const revised = f.run("status").history.find((item) => item.action === "reconcile").changes[0];
  assert.equal(revised.previousSpec.requiredQa.length, 1);
  assert.equal(revised.spec.requiredQa.length, 2);
});

test("pause/stop prohibit next/claims/merge while accepting results and checkpoints", (t) => {
  const f = fixture(t);
  f.run("init");
  claim(f, "A");
  f.run("pause");
  code("DISPATCH_DISABLED", () => f.run("next"));
  code("DISPATCH_DISABLED", () => claim(f, "B"));
  f.run("checkpoint", { ticket: "A", worker: "feature-A", evidence });
  submit(f, "A", 1);
  code("DISPATCH_DISABLED", () => qa(f, "A", 1));
  f.run("resume");
  f.run("claim", { ticket: "A", worker: "tester-A", revision: 1, kind: "qa", role: "qa-api-data", sha: sha(1) });
  f.run("stop");
  f.run("verdict", { ticket: "A", worker: "tester-A", revision: 1, role: "qa-api-data", sha: sha(1), result: "PASS", evidence });
  code("DISPATCH_DISABLED", () => f.run("gate", { ticket: "A", revision: 1, sha: sha(1) }));
  f.run("resume");
  f.run("gate", { ticket: "A", revision: 1, sha: sha(1) });
  f.run("stop");
  code("DISPATCH_DISABLED", () => f.run("merged", { ticket: "A", revision: 1, sha: sha(1), "merged-sha": sha(2), evidence }));
  assert.equal(f.subprocess("next").status, 1, "restart does not silently resume");
  assert.equal(f.entry("A").status, "integrating");
  f.run("resume");
  f.run("merged", { ticket: "A", revision: 1, sha: sha(1), "merged-sha": sha(2), evidence });
});

test("interrupted claims survive process restart and explicit recovery frees only owned assignment", (t) => {
  const f = fixture(t);
  assert.equal(f.subprocess("init").status, 0);
  assert.equal(f.subprocess("claim", "--ticket", "A", "--worker", "feature-A", "--revision", "1").status, 0);
  assert.equal(JSON.parse(f.subprocess("status").stdout).tickets.A.feature.worker, "feature-A");
  code("NO_CLAIM", () => f.run("recover", { ticket: "A", worker: "unrelated-worker", evidence }));
  f.run("stop");
  f.run("recover", { ticket: "A", worker: "feature-A", evidence: "Explicit interrupted-worker acknowledgement; branch preserved." });
  assert.equal(f.entry("A").feature, null);
  assert.equal(f.entry("A").lease, null);
  assert.equal(f.run("status").mode, "stopped");
  code("DISPATCH_DISABLED", () => claim(f, "A"));
});

test("stop/checkpoint/requeue remain usable with malformed PM edits; resume never bypasses reconciliation", (t) => {
  const f = fixture(t);
  f.run("init");
  claim(f, "A");
  fs.writeFileSync(path.join(f.root, "docs/roadmap/backlog.json"), "{bad");
  f.run("stop");
  assert.equal(f.run("status").backlogError.code, "CORRUPT_JSON");
  f.run("checkpoint", { ticket: "A", worker: "feature-A", evidence });
  f.run("requeue", { ticket: "A", evidence });
  code("CORRUPT_JSON", () => f.run("resume"));
});

test("corrupted/unknown state and CLI mistakes fail explicitly, without fallback or overwriting", (t) => {
  const f = fixture(t);
  f.run("init");
  const saved = fs.readFileSync(f.statePath, "utf8");
  for (const contents of ["{broken", '{"version":99}', JSON.stringify({ ...JSON.parse(saved), mode: "unknown" })]) {
    fs.writeFileSync(f.statePath, contents);
    const result = f.subprocess("status");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /loop: (?:CORRUPT_JSON|CORRUPT_STATE):/);
    assert.equal(result.stdout, "");
    code("ALREADY_INITIALIZED", () => f.run("init"));
    assert.equal(fs.readFileSync(f.statePath, "utf8"), contents);
  }
  fs.writeFileSync(f.statePath, saved);
  const tampered = JSON.parse(saved);
  tampered.tickets.A.spec.acceptance.push("tampered");
  fs.writeFileSync(f.statePath, JSON.stringify(tampered));
  code("CORRUPT_STATE", () => f.run("status"));
  fs.writeFileSync(f.statePath, saved);
  for (const args of [
    ["no-such-command"], ["claim", "--ticket"], ["claim", "--unknown", "x"],
    ["status", "unexpected"], ["status", "--root", f.root], ["status", "--kind", "qa"],
  ]) {
    const result = f.subprocess(...args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^loop: /);
    assert.doesNotMatch(result.stderr, /\n\s+at /, "no stack dump or success-shaped output");
  }
  const help = f.subprocess("--help");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /no daemon/i);
  assert.match(help.stdout, /recover-lock --token/);
});

test("malformed persisted claims, verdicts and failure counters cannot silently grant a merge gate", (t) => {
  const f = fixture(t);
  f.run("init");
  claim(f, "A");
  submit(f, "A", 1);
  qa(f, "A", 1);
  const saved = fs.readFileSync(f.statePath, "utf8");
  for (const mutate of [
    (state) => { state.tickets.A.verdicts[0].worker = null; },
    (state) => { state.tickets.A.verdicts[0].sha = sha(99); },
    (state) => { state.tickets.A.failureCount = 3; },
    (state) => { state.tickets.A.verdicts.push(state.tickets.A.verdicts[0]); },
    (state) => { state.tickets.A.candidate = null; state.tickets.A.status = "merged"; },
    (state) => { state.tickets.A.status = "merged"; },
    (state) => { delete state.tickets.B.feature; },
  ]) {
    const state = JSON.parse(saved);
    mutate(state);
    fs.writeFileSync(f.statePath, JSON.stringify(state));
    assert.throws(() => f.run("gate", { ticket: "A", revision: 1, sha: sha(1) }));
  }
  fs.writeFileSync(f.statePath, saved);
  merge(f, "A", 1);
});

test("exclusive live lock contention rejects recovery even with exact token", (t) => {
  const f = fixture(t);
  f.run("init");
  const lock = acquireLock(f.statePath);
  try {
    code("LOCKED", () => f.run("pause"));
    assert.equal(f.subprocess("stop").status, 1);
    assert.equal(f.run("status").locks[0].owner.token, lock.owner.token);
    code("LOCK_TOKEN_MISMATCH", () => f.run("recover-lock", { token: "wrong" }));
    code("LIVE_LOCK", () => f.run("recover-lock", { token: lock.owner.token }));
    assert.equal(JSON.parse(fs.readFileSync(`${f.statePath}.lock`)).token, lock.owner.token);
  } finally { lock.release(); }
  f.run("stop");
});

test("dead process locks survive restart until exact-token recovery; active claims are not relaunched", (t) => {
  const f = fixture(t);
  f.run("init");
  claim(f, "A");
  const owner = pausedClaimOwner(f);
  code("LOCKED", () => f.run("resume"));
  code("LOCK_TOKEN_MISMATCH", () => f.run("recover-lock", { token: "not-the-owner" }));
  const recovered = f.run("recover-lock", { token: owner.token });
  assert.equal(recovered.recovered.pid, owner.pid);
  assert.equal(recovered.auditWritten, true);
  assert.equal(f.entry("A").feature.worker, "feature-A");
  assert.ok(f.entry("A").lease);
  assert.equal(f.run("status").history.at(-1).action, "recover-lock");
  code("NOT_READY", () => claim(f, "A", "new-feature"));
  f.run("requeue", { ticket: "A", evidence: "Explicit interrupted work acknowledgement; no process killed." });
  claim(f, "A", "new-feature");
});

test("remote host and recycled PID locks cannot cause unrelated processes to be killed", (t) => {
  const f = fixture(t);
  f.run("init");
  const owner = pausedClaimOwner(f);
  const filename = `${f.statePath}.lock`;
  fs.writeFileSync(filename, JSON.stringify({ ...owner, hostname: `${os.hostname()}-different-host` }));
  code("REMOTE_LOCK", () => f.run("recover-lock", { token: owner.token }));
  fs.writeFileSync(filename, JSON.stringify({ ...owner, pid: process.pid, start: "not-this-process-start" }));
  f.run("recover-lock", { token: owner.token });
  assert.equal(process.kill(process.pid, 0), true);
  f.run("stop");
});

test("interrupted recovery guard can itself be recovered explicitly, deepest first", (t) => {
  const f = fixture(t);
  f.run("init");
  const owner = pausedClaimOwner(f);
  const mainLock = `${f.statePath}.lock`;
  // Model death while a recovery was holding its complete ownership record.
  fs.copyFileSync(mainLock, `${mainLock}.recovery`);
  code("LOCKED", () => f.run("pause"));
  code("LOCKED", () => f.run("recover-lock", { token: owner.token }));
  assert.equal(f.run("status").locks.length, 2);
  f.run("recover-lock", { token: owner.token, "recovery-depth": 1 });
  assert.equal(fs.existsSync(`${mainLock}.recovery`), false);
  assert.equal(fs.existsSync(mainLock), true);
  f.run("recover-lock", { token: owner.token });
  f.run("pause");
});

test("a real concurrent owner is preserved, and restart/recovery does not terminate it", async (t) => {
  const f = fixture(t);
  f.run("init");
  const child = spawn(process.execPath, ["--input-type=module", "-e",
    `import { acquireLock } from ${JSON.stringify(new URL("./loop.mjs", import.meta.url).href)};
     const lock = acquireLock(${JSON.stringify(f.statePath)});
     process.stdout.write(JSON.stringify(lock.owner) + '\\n');
     process.stdin.resume(); process.stdin.on('end', () => process.exit(0));`],
  { stdio: ["pipe", "pipe", "pipe"], env: {} });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const [chunk] = await once(child.stdout, "data");
  const owner = JSON.parse(chunk.toString());
  code("LIVE_LOCK", () => f.run("recover-lock", { token: owner.token }));
  assert.equal(child.exitCode, null);
  code("LOCKED", () => f.run("stop"));
  const exited = once(child, "exit");
  child.stdin.end();
  await exited;
  f.run("recover-lock", { token: owner.token });
  f.run("stop");
});
