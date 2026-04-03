import test from "node:test";
import assert from "node:assert/strict";
import {
  getActiveFrame,
  switchToMainFrame
} from "./browser";
import type { BrowserSession } from "./browser";

test("getActiveFrame returns undefined when no frame is active", () => {
  const session = { page: {}, browser: {}, context: {} } as unknown as BrowserSession;
  assert.equal(getActiveFrame(session), undefined);
});

test("switchToMainFrame clears active frame", () => {
  const session = { page: {}, browser: {}, context: {} } as unknown as BrowserSession;
  (session as any)._activeFrame = "iframe#main";
  switchToMainFrame(session);
  assert.equal(getActiveFrame(session), undefined);
});

test("getAllTabs returns pages from context", () => {
  // Test with mock context
  const mockPages = [{}, {}];
  const session = {
    page: mockPages[0],
    browser: {},
    context: { pages: () => mockPages }
  } as unknown as BrowserSession;

  const { getAllTabs } = require("./browser");
  const tabs = getAllTabs(session);
  assert.equal(tabs.length, 2);
});

test("switchToTab changes active page", () => {
  const page1 = { url: () => "http://page1.com" };
  const page2 = { url: () => "http://page2.com" };
  const session = {
    page: page1,
    browser: {},
    context: { pages: () => [page1, page2] }
  } as unknown as BrowserSession;

  const { switchToTab } = require("./browser");
  const result = switchToTab(session, 1);
  assert.ok(result !== null);
  assert.equal(session.page, page2);
});

test("switchToTab returns null for invalid index", () => {
  const session = {
    page: {},
    browser: {},
    context: { pages: () => [{}] }
  } as unknown as BrowserSession;

  const { switchToTab } = require("./browser");
  assert.equal(switchToTab(session, 5), null);
  assert.equal(switchToTab(session, -1), null);
});
