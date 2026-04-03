import test from "node:test";
import assert from "node:assert/strict";
import { callOpenAICompatible, readProviderConfig } from "./provider";
import { withEnv, withMockedFetch, jsonResponse } from "../provider-smoke.utils";

test("readProviderConfig: kimi-k2.5 on moonshot defaults temperature to 1", async () => {
  await withEnv(
    {
      LLM_TEST_PROVIDER: "openai-compatible",
      LLM_TEST_MODEL: "kimi-k2.5",
      LLM_TEST_BASE_URL: "https://api.moonshot.ai/v1"
    },
    async () => {
      const config = readProviderConfig("LLM_TEST");
      assert.equal(config.temperature, 1);
    }
  );
});

test("callOpenAICompatible: appends chat completions to v1 base url", async () => {
  let requestedUrl = "";

  await withMockedFetch(
    async (input) => {
      requestedUrl = String(input);
      return jsonResponse({
        choices: [{ message: { content: "{\"tasks\":[]}" } }]
      });
    },
    async () => {
      await callOpenAICompatible(
        {
          provider: "openai-compatible",
          model: "kimi-k2.5",
          timeoutMs: 1000,
          maxTokens: 100,
          temperature: 1,
          apiKey: "test-key",
          baseUrl: "https://api.moonshot.ai/v1"
        },
        [{ role: "user", content: "hello" }],
        "provider test"
      );
    }
  );

  assert.equal(requestedUrl, "https://api.moonshot.ai/v1/chat/completions");
});

test("parseOpenAIUsage extracts prompt and completion tokens", () => {
  const { parseOpenAIUsage } = require("./provider");
  const usage = parseOpenAIUsage({ prompt_tokens: 100, completion_tokens: 50 });
  assert.equal(usage.inputTokens, 100);
  assert.equal(usage.outputTokens, 50);
});

test("parseAnthropicUsage extracts input and output tokens", () => {
  const { parseAnthropicUsage } = require("./provider");
  const usage = parseAnthropicUsage({ input_tokens: 200, output_tokens: 80 });
  assert.equal(usage.inputTokens, 200);
  assert.equal(usage.outputTokens, 80);
});

test("parseOpenAIUsage returns zeros for missing data", () => {
  const { parseOpenAIUsage } = require("./provider");
  const usage = parseOpenAIUsage(undefined);
  assert.equal(usage.inputTokens, 0);
  assert.equal(usage.outputTokens, 0);
});

test("parseAnthropicUsage returns zeros for missing data", () => {
  const { parseAnthropicUsage } = require("./provider");
  const usage = parseAnthropicUsage(null);
  assert.equal(usage.inputTokens, 0);
  assert.equal(usage.outputTokens, 0);
});
