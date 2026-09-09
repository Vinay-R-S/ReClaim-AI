/**
 * What a chat model looks like from the inside of this application.
 *
 * Callers depend on this and on nothing else: no caller knows whether the
 * request went to Groq, Gemini, OpenAI, Anthropic or a model running on the
 * developer's own machine. That is what makes a provider one file plus a
 * registry entry (ADR 0010).
 */

import type { StructuredSpec } from '../structured.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatImage {
  /** Raw base64, no data-URL prefix. */
  base64: string;
  mimeType?: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** Images of the same subject, analysed together. */
  images?: ChatImage[];
  temperature?: number;
  maxTokens?: number;
  /** Ask for a schema-constrained reply. Only routed to providers that can. */
  structured?: StructuredSpec<unknown>;
  signal?: AbortSignal;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResponse {
  content: string;
  providerId: string;
  model: string;
  usage?: ChatUsage;
}

export interface ProviderCapabilities {
  vision: boolean;
  tools: boolean;
  /** True only when the provider constrains the reply, not when it is asked nicely. */
  jsonSchema: boolean;
  maxContext: number;
}

/**
 * US dollars per million tokens.
 *
 * Used for the cost meter and for ordering candidates by price, never for
 * billing. `verifiedOn` is there because a price nobody has checked since it
 * was typed is a guess with a decimal point.
 */
export interface ProviderCost {
  inputPerMTok: number;
  outputPerMTok: number;
  verifiedOn: string;
}

export interface ChatProvider {
  readonly id: string;
  readonly model: string;
  readonly capabilities: ProviderCapabilities;
  readonly cost: ProviderCost;
  chat(request: ChatRequest): Promise<ChatResponse>;
}
