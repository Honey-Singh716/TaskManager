
const cors = require("cors");
const pool = require("./db");
const authRoutes = require("./auth");
const authenticateToken = require("./authMiddleware");
const express = require("express");

const app = express();

app.use(
    cors({
        origin: "http://localhost:5173"
    })
);

app.use(express.json({ limit: "100kb" }));

app.get("/", (req, res) => {
    res.send("Task Manager Backend is running!");
});

function validateTaskId(req, res, next) {
    const { id } = req.params;

    if (!/^[1-9]\d*$/.test(id)) {
        return res.status(400).json({
            error: "Task ID must be a positive integer"
        });
    }

    next();
}

// Accept a real YYYY-MM-DD date, or null to clear a date.
function isValidDate(value) {
    if (typeof value !== "string") return false;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}

function validateOptionalDate(value, fieldName, res) {
    if (value !== null && !isValidDate(value)) {
        res.status(400).json({
            error: `${fieldName} must be a valid YYYY-MM-DD date or null`
        });

        return false;
    }

    return true;
}

// GET all tasks belonging to the logged-in user
app.get("/tasks", authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT *
             FROM tasks
             WHERE user_id = $1
             ORDER BY
                scheduled_date ASC NULLS LAST,
                id ASC`,
            [req.user.id]
        );

        return res.status(200).json(result.rows);
    } catch (error) {
        console.error("Failed to fetch tasks:", error.message);

        return res.status(500).json({
            error: "Failed to fetch tasks"
        });
    }
});

// CREATE a task
app.post("/tasks", authenticateToken, async (req, res) => {
    try {
        const {
            title,
            completed,
            scheduled_date,
            due_date
        } = req.body ?? {};

        if (typeof title !== "string" || title.trim() === "") {
            return res.status(400).json({
                error: "Title must be a non-empty string"
            });
        }

        if (title.trim().length > 200) {
            return res.status(400).json({
                error: "Title cannot exceed 200 characters"
            });
        }

        if (
            completed !== undefined &&
            typeof completed !== "boolean"
        ) {
            return res.status(400).json({
                error: "Completed must be true or false"
            });
        }

        if (
            scheduled_date !== undefined &&
            !validateOptionalDate(scheduled_date, "Scheduled date", res)
        ) {
            return;
        }

        if (
            due_date !== undefined &&
            !validateOptionalDate(due_date, "Due date", res)
        ) {
            return;
        }

        const result = await pool.query(
            `INSERT INTO tasks
                (title, completed, user_id, scheduled_date, due_date)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [
                title.trim(),
                completed ?? false,
                req.user.id,
                scheduled_date ?? null,
                due_date ?? null
            ]
        );

        return res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error("Failed to create task:", error.message);

        return res.status(500).json({
            error: "Failed to create task"
        });
    }
});

// UPDATE title, completion status, scheduled date, and/or due date
app.patch(
    "/tasks/:id",
    authenticateToken,
    validateTaskId,
    async (req, res) => {
        try {
            const { id } = req.params;

            const {
                title,
                completed,
                scheduled_date,
                due_date
            } = req.body ?? {};

            const fields = [];
            const values = [];

            if (title !== undefined) {
                if (
                    typeof title !== "string" ||
                    title.trim() === ""
                ) {
                    return res.status(400).json({
                        error: "Title must be a non-empty string"
                    });
                }

                if (title.trim().length > 200) {
                    return res.status(400).json({
                        error: "Title cannot exceed 200 characters"
                    });
                }

                values.push(title.trim());
                fields.push(`title = $${values.length}`);
            }

            if (completed !== undefined) {
                if (typeof completed !== "boolean") {
                    return res.status(400).json({
                        error: "Completed must be true or false"
                    });
                }

                values.push(completed);
                fields.push(`completed = $${values.length}`);
            }

            if (scheduled_date !== undefined) {
                if (
                    !validateOptionalDate(
                        scheduled_date,
                        "Scheduled date",
                        res
                    )
                ) {
                    return;
                }

                values.push(scheduled_date);
                fields.push(`scheduled_date = $${values.length}`);
            }

            if (due_date !== undefined) {
                if (
                    !validateOptionalDate(due_date, "Due date", res)
                ) {
                    return;
                }

                values.push(due_date);
                fields.push(`due_date = $${values.length}`);
            }

            if (fields.length === 0) {
                return res.status(400).json({
                    error: "Provide at least one field to update"
                });
            }

            values.push(id);
            const idParam = values.length;

            values.push(req.user.id);
            const userParam = values.length;

            const query = `
                UPDATE tasks
                SET ${fields.join(", ")}
                WHERE id = $${idParam}
                  AND user_id = $${userParam}
                RETURNING *
            `;

            const result = await pool.query(query, values);

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: "Task not found"
                });
            }

            return res.status(200).json(result.rows[0]);
        } catch (error) {
            console.error("Update task failed:", error.message);

            return res.status(500).json({
                error: "Failed to update task"
            });
        }
    }
);

// DELETE a task
app.delete(
    "/tasks/:id",
    authenticateToken,
    validateTaskId,
    async (req, res) => {
        try {
            const { id } = req.params;

            const result = await pool.query(
                `DELETE FROM tasks
                 WHERE id = $1 AND user_id = $2
                 RETURNING *`,
                [id, req.user.id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: "Task not found"
                });
            }

            return res.status(200).json({
                message: "Task deleted successfully",
                task: result.rows[0]
            });
        } catch (error) {
            console.error("Delete task failed:", error.message);

            return res.status(500).json({
                error: "Failed to delete task"
            });
        }
    }
);

// Keep existing authentication routes
app.use("/auth", authRoutes);

// Invalid JSON and other errors
app.use((err, req, res, next) => {
    console.error("Request error:", err.message);

    if (err.type === "entity.parse.failed") {
        return res.status(400).json({
            error: "Invalid JSON body"
        });
    }

    return res.status(500).json({
        error: "Internal server error"
    });
});

// Unknown routes
app.use((req, res) => {
    return res.status(404).json({
        error: "Route not found"
    });
});

app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});
