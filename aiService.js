const Groq = require("groq-sdk");

const MAX_SUGGESTIONS = 10;
const PRIORITIES = new Set(["low", "medium", "high"]);

function isValidDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    return date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day;
}

function readJson(text) {
    if (typeof text !== "string") {
        throw new Error("AI response did not contain text");
    }

    let cleaned = text.trim();
    // Strip thinking tags if present from reasoning models
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    // Strip markdown code fences
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

    // Extract outer JSON object or array if extra preamble/postamble exists
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }

    try {
        return JSON.parse(cleaned);
    } catch (error) {
        const parseError = new Error("AI response was not valid JSON");
        parseError.code = "AI_INVALID_RESPONSE";
        parseError.cause = error;
        throw parseError;
    }
}

function validateSuggestions(value) {
    if (!value || typeof value !== "object") {
        const error = new Error("AI response was not a valid object");
        error.code = "AI_INVALID_RESPONSE";
        throw error;
    }

    const rawList = Array.isArray(value)
        ? value
        : Array.isArray(value.suggestions)
        ? value.suggestions
        : [];

    if (!rawList.length) {
        const error = new Error("AI response did not contain a valid suggestions array");
        error.code = "AI_INVALID_RESPONSE";
        throw error;
    }

    const suggestions = rawList.slice(0, MAX_SUGGESTIONS).map((suggestion) => {
        if (!suggestion || typeof suggestion !== "object") {
            return null;
        }

        const title = typeof suggestion.title === "string" ? suggestion.title.trim() : "";
        if (!title) return null;

        const description = typeof suggestion.description === "string"
            ? suggestion.description.trim().slice(0, 1000)
            : "";

        const priority = PRIORITIES.has(suggestion.priority) ? suggestion.priority : "medium";

        let estimatedDurationMinutes = Number.isInteger(suggestion.estimated_duration_minutes)
            ? suggestion.estimated_duration_minutes
            : 30;
        estimatedDurationMinutes = Math.max(5, Math.min(480, estimatedDurationMinutes));

        let scheduledDate = isValidDate(suggestion.scheduled_date) ? suggestion.scheduled_date : null;
        let dueDate = isValidDate(suggestion.due_date) ? suggestion.due_date : null;

        // If both dates exist and dueDate < scheduledDate, swap them so date range is valid
        if (scheduledDate && dueDate && dueDate < scheduledDate) {
            const temp = scheduledDate;
            scheduledDate = dueDate;
            dueDate = temp;
        }

        return {
            title: title.slice(0, 200),
            description,
            priority,
            estimated_duration_minutes: estimatedDurationMinutes,
            scheduled_date: scheduledDate,
            due_date: dueDate
        };
    }).filter(Boolean);

    if (suggestions.length === 0) {
        const error = new Error("AI returned no valid tasks");
        error.code = "AI_INVALID_RESPONSE";
        throw error;
    }

    return { suggestions };
}

function buildMockSuggestions(prompt) {
    const title = prompt.trim().replace(/\s+/g, " ").slice(0, 200);
    return {
        suggestions: [{
            title: title || "Clarify the next action",
            description: "Break the request into a concrete first step and review the result.",
            priority: "medium",
            estimated_duration_minutes: 30,
            scheduled_date: null,
            due_date: null
        }]
    };
}

const responseSchema = {
    type: "object",
    properties: {
        suggestions: {
            type: "array",
            maxItems: MAX_SUGGESTIONS,
            items: {
                type: "object",
                properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                    priority: { type: "string", enum: ["low", "medium", "high"] },
                    estimated_duration_minutes: { type: "integer" },
                    scheduled_date: { type: ["string", "null"] },
                    due_date: { type: ["string", "null"] }
                },
                additionalProperties: false,
                required: [
                    "title",
                    "description",
                    "priority",
                    "estimated_duration_minutes",
                    "scheduled_date",
                    "due_date"
                ]
            }
        }
    },
    additionalProperties: false,
    required: ["suggestions"]
};

async function generateTaskSuggestions({ prompt, tasks }) {
    const mode = (process.env.AI_MODE || "mock").toLowerCase();

    if (mode === "mock") {
        return {
            ...validateSuggestions(buildMockSuggestions(prompt)),
            source: "mock"
        };
    }

    if (mode !== "groq") {
        const error = new Error("AI_MODE must be either mock or groq");
        error.code = "AI_CONFIGURATION_ERROR";
        throw error;
    }

    if (!process.env.GROQ_API_KEY) {
        const error = new Error("GROQ_API_KEY is required when AI_MODE=groq");
        error.code = "AI_CONFIGURATION_ERROR";
        throw error;
    }

    const ai = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const taskContext = tasks.length
        ? tasks.map((task) =>
            `- ${task.title} (start: ${task.scheduled_date || "none"}, due: ${task.due_date || "none"})`
        ).join("\n")
        : "No existing incomplete tasks.";
    const today = new Date().toISOString().slice(0, 10);
    const model = process.env.AI_MODEL || "qwen/qwen3.8-27b";

    try {
        let response;
        try {
            response = await ai.chat.completions.create({
                model,
                temperature: 0.2,
                messages: [{
                    role: "user",
                    content: [
                        "You are a task planning assistant. Return only JSON matching the provided schema.",
                        `Today is ${today}. Create actionable task suggestions for this request: ${prompt}`,
                        "Existing incomplete tasks (use only as context and do not duplicate them):",
                        taskContext,
                        `JSON schema: ${JSON.stringify(responseSchema)}`
                    ].join("\n\n")
                }],
                response_format: {
                    type: "json_schema",
                    json_schema: {
                        name: "task_suggestions",
                        strict: true,
                        schema: responseSchema
                    }
                }
            });
        } catch (createError) {
            const errorMsg = String(createError.message || "").toLowerCase();
            // If the model does not support json_schema, fallback to json_object
            if (errorMsg.includes("json_schema") || errorMsg.includes("response_format")) {
                response = await ai.chat.completions.create({
                    model,
                    temperature: 0.2,
                    messages: [{
                        role: "user",
                        content: [
                            "You are a task planning assistant. Return only valid JSON with a 'suggestions' array matching this schema: " + JSON.stringify(responseSchema),
                            `Today is ${today}. Create actionable task suggestions for this request: ${prompt}`,
                            "Existing incomplete tasks (use only as context and do not duplicate them):",
                            taskContext
                        ].join("\n\n")
                    }],
                    response_format: { type: "json_object" }
                });
            } else {
                throw createError;
            }
        }

        return {
            ...validateSuggestions(readJson(response.choices?.[0]?.message?.content)),
            source: "groq"
        };
    } catch (error) {
        if (error.code === "AI_INVALID_RESPONSE") {
            throw error;
        }

        const message = String(error.message || "").toLowerCase();
        const providerError = new Error("The AI provider could not complete the request");
        providerError.code = message.includes("quota") ||
            message.includes("rate") ||
            message.includes("resource exhausted")
            ? "AI_QUOTA_EXHAUSTED"
            : "AI_PROVIDER_ERROR";
        providerError.cause = error;
        throw providerError;
    }
}

module.exports = { generateTaskSuggestions };
