# Task Manager REST API

A RESTful Task Manager API built with **Node.js, Express.js, and PostgreSQL**, featuring user registration, secure password hashing, JWT-based authentication, and user-specific task management.

## Features

- **User Registration:** Create an account using an email and password.
- **User Login:** Authenticate users and issue JWT access tokens.
- **Password Security:** Hash passwords using bcrypt before storing them.
- **Task Management:** Create, retrieve, update, and delete tasks.
- **Protected Routes:** Require authentication for task operations.
- **User-specific Access:** Users can access and modify only their own tasks.
- **Input Validation:** Validate request data before processing it.
- **PostgreSQL Database:** Store user accounts and tasks persistently.
- **AI Task Assistant:** Generate authenticated, validated task suggestions with a mock mode
  for development and optional Groq integration.

## Tech Stack

| Technology | Purpose |
|---|---|
| Node.js | JavaScript runtime |
| Express.js | HTTP server and REST API routing |
| PostgreSQL | Relational database |
| `pg` | PostgreSQL client for Node.js |
| `bcryptjs` | Password hashing |
| `jsonwebtoken` | JWT creation and verification |
| `dotenv` | Environment variable configuration |
| `groq-sdk` | Optional server-side Groq task planning |
| Postman | API testing |

## Project Structure

```text
TaskManager/
├── auth.js
├── authMiddleware.js
├── ai.js
├── aiService.js
├── db.js
├── server.js
├── test-db.js
├── package.json
├── package-lock.json
├── .env.example
├── .gitignore
└── README.md
```

## Prerequisites

Install the following before running the project:

- Node.js and npm
- PostgreSQL
- Postman (recommended for API testing)

## Installation and Setup

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/task-manager-api.git
cd task-manager-api
```

Replace `YOUR_USERNAME` with your GitHub username.

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root using `.env.example` as a template.

Example:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=your_database_name
DB_USER=your_database_user
DB_PASSWORD=your_database_password
JWT_SECRET=replace_with_a_long_random_secret
FRONTEND_ORIGINS=https://task-manager-honey-singh716s-projects.vercel.app
AI_MODE=mock
AI_MODEL=qwen/qwen3.8-27b
# Required only when AI_MODE=groq
GROQ_API_KEY=
```

Use your actual local PostgreSQL credentials. Generate a strong, private JWT secret.

**Never commit your `.env` file or share real credentials publicly.**

`AI_MODE=mock` is the safe default and makes no external AI calls. Set
`AI_MODE=groq` and provide `GROQ_API_KEY` only when you want to use Groq. The
key is read by the backend only and is never sent to the frontend. `AI_MODEL`
defaults to `qwen/qwen3.8-27b`; it can be changed to another Groq model
that supports JSON schema output.

`FRONTEND_ORIGINS` is a comma-separated list of browser origins allowed to call
the backend. Add the exact Vercel production URL here when it changes; do not
use a wildcard for authenticated requests.

### 4. Create the database tables

Create a PostgreSQL database, connect to it, and run the following SQL:

```sql
CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tasks (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id BIGINT NOT NULL REFERENCES users(id)
);
```

If the tables already exist, do not run the creation statements again. Check your existing schema first.

### 5. Start the server

```bash
npm start
```

The API is expected to run at:

`http://localhost:3000`

Make sure your `package.json` contains a `start` script that runs `server.js`. If it does not, add:

```json
"scripts": {
  "start": "node server.js"
}
```

## API Endpoints

Base URL: `http://localhost:3000`

| Method | Endpoint | Description | Authentication |
|---|---|---|---|
| POST | `/auth/signup` | Register a user | Not required |
| POST | `/auth/login` | Log in and receive a JWT | Not required |
| GET | `/tasks` | Retrieve the logged-in user's tasks | Required |
| POST | `/tasks` | Create a task | Required |
| PATCH | `/tasks/:id` | Update a task | Required |
| DELETE | `/tasks/:id` | Delete a task | Required |
| POST | `/ai/task-suggestions` | Generate a task preview from natural language | Required |

## Example Requests

### Register a user

`POST /auth/signup`

```json
{
  "email": "rahul@example.com",
  "password": "Rahul@12345"
}
```

### Log in

`POST /auth/login`

```json
{
  "email": "rahul@example.com",
  "password": "Rahul@12345"
}
```

The login response contains an access token. Copy the token and use it in the Authorization header for protected endpoints:

```http
Authorization: Bearer YOUR_JWT_TOKEN
```

### Create a task

`POST /tasks`

```json
{
  "title": "Learn REST APIs",
  "completed": false
}
```

### Retrieve tasks

`GET /tasks`

Include the Bearer token in the Authorization header.

### Update a task

`PATCH /tasks/1`

```json
{
  "completed": true
}
```

Replace `1` with an actual task ID belonging to the logged-in user.

### Delete a task

`DELETE /tasks/1`

Replace `1` with the task ID you want to delete.

### AI task assistant

After signing in, use the AI Task Assistant panel in the existing React application
to describe a goal. The backend loads up to 50 of the authenticated user's
incomplete task titles and dates as planning context, then returns validated JSON:

```json
{
  "suggestions": [
    {
      "title": "Finish backend authentication",
      "description": "Complete and verify the authentication flow.",
      "priority": "high",
      "estimated_duration_minutes": 90,
      "scheduled_date": "2026-10-27",
      "due_date": "2026-10-30"
    }
  ],
  "source": "mock"
}
```

Suggestions are only previews. The user must edit or explicitly approve them
before the frontend calls the existing `POST /tasks` endpoint. Because the current
schema stores only title and dates, description, priority, and duration remain
planning metadata until a later schema-backed phase.

Run the backend from the repository root:

```bash
npm start
```

Run the existing frontend separately:

```bash
cd frontend
npm install
npm run dev
```

## Authentication and Authorization

The authentication flow is:

1. A user registers with an email and password.
2. The server hashes the password using bcrypt.
3. During login, the server verifies the password and generates a JWT.
4. The client sends the JWT with protected API requests.
5. Authentication middleware verifies the token.
6. Task queries use the authenticated user's ID to restrict access to their own tasks.

```text
Client
  |
  v
Login API
  |
  v
Verify Credentials
  |
  v
Generate JWT
  |
  v
Protected Task API
  |
  v
Verify JWT
  |
  v
Check Task Ownership
  |
  v
PostgreSQL
```

## Testing

Use Postman to test the API.

Recommended test cases:

- Successful signup and login.
- Duplicate email registration.
- Login with incorrect credentials.
- Accessing task routes without a token.
- Creating, retrieving, updating, and deleting tasks.
- Attempting to modify another user's task.
- Sending invalid or missing request fields.

## Future Improvements

- Automated API tests.
- Pagination, filtering, and sorting.
- Improved validation and centralized error handling.
- Rate limiting and additional security controls.
- Frontend using React, TypeScript, and Tailwind CSS.
- Deployment with a hosted PostgreSQL database.
- Refresh-token support where appropriate.

## Learning Goals

This project demonstrates practical understanding of REST API development, HTTP methods, database integration, authentication, authorization, password hashing, and environment-based configuration.

## License

Choose and add a license if you intend to distribute or reuse this project publicly.
