export interface Task {
  _id: string;
  title: string;
  done: boolean;
  createdAt: string;
  updatedAt: string;
}

export const apiBaseUrl = (
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = "Request failed.";

    try {
      const data = (await response.json()) as { message?: string };

      if (data.message) {
        message = data.message;
      }
    } catch {
      // Ignore non-JSON error bodies.
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

export const taskApi = {
  list: () => request<Task[]>("/api/tasks"),
  create: (title: string) =>
    request<Task>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  toggle: (id: string, done: boolean) =>
    request<Task>(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ done }),
    }),
  remove: (id: string) =>
    request<{ success: boolean }>(`/api/tasks/${id}`, {
      method: "DELETE",
    }),
};
