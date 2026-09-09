/**
 * The AI platform, as seen by the rest of the application.
 *
 * Callers import from here and get a task-based interface: `aiRouter.chat` and
 * `aiRouter.chatStructured`. Nothing outside this directory imports a
 * provider, and nothing outside it knows a provider's name except the admin
 * setting, which chooses an order.
 */

export { aiRouter, AiRouter } from './router/router.js';
export type { RouterRequest, RouterResponse } from './router/router.js';
export { AI_TASKS, DEFAULT_POLICIES, resetPolicyCache } from './router/policy.js';
export type { AiTask, TaskPolicy } from './router/policy.js';
export {
  providerRegistry,
  ProviderRegistry,
  PROVIDER_IDS,
  isProviderId,
} from './providers/registry.js';
export type { ProviderId } from './providers/registry.js';
export { defineStructured, extractJson } from './structured.js';
export type { StructuredSpec } from './structured.js';
export {
  BudgetExceededError,
  NoProviderAvailableError,
  ProviderError,
  StructuredOutputError,
} from './ai.errors.js';
export type { ChatMessage, ChatProvider, ChatRequest, ChatResponse } from './ports/chat.port.js';
export type {
  Detection,
  EmbeddingProvider,
  ImageEmbedder,
  VisionProvider,
} from './ports/embedding.port.js';
