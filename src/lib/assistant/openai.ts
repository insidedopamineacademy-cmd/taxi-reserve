import "server-only";

import OpenAI from "openai";
import type {
  ResponseInput,
  ResponseOutputItem,
} from "openai/resources/responses/responses";
import {
  AssistantConfigurationError,
  getAssistantOpenAIConfig,
} from "./config.ts";
import { AssistantTransportError } from "./errors.ts";
import type {
  AssistantModelOutputItem,
  AssistantModelRequest,
  AssistantModelResult,
} from "./tool-loop.ts";

let openAIClient: OpenAI | null = null;
let configuredApiKey: string | null = null;

function getOpenAIClient() {
  const config = getAssistantOpenAIConfig();

  if (!openAIClient || configuredApiKey !== config.apiKey) {
    openAIClient = new OpenAI({
      apiKey: config.apiKey,
      timeout: config.timeoutMs,
      maxRetries: 0,
    });
    configuredApiKey = config.apiKey;
  }

  return { client: openAIClient, config };
}

export function throwAssistantOpenAIError(error: unknown, signalAborted = false): never {
  if (signalAborted) throw error;
  if (error instanceof AssistantTransportError) throw error;
  if (error instanceof OpenAI.RateLimitError) {
    throw new AssistantTransportError("RATE_LIMITED", { cause: error });
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    throw new AssistantTransportError("REQUEST_TIMEOUT", { cause: error });
  }
  if (
    error instanceof OpenAI.APIConnectionError ||
    error instanceof OpenAI.APIError ||
    error instanceof AssistantConfigurationError
  ) {
    throw new AssistantTransportError("UPSTREAM_UNAVAILABLE", { cause: error });
  }

  throw new AssistantTransportError("UPSTREAM_UNAVAILABLE", { cause: error });
}

export async function streamOpenAIResponse(
  request: AssistantModelRequest,
): Promise<AssistantModelResult> {
  try {
    const { client, config } = getOpenAIClient();
    const stream = await client.responses.create(
      {
        model: config.model,
        instructions: request.instructions,
        input: request.input as ResponseInput,
        tools: [...request.tools],
        tool_choice: "auto",
        parallel_tool_calls: request.parallelToolCalls,
        max_output_tokens: request.maxOutputTokens,
        safety_identifier: request.safetyIdentifier,
        include: ["reasoning.encrypted_content"],
        store: false,
        stream: true,
      },
      {
        signal: request.signal,
        timeout: config.timeoutMs,
        maxRetries: 0,
      },
    );

    let completedOutput: ResponseOutputItem[] | null = null;
    let upstreamResponseId: string | undefined;
    let usage: AssistantModelResult["usage"];

    for await (const event of stream) {
      if (event.type === "response.created") {
        upstreamResponseId = event.response.id ?? upstreamResponseId;
      } else if (event.type === "response.output_text.delta") {
        request.onTextDelta(event.delta);
      } else if (event.type === "response.completed") {
        completedOutput = event.response.output;
        upstreamResponseId = event.response.id ?? upstreamResponseId;
        if (event.response.usage) {
          usage = {
            inputTokens: event.response.usage.input_tokens,
            outputTokens: event.response.usage.output_tokens,
            totalTokens: event.response.usage.total_tokens,
          };
        }
      } else if (
        event.type === "error" ||
        event.type === "response.failed" ||
        event.type === "response.incomplete"
      ) {
        throw new AssistantTransportError("UPSTREAM_UNAVAILABLE");
      }
    }

    if (!completedOutput) {
      throw new AssistantTransportError("UPSTREAM_UNAVAILABLE");
    }

    return {
      output: completedOutput as unknown as AssistantModelOutputItem[],
      upstreamResponseId,
      usage,
    };
  } catch (error) {
    throwAssistantOpenAIError(error, request.signal.aborted);
  }
}
