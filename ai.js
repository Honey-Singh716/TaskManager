const express = require("express");
const pool = require("./db");
const authenticateToken = require("./authMiddleware");
const { generateTaskSuggestions } = require("./aiService");

const router = express.Router();

router.post("/task-suggestions", authenticateToken, async (req, res) => {
    const { prompt } = req.body ?? {};

    if (typeof prompt !== "string" || !prompt.trim()) {
        return res.status(400).json({ error: "Prompt must be a non-empty string" });
    }

    if (prompt.trim().length > 4000) {
        return res.status(400).json({ error: "Prompt cannot exceed 4000 characters" });
    }

    try {
        const taskResult = await pool.query(
            `SELECT title, scheduled_date, due_date
             FROM tasks
             WHERE user_id = $1 AND completed = FALSE
             ORDER BY due_date ASC NULLS LAST, scheduled_date ASC NULLS LAST
             LIMIT 50`,
            [req.user.id]
        );
        const result = await generateTaskSuggestions({
            prompt: prompt.trim(),
            tasks: taskResult.rows
        });

        return res.status(200).json(result);
    } catch (error) {
        console.error("Task suggestion failed:", error.message);

        if (error.code === "AI_CONFIGURATION_ERROR") {
            return res.status(503).json({ error: error.message });
        }
        if (error.code === "AI_QUOTA_EXHAUSTED") {
            return res.status(429).json({
                error: "AI quota or rate limit reached. Try again later or use mock mode."
            });
        }
        if (error.code === "AI_INVALID_RESPONSE") {
            return res.status(502).json({ error: "AI returned an invalid task plan" });
        }

        return res.status(502).json({ error: "AI task planning is temporarily unavailable" });
    }
});

module.exports = router;
