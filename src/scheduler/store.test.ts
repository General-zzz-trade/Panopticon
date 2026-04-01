import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "../db/client";
import { initSchedulesTable, createSchedule, getSchedule, listSchedules, deleteSchedule, setScheduleEnabled, updateScheduleRun } from "./store";

beforeEach(() => {
  initSchedulesTable();
  getDb().prepare("DELETE FROM schedules").run();
});

test("createSchedule + getSchedule roundtrip", () => {
  createSchedule({ id: "s1", name: "test", goal: "open http://example.com", cronExpr: "@daily", tenantId: "default", enabled: true });
  const s = getSchedule("s1");
  assert.equal(s?.name, "test");
  assert.equal(s?.cronExpr, "@daily");
});

test("listSchedules: returns created schedules", () => {
  createSchedule({ id: "s2", name: "job", goal: "screenshot", cronExpr: "0 9 * * *", tenantId: "t1", enabled: true });
  const all = listSchedules("t1");
  assert.ok(all.some(s => s.id === "s2"));
});

test("setScheduleEnabled: disables schedule", () => {
  createSchedule({ id: "s3", name: "x", goal: "x", cronExpr: "@hourly", tenantId: "default", enabled: true });
  setScheduleEnabled("s3", false);
  assert.equal(getSchedule("s3")?.enabled, false);
});

test("updateScheduleRun: increments run_count", () => {
  createSchedule({ id: "s4", name: "x", goal: "x", cronExpr: "@hourly", tenantId: "default", enabled: true });
  updateScheduleRun("s4", new Date().toISOString(), new Date().toISOString());
  assert.equal(getSchedule("s4")?.runCount, 1);
});

test("deleteSchedule: removes record", () => {
  createSchedule({ id: "s5", name: "x", goal: "x", cronExpr: "@daily", tenantId: "default", enabled: true });
  deleteSchedule("s5");
  assert.equal(getSchedule("s5"), undefined);
});
