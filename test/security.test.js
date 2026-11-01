const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const jwt = require("jsonwebtoken");

// Ensure test environment JWT secret
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-super-secret-jwt-key-for-security-tests";
process.env.TEST_NO_RATE_LIMIT = "false";

const app = require("../server.js");
const { authRateLimiter } = require("../server.js");
const { generateTaskSuggestions } = require("../aiService.js");

// Helper to simulate Express request/response in-memory
function makeRequest(app, method, url, { headers = {}, body = null } = {}) {
    return new Promise((resolve, reject) => {
        const req = new EventEmitter();
        req.method = method.toUpperCase();
        req.url = url;
        req.headers = { host: "localhost", ...headers };
        req.body = body;
        req.socket = { remoteAddress: headers["x-forwarded-for"] || "127.0.0.1" };

        const res = new EventEmitter();
        res.statusCode = 200;
        res.headers = {};
        res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
        res.getHeader = (k) => res.headers[k.toLowerCase()];
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (data) => {
            resolve({ status: res.statusCode, headers: res.headers, body: data });
            return res;
        };
        res.send = (data) => {
            resolve({ status: res.statusCode, headers: res.headers, text: data });
            return res;
        };
        res.end = (data) => {
            resolve({ status: res.statusCode, headers: res.headers, text: data });
            return res;
        };

        try {
            app.handle(req, res);
        } catch (err) {
            reject(err);
        }
    });
}

test("1. Security Headers are correctly sent on backend responses", async () => {
    const res = await makeRequest(app, "GET", "/");
    assert.equal(res.status, 200);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["x-frame-options"], "DENY");
    assert.equal(res.headers["referrer-policy"], "strict-origin-when-cross-origin");
    assert.match(res.headers["permissions-policy"], /camera=\(\)/);
});

test("2. CORS origin validation and preflight safety", async () => {
    // Allowed localhost
    const resLocal = await makeRequest(app, "OPTIONS", "/tasks", {
        headers: { origin: "http://localhost:5173", "access-control-request-method": "GET" }
    });
    assert.equal(resLocal.headers["access-control-allow-origin"], "http://localhost:5173");

    // Allowed Vercel deployment preview
    const resVercel = await makeRequest(app, "OPTIONS", "/tasks", {
        headers: { origin: "https://task-manager-test-pr-12.vercel.app", "access-control-request-method": "GET" }
    });
    assert.equal(resVercel.headers["access-control-allow-origin"], "https://task-manager-test-pr-12.vercel.app");

    // Disallowed origin should NOT crash with 500 error
    const resDisallowed = await makeRequest(app, "OPTIONS", "/tasks", {
        headers: { origin: "https://attacker-controlled-site.com", "access-control-request-method": "GET" }
    });
    assert.notEqual(resDisallowed.status, 500);
    assert.equal(resDisallowed.headers["access-control-allow-origin"], undefined);
});

test("3. Route normalization supports /api prefix transparently", async () => {
    const resRoot = await makeRequest(app, "GET", "/");
    assert.equal(resRoot.status, 200);

    const resApi = await makeRequest(app, "GET", "/api");
    assert.equal(resApi.status, 200);
    assert.equal(resApi.text, "Task Manager Backend is running!");

    const resTasks = await makeRequest(app, "GET", "/api/tasks");
    assert.equal(resTasks.status, 401);
    assert.equal(resTasks.body.error, "Authentication token required");
});

test("4. Authentication input validation and password rules", async () => {
    // Missing email/password
    const resEmpty = await makeRequest(app, "POST", "/auth/signup", { body: {} });
    assert.equal(resEmpty.status, 400);

    // Invalid email format
    const resBadEmail = await makeRequest(app, "POST", "/auth/signup", {
        body: { email: "not-an-email", password: "ValidPassword123" }
    });
    assert.equal(resBadEmail.status, 400);
    assert.match(resBadEmail.body.error, /valid email/i);

    // Password too short (< 8 chars)
    const resShortPass = await makeRequest(app, "POST", "/auth/signup", {
        body: { email: "user@example.com", password: "short" }
    });
    assert.equal(resShortPass.status, 400);
    assert.match(resShortPass.body.error, /between 8 and 72/i);

    // Login missing fields
    const resLoginMissing = await makeRequest(app, "POST", "/auth/login", { body: {} });
    assert.equal(resLoginMissing.status, 400);
});

test("5. Authentication rate limiter blocks brute force attacks (HTTP 429)", async () => {
    const limiter = authRateLimiter(3, 60000); // 3 attempts per minute for test
    const testIp = "192.0.2.100";

    const simulateAttempt = () => {
        return new Promise((resolve) => {
            const req = {
                headers: { "x-forwarded-for": testIp },
                socket: { remoteAddress: testIp }
            };
            const res = {
                statusCode: 200,
                headers: {},
                setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
                status(code) { this.statusCode = code; return this; },
                json(data) { resolve({ status: this.statusCode, body: data, headers: this.headers }); }
            };
            limiter(req, res, () => resolve({ status: 200 }));
        });
    };

    assert.equal((await simulateAttempt()).status, 200);
    assert.equal((await simulateAttempt()).status, 200);
    assert.equal((await simulateAttempt()).status, 200);

    // 4th attempt must be rejected with 429
    const blocked = await simulateAttempt();
    assert.equal(blocked.status, 429);
    assert.match(blocked.body.error, /Too many authentication attempts/);
    assert.ok(blocked.headers["retry-after"]);
});

test("6. Protected endpoints reject missing and invalid tokens", async () => {
    // Missing Authorization header
    const resNoAuth = await makeRequest(app, "GET", "/tasks");
    assert.equal(resNoAuth.status, 401);
    assert.equal(resNoAuth.body.error, "Authentication token required");

    // Invalid format
    const resBadFormat = await makeRequest(app, "GET", "/tasks", {
        headers: { authorization: "Basic 12345" }
    });
    assert.equal(resBadFormat.status, 401);

    // Invalid token signature
    const resBadSig = await makeRequest(app, "GET", "/tasks", {
        headers: { authorization: "Bearer invalid.jwt.token" }
    });
    assert.equal(resBadSig.status, 401);
    assert.equal(resBadSig.body.error, "Invalid or expired token");

    // Expired token
    const expiredToken = jwt.sign(
        { userId: 999 },
        process.env.JWT_SECRET,
        { expiresIn: "-1s" }
    );
    const resExpired = await makeRequest(app, "GET", "/tasks", {
        headers: { authorization: `Bearer ${expiredToken}` }
    });
    assert.equal(resExpired.status, 401);
    assert.equal(resExpired.body.error, "Invalid or expired token");
});

test("7. Input validation on Task endpoints", async () => {
    const validToken = jwt.sign({ userId: 1 }, process.env.JWT_SECRET, { expiresIn: "1h" });
    const authHeaders = { authorization: `Bearer ${validToken}` };

    // Empty title
    const resEmptyTitle = await makeRequest(app, "POST", "/tasks", {
        headers: authHeaders,
        body: { title: "   " }
    });
    assert.equal(resEmptyTitle.status, 400);
    assert.match(resEmptyTitle.body.error, /Title must be a non-empty string/);

    // Title exceeding 200 characters
    const resLongTitle = await makeRequest(app, "POST", "/tasks", {
        headers: authHeaders,
        body: { title: "A".repeat(201) }
    });
    assert.equal(resLongTitle.status, 400);
    assert.match(resLongTitle.body.error, /cannot exceed 200 characters/);

    // Invalid date
    const resInvalidDate = await makeRequest(app, "POST", "/tasks", {
        headers: authHeaders,
        body: { title: "Valid Title", scheduled_date: "2026-99-99" }
    });
    assert.equal(resInvalidDate.status, 400);
    assert.match(resInvalidDate.body.error, /must be a valid YYYY-MM-DD date/);

    // Invalid Task ID (non-numeric)
    const resBadId = await makeRequest(app, "PATCH", "/tasks/abc", {
        headers: authHeaders,
        body: { title: "Updated" }
    });
    assert.equal(resBadId.status, 400);
    assert.match(resBadId.body.error, /Task ID must be a positive integer/);

    // Negative ID
    const resNegId = await makeRequest(app, "DELETE", "/tasks/-5", {
        headers: authHeaders
    });
    assert.equal(resNegId.status, 400);
});

test("8. AI task planner handles mock mode securely", async () => {
    process.env.AI_MODE = "mock";
    const result = await generateTaskSuggestions({
        prompt: "Prepare security report and audit tests",
        tasks: []
    });

    assert.equal(result.source, "mock");
    assert.ok(Array.isArray(result.suggestions));
    assert.ok(result.suggestions.length > 0);
    const suggestion = result.suggestions[0];
    assert.equal(typeof suggestion.title, "string");
    assert.equal(typeof suggestion.description, "string");
    assert.ok(["low", "medium", "high"].includes(suggestion.priority));
    assert.ok(suggestion.estimated_duration_minutes >= 5);
});

