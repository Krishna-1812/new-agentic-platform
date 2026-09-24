// Shared LLM model options for Article Enhancer and Enhance Existing Article.
// Keep in sync with server/services/llmProviders.js MODEL_OPTIONS.
export const LLM_MODEL_OPTIONS = [
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini (OpenAI)' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
];
export const DEFAULT_LLM_MODEL = 'gpt-5.4-mini';
