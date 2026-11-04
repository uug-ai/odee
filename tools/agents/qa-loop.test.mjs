import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { acquireLock, validateBacklog } from "./loop.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(directory, "loop.mjs");
const repository = path.resolve(directory, "../..");
const sha = (n) => n.toString(16).padStart(40, "0");
const evidence = "Independent synthetic CLI QA; fake SHA; assertion/reproducer in qa-loop.test.mjs.";
const ticket = (id, changes = {}) => ({
  id, revision: 1, title: `Synthetic ${id}`, owner: "coordinator", priority: 10,
  dependsOn: [], paths: [`synthetic/${id}`], acceptance: ["Preserve the synthetic contract."],
  requiredQa: ["qa-api-data"], ...changes,
});

function fixture(t, tickets = [ticket("A"), ticket("B")], metadata = {}) {
  const root = path.join(directory, `.qa-loop-${randomUUID()}`);
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const backlogPath = path.join(root, "backlog.json");
  const statePath = path.join(root, ".odee/loop.json");
  const backlog = { version: 1, ...metadata, tickets: structuredClone(tickets) };
  const write = () => fs.writeFileSync(backlogPath, JSON.stringify(backlog));
  write();
  const raw = (command, args = {}) => spawnSync(process.execPath, [
    cli, "--root", root, "--backlog", "backlog.json", command,
    ...Object.entries(args).flatMap(([name, value]) => [`--${name}`, String(value)]),
  ], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, env: { PATH: process.env.PATH, NODE_ENV: "test" } });
  const run = (command, args = {}) => {
    const result = raw(command, args);
    assert.equal(result.status, 0, `${command}: ${result.stderr || result.error || result.stdout}`);
    return JSON.parse(result.stdout);
  };
  const bytes = () => fs.existsSync(statePath) ? fs.readFileSync(statePath, "utf8") : null;
  const reject = (command, args, code) => {
    const before = bytes();
    const result = raw(command, args);
    assert.equal(result.status, 1, `${command} should reject ${code}: ${result.stdout}`);
    assert.match(result.stderr, new RegExp(`loop: ${code}:`));
    assert.equal(bytes(), before, `${command} rejection must not change state`);
    return result;
  };
  const status = () => run("status");
  const claim = (id, worker = `build-${id}`, revision = 1) =>
    run("claim", { ticket: id, worker, revision });
  const submit = (id, n, worker = `build-${id}`, revision = 1) =>
    run("submit", { ticket: id, worker, revision, sha: sha(n), evidence });
  const qaClaim = (id, n, role = "qa-api-data", worker = `test-${id}-${role}`, revision = 1) =>
    run("claim", { ticket: id, kind: "qa", role, worker, revision, sha: sha(n) });
  const verdict = (id, n, result = "PASS", role = "qa-api-data", worker = `test-${id}-${role}`, revision = 1) =>
    run("verdict", { ticket: id, role, worker, revision, sha: sha(n), result, evidence });
  const qa = (id, n, result = "PASS", role = "qa-api-data", worker = `test-${id}-${role}`, revision = 1) => {
    qaClaim(id, n, role, worker, revision);
    return verdict(id, n, result, role, worker, revision);
  };
  const gate = (id, n, revision = 1) => run("gate", { ticket: id, revision, sha: sha(n) });
  const merged = (id, n, revision = 1) =>
    run("merged", { ticket: id, revision, sha: sha(n), "merged-sha": sha(n + 1000), evidence });
  return { root, backlog, write, raw, run, bytes, reject, status, statePath,
    claim, submit, qaClaim, verdict, qa, gate, merged };
}

test("independent QA: two-ticket fail/fix/exact-role retest/gate/merge survives every CLI restart", (t) => {
  const f = fixture(t, [ticket("A", { requiredQa: ["qa-api-data", "qa-integration"] }), ticket("B")]);
  f.run("init");
  for (const [id, n] of [["A", 1], ["B", 2]]) {
    f.claim(id);
    f.submit(id, n);
  }
  f.qa("A", 1);
  f.qa("A", 1, "FAIL", "qa-integration");
  f.qa("B", 2);
  f.reject("gate", { ticket: "A", revision: 1, sha: sha(1) }, "QA_GATE");
  f.gate("B", 2);
  f.merged("B", 2);
  f.claim("A", "repair-A");
  f.submit("A", 3, "repair-A");
  f.qa("A", 3, "PASS", "qa-integration");
  f.reject("gate", { ticket: "A", revision: 1, sha: sha(3) }, "QA_GATE");
  f.qa("A", 3);
  f.gate("A", 3);
  f.merged("A", 3);
  const result = f.status();
  assert.equal(result.counts.merged, 2);
  assert.deepEqual(result.active, { feature: 0, qa: 0 });
  assert.equal(result.next, null);
  assert.equal(result.tickets.A.failureCount, 1);
  assert.equal(result.tickets.A.verdicts.length, 4);
  assert.equal(result.tickets.A.merged.candidateSha, sha(3));
  assert.equal(result.tickets.A.merged.sha, sha(1003));
  assert.equal(result.tickets.A.merged.revision, 1);
  assert.equal(result.tickets.A.lease, null);
  assert.equal(result.tickets.B.lease, null);
  assert.deepEqual(result.history.map((item) => item.sequence),
    Array.from({ length: result.sequence }, (_, index) => index + 1));
  f.reject("init", {}, "ALREADY_INITIALIZED");
});

test("independent QA: real backlog schema accepts current and extended manifests without fabricated completion", (t) => {
  const shared = JSON.parse(fs.readFileSync(path.join(repository, "docs/roadmap/backlog.json"), "utf8"));
  const extended = structuredClone(shared);
  const revised = extended.tickets.find((item) => item.id === "ODEE-005");
  revised.revision += 1;
  revised.requiredQa.push("qa-fixture-extra");
  revised.acceptance.push("Additional synthetic unrelated manifest regression.");
  extended.tickets.push(ticket("QA-UNRELATED", { revision: 3, requiredQa: ["qa-fixture-unrelated"] }));
  extended.fixtureExtension = { purpose: "synthetic current-manifest variation", nested: { retained: true } };
  for (const [name, manifest] of [["current", shared], ["added/revised unrelated contract", extended]]) {
    const validated = validateBacklog(manifest, repository);
    const expectedTotal = validated.tickets.length;
    const expectedEpics = validated.tickets.filter((item) => item.kind === "epic").length;
    const expectedLeaves = expectedTotal - expectedEpics;
    assert.equal(validated.tickets.length, manifest.tickets.length);
    const { tickets, version: _version, ...metadata } = validated;
    const f = fixture(t, tickets, metadata);
    f.run("init");
    const before = f.bytes();
    const result = f.status();
    const entries = Object.values(result.tickets);
    assert.equal(entries.length, expectedTotal);
    assert.deepEqual(Object.keys(result.tickets).sort(), tickets.map((item) => item.id).sort());
    assert.equal(result.leaves.total, expectedLeaves);
    assert.equal(result.counts.ready, expectedLeaves);
    assert.equal(result.counts.cancelled, expectedEpics);
    assert.equal(result.counts.merged, 0);
    assert.equal(result.leaves.counts.merged, 0);
    assert.equal(result.leaves.counts.cancelled, 0);
    assert.deepEqual(result.active, { feature: 0, qa: 0 });
    assert.ok(entries.every((entry) => !entry.merged && !entry.candidate && !entry.gate));
    assert.ok(entries.every((entry) => !entry.feature && Object.keys(entry.qa).length === 0));
    assert.ok(entries.every((entry) => entry.lease === null && entry.contributors.length === 0 &&
      entry.verdicts.length === 0 && entry.submissions.length === 0 && entry.checkpoints.length === 0 && entry.failureCount === 0));
    const epics = entries.filter((entry) => entry.spec.kind === "epic");
    assert.equal(epics.length, expectedEpics);
    assert.ok(epics.every((entry) => entry.status === "cancelled"));
    assert.ok(result.leaves.ready.every((entry) => result.tickets[entry.ticket].spec.kind !== "epic"));
    if (result.next) assert.notEqual(result.next.ticket.kind, "epic");
    if (epics.length) f.reject("claim", { ticket: epics[0].spec.id, worker: "synthetic-epic-worker",
      revision: epics[0].spec.revision }, "NOT_DISPATCHABLE");
    const state = JSON.parse(f.bytes());
    assert.deepEqual(state.backlog, validated, "preserve exact accepted PM metadata and schema extensions");
    assert.deepEqual(validated.tickets.map((item) => result.tickets[item.id].spec), validated.tickets,
      "preserve current revisions and required roles for every contract without depending on object-key order");
    assert.equal(f.bytes(), before, "schema/status and refused epic dispatch fabricate no execution history");
    t.diagnostic(`${name}: ${expectedTotal} validated tickets, ${expectedLeaves} leaves, ${expectedEpics} epics; no fabricated completion or execution.`);
  }
});

test("independent QA: hard caps of three features and four testers, advisory next and unique workers", (t) => {
  const f = fixture(t, ["A", "B", "C", "D", "E", "F", "G"].map((id) =>
    ticket(id, { requiredQa: ["qa-api-data", "qa-integration"] })));
  f.run("init");
  const before = f.bytes();
  assert.equal(f.run("next", { worker: "build-A" }).next.ticket.id, "A");
  assert.equal(f.run("next", { worker: "build-A" }).next.ticket.id, "A");
  assert.equal(f.bytes(), before, "next is not a reservation");
  for (const id of ["A", "B", "C"]) f.claim(id);
  f.reject("claim", { ticket: "D", worker: "build-A", revision: 1 }, "WORKER_BUSY");
  f.reject("claim", { ticket: "D", worker: "build-D", revision: 1 }, "CAPACITY");
  assert.equal(f.run("next").next, null);
  for (const [id, n] of [["A", 1], ["B", 2], ["C", 3]]) f.submit(id, n);
  f.qaClaim("A", 1);
  f.qaClaim("B", 2);
  assert.deepEqual(f.status().active, { feature: 0, qa: 2 });
  assert.ok(f.run("next", { kind: "qa" }).next);
  f.qaClaim("A", 1, "qa-integration");
  f.qaClaim("B", 2, "qa-integration");
  for (const id of ["D", "E", "F"]) f.claim(id);
  assert.deepEqual(f.status().active, { feature: 3, qa: 4 });
  f.reject("claim", { ticket: "G", worker: "build-G", revision: 1 }, "CAPACITY");
  f.reject("claim", { ticket: "C", kind: "qa", worker: "fifth-tester",
    role: "qa-api-data", revision: 1, sha: sha(3) }, "CAPACITY");
  assert.equal(f.run("next", { kind: "qa" }).next, null);
  f.verdict("A", 1);
  assert.equal(f.run("next", { kind: "qa", role: "qa-integration" }).next.ticket.id, "C");
  f.qaClaim("C", 3);
  assert.deepEqual(f.status().active, { feature: 3, qa: 4 });
});

test("independent QA: contributors, wrong workers/roles and stale SHA/revision cannot approve", (t) => {
  const f = fixture(t);
  f.run("init");
  f.claim("A");
  f.submit("A", 1);
  const claim = { ticket: "A", kind: "qa", role: "qa-api-data", worker: "reviewer", revision: 1, sha: sha(1) };
  const verdict = { ticket: "A", role: "qa-api-data", worker: "reviewer", revision: 1,
    sha: sha(1), result: "PASS", evidence };
  f.reject("verdict", verdict, "NO_CLAIM");
  f.reject("claim", { ...claim, worker: "build-A" }, "SELF_QA");
  f.reject("claim", { ...claim, role: "unrequired-role" }, "QA_NOT_READY");
  f.reject("claim", { ...claim, sha: sha(2) }, "STALE_SHA");
  f.reject("claim", { ...claim, revision: 2 }, "STALE_REVISION");
  f.run("claim", claim);
  f.reject("verdict", { ...verdict, worker: "build-A" }, "SELF_QA");
  f.reject("verdict", { ...verdict, worker: "impostor" }, "NO_CLAIM");
  f.reject("verdict", { ...verdict, role: "qa-integration" }, "NO_CLAIM");
  f.reject("verdict", { ...verdict, revision: 2 }, "STALE_REVISION");
  f.reject("verdict", { ...verdict, sha: sha(2) }, "STALE_SHA");
  f.reject("verdict", { ...verdict, evidence: " " }, "INVALID_INPUT");
  f.run("verdict", verdict);
  f.reject("merged", { ticket: "A", revision: 1, sha: sha(1), "merged-sha": sha(11), evidence }, "GATE_REQUIRED");
  f.gate("A", 1);
  f.reject("merged", { ticket: "A", revision: 1, sha: sha(2), "merged-sha": sha(11), evidence }, "STALE_SHA");
  f.reject("merged", { ticket: "A", revision: 2, sha: sha(1), "merged-sha": sha(11), evidence }, "STALE_REVISION");
  f.merged("A", 1);
});

test("independent QA: acceptance/path/dependency edits require revision and reject atomically", (t) => {
  for (const delta of [
    { acceptance: ["A different requirement"] },
    { paths: ["synthetic/changed-path"] },
    { dependsOn: ["B"] },
  ]) {
    const f = fixture(t);
    f.run("init");
    f.claim("A");
    Object.assign(f.backlog.tickets[0], delta);
    f.write();
    f.reject("claim", { ticket: "B", worker: "build-B", revision: 1 }, "RECONCILE_REQUIRED");
    f.reject("reconcile", {}, "REVISION_REQUIRED");
    assert.equal(f.status().tickets.A.feature.worker, "build-A");
  }
});

test("independent QA: revised specs pause in-flight work, retain checkpoints and invalidate old approval", (t) => {
  const f = fixture(t);
  f.run("init");
  f.claim("A");
  f.submit("A", 1);
  f.qa("A", 1);
  f.gate("A", 1);
  f.claim("B");
  for (const spec of f.backlog.tickets) {
    spec.revision += 1;
    spec.acceptance.push("New criterion independently retested.");
  }
  f.write();
  f.run("reconcile");
  let state = f.status();
  assert.equal(state.tickets.A.status, "paused");
  assert.equal(state.tickets.A.candidate, null);
  assert.equal(state.tickets.A.gate, null);
  assert.equal(state.tickets.A.verdicts.length, 1);
  assert.equal(state.tickets.B.status, "paused");
  assert.equal(state.tickets.B.feature.revision, 1);
  assert.deepEqual(state.tickets.B.lease.paths, ["synthetic/B"]);
  f.reject("gate", { ticket: "A", revision: 1, sha: sha(1) }, "STALE_REVISION");
  f.reject("gate", { ticket: "A", revision: 2, sha: sha(1) }, "STALE_SHA");
  f.reject("submit", { ticket: "B", worker: "build-B", revision: 2, sha: sha(2), evidence }, "NO_CLAIM");
  f.run("checkpoint", { ticket: "B", worker: "build-B", evidence });
  f.run("recover", { ticket: "B", worker: "build-B", evidence });
  f.run("resume");
  f.reject("claim", { ticket: "B", worker: "replacement-B", revision: 2 }, "NOT_READY");
  for (const id of ["A", "B"]) f.run("requeue", { ticket: id, evidence });
  f.claim("A", "replacement-A", 2);
  f.submit("A", 1, "replacement-A", 2);
  f.reject("gate", { ticket: "A", revision: 2, sha: sha(1) }, "QA_GATE");
  f.qa("A", 1, "PASS", "qa-api-data", "revision-tester", 2);
  f.gate("A", 1, 2);
  f.merged("A", 1, 2);
  state = f.status();
  assert.equal(state.tickets.A.merged.revision, 2);
  assert.equal(state.tickets.A.verdicts.length, 2);
  assert.equal(state.tickets.B.checkpoints.length, 2);
});

test("independent QA: epics never dispatch; dependency completion and segment leases gate leaves", (t) => {
  const f = fixture(t, [
    ticket("EPIC", { kind: "epic", status: "proposed", priority: -10, paths: [], acceptance: [], requiredQa: [] }),
    ticket("A", { priority: 0, paths: ["synthetic/shared/"] }),
    ticket("B", { dependsOn: ["A"], priority: -1, paths: ["synthetic/dependent"] }),
    ticket("C", { paths: ["synthetic/shared/file.mjs"] }),
    ticket("D", { paths: ["synthetic/shared-neighbor"] }),
  ]);
  f.run("init");
  assert.equal(f.run("next").next.ticket.id, "A");
  f.reject("claim", { ticket: "EPIC", worker: "epic-worker", revision: 1 }, "NOT_DISPATCHABLE");
  f.reject("claim", { ticket: "B", worker: "build-B", revision: 1 }, "DEPENDENCIES_UNMET");
  f.claim("A");
  f.claim("D");
  for (const stage of ["building", "awaiting-qa", "verified", "integrating"]) {
    assert.equal(f.status().tickets.A.status, stage);
    f.reject("claim", { ticket: "C", worker: "build-C", revision: 1 }, "PATH_COLLISION");
    f.reject("claim", { ticket: "B", worker: "build-B", revision: 1 }, "DEPENDENCIES_UNMET");
    if (stage === "building") f.submit("A", 1);
    if (stage === "awaiting-qa") f.qa("A", 1);
    if (stage === "verified") f.gate("A", 1);
  }
  f.merged("A", 1);
  assert.equal(f.run("next").next.ticket.id, "B");
  f.claim("B");
  f.claim("C");
  assert.equal(f.status().tickets.EPIC.status, "cancelled");
});

test("independent QA: three failed candidate rounds stay blocked through resume, reprioritization and requeue", (t) => {
  const f = fixture(t);
  f.run("init");
  for (let round = 1; round <= 3; round += 1) {
    f.claim("A");
    f.submit("A", round);
    f.qa("A", round, "FAIL");
    assert.equal(f.status().tickets.A.failureCount, round);
  }
  assert.equal(f.status().tickets.A.status, "blocked");
  f.reject("claim", { ticket: "A", worker: "fourth-attempt", revision: 1 }, "NOT_READY");
  f.backlog.tickets[0].priority = -100;
  f.write();
  f.run("reconcile");
  f.run("pause");
  f.run("resume");
  f.run("requeue", { ticket: "A", evidence });
  assert.equal(f.status().tickets.A.status, "blocked");
  assert.equal(f.status().tickets.A.failureCount, 3);
  assert.equal(f.run("next").next.ticket.id, "B");
  f.reject("claim", { ticket: "A", worker: "fourth-attempt", revision: 1 }, "NOT_READY");
  f.reject("gate", { ticket: "A", revision: 1, sha: sha(3) }, "STALE_SHA");
});

for (const mode of ["pause", "stop"]) {
  test(`independent QA: ${mode} preserves four QA claims, denies dispatch/gate/merge and accepts late results`, (t) => {
    const roles = ["qa-api-data", "qa-integration", "qa-browser", "qa-security"];
    const f = fixture(t, [ticket("A", { requiredQa: roles }), ticket("B"), ticket("C")]);
    f.run("init");
    f.claim("A");
    f.submit("A", 1);
    for (const role of roles) f.qaClaim("A", 1, role);
    f.claim("B");
    f.run(mode);
    assert.deepEqual(f.status().active, { feature: 1, qa: 4 });
    for (const [command, args] of [
      ["next", {}],
      ["next", { kind: "qa" }],
      ["claim", { ticket: "C", worker: "build-C", revision: 1 }],
      ["gate", { ticket: "A", revision: 1, sha: sha(1) }],
      ["merged", { ticket: "A", revision: 1, sha: sha(1), "merged-sha": sha(11), evidence }],
    ]) f.reject(command, args, "DISPATCH_DISABLED");
    f.run("checkpoint", { ticket: "A", kind: "qa", role: "qa-api-data", worker: "test-A-qa-api-data", evidence });
    f.verdict("A", 1);
    assert.deepEqual(f.status().active, { feature: 1, qa: 3 });
    f.run("checkpoint", { ticket: "B", worker: "build-B", evidence });
    f.submit("B", 2);
    f.reject("claim", { ticket: "B", kind: "qa", role: "qa-api-data", worker: "late-dispatch",
      revision: 1, sha: sha(2) }, "DISPATCH_DISABLED");
    for (const role of roles.slice(1)) f.verdict("A", 1, "PASS", role);
    assert.equal(f.status().tickets.A.status, "verified");
    assert.equal(f.status().tickets.B.status, "awaiting-qa");
    f.reject("gate", { ticket: "A", revision: 1, sha: sha(1) }, "DISPATCH_DISABLED");
    f.run("resume");
    assert.deepEqual(f.status().active, { feature: 0, qa: 0 }, "resume never launches an agent");
    f.gate("A", 1);
    f.run(mode);
    f.reject("merged", { ticket: "A", revision: 1, sha: sha(1), "merged-sha": sha(11), evidence }, "DISPATCH_DISABLED");
    f.run("resume");
    f.merged("A", 1);
  });
}

test("independent QA: recovery owns only the interrupted claim and malformed backlog cannot disable stop/checkpoint", (t) => {
  const f = fixture(t);
  f.run("init");
  f.claim("A");
  f.claim("B");
  f.reject("recover", { ticket: "A", worker: "impostor", evidence }, "NO_CLAIM");
  fs.writeFileSync(path.join(f.root, "backlog.json"), "{bad planning edit");
  f.run("stop");
  f.run("checkpoint", { ticket: "A", worker: "build-A", evidence });
  f.reject("resume", {}, "CORRUPT_JSON");
  f.run("recover", { ticket: "A", worker: "build-A", evidence });
  let state = f.status();
  assert.equal(state.mode, "stopped");
  assert.equal(state.tickets.A.feature, null);
  assert.equal(state.tickets.A.lease, null);
  assert.equal(state.tickets.A.checkpoints.length, 2);
  assert.equal(state.tickets.B.feature.worker, "build-B");
  assert.equal(state.backlogError.code, "CORRUPT_JSON");
  f.write();
  f.run("resume");
  state = f.status();
  assert.deepEqual(state.active, { feature: 1, qa: 0 });
  assert.equal(state.tickets.B.feature.worker, "build-B", "restart/resume never duplicates abandoned or active work");
});

test("independent QA: corrupt JSON/structural state is rejected without overwriting existing bytes", (t) => {
  const f = fixture(t);
  f.run("init");
  f.claim("A");
  const good = f.bytes();
  for (const [content, code] of [
    ["{interrupted-write", "CORRUPT_JSON"],
    [JSON.stringify({ ...JSON.parse(good), sequence: 9999 }), "CORRUPT_STATE"],
    [JSON.stringify({ ...JSON.parse(good), version: 9999 }), "CORRUPT_STATE"],
  ]) {
    fs.writeFileSync(f.statePath, content);
    f.reject("status", {}, code);
    f.reject("resume", {}, code);
    f.reject("init", {}, "ALREADY_INITIALIZED");
    assert.equal(fs.existsSync(`${f.statePath}.lock`), false);
  }
  fs.writeFileSync(f.statePath, good);
  assert.equal(f.status().tickets.A.feature.worker, "build-A");
});

test("independent QA: live contention, dead-owner token recovery and corrupt lock preserve durable work", (t) => {
  const f = fixture(t);
  f.run("init");
  f.claim("A");
  const lock = acquireLock(f.statePath);
  try {
    assert.equal(f.status().locks[0].owner.token, lock.owner.token);
    f.reject("claim", { ticket: "B", worker: "build-B", revision: 1 }, "LOCKED");
    f.reject("recover-lock", { token: lock.owner.token }, "LIVE_LOCK");
    assert.equal(JSON.parse(fs.readFileSync(`${f.statePath}.lock`, "utf8")).token, lock.owner.token);
  } finally { lock.release(); }
  const exited = spawnSync(process.execPath, ["--input-type=module", "-e",
    `import { acquireLock } from ${JSON.stringify(new URL("./loop.mjs", import.meta.url).href)};
     process.stdout.write(JSON.stringify(acquireLock(${JSON.stringify(f.statePath)}).owner));`,
  ], { encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(exited.status, 0, exited.stderr);
  const owner = JSON.parse(exited.stdout);
  assert.equal(f.status().locks[0].owner.token, owner.token);
  f.reject("resume", {}, "LOCKED");
  f.reject("recover-lock", { token: "wrong-owner-token" }, "LOCK_TOKEN_MISMATCH");
  const before = f.status();
  const recovered = f.run("recover-lock", { token: owner.token });
  assert.equal(recovered.auditWritten, true);
  const after = f.status();
  assert.deepEqual(after.tickets, before.tickets);
  assert.equal(after.sequence, before.sequence + 1);
  assert.equal(after.history.at(-1).action, "recover-lock");
  assert.equal(after.tickets.A.feature.worker, "build-A");
  assert.deepEqual(after.active, { feature: 1, qa: 0 });
  fs.writeFileSync(`${f.statePath}.lock`, "{not-valid-lock");
  f.reject("claim", { ticket: "B", worker: "build-B", revision: 1 }, "LOCKED");
  f.reject("recover-lock", { token: owner.token }, "CORRUPT_JSON");
  assert.equal(fs.readFileSync(`${f.statePath}.lock`, "utf8"), "{not-valid-lock");
});
