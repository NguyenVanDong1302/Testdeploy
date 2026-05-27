import { FormEvent, useEffect, useState } from "react";
import { apiBaseUrl, taskApi, type Task } from "./api";

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isRemoteFrontend =
    typeof window !== "undefined" && window.location.hostname !== "localhost";
  const apiNeedsPublicUrl = isRemoteFrontend && apiBaseUrl.includes("localhost");

  useEffect(() => {
    async function loadTasks() {
      try {
        setLoading(true);
        setError("");
        const nextTasks = await taskApi.list();
        setTasks(nextTasks);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load tasks.",
        );
      } finally {
        setLoading(false);
      }
    }

    void loadTasks();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const title = draft.trim();

    if (!title) {
      return;
    }

    try {
      setSubmitting(true);
      setError("");
      const createdTask = await taskApi.create(title);
      setTasks((currentTasks) => [createdTask, ...currentTasks]);
      setDraft("");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not create task.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(task: Task) {
    try {
      setError("");
      const updatedTask = await taskApi.toggle(task._id, !task.done);
      setTasks((currentTasks) =>
        currentTasks.map((currentTask) =>
          currentTask._id === updatedTask._id ? updatedTask : currentTask,
        ),
      );
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "Could not update task.",
      );
    }
  }

  async function handleDelete(taskId: string) {
    try {
      setError("");
      await taskApi.remove(taskId);
      setTasks((currentTasks) =>
        currentTasks.filter((currentTask) => currentTask._id !== taskId),
      );
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete task.",
      );
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">React + TypeScript + Node + MongoDB</p>
        <h1>Your personal machine, public frontend.</h1>
        <p className="intro">
          Frontend deploy len Vercel, backend chay tren may cua ban va tra task
          list qua API.
        </p>
        <div className="status-row">
          <span className="pill">API: {apiBaseUrl}</span>
          <span className="pill">Tasks: {tasks.length}</span>
        </div>
      </section>

      {apiNeedsPublicUrl ? (
        <section className="warning-card">
          <strong>Config issue:</strong> Frontend dang chay tren domain public
          nhung `VITE_API_BASE_URL` van tro ve `localhost`. Hien thi nay chi
          dung khi test local.
        </section>
      ) : null}

      <section className="panel">
        <form className="composer" onSubmit={handleSubmit}>
          <label className="composer-label" htmlFor="taskTitle">
            Add a task
          </label>
          <div className="composer-row">
            <input
              id="taskTitle"
              name="title"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ship API tunnel, update CORS, deploy frontend..."
            />
            <button type="submit" disabled={submitting || !draft.trim()}>
              {submitting ? "Saving..." : "Create"}
            </button>
          </div>
        </form>

        {error ? <p className="error-banner">{error}</p> : null}

        {loading ? (
          <div className="empty-state">
            <p>Loading tasks...</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="empty-state">
            <p>No tasks yet. Create the first one to confirm the stack works.</p>
          </div>
        ) : (
          <ul className="task-list">
            {tasks.map((task) => (
              <li className={`task-card ${task.done ? "task-card-done" : ""}`} key={task._id}>
                <button
                  className={`toggle ${task.done ? "toggle-done" : ""}`}
                  type="button"
                  onClick={() => void handleToggle(task)}
                  aria-label={task.done ? "Mark as not done" : "Mark as done"}
                >
                  {task.done ? "Done" : "Open"}
                </button>

                <div className="task-copy">
                  <h2>{task.title}</h2>
                  <p>Created {dateFormatter.format(new Date(task.createdAt))}</p>
                </div>

                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => void handleDelete(task._id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export default App;
