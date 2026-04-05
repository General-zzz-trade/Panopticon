import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { isEmailConfigured } from "./email-handler";

beforeEach(() => {
  delete process.env.EMAIL_SMTP_HOST;
  delete process.env.EMAIL_SMTP_USER;
  delete process.env.EMAIL_SMTP_PASS;
  delete process.env.EMAIL_SMTP_PORT;
  delete process.env.EMAIL_USE_TLS;
});

test("isEmailConfigured returns false when no env vars set", () => {
  assert.equal(isEmailConfigured(), false);
});

test("isEmailConfigured returns true when EMAIL_SMTP_HOST and EMAIL_SMTP_USER are set", () => {
  process.env.EMAIL_SMTP_HOST = "smtp.example.com";
  process.env.EMAIL_SMTP_USER = "user@example.com";
  assert.equal(isEmailConfigured(), true);
});

test("isEmailConfigured returns false when only EMAIL_SMTP_HOST is set", () => {
  process.env.EMAIL_SMTP_HOST = "smtp.example.com";
  assert.equal(isEmailConfigured(), false);
});

test("isEmailConfigured returns false when only EMAIL_SMTP_USER is set", () => {
  process.env.EMAIL_SMTP_USER = "user@example.com";
  assert.equal(isEmailConfigured(), false);
});
