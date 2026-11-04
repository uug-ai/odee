import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateBacklog } from "./loop.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../..");
const cli = path.join(directory, "loop.mjs");
const readDocument = (name) => fs.readFileSync(path.join(repository, "docs/roadmap", name), "utf8");
const packet = validateBacklog(JSON.parse(readDocument("backlog.json")), repository);
const matrix = JSON.parse(readDocument("capabilities.json"));
const sha = (number) => number.toString(16).padStart(40, "0");
const evidence = "SYNTHETIC current-manifest D013/D014 ledger rehearsal with reconstructed target transitions, not an exact historical snapshot; no application implementation, business data, runtime test or delivered feature is claimed.";

function fixture(t, backlog) {
  const root = fs.mkdtempSync(path.join(directory, ".loop-planning-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const backlogPath = path.join(root, "backlog.json");
  const statePath = path.join(root, ".odee/loop.json");
  let selected;
  const write = (value) => {
    selected = structuredClone(validateBacklog(value, root));
    fs.writeFileSync(backlogPath, JSON.stringify(selected));
  };
  write(backlog);
  const bytes = () => fs.existsSync(statePath) ? fs.readFileSync(statePath, "utf8") : null;
  const invoke = (command, args = {}) => spawnSync(process.execPath, [
    cli, "--root", root, "--backlog", "backlog.json", command,
    ...Object.entries(args).flatMap(([key, value]) => [`--${key}`, String(value)]),
  ], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, env: { PATH: process.env.PATH, NODE_ENV: "test" } });
  const run = (command, args = {}) => {
    const result = invoke(command, args);
    assert.equal(result.status, 0, `${command}: ${result.stderr || result.error || result.stdout}`);
    return JSON.parse(result.stdout);
  };
  const reject = (command, args, errorCode) => {
    const before = bytes();
    const result = invoke(command, args);
    assert.equal(result.status, 1, `${command} must reject ${errorCode}`);
    assert.match(result.stderr, new RegExp(`loop: ${errorCode}:`));
    assert.equal(bytes(), before, "rejected command must not mutate fixture state");
  };
  const spec = (id) => {
    const ticket = selected.tickets.find((ticket) => ticket.id === id);
    assert.ok(ticket, `selected validated fixture must contain ${id}`);
    return ticket;
  };
  return { root, statePath, write, bytes, run, reject, spec, status: () => run("status") };
}
function syntheticTicket(id, extra = {}) {
  return { id, revision: 1, title: `Synthetic ${id}`, owner: "coordinator", priority: 1,
    dependsOn: [], paths: [`fixture/${id}`], acceptance: ["Synthetic contract only"],
    requiredQa: ["qa-api-data"], ...extra };
}
function priorContractFixture(manifest) {
  const baseline = structuredClone(manifest);
  delete baseline.planningChanges;
  // Synthetic predecessor variants of current targets, not byte-exact historical contracts.
  const route = baseline.tickets.find((ticket) => ticket.id === "ODEE-004");
  assert.ok(route.revision > 1, "the current route contract must have a positive predecessor revision");
  route.revision -= 1;
  route.paths = ["web/src/", "web/tests/", "docs/"];
  route.acceptance = [
    "Existing accounting drafts, posting, manual payments, bill scanning and contacts remain usable through the extracted shell.",
    "A session-expiry or CSRF/origin failure produces an actionable UI state and does not retry unsafe writes silently.",
    "Navigation, keyboard dialog behavior and direct routes pass isolated browser regressions; planned tiles do not expose incomplete API workflows.",
  ];
  delete route.capabilities;
  delete route.originatingFindingIds;
  delete route.pmDecisionId;
  const credit = baseline.tickets.find((ticket) => ticket.id === "ODEE-011");
  assert.ok(credit.revision > 1, "the current credit contract must have a positive predecessor revision");
  credit.revision -= 1;
  credit.acceptance = credit.acceptance.slice(0, 4);
  delete credit.referenceVersion;
  delete credit.originatingDiscoveryId;
  delete credit.pmDecisionId;
  return validateBacklog(baseline, repository);
}
function claim(f, id, revision = f.spec(id).revision) {
  return f.run("claim", { ticket: id, worker: `fixture-build-${id}`, revision });
}
function submit(f, id, hash, revision = f.spec(id).revision) {
  return f.run("submit", { ticket: id, worker: `fixture-build-${id}`, revision, sha: hash, evidence });
}
function claimQa(f, id, hash, role, revision = f.spec(id).revision) {
  assert.ok(f.spec(id).requiredQa.includes(role), `${id} must require the selected current QA role ${role}`);
  return f.run("claim", { ticket: id, kind: "qa", role, worker: `fixture-${role}`, revision, sha: hash });
}
function verdict(f, id, hash, role, result = "PASS", revision = f.spec(id).revision) {
  return f.run("verdict", { ticket: id, role, worker: `fixture-${role}`, revision, sha: hash, result, evidence });
}

function evolvedManifest() {
  const manifest = structuredClone(packet);
  for (const id of ["ODEE-005", "ODEE-013"]) {
    const ticket = manifest.tickets.find((ticket) => ticket.id === id);
    ticket.revision += 1;
    ticket.requiredQa.push(`qa-fixture-${id.toLowerCase()}`);
    ticket.acceptance.push("Additional synthetic regression criterion; existing acceptance is preserved.");
  }
  manifest.tickets.push(syntheticTicket("FIXTURE-UNRELATED", {
    priority: Math.min(...manifest.tickets.map((ticket) => ticket.priority)) - 1,
    revision: 3, requiredQa: ["qa-fixture-unrelated"],
  }));
  return validateBacklog(manifest, repository);
}
const scenarios = [
  { name: "current validated manifest", manifest: packet },
  { name: "added leaf and revised dependent/unrelated roles", manifest: evolvedManifest() },
];

for (const { name, manifest } of scenarios) {
test(`D013/D014 actual finding/capability packet: revision, handoff, failure, stale QA and idempotent restart drill (${name})`, (t) => {
  const baseline = priorContractFixture(manifest);
  const routeSpec = manifest.tickets.find((ticket) => ticket.id === "ODEE-004");
  const creditSpec = manifest.tickets.find((ticket) => ticket.id === "ODEE-011");
  const oldRouteRevision = baseline.tickets.find((ticket) => ticket.id === routeSpec.id).revision;
  const oldCreditRevision = baseline.tickets.find((ticket) => ticket.id === creditSpec.id).revision;
  const dependent = manifest.tickets.find((ticket) => ticket.id === "ODEE-005");
  assert.ok(dependent.revision >= 2, "exercise the legitimately revised permissions prerequisite");
  t.diagnostic(`Current-manifest SYNTHETIC rehearsal (${name}): ODEE-004 ${oldRouteRevision}->${routeSpec.revision}, ODEE-011 ${oldCreditRevision}->${creditSpec.revision}, ODEE-005 v${dependent.revision}; no byte-exact historical snapshot or application delivery is claimed.`);
  const routeChange = manifest.planningChanges.find((change) => change.id === "PM-20261103-004-ROUTES");
  const creditChange = manifest.planningChanges.find((change) => change.id === "PM-20261103-CREDIT-PARTIAL");
  const repairChange = manifest.planningChanges.find((change) => change.id === "PM-20261103-022-REPAIR");
  assert.equal(routeChange.decisionId, "D013");
  assert.deepEqual(routeChange.findingIds, ["F-004-DIRECT-ROUTE-20261103"]);
  assert.deepEqual(routeChange.ticketChanges, [{ ticket: "ODEE-004", fromRevision: 1, toRevision: 2 }]);
  assert.equal(creditChange.decisionId, "D014");
  assert.deepEqual(creditChange.findingIds, [], "a separately sourced discovery is not a fabricated tester finding");
  assert.deepEqual(creditChange.discoveryIds, ["G-CREDIT-PARTIAL-20261103"]);
  assert.deepEqual(creditChange.ticketChanges, [{ ticket: "ODEE-011", fromRevision: 1, toRevision: 2 }]);
  assert.deepEqual(repairChange.ticketChanges, [], "valid ODEE-022 acceptance is not weakened or relabelled");
  assert.deepEqual(repairChange.findingIds, ["F-022-PLANNING-DRILL-20261103", "F-022-STATUS-PIN-20261103"]);
  const decisions = readDocument("decisions.md");
  for (const id of ["D013", "D014"]) assert.match(decisions, new RegExp(`## ${id} `));
  for (const change of [routeChange, creditChange]) {
    for (const capabilityId of change.capabilityIds) {
      const capability = matrix.capabilities.find((item) => item.id === capabilityId);
      assert.ok(capability, `${capabilityId} must resolve to the actual matrix`);
      const historicalChange = change.ticketChanges.find((item) => capability.tickets.includes(item.ticket));
      const plannedDecision = manifest.planningChanges.find((item) =>
        item.decisionId === capability.pmDecisionId && item.capabilityIds?.includes(capabilityId));
      assert.ok(plannedDecision, `${capabilityId} must name a recorded planning decision`);
      const plannedChange = plannedDecision.ticketChanges.find((item) => item.ticket === historicalChange.ticket);
      assert.ok(plannedChange, "current capability planning must resolve to the historical ticket");
      assert.equal(capability.plannedTicketRevision, plannedChange.toRevision);
      assert.ok(plannedChange.toRevision >= historicalChange.toRevision);
      assert.ok(manifest.tickets.find((ticket) => ticket.id === plannedChange.ticket).revision >= plannedChange.toRevision);
      assert.equal(capability.deliveredSha, null, "planning cannot invent delivered application evidence");
      assert.deepEqual(capability.qaEvidence, []);
      if (change.findingIds.length) assert.deepEqual(capability.originatingFindingIds, change.findingIds);
      else assert.equal(capability.originatingDiscoveryId, change.discoveryIds[0]);
    }
  }
  const source = matrix.sources.find((item) => item.id === creditChange.sourceRefs[0]);
  assert.equal(source.verification, "verified");
  assert.equal(source.url, "https://www.odoo.com/documentation/20.0/applications/finance/accounting/customer_invoices/credit_notes.html");
  assert.deepEqual(creditSpec.sourceRefs, creditChange.sourceRefs);
  assert.equal(creditSpec.referenceVersion, source.version);
  // Later decisions append after D014's fifth criterion.
  assert.match(creditSpec.acceptance[4], /24200 cents.*10000-cent.*12100 cents.*2100 cents/);

  const f = fixture(t, baseline);
  f.run("init");
  const ids = baseline.tickets.map((ticket) => ticket.id).sort();
  const prerequisites = new Set();
  function visit(id) {
    for (const dependency of baseline.tickets.find((ticket) => ticket.id === id).dependsOn) {
      visit(dependency);
      prerequisites.add(dependency);
    }
  }
  visit("ODEE-011");
  let number = 100;
  for (const id of prerequisites) {
    const ticket = baseline.tickets.find((item) => item.id === id);
    const hash = sha(number++);
    claim(f, id);
    submit(f, id, hash);
    for (const role of ticket.requiredQa) {
      claimQa(f, id, hash, role);
      verdict(f, id, hash, role);
    }
    f.run("gate", { ticket: id, revision: ticket.revision, sha: hash });
    f.run("merged", { ticket: id, revision: ticket.revision, sha: hash, "merged-sha": sha(number++), evidence });
  }
  const [failedRole, interruptedRole] = creditSpec.requiredQa;
  assert.ok(failedRole && interruptedRole, "the source-linked credit rehearsal requires two independent QA roles");
  claim(f, "ODEE-011");
  submit(f, "ODEE-011", sha(5000));
  claimQa(f, "ODEE-011", sha(5000), failedRole);
  verdict(f, "ODEE-011", sha(5000), failedRole, "FAIL");
  f.reject("gate", { ticket: "ODEE-011", revision: oldCreditRevision, sha: sha(5000) }, "QA_GATE");
  claim(f, "ODEE-011");
  submit(f, "ODEE-011", sha(5001));
  claimQa(f, "ODEE-011", sha(5001), failedRole);
  verdict(f, "ODEE-011", sha(5001), failedRole);
  claimQa(f, "ODEE-011", sha(5001), interruptedRole);
  const handoff = { ticket: "ODEE-011", worker: `fixture-${interruptedRole}`, kind: "qa", role: interruptedRole,
    evidence: `${evidence} Interrupted QA handoff: synthetic branch/checkpoint, no server or provider process.` };
  f.run("checkpoint", handoff);
  const before = f.status();
  const oldCredit = before.tickets["ODEE-011"];
  const oldRoute = before.tickets["ODEE-004"];
  assert.equal(before.tickets[dependent.id].spec.revision, dependent.revision);
  assert.equal(before.tickets[dependent.id].merged.revision, dependent.revision);
  assert.deepEqual(before.tickets[dependent.id].verdicts.map((verdict) => verdict.role).sort(),
    [...dependent.requiredQa].sort(), "every current dependent role must actually run, including added synthetic roles");
  assert.equal(oldCredit.failureCount, 1);
  assert.ok(oldRoute.gate && oldRoute.merged, "fixture creates real old-revision gate state to invalidate");

  f.run("stop");
  f.write(manifest);
  const reconciled = f.run("reconcile");
  assert.deepEqual(reconciled.changes.filter((change) => change.change === "revised").map((change) => change.ticket),
    ["ODEE-004", "ODEE-011"], "source-linked existing tickets, not duplicate features");
  const after = f.status();
  assert.equal(after.mode, "stopped");
  assert.deepEqual(Object.keys(after.tickets).sort(), ids);
  assert.equal(after.tickets["ODEE-004"].spec.revision, routeSpec.revision);
  assert.equal(after.tickets["ODEE-011"].spec.revision, creditSpec.revision);
  assert.equal(after.tickets["ODEE-004"].gate, null);
  assert.equal(after.tickets["ODEE-004"].merged, null);
  assert.equal(after.tickets["ODEE-011"].candidate, null);
  assert.equal(after.tickets["ODEE-011"].status, "paused");
  assert.deepEqual(after.tickets["ODEE-011"].qa, oldCredit.qa);
  assert.deepEqual(after.tickets["ODEE-011"].checkpoints, oldCredit.checkpoints);
  assert.deepEqual(after.tickets["ODEE-011"].lease, oldCredit.lease);
  assert.deepEqual(after.tickets["ODEE-011"].failures, oldCredit.failures);
  assert.deepEqual(after.tickets["ODEE-011"].verdicts, oldCredit.verdicts);
  assert.equal(after.tickets["ODEE-011"].failureCount, 1, "the failed criterion was not waived");
  for (const ticket of manifest.tickets.filter((ticket) => !prerequisites.has(ticket.id) && ticket.id !== creditSpec.id)) {
    const untouched = after.tickets[ticket.id];
    assert.deepEqual(untouched.spec, ticket, "added/revised unrelated contracts retain their current revisions and roles");
    assert.ok(!untouched.feature && !untouched.candidate && !untouched.gate && !untouched.merged);
    assert.deepEqual(untouched.qa, {});
    assert.deepEqual(untouched.verdicts, []);
    assert.deepEqual(untouched.submissions, []);
  }
  assert.deepEqual(after.planningBaseline, manifest.planningBaseline);
  assert.deepEqual(after.planningChanges, manifest.planningChanges);
  const epics = manifest.tickets.filter((ticket) => ticket.kind === "epic");
  assert.equal(after.leaves.total, manifest.tickets.length - epics.length);
  assert.equal(after.counts.cancelled, epics.length);
  assert.equal(after.leaves.counts.cancelled, 0, "nondispatchable epics do not count as completed leaves");
  const changedTargets = new Set([routeSpec.id, creditSpec.id]);
  function affected(id) {
    return changedTargets.has(id) || baseline.tickets.find((ticket) => ticket.id === id).dependsOn.some(affected);
  }
  const unaffected = [...prerequisites].filter((id) => !affected(id)).sort();
  assert.deepEqual(Object.values(after.tickets).filter((entry) => entry.status === "merged").map((entry) => entry.spec.id).sort(), unaffected);
  assert.equal(after.leaves.counts.merged, unaffected.length, "only unaffected synthetic prerequisites remain gated, not revised application features");
  assert.deepEqual(after.leaves.ready, []);
  assert.equal(after.next, null);
  const samePacket = f.run("reconcile");
  assert.deepEqual(samePacket.changes, []);
  const repeated = f.status();
  assert.deepEqual(repeated.tickets, after.tickets);
  assert.deepEqual(repeated.planningChanges, manifest.planningChanges);
  assert.equal(new Set(repeated.planningChanges.map((change) => change.id)).size, manifest.planningChanges.length);
  assert.equal(Object.keys(repeated.tickets).length, manifest.tickets.length);
  f.reject("next", {}, "DISPATCH_DISABLED");
  f.reject("claim", { ticket: "ODEE-004", worker: "fixture-new-worker", revision: routeSpec.revision }, "DISPATCH_DISABLED");
  f.reject("gate", { ticket: "ODEE-004", revision: oldRouteRevision, sha: oldRoute.candidate.sha }, "DISPATCH_DISABLED");
  f.reject("merged", { ticket: "ODEE-004", revision: oldRouteRevision, sha: oldRoute.candidate.sha,
    "merged-sha": sha(9999), evidence }, "DISPATCH_DISABLED");
  f.reject("verdict", { ticket: "ODEE-011", worker: `fixture-${interruptedRole}`, role: interruptedRole,
    revision: oldCreditRevision, sha: sha(5001), result: "PASS", evidence }, "STALE_REVISION");
  f.run("checkpoint", handoff);
  f.run("recover", handoff);
  f.run("requeue", { ticket: "ODEE-011", evidence: `${evidence} Explicit fixture handoff acknowledgment after PM revision.` });
  const resumed = f.run("resume");
  assert.deepEqual(resumed.planningBaseline, manifest.planningBaseline);
  assert.deepEqual(resumed.planningChanges, manifest.planningChanges);
  assert.deepEqual(resumed.active, { feature: 0, qa: 0 }, "resume never relaunches interrupted work");
  assert.equal(resumed.tickets["ODEE-011"].failureCount, 1);
  assert.ok(Object.values(resumed.tickets).every((entry) => entry.lease === null), "explicit recovery leaves no hidden lease");
  const expectedReady = manifest.tickets.filter((ticket) => ticket.kind !== "epic" &&
    ["ready", "changes-requested"].includes(resumed.tickets[ticket.id].status) &&
    ticket.dependsOn.every((id) => resumed.tickets[id].status === "merged"))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)).map((ticket) => ticket.id);
  assert.ok(expectedReady.length > 0, "the reviewed manifest still has safe independent work");
  assert.deepEqual(resumed.leaves.ready.map((entry) => entry.ticket), expectedReady);
  assert.equal(resumed.next.ticket.id, expectedReady[0], "next follows current manifest priorities, not incidental original queue order");
  assert.equal(resumed.next.ticket.id, f.run("next").next.ticket.id);
  assert.ok(resumed.leaves.ready.some((entry) => entry.ticket === resumed.next.ticket.id));
  assert.ok(resumed.leaves.blocked.find((entry) => entry.ticket === "ODEE-011").blockers.includes("dependencies"));
  f.reject("gate", { ticket: "ODEE-004", revision: oldRouteRevision, sha: oldRoute.candidate.sha }, "STALE_REVISION");
  f.reject("gate", { ticket: "ODEE-004", revision: routeSpec.revision, sha: oldRoute.candidate.sha }, "STALE_SHA");
  f.reject("gate", { ticket: "ODEE-011", revision: creditSpec.revision, sha: sha(5001) }, "STALE_SHA");
  t.diagnostic(`Executed ${manifest.tickets.length}-record current-manifest SYNTHETIC D013/D014 CLI drill: source links, invalidation, retained handoffs/failures, idempotence and stop/resume asserted.`);
});
}

test("status/resume use accepted persisted planning, never an unreconciled file pin or PM change", (t) => {
  const accepted = { version: 1, planningBaseline: packet.planningBaseline,
    planningChanges: packet.planningChanges, tickets: [syntheticTicket("A")] };
  const f = fixture(t, accepted);
  f.run("init");
  f.run("pause");
  const pending = structuredClone(accepted);
  pending.planningBaseline.referenceVersion = "synthetic-unaccepted-reference";
  pending.planningChanges.push({ id: "SYNTHETIC-UNACCEPTED-PACKET" });
  f.write(pending);
  const before = f.bytes();
  const status = f.status();
  assert.equal(status.backlogChanged, true);
  assert.deepEqual(status.planningBaseline, accepted.planningBaseline);
  assert.deepEqual(status.planningChanges, accepted.planningChanges);
  assert.equal(status.next, null);
  assert.deepEqual(status.leaves.ready, []);
  assert.ok(status.leaves.blocked[0].blockers.includes("backlog-reconciliation"));
  assert.equal(f.bytes(), before, "status is read-only");
  f.reject("resume", {}, "RECONCILE_REQUIRED");
  f.write(accepted);
  const resumed = f.run("resume");
  assert.equal(resumed.planningBaseline.referenceVersion, accepted.planningBaseline.referenceVersion);
  assert.equal(resumed.planningBaseline.referenceReleaseMonth, accepted.planningBaseline.referenceReleaseMonth);
  assert.equal(resumed.planningBaseline.referenceRetrievedOn, accepted.planningBaseline.referenceRetrievedOn);
  assert.equal(resumed.planningBaseline.referenceConfidence, accepted.planningBaseline.referenceConfidence);
  assert.deepEqual(resumed.planningBaseline.referenceSources, packet.planningBaseline.referenceSources);
  assert.deepEqual(resumed.planningChanges, accepted.planningChanges);
  assert.equal(resumed.leaves.ready[0].ticket, "A");
});

test("D013 route finding keeps its valid failure and interrupted feature handoff across the actual PM delta", (t) => {
  const baseline = priorContractFixture(packet);
  const routeSpec = packet.tickets.find((ticket) => ticket.id === "ODEE-004");
  const f = fixture(t, baseline);
  f.run("init");
  const prerequisite = baseline.tickets.find((ticket) => ticket.id === "ODEE-001");
  claim(f, prerequisite.id);
  submit(f, prerequisite.id, sha(6000));
  for (const role of prerequisite.requiredQa) {
    claimQa(f, prerequisite.id, sha(6000), role);
    verdict(f, prerequisite.id, sha(6000), role);
  }
  f.run("gate", { ticket: prerequisite.id, revision: prerequisite.revision, sha: sha(6000) });
  f.run("merged", { ticket: prerequisite.id, revision: prerequisite.revision, sha: sha(6000), "merged-sha": sha(6001), evidence });
  claim(f, "ODEE-004");
  submit(f, "ODEE-004", sha(6002));
  const blockedRole = f.spec("ODEE-004").requiredQa[0];
  claimQa(f, "ODEE-004", sha(6002), blockedRole);
  verdict(f, "ODEE-004", sha(6002), blockedRole, "BLOCKED");
  f.reject("gate", { ticket: "ODEE-004", revision: f.spec("ODEE-004").revision, sha: sha(6002) }, "QA_GATE");
  f.run("requeue", { ticket: "ODEE-004", evidence: `${evidence} Explicit repair acknowledgment, not a QA waiver.` });
  claim(f, "ODEE-004");
  const handoff = { ticket: "ODEE-004", worker: "fixture-build-ODEE-004",
    evidence: `${evidence} F-004-DIRECT-ROUTE-20261103 repair checkpoint; preserve branch, valid route criterion and failure.` };
  f.run("checkpoint", handoff);
  const previous = f.status().tickets["ODEE-004"];
  f.write(packet);
  f.run("reconcile");
  const revised = f.status().tickets["ODEE-004"];
  assert.equal(revised.status, "paused");
  assert.equal(revised.spec.revision, routeSpec.revision);
  assert.equal(revised.spec.pmDecisionId, "D013");
  assert.deepEqual(revised.spec.originatingFindingIds, ["F-004-DIRECT-ROUTE-20261103"]);
  assert.deepEqual(revised.feature, previous.feature);
  assert.deepEqual(revised.checkpoints, previous.checkpoints);
  assert.deepEqual(revised.failures, previous.failures);
  assert.deepEqual(revised.verdicts, previous.verdicts);
  assert.equal(revised.failureCount, 1);
  assert.equal(revised.candidate, null);
  assert.equal(revised.gate, null);
  assert.deepEqual(f.run("reconcile").changes, []);
  f.reject("claim", { ticket: "ODEE-004", worker: "fixture-extra-worker", revision: routeSpec.revision }, "NOT_READY");
  f.run("stop");
  f.reject("next", {}, "DISPATCH_DISABLED");
  f.run("checkpoint", handoff);
  f.run("recover", handoff);
  f.run("requeue", { ticket: "ODEE-004", evidence: `${evidence} Reviewed D013 handoff; old failure remains unresolved until fresh QA.` });
  const resumed = f.run("resume");
  assert.equal(resumed.tickets["ODEE-004"].failureCount, 1);
  const gatedPrerequisites = [prerequisite.id];
  assert.deepEqual(Object.values(resumed.tickets).filter((entry) => entry.status === "merged").map((entry) => entry.spec.id), gatedPrerequisites);
  assert.equal(resumed.leaves.counts.merged, gatedPrerequisites.length, "no application feature was auto-completed by PM relabelling");
  f.reject("gate", { ticket: "ODEE-004", revision: routeSpec.revision, sha: sha(6002) }, "STALE_SHA");
});

test("legacy version-1 state needs no migration; leaf readiness excludes epics, dependencies, leases and stopped dispatch", (t) => {
  const f = fixture(t, { version: 1, tickets: [
    syntheticTicket("A"), syntheticTicket("B", { dependsOn: ["A"] }),
    syntheticTicket("C", { paths: ["fixture/A/child"] }),
    syntheticTicket("E", { kind: "epic", status: "proposed" }),
  ] });
  f.run("init");
  const legacy = f.status();
  assert.equal(legacy.version, 1);
  assert.equal(legacy.planningBaseline, null);
  assert.deepEqual(legacy.planningChanges, []);
  assert.equal(legacy.leaves.total, 3);
  assert.equal(legacy.leaves.counts.merged, 0);
  assert.deepEqual(legacy.leaves.ready.map((entry) => entry.ticket), ["A", "C"]);
  assert.deepEqual(legacy.leaves.blocked[0].dependencies, ["A"]);
  claim(f, "A");
  const leased = f.status();
  assert.deepEqual(leased.leaves.ready, []);
  assert.equal(leased.leaves.blocked.find((entry) => entry.ticket === "C").leaseTicket, "A");
  f.run("stop");
  const stopped = f.status();
  assert.equal(stopped.next, null);
  assert.ok(stopped.leaves.blocked.every((entry) => entry.blockers.includes("control-stopped")));
  const resumed = f.run("resume");
  assert.equal(resumed.planningBaseline, null);
  assert.deepEqual(resumed.planningChanges, []);
  assert.deepEqual(resumed.activeClaimsPreserved, { feature: 1, qa: 0 });
  assert.equal(resumed.tickets.A.feature.worker, "fixture-build-A");
});
