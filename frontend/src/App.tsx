
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api";

type Task = {
  id: number;
  title: string;
  completed: boolean;
  scheduled_date: string | null;
  due_date: string | null;
};

type TaskSuggestion = {
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  estimated_duration_minutes: number;
  scheduled_date: string | null;
  due_date: string | null;
};

type AuthResponse = {
  token?: string;
  email?: string;
  user?: {
    email?: string;
  };
  error?: string;
};

type TaskFilter = "all" | "pending" | "completed";

const toDateString = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
};

const todayISO = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(today.getDate()).padStart(2, "0")}`;
};

const toISODate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;

const formatDate = (value: string | null | undefined) => {
  const str = toDateString(value);
  if (!str) return "Not set";
  const [year, month, day] = str.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const formatShortDate = (value: string | null | undefined) => {
  const str = toDateString(value);
  if (!str) return "";
  const [year, month, day] = str.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
};

const monthName = (date: Date) =>
  date.toLocaleDateString(undefined, { month: "long", year: "numeric" });

/**
 * Determines whether an incomplete task is active on the given date (YYYY-MM-DD).
 * Rules:
 * - Completed tasks never show on any calendar date.
 * - Both scheduled_date and due_date: active range is scheduled_date through due_date inclusive.
 * - If due_date < scheduled_date: safely and consistently active only on individual dates, never invert a range.
 * - Only scheduled_date: single-day task on scheduled_date.
 * - Only due_date: single-day task on due_date.
 * - Neither date: not shown on the calendar.
 */
const isTaskActiveOnDate = (task: Task, dateStr: string): boolean => {
  if (task.completed) return false;

  const start = toDateString(task.scheduled_date);
  const due = toDateString(task.due_date);

  if (start && due) {
    if (start <= due) {
      return dateStr >= start && dateStr <= due;
    }
    // If due date is earlier than scheduled date, do not invent a valid range.
    return dateStr === start || dateStr === due;
  }

  if (start) {
    return dateStr === start;
  }

  if (due) {
    return dateStr === due;
  }

  return false;
};

const isTaskDueOnDate = (task: Task, dateStr: string): boolean => {
  if (task.completed) return false;
  const due = toDateString(task.due_date);
  return due === dateStr;
};

const isTaskStartingOnDate = (task: Task, dateStr: string): boolean => {
  if (task.completed) return false;
  const start = toDateString(task.scheduled_date);
  return start === dateStr;
};

function App() {
  const [token, setToken] = useState(
    () => sessionStorage.getItem("token") || ""
  );
  const [userEmail, setUserEmail] = useState(
    () => sessionStorage.getItem("userEmail") || ""
  );

  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [newScheduledDate, setNewScheduledDate] = useState(todayISO());
  const [newDueDate, setNewDueDate] = useState("");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editScheduledDate, setEditScheduledDate] = useState("");
  const [editDueDate, setEditDueDate] = useState("");

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });

  const [loading, setLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [suggestions, setSuggestions] = useState<TaskSuggestion[]>([]);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantSource, setAssistantSource] = useState<"mock" | "groq" | null>(
    null
  );
  const [approvingSuggestions, setApprovingSuggestions] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadTasks = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    setError("");

    try {
      const data = await apiRequest("/tasks", {}, token);
      const rawTasks = Array.isArray(data) ? data : data.tasks || [];
      const normalizedTasks: Task[] = rawTasks.map((t: any) => ({
        ...t,
        id: Number(t.id),
        scheduled_date: toDateString(t.scheduled_date),
        due_date: toDateString(t.due_date),
        completed: Boolean(t.completed),
      }));
      setTasks(normalizedTasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load tasks.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      void loadTasks();
    } else {
      setTasks([]);
    }
  }, [token, loadTasks]);

  const handleAuth = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setAuthLoading(true);

    try {
      const endpoint =
        authMode === "signup" ? "/auth/signup" : "/auth/login";

      const data: AuthResponse = await apiRequest(endpoint, {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (!data.token) {
        throw new Error(
          "Authentication succeeded without a token. Check the response from your backend."
        );
      }

      const resolvedEmail = data.user?.email || data.email || email.trim();

      sessionStorage.setItem("token", data.token);
      sessionStorage.setItem("userEmail", resolvedEmail);

      setToken(data.token);
      setUserEmail(resolvedEmail);
      setPassword("");
      setNotice(
        authMode === "signup"
          ? "Account created successfully!"
          : "Welcome back!"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = () => {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("userEmail");
    setToken("");
    setUserEmail("");
    setTasks([]);
    setError("");
    setNotice("");
    setEditingId(null);
    setSuggestions([]);
    setAssistantPrompt("");
  };

  const addTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = newTitle.trim();

    if (!title) {
      setError("Please enter a task title.");
      return;
    }

    setError("");
    setNotice("");

    try {
      const created = await apiRequest(
        "/tasks",
        {
          method: "POST",
          body: JSON.stringify({
            title,
            completed: false,
            scheduled_date: newScheduledDate || null,
            due_date: newDueDate || null,
          }),
        },
        token
      );

      const rawTask = created.task || created;
      const newTask: Task = {
        ...rawTask,
        id: Number(rawTask.id),
        scheduled_date: toDateString(rawTask.scheduled_date),
        due_date: toDateString(rawTask.due_date),
        completed: Boolean(rawTask.completed),
      };

      setTasks((current) => [...current, newTask]);
      setNewTitle("");
      const targetDate = newScheduledDate || newDueDate || selectedDate;
      setNewScheduledDate(targetDate);
      setNewDueDate("");
      setSelectedDate(targetDate);
      if (targetDate) {
        const [y, m] = targetDate.split("-").map(Number);
        setVisibleMonth(new Date(y, m - 1, 1));
      }
      setNotice("Task added successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add task.");
    }
  };

  const requestSuggestions = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!assistantPrompt.trim()) {
      setError("Describe what you want to accomplish first.");
      return;
    }

    setAssistantLoading(true);
    setError("");
    setNotice("");

    try {
      const result = await apiRequest(
        "/ai/task-suggestions",
        {
          method: "POST",
          body: JSON.stringify({ prompt: assistantPrompt.trim() }),
        },
        token
      );
      setSuggestions(Array.isArray(result.suggestions) ? result.suggestions : []);
      setAssistantSource(result.source === "groq" ? "groq" : "mock");
      if (!result.suggestions?.length) {
        setNotice("The assistant did not find any actionable tasks.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate suggestions.");
    } finally {
      setAssistantLoading(false);
    }
  };

  const updateSuggestion = (
    index: number,
    field: "title" | "scheduled_date" | "due_date",
    value: string
  ) => {
    setSuggestions((current) =>
      current.map((suggestion, suggestionIndex) => {
        if (suggestionIndex !== index) return suggestion;
        if (field === "title") return { ...suggestion, title: value };
        return { ...suggestion, [field]: value || null };
      })
    );
  };

  const approveSuggestions = async () => {
    if (!suggestions.length) return;

    setApprovingSuggestions(true);
    setError("");
    setNotice("");

    try {
      const createdTasks: Task[] = [];
      for (const suggestion of suggestions) {
        const created = await apiRequest(
          "/tasks",
          {
            method: "POST",
            body: JSON.stringify({
              title: suggestion.title.trim(),
              completed: false,
              scheduled_date: suggestion.scheduled_date,
              due_date: suggestion.due_date,
            }),
          },
          token
        );
        const rawTask = created.task || created;
        createdTasks.push({
          ...rawTask,
          id: Number(rawTask.id),
          scheduled_date: toDateString(rawTask.scheduled_date),
          due_date: toDateString(rawTask.due_date),
          completed: Boolean(rawTask.completed),
        });
      }

      setTasks((current) => [...current, ...createdTasks]);
      setSuggestions([]);
      setNotice(`${createdTasks.length} approved task${createdTasks.length === 1 ? "" : "s"} added.`);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Approval stopped before all tasks were added: ${err.message}`
          : "Approval could not be completed."
      );
    } finally {
      setApprovingSuggestions(false);
    }
  };

  const startEditing = (task: Task) => {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditScheduledDate(task.scheduled_date || "");
    setEditDueDate(task.due_date || "");
    setError("");
    setNotice("");
  };

  const saveEdit = async (id: number) => {
    const title = editTitle.trim();

    if (!title) {
      setError("Task title cannot be empty.");
      return;
    }

    setError("");
    setNotice("");

    try {
      const updated = await apiRequest(
        `/tasks/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            title,
            scheduled_date: editScheduledDate || null,
            due_date: editDueDate || null,
          }),
        },
        token
      );

      const rawTask = updated.task || updated;
      const updatedTask: Task = {
        ...rawTask,
        id: Number(rawTask.id),
        scheduled_date: toDateString(rawTask.scheduled_date),
        due_date: toDateString(rawTask.due_date),
        completed: Boolean(rawTask.completed),
      };

      setTasks((current) =>
        current.map((task) =>
          task.id === id ? { ...task, ...updatedTask } : task
        )
      );
      setEditingId(null);
      setNotice("Task updated successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update task.");
    }
  };

  const toggleTask = async (task: Task) => {
    setError("");
    setNotice("");

    const nextCompleted = !task.completed;

    try {
      const updated = await apiRequest(
        `/tasks/${task.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ completed: nextCompleted }),
        },
        token
      );

      const rawTask = updated.task || updated;
      const updatedTask: Task = {
        ...rawTask,
        id: Number(rawTask.id),
        scheduled_date: toDateString(rawTask.scheduled_date),
        due_date: toDateString(rawTask.due_date),
        completed: Boolean(rawTask.completed),
      };

      setTasks((current) =>
        current.map((item) =>
          item.id === task.id ? { ...item, ...updatedTask } : item
        )
      );

      if (nextCompleted) {
        setNotice(`Task "${task.title}" completed. Removed from calendar.`);
      } else {
        setNotice(`Task "${task.title}" marked as pending. Restored to calendar.`);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update task status."
      );
    }
  };

  const deleteTask = async (id: number) => {
    if (!window.confirm("Are you sure you want to delete this task?")) return;

    setError("");
    setNotice("");

    try {
      await apiRequest(`/tasks/${id}`, { method: "DELETE" }, token);
      setTasks((current) => current.filter((task) => task.id !== id));

      if (editingId === id) setEditingId(null);
      setNotice("Task deleted successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete task.");
    }
  };

  const completedCount = tasks.filter((task) => task.completed).length;
  const pendingCount = tasks.length - completedCount;
  const progress = tasks.length
    ? Math.round((completedCount / tasks.length) * 100)
    : 0;

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const matchesSearch = task.title
        .toLowerCase()
        .includes(search.toLowerCase());

      const matchesFilter =
        filter === "all" ||
        (filter === "pending" && !task.completed) ||
        (filter === "completed" && task.completed);

      return matchesSearch && matchesFilter;
    });
  }, [tasks, search, filter]);

  const calendarCells = useMemo(() => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const firstDayOffset = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    return [
      ...Array.from({ length: firstDayOffset }, () => null),
      ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
    ];
  }, [visibleMonth]);

  const incompleteTasks = useMemo(
    () => tasks.filter((task) => !task.completed),
    [tasks]
  );

  const selectedDateTasks = useMemo(() => {
    return tasks
      .filter((task) => isTaskActiveOnDate(task, selectedDate))
      .sort((a, b) => {
        const aDueToday = toDateString(a.due_date) === selectedDate;
        const bDueToday = toDateString(b.due_date) === selectedDate;
        if (aDueToday && !bDueToday) return -1;
        if (!aDueToday && bDueToday) return 1;
        return a.id - b.id;
      });
  }, [tasks, selectedDate]);

  const goToMonth = (offset: number) => {
    setVisibleMonth(
      (current) =>
        new Date(current.getFullYear(), current.getMonth() + offset, 1)
    );
  };

  const selectCalendarDay = (day: number) => {
    const date = toISODate(
      new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day)
    );
    setSelectedDate(date);
    setError("");
    setNotice("");
  };

  if (!token) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
        <div className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500 text-3xl shadow-lg shadow-indigo-500/20">
              ✓
            </div>
            <h1 className="text-3xl font-bold tracking-tight">TaskFlow</h1>
            <p className="mt-2 text-slate-400">
              Organize your tasks. Make every day count.
            </p>
          </div>

          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl sm:p-8">
            <div className="mb-6 grid grid-cols-2 rounded-xl bg-slate-800 p-1">
              <button
                type="button"
                onClick={() => {
                  setAuthMode("login");
                  setError("");
                }}
                className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                  authMode === "login"
                    ? "bg-indigo-500 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode("signup");
                  setError("");
                }}
                className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                  authMode === "signup"
                    ? "bg-indigo-500 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Sign up
              </button>
            </div>

            <h2 className="text-xl font-bold">
              {authMode === "login" ? "Welcome back" : "Create your account"}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {authMode === "login"
                ? "Log in to see your tasks."
                : "Sign up to start managing your tasks."}
            </p>

            <form onSubmit={handleAuth} className="mt-6 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Email
                </label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Password
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete={
                    authMode === "login" ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              {error && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={authLoading}
                className="w-full rounded-xl bg-indigo-500 px-4 py-3 font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {authLoading
                  ? "Please wait..."
                  : authMode === "login"
                    ? "Login"
                    : "Create account"}
              </button>
            </form>
          </section>
          <p className="mt-6 text-center text-xs text-slate-500">
            Your tasks are private to your account.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/95">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500 text-xl font-bold">
              ✓
            </div>
            <div>
              <h1 className="text-xl font-bold">TaskFlow</h1>
              <p className="text-xs text-slate-400">Your personal workspace</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium">{userEmail || "Your account"}</p>
              <p className="text-xs text-slate-400">Signed in</p>
            </div>
            <button
              type="button"
              onClick={logout}
              className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-red-400 hover:text-red-300"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError("")}
              className="font-bold"
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        {notice && (
          <div className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice("")}
              className="font-bold"
              aria-label="Dismiss message"
            >
              ×
            </button>
          </div>
        )}

        <div className="mb-8">
          <p className="text-sm font-medium text-indigo-300">
            YOUR PRODUCTIVITY SPACE
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            Your tasks, in control.
          </h2>
          <p className="mt-2 text-slate-400">
            Plan your schedule, track deadlines, and keep moving forward.
          </p>
        </div>

        <section className="mb-8 rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-indigo-300">
                AI task assistant
              </p>
              <h3 className="mt-1 text-xl font-bold">Turn a goal into a task plan</h3>
              <p className="mt-1 max-w-2xl text-sm text-slate-400">
                Describe your goal in plain language. Review and edit the proposed tasks
                before anything is added to your workspace.
              </p>
            </div>
            {assistantSource && (
              <span className="rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1 text-xs text-slate-400">
                {assistantSource === "mock" ? "Mock assistant" : "Groq assistant"}
              </span>
            )}
          </div>

          <form onSubmit={requestSuggestions} className="mt-5 flex flex-col gap-3 sm:flex-row">
            <textarea
              value={assistantPrompt}
              onChange={(event) => setAssistantPrompt(event.target.value)}
              maxLength={4000}
              rows={3}
              placeholder="I need to finish backend authentication by Friday and prepare for interviews over the weekend."
              className="min-h-20 flex-1 resize-y rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-indigo-400"
            />
            <button
              type="submit"
              disabled={assistantLoading}
              className="rounded-xl bg-indigo-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60 sm:self-end"
            >
              {assistantLoading ? "Thinking..." : "Suggest tasks"}
            </button>
          </form>

          {suggestions.length > 0 && (
            <div className="mt-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="font-semibold text-slate-100">Review suggestions</h4>
                  <p className="text-xs text-slate-500">
                    Duration, priority, and descriptions are planning guidance; the existing
                    task API stores title and dates.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSuggestions([])}
                    disabled={approvingSuggestions}
                    className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void approveSuggestions()}
                    disabled={approvingSuggestions}
                    className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
                  >
                    {approvingSuggestions ? "Adding..." : "Approve all"}
                  </button>
                </div>
              </div>

              {suggestions.map((suggestion, index) => (
                <article
                  key={`${suggestion.title}-${index}`}
                  className="rounded-xl border border-slate-800 bg-slate-950/70 p-4"
                >
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                    <div>
                      <label className="mb-1 block text-xs text-slate-400">Task title</label>
                      <input
                        value={suggestion.title}
                        maxLength={200}
                        onChange={(event) => updateSuggestion(index, "title", event.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                      />
                    </div>
                    <div className="flex items-end gap-2 text-xs">
                      <span className="rounded-md bg-indigo-500/15 px-2 py-1 text-indigo-300">
                        {suggestion.priority} priority
                      </span>
                      <span className="rounded-md bg-slate-800 px-2 py-1 text-slate-400">
                        {suggestion.estimated_duration_minutes} min
                      </span>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-slate-400">{suggestion.description}</p>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-xs text-slate-400">
                      Scheduled date
                      <input
                        type="date"
                        value={suggestion.scheduled_date || ""}
                        onChange={(event) =>
                          updateSuggestion(index, "scheduled_date", event.target.value)
                        }
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                      />
                    </label>
                    <label className="text-xs text-slate-400">
                      Due date
                      <input
                        type="date"
                        value={suggestion.due_date || ""}
                        onChange={(event) =>
                          updateSuggestion(index, "due_date", event.target.value)
                        }
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                      />
                    </label>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">Total tasks</p>
            <p className="mt-3 text-3xl font-bold">{tasks.length}</p>
            <p className="mt-1 text-xs text-slate-500">All your tasks</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">Completed</p>
            <p className="mt-3 text-3xl font-bold text-emerald-400">
              {completedCount}
            </p>
            <p className="mt-1 text-xs text-slate-500">Tasks finished</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">Pending</p>
            <p className="mt-3 text-3xl font-bold text-amber-300">
              {pendingCount}
            </p>
            <p className="mt-1 text-xs text-slate-500">Still to do</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-slate-400">Progress</p>
              <span className="text-sm font-semibold text-indigo-300">
                {progress}%
              </span>
            </div>
            <p className="mt-3 text-3xl font-bold">{completedCount}/{tasks.length}</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold">Calendar</h3>
                <p className="mt-1 text-sm text-slate-400">
                  Select a day to view scheduled tasks and deadlines.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const today = todayISO();
                  setSelectedDate(today);
                  const now = new Date();
                  setVisibleMonth(new Date(now.getFullYear(), now.getMonth(), 1));
                }}
                className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-indigo-400 hover:text-white"
              >
                Today
              </button>
            </div>

            <div className="mb-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => goToMonth(-1)}
                aria-label="Previous month"
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 text-xl hover:border-indigo-400 hover:bg-slate-800"
              >
                ‹
              </button>
              <h4 className="text-lg font-semibold">{monthName(visibleMonth)}</h4>
              <button
                type="button"
                onClick={() => goToMonth(1)}
                aria-label="Next month"
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 text-xl hover:border-indigo-400 hover:bg-slate-800"
              >
                ›
              </button>
            </div>

            {/* Active Range Guide Banner based on reference image */}
            <div className="mb-5 rounded-2xl border border-sky-900/50 bg-slate-950/80 p-4 shadow-inner">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-1 text-xs">
                <span className="font-semibold text-sky-200">
                  Example: Start 19 Oct · Due 25 Oct
                </span>
                <span className="text-[11px] text-slate-400">
                  Active across entire range
                </span>
              </div>
              <div className="grid grid-cols-7 gap-1.5 text-center">
                <div className="flex flex-col items-center justify-between rounded-xl border border-[#1d5773] bg-[#103a4e] p-1.5 text-white shadow-sm">
                  <span className="text-xs font-bold sm:text-sm">19</span>
                  <span className="text-[9px] font-semibold text-sky-300">Start</span>
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-white shadow-sm shadow-white/80" />
                </div>
                {[20, 21, 22, 23, 24].map((d) => (
                  <div
                    key={d}
                    className="flex flex-col items-center justify-between rounded-xl border border-[#1d5773] bg-[#103a4e] p-1.5 text-white shadow-sm"
                  >
                    <span className="text-xs font-bold sm:text-sm">{d}</span>
                    <span className="text-[9px] font-semibold text-sky-300">Active</span>
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-white shadow-sm shadow-white/80" />
                  </div>
                ))}
                <div className="flex flex-col items-center justify-between rounded-xl border border-[#8f3d1b] bg-[#5f2812] p-1.5 text-white shadow-sm">
                  <span className="text-xs font-bold sm:text-sm">25</span>
                  <span className="text-[9px] font-semibold text-amber-300">Due</span>
                  <span className="mt-1 flex items-center justify-center text-[10px] leading-none text-amber-300">
                    ⏰
                  </span>
                </div>
              </div>
              <p className="mt-2.5 text-xs text-slate-400 leading-relaxed">
              </p>
            </div>

            <div className="grid grid-cols-7 gap-1.5 text-center">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                <div
                  key={day}
                  className="py-2 text-xs font-semibold uppercase tracking-wider text-slate-400"
                >
                  {day}
                </div>
              ))}

              {calendarCells.map((day, index) => {
                if (day === null) {
                  return (
                    <div
                      key={`blank-${index}`}
                      className="min-h-[72px] sm:min-h-[82px] rounded-xl border border-transparent"
                    />
                  );
                }

                const date = toISODate(
                  new Date(
                    visibleMonth.getFullYear(),
                    visibleMonth.getMonth(),
                    day
                  )
                );
                const isSelected = selectedDate === date;
                const isToday = todayISO() === date;

                const activeOnDay = incompleteTasks.filter((t) =>
                  isTaskActiveOnDate(t, date)
                );
                const dueOnDay = incompleteTasks.filter((t) =>
                  isTaskDueOnDate(t, date)
                );
                const startsOnDay = incompleteTasks.filter((t) =>
                  isTaskStartingOnDate(t, date)
                );

                const hasActive = activeOnDay.length > 0;
                const hasDue = dueOnDay.length > 0;
                const hasActiveNonDue = activeOnDay.some(
                  (t) => toDateString(t.due_date) !== date
                );
                const hasStart = startsOnDay.length > 0;

                let cellStyle =
                  "border-slate-800/80 bg-slate-900/40 text-slate-300 hover:border-slate-700 hover:bg-slate-800/60";
                let statusText: string | null = null;
                let statusColor = "text-slate-400";

                if (hasDue && hasActiveNonDue) {
                  cellStyle =
                    "border-amber-500/70 bg-gradient-to-br from-[#103a4e] via-[#103a4e]/90 to-[#5f2812] text-white shadow-sm";
                  statusText = "Active · Due";
                  statusColor = "text-amber-300";
                } else if (hasDue) {
                  cellStyle =
                    "border-[#8f3d1b] bg-[#5f2812] text-white shadow-sm hover:bg-[#6b3112]";
                  statusText = "Due";
                  statusColor = "text-amber-300";
                } else if (hasActive) {
                  cellStyle =
                    "border-[#1d5773] bg-[#103a4e] text-white shadow-sm hover:bg-[#15465e]";
                  statusText = hasStart ? "Start" : "Active";
                  statusColor = "text-sky-300";
                } else if (isToday) {
                  cellStyle =
                    "border-indigo-500/50 bg-slate-800/90 text-indigo-200 font-medium";
                }

                const selectionClass = isSelected
                  ? "ring-2 ring-indigo-400 ring-offset-2 ring-offset-slate-950 font-bold scale-[1.02] z-10 shadow-lg"
                  : "";

                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => selectCalendarDay(day)}
                    aria-pressed={isSelected}
                    aria-label={`${date}: ${activeOnDay.length} active tasks, ${dueOnDay.length} deadlines`}
                    className={`group relative flex min-h-[72px] sm:min-h-[82px] flex-col items-center justify-between rounded-xl border p-1 sm:p-1.5 transition ${cellStyle} ${selectionClass}`}
                  >
                    <div className="flex w-full items-center justify-between px-0.5">
                      <span className="text-xs sm:text-sm font-bold">{day}</span>
                      {isToday && !statusText && (
                        <span className="text-[9px] font-semibold uppercase text-indigo-400">
                          Today
                        </span>
                      )}
                    </div>

                    <div className="my-auto text-center">
                      {statusText ? (
                        <span
                          className={`text-[10px] sm:text-[11px] font-bold tracking-tight ${statusColor}`}
                        >
                          {statusText}
                        </span>
                      ) : (
                        <span className="text-[10px] opacity-0">·</span>
                      )}
                    </div>

                    <div className="flex h-3 items-center justify-center gap-1.5">
                      {hasActiveNonDue && (
                        <span
                          className="h-2 w-2 rounded-full bg-sky-300 shadow-sm shadow-sky-300/80"
                          title={`${activeOnDay.length} active task(s)`}
                        />
                      )}
                      {hasDue && (
                        <span
                          className="h-2 w-2 rounded-full bg-amber-400 shadow-sm shadow-amber-400/80"
                          title={`${dueOnDay.length} deadline(s)`}
                        />
                      )}
                      {!hasDue && !hasActiveNonDue && hasActive && (
                        <span
                          className="h-2 w-2 rounded-full bg-sky-300 shadow-sm shadow-sky-300/80"
                          title="Active task"
                        />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Calendar Legend */}
            <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 text-xs text-slate-300 space-y-2">
              <div className="font-semibold text-slate-200">Calendar Indicators</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-400">
                <div className="flex items-center gap-2">
                  <span className="flex h-4 w-4 items-center justify-center rounded bg-[#103a4e] border border-[#1d5773]">
                    <span className="h-1.5 w-1.5 rounded-full bg-sky-300" />
                  </span>
                  <span><strong className="text-sky-300">Blue:</strong> Active task (across start..due range)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex h-4 w-4 items-center justify-center rounded bg-[#5f2812] border border-[#8f3d1b]">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  </span>
                  <span><strong className="text-amber-300">Orange:</strong> Deadline (task due date)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex h-4 w-4 items-center justify-center rounded bg-gradient-to-r from-[#103a4e] to-[#5f2812] border border-amber-500/50">
                    <span className="flex gap-0.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-sky-300" />
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                    </span>
                  </span>
                  <span><strong className="text-indigo-200">Dual:</strong> Active tasks + Deadline on same day</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <span>Completed tasks are hidden from calendar</span>
                </div>
              </div>
            </div>

            <div className="mt-6 border-t border-slate-800 pt-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
                    Selected day
                  </p>
                  <h4 className="mt-1 text-lg font-bold">
                    {formatDate(selectedDate)}
                  </h4>
                </div>
                <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
                  {selectedDateTasks.length} active {selectedDateTasks.length === 1 ? "task" : "tasks"}
                </span>
              </div>

              {selectedDateTasks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center">
                  <p className="font-medium text-slate-300">Nothing active on this day</p>
                  <p className="mt-1 text-sm text-slate-500">
                    No incomplete task is scheduled or due on this date.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setNewScheduledDate(selectedDate);
                      setNewDueDate("");
                      document.getElementById("add-task-form")?.scrollIntoView({ behavior: "smooth" });
                    }}
                    className="mt-3 inline-flex items-center gap-1 rounded-lg bg-indigo-600/30 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-600/50"
                  >
                    + Schedule a task for this day
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedDateTasks.map((task) => (
                    <div
                      key={task.id}
                      className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 transition hover:border-slate-700"
                    >
                      {editingId === task.id ? (
                        <div className="space-y-3">
                          <div>
                            <label className="mb-1 block text-xs text-slate-400">
                              Task title
                            </label>
                            <input
                              type="text"
                              maxLength={200}
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 outline-none focus:border-indigo-400 text-sm"
                            />
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-xs text-slate-400">
                                Scheduled date (Start)
                              </label>
                              <input
                                type="date"
                                value={editScheduledDate}
                                onChange={(e) => setEditScheduledDate(e.target.value)}
                                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-sm outline-none focus:border-indigo-400"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-slate-400">
                                Due date (Deadline)
                              </label>
                              <input
                                type="date"
                                value={editDueDate}
                                onChange={(e) => setEditDueDate(e.target.value)}
                                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-sm outline-none focus:border-indigo-400"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => void saveEdit(task.id)}
                              className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-400"
                            >
                              Save changes
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:text-white"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => void toggleTask(task)}
                            aria-label="Mark task completed"
                            title="Mark task completed (removes from calendar)"
                            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-slate-600 text-xs hover:border-emerald-400 hover:bg-emerald-500/20 text-transparent hover:text-emerald-300 transition"
                          >
                            ✓
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className="break-words font-medium text-slate-100">
                              {task.title}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {toDateString(task.due_date) === selectedDate && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-300 border border-amber-500/30">
                                  ⏰ Due today
                                </span>
                              )}
                              {toDateString(task.scheduled_date) === selectedDate && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/20 px-2 py-0.5 text-xs font-semibold text-sky-300 border border-sky-500/30">
                                  🚀 Starts today
                                </span>
                              )}
                              {task.scheduled_date &&
                                task.due_date &&
                                selectedDate > toDateString(task.scheduled_date)! &&
                                selectedDate < toDateString(task.due_date)! && (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-300 border border-sky-500/20">
                                    Active range
                                  </span>
                                )}
                              <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                                Pending
                              </span>
                            </div>

                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                              <span>
                                <strong className="text-sky-300 font-medium">Scheduled:</strong>{" "}
                                {formatDate(task.scheduled_date)}
                              </span>
                              <span>
                                <strong className="text-amber-300 font-medium">Due:</strong>{" "}
                                {formatDate(task.due_date)}
                              </span>
                            </div>

                            {task.scheduled_date &&
                              task.due_date &&
                              toDateString(task.scheduled_date)! <= toDateString(task.due_date)! && (
                                <div className="mt-2 text-[11px] text-slate-400">
                                  Active window:{" "}
                                  <span className="text-sky-300 font-medium">
                                    {formatShortDate(task.scheduled_date)}
                                  </span>{" "}
                                  ➔{" "}
                                  <span className="text-amber-300 font-medium">
                                    {formatShortDate(task.due_date)}
                                  </span>
                                </div>
                              )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2 text-xs font-semibold">
                            <button
                              type="button"
                              onClick={() => startEditing(task)}
                              className="text-indigo-300 hover:text-indigo-200"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteTask(task.id)}
                              className="text-red-400 hover:text-red-300"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <div className="space-y-6">
            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
              <h3 className="text-xl font-bold">Add a task</h3>
              <p className="mt-1 text-sm text-slate-400">
                Set a schedule and a deadline for your task.
              </p>

              <form onSubmit={addTask} className="mt-5 space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    Task title
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={200}
                    value={newTitle}
                    onChange={(event) => setNewTitle(event.target.value)}
                    placeholder="e.g. Complete DSA practice"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-300">
                      Scheduled date
                    </label>
                    <input
                      type="date"
                      value={newScheduledDate}
                      onChange={(event) => setNewScheduledDate(event.target.value)}
                      className="w-full min-w-0 rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm outline-none focus:border-indigo-400"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-300">
                      Due date
                    </label>
                    <input
                      type="date"
                      value={newDueDate}
                      onChange={(event) => setNewDueDate(event.target.value)}
                      className="w-full min-w-0 rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm outline-none focus:border-indigo-400"
                    />
                  </div>
                </div>

                <p className="text-xs text-slate-500">
                  Scheduled date = when you plan to work. Due date = deadline.
                </p>

                <button
                  type="submit"
                  className="w-full rounded-xl bg-indigo-500 px-4 py-3 font-semibold text-white transition hover:bg-indigo-400"
                >
                  + Add task
                </button>
              </form>
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-xl font-bold">All tasks</h3>
                  <p className="mt-1 text-sm text-slate-400">
                    Search, filter, edit, or update your tasks.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadTasks()}
                  disabled={loading}
                  className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-indigo-400 disabled:opacity-50"
                >
                  {loading ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              <div className="mt-5 space-y-3">
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search tasks..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-indigo-400"
                />

                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ["all", "All"],
                      ["pending", "Pending"],
                      ["completed", "Completed"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFilter(value)}
                      className={`rounded-lg px-2 py-2.5 text-sm font-medium transition ${
                        filter === value
                          ? "bg-indigo-500 text-white"
                          : "bg-slate-800 text-slate-400 hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {loading && tasks.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">
                    Loading tasks...
                  </p>
                ) : filteredTasks.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center">
                    <p className="font-medium text-slate-300">No tasks found</p>
                    <p className="mt-1 text-sm text-slate-500">
                      Add a task or try another search/filter.
                    </p>
                  </div>
                ) : (
                  filteredTasks.map((task) => (
                    <div
                      key={task.id}
                      className="rounded-xl border border-slate-800 bg-slate-950/70 p-4"
                    >
                      {editingId === task.id ? (
                        <div className="space-y-4">
                          <div>
                            <label className="mb-1 block text-xs text-slate-400">
                              Task title
                            </label>
                            <input
                              type="text"
                              maxLength={200}
                              value={editTitle}
                              onChange={(event) => setEditTitle(event.target.value)}
                              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 outline-none focus:border-indigo-400"
                            />
                          </div>

                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-xs text-slate-400">
                                Scheduled date
                              </label>
                              <input
                                type="date"
                                value={editScheduledDate}
                                onChange={(event) =>
                                  setEditScheduledDate(event.target.value)
                                }
                                className="w-full min-w-0 rounded-lg border border-slate-700 bg-slate-900 px-2 py-2.5 text-sm outline-none focus:border-indigo-400"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-slate-400">
                                Due date
                              </label>
                              <input
                                type="date"
                                value={editDueDate}
                                onChange={(event) => setEditDueDate(event.target.value)}
                                className="w-full min-w-0 rounded-lg border border-slate-700 bg-slate-900 px-2 py-2.5 text-sm outline-none focus:border-indigo-400"
                              />
                            </div>
                          </div>

                          <p className="text-xs text-slate-500">
                            Clear a date field to remove that date.
                          </p>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void saveEdit(task.id)}
                              className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400"
                            >
                              Save changes
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:text-white"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => void toggleTask(task)}
                            aria-label={
                              task.completed
                                ? "Mark task pending"
                                : "Mark task completed"
                            }
                            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs ${
                              task.completed
                                ? "border-emerald-500 bg-emerald-500 text-white"
                                : "border-slate-600 hover:border-indigo-400"
                            }`}
                          >
                            {task.completed ? "✓" : ""}
                          </button>

                          <div className="min-w-0 flex-1">
                            <p
                              className={`break-words font-medium ${
                                task.completed
                                  ? "text-slate-500 line-through"
                                  : "text-slate-100"
                              }`}
                            >
                              {task.title}
                            </p>

                            <div className="mt-2 space-y-1 text-xs text-slate-500">
                              <p>
                                <span className="text-sky-300">Scheduled:</span>{" "}
                                {formatDate(task.scheduled_date)}
                              </p>
                              <p>
                                <span className="text-amber-300">Due:</span>{" "}
                                {formatDate(task.due_date)}
                              </p>
                            </div>

                            <div className="mt-3 flex flex-wrap items-center gap-1.5">
                              <span
                                className={`inline-block rounded-md px-2 py-1 text-xs font-medium ${
                                  task.completed
                                    ? "bg-emerald-400/10 text-emerald-300 border border-emerald-500/20"
                                    : task.due_date && toDateString(task.due_date)! < todayISO()
                                      ? "bg-red-400/10 text-red-300 border border-red-500/20"
                                      : "bg-amber-400/10 text-amber-300 border border-amber-500/20"
                                }`}
                              >
                                {task.completed
                                  ? "Completed"
                                  : task.due_date && toDateString(task.due_date)! < todayISO()
                                    ? "Overdue (Expired deadline)"
                                    : "Pending"}
                              </span>
                              {task.scheduled_date &&
                                task.due_date &&
                                toDateString(task.due_date)! < toDateString(task.scheduled_date)! && (
                                  <span className="rounded-md bg-rose-400/10 px-2 py-1 text-xs text-rose-300 border border-rose-500/20">
                                    Due earlier than start
                                  </span>
                                )}
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-col gap-3 text-xs font-semibold">
                            <button
                              type="button"
                              onClick={() => startEditing(task)}
                              className="text-indigo-300 hover:text-indigo-200"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteTask(task.id)}
                              className="text-red-300 hover:text-red-200"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              <p className="mt-4 text-xs text-slate-500">
                Showing {filteredTasks.length} of {tasks.length} tasks
              </p>
            </section>
          </div>
        </div>

        <footer className="py-8 text-center text-xs text-slate-600">
          TaskFlow · Plan your work, one day at a time.
        </footer>
      </div>
    </main>
  );
}

export default App;
