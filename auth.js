
const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("./db");
const jwt = require("jsonwebtoken");

const router = express.Router();

router.post("/signup", async (req, res) => {
    try {
        const { email, password } = req.body ?? {};

        // 1. Validate input
        if (
            typeof email !== "string" ||
            typeof password !== "string" ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                error: "Email and password are required"
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        if (
            normalizedEmail.length > 255 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
        ) {
            return res.status(400).json({
                error: "Please provide a valid email"
            });
        }

        if (password.length < 8 || password.length > 72) {
            return res.status(400).json({
                error: "Password must be between 8 and 72 characters"
            });
        }

        // 2. Hash the password
        const passwordHash = await bcrypt.hash(password, 12);

        // 3. Save the user in PostgreSQL
        const result = await pool.query(
            `INSERT INTO users (email, password_hash)
             VALUES ($1, $2)
             RETURNING id, email, created_at`,
            [normalizedEmail, passwordHash]
        );

        // 4. Sign a token for the new user
        const newUser = result.rows[0];

        const token = jwt.sign(
            { userId: newUser.id },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        // 5. Return the newly created account along with the token
        return res.status(201).json({
            message: "Account created successfully",
            token,
            user: {
                id: newUser.id,
                email: newUser.email
            }
        });

    } catch (error) {
        // PostgreSQL unique-constraint violation
        if (error.code === "23505") {
            return res.status(409).json({
                error: "An account with this email already exists"
            });
        }

        console.error("Signup failed:", error.message);

        return res.status(500).json({
            error: "Unable to create account"
        });
    }
});


router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body ?? {};

        if (
            typeof email !== "string" ||
            typeof password !== "string" ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                error: "Email and password are required"
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Find the user by email
        const result = await pool.query(
            `SELECT id, email, password_hash
             FROM users
             WHERE email = $1`,
            [normalizedEmail]
        );

        const user = result.rows[0];

        // Use the same message for unknown email and wrong password
        if (!user) {
            return res.status(401).json({
                error: "Invalid email or password"
            });
        }

        // Compare submitted password with stored hash
        const passwordMatches = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatches) {
            return res.status(401).json({
                error: "Invalid email or password"
            });
        }

        // Create a signed token
        const token = jwt.sign(
            { userId: user.id },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        return res.status(200).json({
            message: "Login successful",
            token,
            user: {
                id: user.id,
                email: user.email
            }
        });

    } catch (error) {
        console.error("Login failed:", error.message);

        return res.status(500).json({
            error: "Unable to log in"
        });
    }
});

module.exports = router;
