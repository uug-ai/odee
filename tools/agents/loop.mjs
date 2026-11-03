#!/usr/bin/env node
/**
 * Durable coordinator bookkeeping, not an agent runner or a Git integration tool.
 * The VS Code coordinator calls actual task tools after obtaining a claim here.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const MODES = ["running", "paused", "stopped"];
const STATUSES = ["ready", "building", "awaiting-qa", "testing", "changes-requested", "verified", "integrating", "merged", "blocked", "paused", "cancelled"];
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const SLUG = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const own = (object, key) => Object.hasOwn(object, key);
const now = () => new Date().toISOString();
const clone = (value) => JSON.parse(JSON.stringify(value));
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function check(condition, code, message) {
  if (!condition) fail(code, message);
}
function text(value, label) {
  check(typeof value === "string" && value.trim().length > 0, "INVALID_INPUT", `${label} must be a nonempty string`);
  return value;
}
function slug(value, label) {
  check(typeof value === "string" && SLUG.test(value) && !["__proto__", "constructor", "prototype"].includes(value), "INVALID_INPUT", `${label} must be a safe identifier`);
  return value;
}
function integer(value, label, minimum = 0) {
  check(Number.isSafeInteger(value) && value >= minimum, "INVALID_INPUT", `${label} must be an integer >= ${minimum}`);
}
function fullSha(value) {
  check(typeof value === "string" && SHA.test(value), "INVALID_INPUT", "sha must be a full lowercase 40- or 64-character commit SHA");
  return value;
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const hash = (value) => createHash("sha256").update(stable(value)).digest("hex");
function specHash(spec) {
  const { priority, revision, ...contract } = spec;
  return hash(contract);
}
function relativePath(value, label, reserved = true) {
  text(value, label);
  check(!value.includes("\\") && !value.includes(":") && !/[\x00-\x1f]/.test(value) &&
    !path.posix.isAbsolute(value) && value.split("/").every((part) => part && part !== "." && part !== ".."),
  "UNSAFE_PATH", `${label} must be a normalized repository-relative path`);
  check(value.split("/")[0] !== ".git" && (!reserved || value.split("/")[0] !== ".odee"), "UNSAFE_PATH", `${label} targets reserved coordinator/Git state`);
  return value;
}
function within(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}
function confined(root, relative, label, reserved = true) {
  relativePath(relative, label, reserved);
  const target = path.resolve(root, relative);
  let segment = root;
  for (const part of relative.split("/")) {
    segment = path.join(segment, part);
    try {
      check(!fs.lstatSync(segment).isSymbolicLink(), "UNSAFE_PATH", `${label} cannot traverse a symlink (leases must have unambiguous paths)`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  let ancestor = target;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    check(parent !== ancestor, "UNSAFE_PATH", `${label} has no safe ancestor`);
    ancestor = parent;
  }
  check(within(root, fs.realpathSync(ancestor)), "UNSAFE_PATH", `${label} escapes repository through a symlink`);
  return target;
}
function stringList(value, label, { empty = false, identifiers = false } = {}) {
  check(Array.isArray(value) && (empty || value.length > 0), "INVALID_BACKLOG", `${label} must be ${empty ? "an" : "a nonempty"} array`);
  for (const item of value) (identifiers ? slug : text)(item, label);
  check(new Set(value).size === value.length, "INVALID_BACKLOG", `${label} contains duplicates`);
}
function validateTicket(ticket, root, inspectPaths = true) {
  check(object(ticket), "INVALID_BACKLOG", "ticket must be an object");
  slug(ticket.id, "ticket id");
  integer(ticket.revision, `${ticket.id}.revision`, 1);
  text(ticket.title, `${ticket.id}.title`);
  slug(ticket.owner, `${ticket.id}.owner`);
  check(Number.isSafeInteger(ticket.priority), "INVALID_BACKLOG", `${ticket.id}.priority must be an integer (lower is earlier)`);
  check(ticket.kind === undefined || ["feature", "epic"].includes(ticket.kind), "INVALID_BACKLOG", `${ticket.id}.kind must be feature or epic`);
  const epic = ticket.kind === "epic";
  stringList(ticket.dependsOn, `${ticket.id}.dependsOn`, { empty: true, identifiers: true });
  stringList(ticket.paths, `${ticket.id}.paths`, { empty: epic });
  for (const prefix of ticket.paths) {
    const normalized = prefix.replace(/\/$/, "");
    if (inspectPaths) confined(root, normalized, `${ticket.id}.paths`);
    else relativePath(normalized, `${ticket.id}.paths`);
  }
  check(new Set(ticket.paths.map((prefix) => prefix.replace(/\/$/, ""))).size === ticket.paths.length,
    "INVALID_BACKLOG", `${ticket.id}.paths contains equivalent duplicate prefixes`);
  stringList(ticket.acceptance, `${ticket.id}.acceptance`, { empty: epic });
  stringList(ticket.requiredQa, `${ticket.id}.requiredQa`, { empty: epic, identifiers: true });
  check(ticket.status === undefined || (epic && ticket.status === "proposed"), "INVALID_BACKLOG", `${ticket.id}: execution status belongs in coordinator state, not leaf specifications`);
}
export function validateBacklog(backlog, root = process.cwd(), inspectPaths = true) {
  check(object(backlog) && backlog.version === 1 && Array.isArray(backlog.tickets), "INVALID_BACKLOG", "backlog must contain version:1 and tickets:[]");
  const tickets = new Map();
  for (const ticket of backlog.tickets) {
    validateTicket(ticket, root, inspectPaths);
    check(!tickets.has(ticket.id), "INVALID_BACKLOG", `duplicate ticket id ${ticket.id}`);
    tickets.set(ticket.id, ticket);
  }
  for (const ticket of tickets.values()) {
    for (const dependency of ticket.dependsOn) {
      check(tickets.has(dependency), "INVALID_BACKLOG", `${ticket.id} has unknown dependency ${dependency}`);
    }
  }
  const visited = new Set();
  const visiting = new Set();
  function visit(id) {
    check(!visiting.has(id), "DEPENDENCY_CYCLE", `dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of tickets.get(id).dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of tickets.keys()) visit(id);
  return backlog;
}
function readJson(filename, label) {
  try {
    check(!fs.lstatSync(filename).isSymbolicLink(), "UNSAFE_PATH", `${label} cannot be a symlink`);
    return JSON.parse(fs.readFileSync(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") fail("NOT_INITIALIZED", `${label} does not exist: ${filename}`);
    if (error instanceof SyntaxError) fail("CORRUPT_JSON", `${label} is not valid JSON: ${filename}`);
    throw error;
  }
}
function atomicJson(filename, value) {
  const scratch = `${filename}.write-${randomUUID()}`;
  let fd;
  try {
    fd = fs.openSync(scratch, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(scratch, filename);
    const directory = fs.openSync(path.dirname(filename), "r");
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(scratch)) fs.unlinkSync(scratch);
  }
}
function procStart(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19];
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function bootId() {
  try { return fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function lockOwner() {
  return { version: 1, hostname: os.hostname(), pid: process.pid, start: procStart(process.pid), bootId: bootId(), token: randomUUID(), createdAt: now() };
}
function readOwner(filename) {
  const owner = readJson(filename, "lock");
  check(object(owner) && owner.version === 1 && Number.isSafeInteger(owner.pid) && owner.pid > 0 &&
    typeof owner.hostname === "string" && typeof owner.token === "string" &&
    (owner.start === null || typeof owner.start === "string") &&
    (owner.bootId === null || typeof owner.bootId === "string"),
  "CORRUPT_LOCK", `invalid lock ownership: ${filename}; do not guess an owner or delete a live lock`);
  return owner;
}
function definitelyDead(owner) {
  check(owner.hostname === os.hostname(), "REMOTE_LOCK", `cannot prove death of owner on host ${owner.hostname}`);
  const currentBoot = bootId();
  if (owner.bootId && currentBoot && owner.bootId !== currentBoot) return true;
  const current = procStart(owner.pid);
  if (current && owner.start) return current !== owner.start;
  try { process.kill(owner.pid, 0); return false; }
  catch (error) {
    if (error.code === "ESRCH") return true;
    fail("UNKNOWN_LOCK_OWNER", `cannot establish process ownership for pid ${owner.pid}: ${error.code}`);
  }
}
function recoveryFiles(lockPath) {
  const prefix = `${path.basename(lockPath)}.recovery`;
  return fs.readdirSync(path.dirname(lockPath)).filter((name) =>
    name.startsWith(prefix) && /^(?:\.recovery)+$/.test(name.slice(path.basename(lockPath).length)));
}
function createExclusive(filename, owner) {
  const scratch = `${filename}.owner-${owner.token}`;
  try {
    const fd = fs.openSync(scratch, "wx", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(owner)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    try { fs.linkSync(scratch, filename); }
    catch (error) {
      if (error.code === "EEXIST") fail("LOCKED", `exclusive lock exists: ${filename}; inspect ownership and use explicit recover-lock only after its owner exits`);
      throw error;
    }
  } finally {
    if (fs.existsSync(scratch)) fs.unlinkSync(scratch);
  }
}
function removeOwned(filename, token) {
  check(readOwner(filename).token === token, "LOCK_LOST", "lock ownership changed; refusing to remove it");
  fs.unlinkSync(filename);
}
export function acquireLock(statePath) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
  const lockPath = `${statePath}.lock`;
  check(recoveryFiles(lockPath).length === 0, "LOCKED", "lock recovery is pending; inspect status and recover the deepest stale recovery lock first");
  const owner = lockOwner();
  createExclusive(lockPath, owner);
  if (recoveryFiles(lockPath).length) {
    removeOwned(lockPath, owner.token);
    fail("LOCKED", "lock recovery began concurrently; retry this bounded command");
  }
  return {
    owner,
    assert() { check(readOwner(lockPath).token === owner.token, "LOCK_LOST", "state lock ownership changed"); },
    release() { removeOwned(lockPath, owner.token); },
  };
}
function event(state, action, detail = {}) {
  state.sequence += 1;
  state.history.push({ sequence: state.sequence, at: now(), action, ...clone(detail) });
  state.updatedAt = now();
}
function activeClaims(entry) {
  return [...(entry.feature ? [{ kind: "feature", ...entry.feature }] : []),
    ...Object.entries(entry.qa).map(([role, claim]) => ({ kind: "qa", role, ...claim }))];
}
function validateCandidate(candidate, entry) {
  check(object(candidate) && /^[a-f0-9]{64}$/.test(candidate.specHash), "CORRUPT_STATE", "invalid stored candidate");
  fullSha(candidate.sha);
  integer(candidate.revision, "stored candidate revision", 1);
  check(candidate.revision <= entry.spec.revision, "CORRUPT_STATE", "candidate revision is in the future");
  slug(candidate.worker, "stored candidate worker");
  text(candidate.evidence, "stored submission evidence");
  text(candidate.submittedAt, "stored submission time");
  check(entry.contributors.includes(candidate.worker), "CORRUPT_STATE", "candidate author is missing from contributors");
}
function readState(context) {
  const state = readJson(context.statePath, "state");
  check(object(state) && state.version === 1 && state.repository === context.root &&
    MODES.includes(state.mode) && object(state.tickets) && Array.isArray(state.history) &&
    state.sequence === state.history.length, "CORRUPT_STATE", "state version, repository, control mode or audit history is invalid");
  // Persisted control/checkpoint access must not depend on a worker's current filesystem edits.
  validateBacklog(state.backlog, context.root, false);
  check(state.backlogHash === hash(state.backlog), "CORRUPT_STATE", "stored backlog hash does not match");
  for (let index = 0; index < state.history.length; index += 1) {
    check(object(state.history[index]) && state.history[index].sequence === index + 1 &&
      typeof state.history[index].action === "string", "CORRUPT_STATE", "audit sequence is invalid");
  }
  for (const [id, entry] of Object.entries(state.tickets)) {
    check(object(entry) && entry.spec?.id === id && STATUSES.includes(entry.status) &&
      object(entry.qa) && Array.isArray(entry.verdicts) && Array.isArray(entry.submissions) && Array.isArray(entry.checkpoints) &&
      Array.isArray(entry.failures) && Array.isArray(entry.contributors) &&
      typeof entry.retired === "boolean" && (entry.feature === null || object(entry.feature)) &&
      (entry.lease === null || object(entry.lease)) && (entry.candidate === null || object(entry.candidate)) &&
      (entry.gate === null || object(entry.gate)) && (entry.merged === null || object(entry.merged)) &&
      entry.failureCount === entry.failures.length, "CORRUPT_STATE", `invalid execution record for ${id}`);
    validateTicket(entry.spec, context.root, false);
    check(entry.specHash === specHash(entry.spec), "CORRUPT_STATE", `specification hash mismatch for ${id}`);
    for (const contributor of entry.contributors) slug(contributor, "stored contributor");
    check(new Set(entry.contributors).size === entry.contributors.length, "CORRUPT_STATE", "duplicate contributor");
    if (entry.lease) {
      stringList(entry.lease.paths, "stored lease paths");
      for (const prefix of entry.lease.paths) relativePath(prefix.replace(/\/$/, ""), "stored lease path");
    }
    check(!(entry.feature && Object.keys(entry.qa).length), "CORRUPT_STATE", `${id} has simultaneous feature and QA claims`);
    for (const claim of activeClaims(entry)) {
      slug(claim.worker, "stored worker");
      integer(claim.revision, "stored claim revision", 1);
      check(claim.revision <= entry.spec.revision && Array.isArray(claim.evidence), "CORRUPT_STATE", "invalid claim revision/checkpoints");
      text(claim.startedAt, "stored claim time");
      if (claim.kind === "qa") {
        slug(claim.role, "stored QA role");
        fullSha(claim.sha);
        check(!entry.contributors.includes(claim.worker), "CORRUPT_STATE", "active QA worker is a feature contributor");
        check(entry.submissions.some((candidate) => candidate.sha === claim.sha && candidate.revision === claim.revision),
          "CORRUPT_STATE", "QA claim has no corresponding submission");
      } else check(entry.contributors.includes(claim.worker), "CORRUPT_STATE", "feature worker is missing from contributors");
    }
    check(!activeClaims(entry).length || entry.lease, "CORRUPT_STATE", "active work has no path lease");
    const submitted = new Set();
    for (const candidate of entry.submissions) {
      validateCandidate(candidate, entry);
      const key = `${candidate.revision}:${candidate.sha}`;
      check(!submitted.has(key), "CORRUPT_STATE", "duplicate candidate submission");
      submitted.add(key);
    }
    if (entry.candidate) {
      validateCandidate(entry.candidate, entry);
      check(entry.candidate.revision === entry.spec.revision && entry.candidate.specHash === entry.specHash,
        "CORRUPT_STATE", `${id} has a stale current candidate`);
      check(entry.submissions.some((candidate) => stable(candidate) === stable(entry.candidate)),
        "CORRUPT_STATE", "current candidate is missing from submission history");
    }
    const verdictKeys = new Set();
    for (const verdict of entry.verdicts) {
      check(object(verdict) && ["PASS", "FAIL", "BLOCKED"].includes(verdict.result) &&
        typeof verdict.specHash === "string", "CORRUPT_STATE", `${id} has an invalid verdict`);
      fullSha(verdict.sha);
      integer(verdict.revision, "stored verdict revision", 1);
      slug(verdict.worker, "stored verdict worker");
      slug(verdict.role, "stored verdict role");
      text(verdict.evidence, "stored verdict evidence");
      check(entry.submissions.some((candidate) => candidate.sha === verdict.sha && candidate.revision === verdict.revision &&
        candidate.specHash === verdict.specHash), "CORRUPT_STATE", "verdict has no corresponding candidate");
      const key = `${verdict.revision}:${verdict.sha}:${verdict.role}`;
      check(!verdictKeys.has(key), "CORRUPT_STATE", "duplicate stored verdict");
      verdictKeys.add(key);
    }
    const failedKeys = new Set();
    for (const failure of entry.failures) {
      check(object(failure) && failure.result !== "PASS" &&
        entry.verdicts.some((verdict) => stable(verdict) === stable(failure)), "CORRUPT_STATE", "invalid failure history");
      const key = `${failure.revision}:${failure.sha}`;
      check(!failedKeys.has(key), "CORRUPT_STATE", "repair round counted twice");
      failedKeys.add(key);
    }
    if (entry.gate) {
      check(entry.candidate && entry.gate.sha === entry.candidate.sha && entry.gate.revision === entry.spec.revision &&
        entry.gate.specHash === entry.specHash, "CORRUPT_STATE", "stale integration gate");
    }
    check(entry.status !== "merged" || (entry.merged && entry.candidate && entry.gate &&
      entry.merged.candidateSha === entry.candidate.sha && entry.merged.revision === entry.spec.revision),
    "CORRUPT_STATE", "merged record lacks its current gate/candidate");
    if (entry.merged) fullSha(entry.merged.sha);
  }
  for (const spec of state.backlog.tickets) {
    check(own(state.tickets, spec.id) && stable(state.tickets[spec.id].spec) === stable(spec) &&
      !state.tickets[spec.id].retired, "CORRUPT_STATE", `backlog record mismatch for ${spec.id}`);
  }
  const currentIds = new Set(state.backlog.tickets.map((spec) => spec.id));
  check(Object.values(state.tickets).every((entry) => currentIds.has(entry.spec.id) || entry.retired),
    "CORRUPT_STATE", "unreviewed execution record is not in the backlog");
  const claims = Object.values(state.tickets).flatMap(activeClaims);
  check(new Set(claims.map((claim) => claim.worker)).size === claims.length &&
    counts(state).feature <= 3 && counts(state).qa <= 2, "CORRUPT_STATE", "worker uniqueness/capacity invariant violated");
  return state;
}
function newEntry(spec) {
  return { spec: clone(spec), specHash: specHash(spec), status: spec.kind === "epic" ? "cancelled" : "ready",
    retired: false, feature: null, qa: {}, lease: null, candidate: null, gate: null, merged: null,
    verdicts: [], submissions: [], contributors: [], failures: [], failureCount: 0, checkpoints: [] };
}
function contextFor(options) {
  const root = fs.realpathSync(options.root ?? process.cwd());
  check(fs.statSync(root).isDirectory(), "INVALID_INPUT", "root must be a repository directory");
  return { root, backlogPath: confined(root, options.backlog ?? "docs/roadmap/backlog.json", "backlog", false),
    statePath: confined(root, options.state ?? ".odee/loop.json", "state", false) };
}
function loadBacklog(context) {
  return validateBacklog(readJson(context.backlogPath, "backlog"), context.root);
}
function synchronized(state, backlog) {
  check(hash(backlog) === state.backlogHash, "RECONCILE_REQUIRED", "backlog changed; run reconcile before using the current contract");
}
function running(state) {
  check(state.mode === "running", "DISPATCH_DISABLED", `coordinator is ${state.mode}; no next, claims, merge gates or merged records until explicit resume`);
}
function ticketFor(state, id) {
  slug(id, "ticket");
  check(own(state.tickets, id), "UNKNOWN_TICKET", `unknown ticket ${id}`);
  return state.tickets[id];
}
function currentRevision(entry, options) {
  const revision = Number(options.revision);
  integer(revision, "revision", 1);
  check(revision === entry.spec.revision, "STALE_REVISION", `expected revision ${entry.spec.revision}, received ${revision}`);
}
function currentCandidate(entry, options) {
  currentRevision(entry, options);
  fullSha(options.sha);
  check(entry.candidate?.sha === options.sha && entry.candidate.revision === entry.spec.revision,
    "STALE_SHA", "candidate SHA is not the current submitted commit");
}
function dispatchable(entry) {
  check(!entry.retired && entry.spec.kind !== "epic", "NOT_DISPATCHABLE", "retired tickets and epics cannot be claimed or merged; split epics into bounded leaves");
}
function dependenciesMet(state, entry) {
  return entry.spec.dependsOn.every((id) => state.tickets[id]?.status === "merged" && !state.tickets[id].retired);
}
function pathsOverlap(a, b) {
  a = a.replace(/\/$/, "");
  b = b.replace(/\/$/, "");
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}
function collision(state, entry) {
  return Object.values(state.tickets).find((other) => other !== entry && other.lease &&
    entry.spec.paths.some((a) => other.lease.paths.some((b) => pathsOverlap(a, b))));
}
function counts(state) {
  const entries = Object.values(state.tickets);
  return { feature: entries.filter((entry) => entry.feature).length,
    qa: entries.reduce((sum, entry) => sum + Object.keys(entry.qa).length, 0) };
}
function workerAvailable(state, worker) {
  return !Object.values(state.tickets).some((entry) => activeClaims(entry).some((claim) => claim.worker === worker));
}
function currentVerdicts(entry) {
  return entry.candidate ? entry.verdicts.filter((verdict) => verdict.sha === entry.candidate.sha &&
    verdict.revision === entry.spec.revision && verdict.specHash === entry.specHash) : [];
}
function deriveStatus(entry) {
  if (entry.retired) return activeClaims(entry).length ? "paused" : "cancelled";
  if (entry.status === "paused") return "paused";
  if (entry.failureCount >= 3 || currentVerdicts(entry).some((verdict) => verdict.result === "BLOCKED")) return "blocked";
  if (entry.feature) return "building";
  if (currentVerdicts(entry).some((verdict) => verdict.result === "FAIL")) return "changes-requested";
  if (Object.keys(entry.qa).length) return "testing";
  if (!entry.candidate) return "ready";
  if (entry.spec.requiredQa.every((role) => currentVerdicts(entry).some((verdict) => verdict.role === role && verdict.result === "PASS"))) return "verified";
  return "awaiting-qa";
}
function featureEligible(state, entry) {
  return !entry.retired && entry.spec.kind !== "epic" && ["ready", "changes-requested"].includes(entry.status) &&
    !activeClaims(entry).length && entry.failureCount < 3 && dependenciesMet(state, entry) && !collision(state, entry);
}
function qaRoles(entry, worker) {
  if (entry.retired || !entry.candidate || !["awaiting-qa", "testing"].includes(entry.status) ||
    (worker && entry.contributors.includes(worker))) return [];
  return entry.spec.requiredQa.filter((role) => !entry.qa[role] && !currentVerdicts(entry).some((verdict) => verdict.role === role));
}
function nextWork(state, options) {
  running(state);
  const kind = options.kind ?? "feature";
  check(["feature", "qa"].includes(kind), "INVALID_INPUT", "kind must be feature or qa");
  if (options.worker) {
    slug(options.worker, "worker");
    if (!workerAvailable(state, options.worker)) return null;
  }
  if (counts(state)[kind] >= (kind === "feature" ? 3 : 2)) return null;
  const entries = Object.values(state.tickets).sort((a, b) => a.spec.priority - b.spec.priority || a.spec.id.localeCompare(b.spec.id));
  for (const entry of entries) {
    if (kind === "feature" && featureEligible(state, entry)) return { ticket: clone(entry.spec), kind };
    if (kind === "qa") {
      const role = qaRoles(entry, options.worker).find((value) => !options.role || options.role === value);
      if (role) return { ticket: clone(entry.spec), kind, role, sha: entry.candidate.sha };
    }
  }
  return null;
}
function gateCheck(state, entry, options) {
  running(state);
  dispatchable(entry);
  currentCandidate(entry, options);
  check(dependenciesMet(state, entry), "DEPENDENCIES_UNMET", "dependencies must be merged before integration");
  check(["verified", "integrating"].includes(entry.status) && !activeClaims(entry).length && entry.failureCount < 3,
    "QA_GATE", "ticket has unfinished, failed, paused or blocked work");
  check(entry.spec.requiredQa.every((role) => currentVerdicts(entry).some((verdict) =>
    verdict.role === role && verdict.result === "PASS" && !entry.contributors.includes(verdict.worker))),
  "QA_GATE", "all current required QA roles must independently PASS this SHA and revision");
}
function invalidate(entry, reason) {
  entry.candidate = null;
  entry.gate = null;
  entry.merged = null;
  entry.pauseReason = reason;
  entry.status = activeClaims(entry).length || entry.lease ? "paused" : "ready";
}
function reconcile(state, backlog) {
  // Validate the entire delta before mutating; a forgotten revision cannot partially apply.
  for (const spec of backlog.tickets) {
    if (!own(state.tickets, spec.id)) continue;
    const old = state.tickets[spec.id];
    check(spec.revision >= old.spec.revision, "STALE_REVISION", `${spec.id} revision cannot go backwards`);
    check(specHash(spec) === old.specHash || spec.revision > old.spec.revision,
      "REVISION_REQUIRED", `${spec.id} contract changed without a revision increase (acceptance, sources, paths, dependencies and metadata are contract)`);
  }
  const changes = [];
  const ids = new Set(backlog.tickets.map((spec) => spec.id));
  for (const [id, entry] of Object.entries(state.tickets)) {
    if (!ids.has(id) && !entry.retired) {
      invalidate(entry, "removed from backlog");
      entry.retired = true;
      entry.status = activeClaims(entry).length || entry.lease ? "paused" : "cancelled";
      changes.push({ ticket: id, change: "retired" });
    }
  }
  const invalidated = new Set();
  for (const spec of backlog.tickets) {
    if (!own(state.tickets, spec.id)) {
      state.tickets[spec.id] = newEntry(spec);
      changes.push({ ticket: spec.id, change: "added" });
      continue;
    }
    const entry = state.tickets[spec.id];
    const changed = entry.retired || spec.revision !== entry.spec.revision || specHash(spec) !== entry.specHash;
    if (changed) {
      invalidate(entry, `specification revised to ${spec.revision}; preserve work and explicitly requeue`);
      invalidated.add(spec.id);
      changes.push({ ticket: spec.id, change: "revised", previousRevision: entry.spec.revision, revision: spec.revision,
        previousSpec: clone(entry.spec), spec: clone(spec), previousSpecHash: entry.specHash, specHash: specHash(spec) });
    } else if (spec.priority !== entry.spec.priority) {
      changes.push({ ticket: spec.id, change: "priority", previousPriority: entry.spec.priority, priority: spec.priority });
    }
    entry.retired = false;
    entry.spec = clone(spec);
    entry.specHash = specHash(spec);
    if (spec.kind === "epic" && !activeClaims(entry).length) entry.status = "cancelled";
  }
  let more = true;
  while (more) {
    more = false;
    for (const entry of Object.values(state.tickets)) {
      if (!entry.retired && !invalidated.has(entry.spec.id) &&
        (activeClaims(entry).length || entry.candidate || entry.lease || entry.merged) &&
        entry.spec.dependsOn.some((id) => invalidated.has(id) || state.tickets[id]?.retired)) {
        invalidate(entry, "dependency contract changed; explicitly requeue after dependencies are merged");
        invalidated.add(entry.spec.id);
        changes.push({ ticket: entry.spec.id, change: "dependency-paused" });
        more = true;
      }
    }
  }
  state.backlog = clone(backlog);
  state.backlogHash = hash(backlog);
  event(state, "reconcile", { changes });
  return { changes };
}
function leafSummary(state, backlogCurrent) {
  const leaves = Object.values(state.tickets).filter((entry) => !entry.retired && entry.spec.kind !== "epic")
    .sort((a, b) => a.spec.priority - b.spec.priority || a.spec.id.localeCompare(b.spec.id));
  const ready = [];
  const blocked = [];
  const capacityReached = counts(state).feature >= 3;
  for (const entry of leaves.filter((entry) => ["ready", "changes-requested", "paused", "blocked"].includes(entry.status))) {
    const blockers = [];
    if (!backlogCurrent) blockers.push("backlog-reconciliation");
    if (state.mode !== "running") blockers.push(`control-${state.mode}`);
    if (capacityReached) blockers.push("feature-capacity");
    if (entry.status === "paused" || entry.status === "blocked") blockers.push(`ticket-${entry.status}`);
    if (entry.failureCount >= 3) blockers.push("failure-limit");
    if (activeClaims(entry).length) blockers.push("active-claims");
    const dependencies = entry.spec.dependsOn.filter((id) => state.tickets[id]?.status !== "merged" || state.tickets[id].retired);
    if (dependencies.length) blockers.push("dependencies");
    const overlap = collision(state, entry);
    if (overlap) blockers.push("path-lease");
    const item = { ticket: entry.spec.id, revision: entry.spec.revision, status: entry.status };
    if (!blockers.length && featureEligible(state, entry)) ready.push(item);
    else blocked.push({ ...item, blockers, dependencies, leaseTicket: overlap?.spec.id ?? null,
      failureCount: entry.failureCount, pauseReason: entry.pauseReason ?? null });
  }
  return { total: leaves.length,
    counts: Object.fromEntries(STATUSES.map((status) => [status, leaves.filter((entry) => entry.status === status).length])),
    ready, blocked };
}
function summary(state, context) {
  let backlogError = null;
  let backlogChanged = false;
  try { backlogChanged = hash(loadBacklog(context)) !== state.backlogHash; }
  catch (error) { backlogError = { code: error.code ?? "ERROR", message: error.message }; }
  const tickets = Object.values(state.tickets);
  const lockPath = `${context.statePath}.lock`;
  const locks = [lockPath, ...recoveryFiles(lockPath).map((name) => path.join(path.dirname(lockPath), name))]
    .filter((filename) => fs.existsSync(filename)).map((filename) => ({ path: filename, owner: readOwner(filename) }));
  const backlogCurrent = !backlogChanged && !backlogError;
  return { version: state.version, mode: state.mode, repository: state.repository, sequence: state.sequence,
    backlogChanged, backlogError, active: counts(state), locks,
    planningBaseline: clone(state.backlog.planningBaseline ?? null),
    planningChanges: clone(state.backlog.planningChanges ?? []),
    leaves: leafSummary(state, backlogCurrent),
    counts: Object.fromEntries(STATUSES.map((status) => [status, tickets.filter((entry) => entry.status === status).length])),
    next: state.mode === "running" && backlogCurrent ? nextWork(state, {}) : null,
    tickets: clone(state.tickets), history: clone(state.history) };
}
function recoverLock(context, options) {
  text(options.token, "token");
  const depth = Number(options["recovery-depth"] ?? 0);
  integer(depth, "recovery-depth");
  check(depth <= 32, "INVALID_INPUT", "recovery-depth must be <= 32");
  const mainPath = `${context.statePath}.lock`;
  const target = `${mainPath}${".recovery".repeat(depth)}`;
  const deeper = recoveryFiles(mainPath).filter((name) => name.length > path.basename(target).length);
  check(!deeper.length, "LOCKED", "a deeper recovery lock exists; inspect status and recover that exact owner first");
  const guard = `${target}.recovery`;
  const owner = lockOwner();
  createExclusive(guard, owner);
  try {
    const previous = readOwner(target);
    check(previous.token === options.token, "LOCK_TOKEN_MISMATCH", "recovery token does not match the exact lock owner");
    check(definitelyDead(previous), "LIVE_LOCK", `pid ${previous.pid} still owns this lock; never delete a live lock or kill an unrelated process`);
    removeOwned(target, previous.token);
    // The guard excludes both ordinary writers and other recovery commands.
    const auditWritten = fs.existsSync(context.statePath) && !fs.existsSync(mainPath);
    if (auditWritten) {
      const state = readState(context);
      event(state, "recover-lock", { owner: previous, recoveryDepth: depth });
      atomicJson(context.statePath, state);
    }
    return { recovered: previous, recoveryDepth: depth, auditWritten };
  } finally { removeOwned(guard, owner.token); }
}
function mutate(state, command, options) {
  if (["pause", "stop", "resume"].includes(command)) {
    state.mode = { pause: "paused", stop: "stopped", resume: "running" }[command];
    event(state, command);
    return { mode: state.mode, activeClaimsPreserved: counts(state) };
  }
  const entry = ticketFor(state, options.ticket);
  const kind = options.kind ?? "feature";
  check(["feature", "qa"].includes(kind), "INVALID_INPUT", "kind must be feature or qa");
  if (command === "claim") {
    running(state);
    dispatchable(entry);
    currentRevision(entry, options);
    const worker = slug(options.worker, "worker");
    check(workerAvailable(state, worker), "WORKER_BUSY", "worker already has an active claim");
    check(counts(state)[kind] < (kind === "feature" ? 3 : 2), "CAPACITY", `${kind} active-claim cap reached`);
    check(dependenciesMet(state, entry), "DEPENDENCIES_UNMET", "ticket dependencies are not merged");
    const claim = { worker, revision: entry.spec.revision, startedAt: now(), evidence: [] };
    if (kind === "feature") {
      check(options.role === undefined && options.sha === undefined, "INVALID_INPUT", "feature claims do not take a QA role or candidate SHA");
      const overlap = collision(state, entry);
      check(!overlap, "PATH_COLLISION", `path lease overlaps ${overlap?.spec.id}`);
      check(featureEligible(state, entry), "NOT_READY", `ticket is ${entry.status} or has unfinished claims; recover/requeue explicitly`);
      entry.feature = claim;
      if (!entry.contributors.includes(worker)) entry.contributors.push(worker);
      entry.lease ??= { paths: clone(entry.spec.paths), acquiredAt: now() };
      entry.gate = null;
    } else {
      currentCandidate(entry, options);
      slug(options.role, "role");
      check(!entry.contributors.includes(worker), "SELF_QA", "feature contributors cannot QA their own ticket");
      check(qaRoles(entry, worker).includes(options.role), "QA_NOT_READY", "role is not required, is already claimed/verdict recorded, or candidate is not awaiting QA");
      entry.qa[options.role] = { ...claim, sha: entry.candidate.sha };
    }
    entry.status = deriveStatus(entry);
    event(state, "claim", { ticket: entry.spec.id, kind, role: options.role ?? null, ...claim });
    return { ticket: entry.spec.id, kind, role: options.role ?? null, claim: clone(claim), status: entry.status };
  }
  if (command === "submit") {
    currentRevision(entry, options);
    fullSha(options.sha);
    text(options.evidence, "evidence");
    check(entry.status === "building" && entry.feature?.worker === options.worker &&
      entry.feature.revision === entry.spec.revision, "NO_CLAIM", "only the active current feature worker can submit");
    check(!Object.keys(entry.qa).length, "QA_ACTIVE", "unfinished QA must checkpoint and recover before a new candidate");
    check(!entry.submissions.some((candidate) => candidate.sha === options.sha && candidate.revision === entry.spec.revision),
      "DUPLICATE_SHA", "this SHA was already submitted for this revision; repairs require a new commit");
    entry.candidate = { sha: options.sha, revision: entry.spec.revision, specHash: entry.specHash,
      worker: options.worker, evidence: options.evidence, submittedAt: now() };
    entry.submissions.push(clone(entry.candidate));
    entry.feature = null;
    entry.gate = null;
    entry.status = deriveStatus(entry);
    event(state, "submit", { ticket: entry.spec.id, ...entry.candidate });
    return { ticket: entry.spec.id, candidate: clone(entry.candidate), status: entry.status };
  }
  if (command === "verdict") {
    currentCandidate(entry, options);
    slug(options.role, "role");
    slug(options.worker, "worker");
    text(options.evidence, "evidence");
    check(["PASS", "FAIL", "BLOCKED"].includes(options.result), "INVALID_INPUT", "result must be PASS, FAIL or BLOCKED");
    check(!entry.contributors.includes(options.worker), "SELF_QA", "feature contributors cannot approve their own ticket");
    check(!currentVerdicts(entry).some((verdict) => verdict.role === options.role), "DUPLICATE_VERDICT", "role already reported for this SHA and revision");
    const claim = entry.qa[options.role];
    check(claim?.worker === options.worker && claim.sha === options.sha && claim.revision === entry.spec.revision,
      "NO_CLAIM", "verdict requires the matching independent QA claim");
    const verdict = { role: options.role, worker: options.worker, sha: options.sha, revision: entry.spec.revision,
      specHash: entry.specHash, result: options.result, evidence: options.evidence, at: now() };
    entry.verdicts.push(verdict);
    delete entry.qa[options.role];
    entry.gate = null;
    if (options.result !== "PASS" && !entry.failures.some((failure) => failure.sha === options.sha && failure.revision === entry.spec.revision)) {
      entry.failures.push(clone(verdict));
      entry.failureCount += 1;
    }
    entry.status = deriveStatus(entry);
    event(state, "verdict", { ticket: entry.spec.id, ...verdict, failureCount: entry.failureCount });
    return { ticket: entry.spec.id, verdict: clone(verdict), status: entry.status, failureCount: entry.failureCount };
  }
  if (command === "gate" || command === "merged") {
    gateCheck(state, entry, options);
    if (command === "gate") {
      entry.gate = { sha: options.sha, revision: entry.spec.revision, specHash: entry.specHash, at: now() };
      entry.status = "integrating";
      event(state, "gate", { ticket: entry.spec.id, ...entry.gate });
      return { eligible: true, ticket: entry.spec.id, gate: clone(entry.gate), note: "Local evidence gate only; no Git merge, server protection or release is performed." };
    }
    check(entry.gate?.sha === options.sha && entry.gate.revision === entry.spec.revision && entry.gate.specHash === entry.specHash,
      "GATE_REQUIRED", "record a current gate before recording an actual merge");
    fullSha(options["merged-sha"]);
    text(options.evidence, "evidence");
    entry.merged = { candidateSha: options.sha, sha: options["merged-sha"], revision: entry.spec.revision, evidence: options.evidence, at: now() };
    entry.status = "merged";
    entry.lease = null;
    event(state, "merged", { ticket: entry.spec.id, ...entry.merged });
    return { ticket: entry.spec.id, merged: clone(entry.merged) };
  }
  if (command === "checkpoint" || command === "recover") {
    slug(options.worker, "worker");
    text(options.evidence, "evidence");
    if (kind === "qa") slug(options.role, "role");
    const claim = kind === "feature" ? entry.feature : entry.qa[options.role];
    check(claim?.worker === options.worker, "NO_CLAIM", "worker does not own this active claim");
    const checkpoint = { kind, role: options.role ?? null, worker: options.worker, revision: claim.revision, evidence: options.evidence, at: now() };
    entry.checkpoints.push(checkpoint);
    if (command === "checkpoint") claim.evidence.push({ evidence: options.evidence, at: now() });
    else {
      if (kind === "feature") entry.feature = null;
      else delete entry.qa[options.role];
      if (!activeClaims(entry).length && !entry.candidate && entry.status !== "paused") entry.lease = null;
      entry.status = deriveStatus(entry);
    }
    event(state, command, { ticket: entry.spec.id, ...checkpoint });
    return { ticket: entry.spec.id, status: entry.status, checkpoint };
  }
  if (command === "requeue") {
    text(options.evidence, "evidence");
    check(entry.status !== "merged", "ALREADY_MERGED", "a merged contract cannot be requeued without a specification revision");
    const abandoned = activeClaims(entry);
    entry.feature = null;
    entry.qa = {};
    entry.candidate = null;
    entry.gate = null;
    entry.lease = null;
    entry.status = entry.retired || entry.spec.kind === "epic" ? "cancelled" : entry.failureCount >= 3 ? "blocked" : "ready";
    delete entry.pauseReason;
    event(state, "requeue", { ticket: entry.spec.id, evidence: options.evidence, abandoned });
    return { ticket: entry.spec.id, status: entry.status, abandoned };
  }
  fail("UNKNOWN_COMMAND", `unknown command ${command}; use --help`);
}
export function runCommand(options, command, args = {}) {
  const context = contextFor(options);
  check(COMMANDS.includes(command), "UNKNOWN_COMMAND", `unknown command ${command}; use --help`);
  if (command === "status") return summary(readState(context), context);
  if (command === "recover-lock") return recoverLock(context, args);
  const lock = acquireLock(context.statePath);
  try {
    if (command === "init") {
      check(!fs.existsSync(context.statePath), "ALREADY_INITIALIZED", "state already exists; init never overwrites unknown, failed or existing execution state");
      const backlog = loadBacklog(context);
      const state = { version: 1, repository: context.root, mode: "running", backlog: clone(backlog),
        backlogHash: hash(backlog), tickets: Object.fromEntries(backlog.tickets.map((spec) => [spec.id, newEntry(spec)])),
        sequence: 0, history: [], updatedAt: now() };
      event(state, "init", { tickets: backlog.tickets.length });
      lock.assert();
      atomicJson(context.statePath, state);
      return { initialized: true, mode: state.mode, tickets: backlog.tickets.length, state: context.statePath };
    }
    const state = readState(context);
    let result;
    if (command === "reconcile") result = reconcile(state, loadBacklog(context));
    else {
      // Stop/checkpoint/recovery remain available even when a PM edit is invalid.
      if (!["pause", "stop", "checkpoint", "recover", "requeue"].includes(command)) synchronized(state, loadBacklog(context));
      if (command === "next") return { next: nextWork(state, args), note: "Selection only; claim before invoking actual VS Code task tools." };
      result = mutate(state, command, args);
      if (command === "resume") result = { ...result, ...summary(state, context) };
    }
    lock.assert();
    atomicJson(context.statePath, state);
    return result;
  } finally { lock.release(); }
}
const COMMANDS = ["init", "status", "next", "claim", "submit", "verdict", "gate", "merged", "pause", "stop", "resume", "checkpoint", "recover", "requeue", "reconcile", "recover-lock"];
const FLAGS = {
  init: [], status: [], next: ["kind", "role", "worker"],
  claim: ["ticket", "worker", "revision", "kind", "role", "sha"],
  submit: ["ticket", "worker", "revision", "sha", "evidence"],
  verdict: ["ticket", "worker", "role", "revision", "sha", "result", "evidence"],
  gate: ["ticket", "revision", "sha"], merged: ["ticket", "revision", "sha", "merged-sha", "evidence"],
  pause: [], stop: [], resume: [], checkpoint: ["ticket", "worker", "kind", "role", "evidence"],
  recover: ["ticket", "worker", "kind", "role", "evidence"], requeue: ["ticket", "evidence"],
  reconcile: [], "recover-lock": ["token", "recovery-depth"],
};
export const HELP = `ODEE durable local coordinator STATE TOOLING (Node 20+; no daemon).

Usage: node tools/agents/loop.mjs [--root DIR] [--backlog PATH] [--state PATH] COMMAND [FLAGS]
Defaults: root=current directory; backlog=docs/roadmap/backlog.json; state=.odee/loop.json.
Backlog/state overrides must be repository-relative. Output is JSON; errors go to stderr with exit 1.

init                            Initialize once from a validated backlog; never resets existing state.
status                          Show control, claims, leases, evidence/history and lock ownership,
                                persisted planningBaseline/planningChanges, leaf readiness and next.
next [--kind feature|qa] [--role ROLE] [--worker ID]
                                Advisory selection only, not a reservation or agent dispatch.
claim --ticket ID --worker ID --revision N [--kind feature|qa]
      [--role ROLE --sha SHA]    QA requires both role and current SHA. Default kind=feature.
submit --ticket ID --worker ID --revision N --sha SHA --evidence TEXT
verdict --ticket ID --worker ID --role ROLE --revision N --sha SHA
        --result PASS|FAIL|BLOCKED --evidence TEXT
gate --ticket ID --revision N --sha SHA
merged --ticket ID --revision N --sha SHA --merged-sha SHA --evidence TEXT
pause | stop | resume           Pause/stop disable next, claims, gates AND merged records.
                                Running tools checkpoint cooperatively; nothing is killed.
                                Resume returns the same planning/readiness report as status.
checkpoint --ticket ID --worker ID [--kind feature|qa] [--role ROLE] --evidence TEXT
recover --ticket ID --worker ID [--kind feature|qa] [--role ROLE] --evidence TEXT
                                Explicitly abandon one interrupted claim; never relaunch it.
requeue --ticket ID --evidence TEXT
                                Acknowledge all abandoned claims and release the lease.
                                Preserve history/failure count; three failures stay blocked.
reconcile                       Apply reviewed backlog changes; contract changes require revision.
                                Changed in-flight work pauses; explicitly requeue after checkpoint.
recover-lock --token TOKEN [--recovery-depth N]
                                Recover only that exact dead same-host process owner.
                                Default depth=0. For an interrupted recovery, recover the deepest
                                .recovery lock first using its token and depth shown by status.
--help                          Print this help.

Feature claims: max 3; QA claims: max 2; one active claim per worker; no feature self-QA.
Leases survive submission/QA/failure/interruption until merge or explicit requeue/recovery.
All required QA roles must PASS the exact SHA AND revision. Epics are never dispatchable.
SHA means a full lowercase 40- or 64-character hash. Evidence is required nonempty text:
include commands/results, synthetic environment, reproducer/criterion and handoff identifiers.
Only one state file should be used per repository. State must be ignored, not committed.
Planning output comes from the accepted persisted backlog, never a new un-reconciled file pin.
Absent legacy planning metadata is null/[]; no reference version or PM work is invented.
leaves.counts are execution states excluding epics/retired records; leaves.ready are currently
claimable feature leaves, leaves.blocked list queued feature blockers, and next is advisory.
Resume is explicit and never launches agents. CLI performs NO Git merge/push/deploy,
proves no remote branch protections, and certifies no release or external-service sandbox.
It records supplied evidence; it does not execute or independently verify test commands.
`;
export function main(argv = process.argv.slice(2)) {
  try {
    if (argv.includes("--help")) { process.stdout.write(HELP); return 0; }
    const flags = {};
    let command;
    for (let index = 0; index < argv.length; index += 1) {
      const item = argv[index];
      if (!item.startsWith("--")) {
        check(!command, "INVALID_INPUT", `unexpected argument ${item}`);
        command = item;
        continue;
      }
      const name = item.slice(2);
      check(!own(flags, name), "INVALID_INPUT", `duplicate flag --${name}`);
      const value = argv[++index];
      check(value !== undefined && !value.startsWith("--"), "INVALID_INPUT", `missing value for --${name}`);
      flags[name] = value;
    }
    check(COMMANDS.includes(command), "UNKNOWN_COMMAND", "expected a supported command; use --help");
    for (const name of Object.keys(flags)) check(["root", "backlog", "state", ...FLAGS[command]].includes(name),
      "INVALID_INPUT", `unsupported flag --${name} for ${command}`);
    const { root, backlog, state, ...args } = flags;
    process.stdout.write(`${JSON.stringify(runCommand({ root, backlog, state }, command, args), null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`loop: ${error.code ?? "ERROR"}: ${error.message}\n`);
    return 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
