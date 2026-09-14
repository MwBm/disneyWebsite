/**
 * Groq model IDs. Groq retires models, and every call then 404s; this is the
 * only file to edit when that happens. List the models currently available with:
 *
 *   curl -H "Authorization: Bearer $GROQ_API_KEY" \
 *     https://api.groq.com/openai/v1/models
 */

/**
 * Used for narration and every structured (JSON-mode) call.
 *
 * The openai/gpt-oss-* models on Groq are reasoning models: they return empty
 * `content` at small token budgets and fail `response_format: json_object`
 * validation, so they are not drop-in replacements here.
 */
export const GROQ_TEXT_MODEL = "qwen/qwen3.8-27b";

/** Used for the streaming chat assistant. */
export const GROQ_CHAT_MODEL = "qwen/qwen3.8-27b";
