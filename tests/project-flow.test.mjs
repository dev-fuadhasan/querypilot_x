import test from "node:test";
import assert from "node:assert/strict";
import { resolveStartupPhase, initialProjectRef } from "../src/lib/connection-flow.ts";

const projects = [
  { id: "project-first", name: "First project" },
  { id: "project-second", name: "Second project" },
];

test("never enters dashboard after OAuth authorization without a project", () => {
  assert.equal(resolveStartupPhase({ connected: false, mode: "oauth", projects }), "setup");
  assert.equal(resolveStartupPhase({ connected: false, mode: "oauth", projects: [projects[0]] }), "setup");
});

test("persisted OAuth project remains in dashboard after refresh", () => {
  assert.equal(resolveStartupPhase({
    connected: true, mode: "oauth", projectRef: "project-second", projects
  }), "workspace");
  assert.equal(initialProjectRef({
    connected: true, mode: "oauth", projectRef: "project-second", projects
  }), "project-second");
});

test("session works with one authorized project and manual PostgreSQL connection", () => {
  assert.equal(resolveStartupPhase({ connected: true, mode: "oauth", projectRef: "project-first", projects: [projects[0]] }), "workspace");
  assert.equal(resolveStartupPhase({ connected: true, mode: "postgres", projects: [] }), "workspace");
});

test("authorized but unselected project list defaults to first project, not dashboard", () => {
  assert.equal(initialProjectRef({ connected: false, mode: "oauth", projects }), "project-first");
});

test("project list does not imply a completed connection; absent authorization is landing", () => {
  assert.equal(resolveStartupPhase({ connected: false, projects: [] }), "landing");
  assert.equal(resolveStartupPhase({ connected: false, mode: "oauth", projects: [] }), "landing");
  assert.equal(initialProjectRef({ connected: false, mode: "oauth", projectRef: "unknown", projects }), "project-first");
});
