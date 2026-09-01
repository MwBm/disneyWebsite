/**
 * Groq model IDs, in one place.
 *
 * These were previously hardcoded at five call sites across groq.ts and the
 * chat route. Groq retires models, and when it does every call 404s — which is
 * exactly what happened: `llama-3.3-70b-versatile` and `llama-3.1-8b-instant`
 * were both removed, so narration, the crowd adjuster, the day-of-week
 * estimate and the chat assistant all failed. Every one of those failures was
 * caught and discarded, so the app looked like it was working and simply never
 * showed any AI output.
 *
 * When a model disappears again, this is the only file to edit. Check what is
 * currently available with:
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
