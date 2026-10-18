const pool = require("./db");
const authRoutes = require("./auth");
const authenticateToken = require("./authMiddleware");

const express = require("express");

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
    res.send("Task Manager Backend is running!");
});






app.get("/tasks",authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT *
             FROM tasks
             WHERE user_id = $1
             ORDER BY id ASC`,
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




app.post("/tasks", authenticateToken, async (req, res) => {
    try {
        const { title, completed } = req.body ?? {};

        // Validate title
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

        // Validate completed
        if (
            completed !== undefined &&
            typeof completed !== "boolean"
        ) {
            return res.status(400).json({
                error: "Completed must be true or false"
            });
        }

        // Insert task into PostgreSQL
        const result = await pool.query(
            `INSERT INTO tasks (title, completed, user_id)
            VALUES ($1, $2, $3)
            RETURNING *`,
            [title.trim(), completed ?? false, req.user.id]
        );

        return res.status(201).json(result.rows[0]);

    } catch (error) {
        console.error("Failed to create task:", error.message);

        return res.status(500).json({
            error: "Failed to create task"
        });
    }
});






app.patch("/tasks/:id", authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, completed } = req.body ?? {};

        const fields = [];
        const values = [];

        if (title !== undefined) {
            if (typeof title !== "string" || !title.trim()) {
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

        if (fields.length === 0) {
            return res.status(400).json({
                error: "Provide title or completed to update"
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
});





app.delete("/tasks/:id", authenticateToken, async (req, res) => {
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
});



app.use("/auth", authRoutes);

// Return when client reach and call the unknown route
app.use((req, res) => {
    return res.status(404).json({
        error: "Route not found"
    });
});

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


app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});