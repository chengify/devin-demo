import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { config } from "../config";

export type DevinStatus =
  "new" | "claimed" | "running" | "exit" | "error" | "suspended" | "resuming";
export interface DevinSession {
  session_id: string;
  url: string;
  status: DevinStatus;
  status_detail?: string | null;
  created_at: number;
  updated_at: number;
  acus_consumed: number;
  pull_requests: Array<{ pr_url: string; pr_state: string }>;
  structured_output?: Record<string, unknown> | null;
}
export interface CreateSessionRequest {
  prompt: string;
  title?: string;
  repos?: string[];
  tags?: string[];
  create_as_user_id?: string;
  knowledge_ids?: string[];
  playbook_id?: string;
}
export type SessionOutcome = "active" | "completed" | "blocked" | "failed";

export function sessionOutcome(session: DevinSession): SessionOutcome {
  if (session.status === "error") return "failed";
  if (session.status === "suspended") return "blocked";
  if (
    session.status === "exit" ||
    (session.status === "running" && session.status_detail === "finished") ||
    // For this automation, an open PR is the handoff boundary. Devin may wait
    // for reviewer feedback after opening it instead of entering "finished".
    (session.status === "running" &&
      session.status_detail === "waiting_for_user" &&
      session.pull_requests.some((pr) => pr.pr_state === "open"))
  )
    return "completed";
  if (
    session.status === "running" &&
    ["waiting_for_user", "waiting_for_approval"].includes(
      session.status_detail || "",
    )
  )
    return "blocked";
  return "active";
}

export class DevinApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "DevinApiError";
  }
}
export class SessionTimeoutError extends Error {
  constructor(
    readonly sessionId: string,
    readonly terminationConfirmed: boolean,
  ) {
    super(
      terminationConfirmed
        ? "Polling timed out; remote session termination confirmed (archived)."
        : "Polling timed out; remote termination could not be confirmed. Inspect the session in Devin.",
    );
    this.name = "SessionTimeoutError";
  }
}

type Options = {
  apiKey: string;
  orgId: string;
  apiBaseUrl: string;
  maxAcuLimit: number;
};
type Runtime = {
  http?: AxiosInstance;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export class DevinClient {
  private client: AxiosInstance;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;

  constructor(
    private options: Options = config.devin,
    runtime: Runtime = {},
  ) {
    this.client =
      runtime.http ||
      axios.create({
        baseURL: options.apiBaseUrl,
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
        maxRedirects: 0,
      });
    this.now = runtime.now || Date.now;
    this.sleep =
      runtime.sleep ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private path(sessionId?: string): string {
    const base = `/organizations/${encodeURIComponent(this.options.orgId)}/sessions`;
    if (sessionId === undefined) return base;
    // Session IDs are opaque. Live v3 responses currently use 32-character
    // hexadecimal IDs, while earlier examples used devin-prefixed values.
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId))
      throw new Error("Invalid Devin session ID");
    return `${base}/${encodeURIComponent(sessionId)}`;
  }

  private validateConfiguration(): void {
    if (
      !this.options.apiKey.startsWith("cog_") ||
      this.options.apiKey.includes("your_")
    ) {
      throw new Error(
        "Set DEVIN_API_KEY to a v3 cog_-prefixed credential in .env.",
      );
    }
    if (
      !this.options.orgId.startsWith("org-") ||
      this.options.orgId.includes("your_")
    ) {
      throw new Error("Set DEVIN_ORG_ID to your org- identifier in .env.");
    }
    if (
      !Number.isSafeInteger(this.options.maxAcuLimit) ||
      this.options.maxAcuLimit <= 0
    ) {
      throw new Error("DEVIN_MAX_ACU_LIMIT must be a positive integer.");
    }
  }

  // Only GETs retry. Retrying a POST after an ambiguous network failure can create a second paid session.
  private async request(
    request: AxiosRequestConfig,
    deadline = this.now() + 120000,
  ): Promise<unknown> {
    this.validateConfiguration();
    for (let attempt = 0; ; attempt++) {
      const remaining = deadline - this.now();
      if (remaining <= 0)
        throw new DevinApiError("Devin request deadline exceeded");
      try {
        return (
          await this.client.request({
            ...request,
            timeout: Math.min(30000, remaining),
          })
        ).data;
      } catch (error) {
        const status = axios.isAxiosError(error)
          ? error.response?.status
          : undefined;
        const retryable =
          axios.isAxiosError(error) &&
          (!error.response ||
            status === 429 ||
            (status !== undefined && status >= 500));
        // Do not serialize Axios errors: request config can contain credentials and issue contents.
        const suffix =
          request.method === "POST" && retryable
            ? " Creation may have succeeded; inspect Devin before retrying."
            : "";
        const failure = new DevinApiError(
          `Devin ${request.method} request failed${status ? ` (HTTP ${status})` : ""}.${suffix}`,
          status,
          retryable,
        );
        if (request.method !== "GET" || !retryable || attempt >= 2)
          throw failure;
        const retryAfter = axios.isAxiosError(error)
          ? error.response?.headers["retry-after"]
          : undefined;
        const seconds = Number(retryAfter);
        const delay =
          retryAfter !== undefined
            ? Number.isFinite(seconds)
              ? Math.max(0, seconds * 1000)
              : Math.max(0, Date.parse(String(retryAfter)) - this.now())
            : 1000 * 2 ** attempt;
        const wait = Number.isFinite(delay) ? delay : 1000 * 2 ** attempt;
        if (wait >= deadline - this.now()) throw failure;
        await this.sleep(wait);
      }
    }
  }

  private parseSession(data: unknown, expectedId?: string): DevinSession {
    const session = data as Partial<DevinSession> | null;
    const statuses = [
      "new",
      "claimed",
      "running",
      "exit",
      "error",
      "suspended",
      "resuming",
    ];
    if (
      !session ||
      typeof session.session_id !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(session.session_id) ||
      (expectedId !== undefined && session.session_id !== expectedId) ||
      typeof session.url !== "string" ||
      !session.url.startsWith("https://") ||
      !statuses.includes(session.status || "") ||
      typeof session.created_at !== "number" ||
      typeof session.updated_at !== "number" ||
      typeof session.acus_consumed !== "number" ||
      !Array.isArray(session.pull_requests) ||
      session.pull_requests.some(
        (pr) =>
          !pr ||
          typeof pr.pr_url !== "string" ||
          typeof pr.pr_state !== "string",
      )
    ) {
      throw new DevinApiError(
        "Unexpected Devin session response; check the v3 API contract.",
      );
    }
    return session as DevinSession;
  }

  async checkAccess(): Promise<void> {
    const data = await this.request({
      method: "GET",
      url: this.path(),
      params: { first: 1 },
    });
    if (!data || !Array.isArray((data as { items?: unknown }).items)) {
      throw new DevinApiError("Unexpected Devin list response.");
    }
  }

  async createSession(request: CreateSessionRequest): Promise<DevinSession> {
    if (!request.prompt.trim())
      throw new Error("Devin prompt cannot be empty.");
    const data = await this.request({
      method: "POST",
      url: this.path(),
      data: { ...request, max_acu_limit: this.options.maxAcuLimit },
    });
    return this.parseSession(data);
  }

  async getSession(
    sessionId: string,
    deadline?: number,
  ): Promise<DevinSession> {
    return this.parseSession(
      await this.request(
        {
          method: "GET",
          url: this.path(sessionId),
        },
        deadline,
      ),
      sessionId,
    );
  }

  async terminateSession(sessionId: string): Promise<boolean> {
    // archive=true preserves the session for inspection; termination is not resumable.
    let session = this.parseSession(
      await this.request({
        method: "DELETE",
        url: this.path(sessionId),
        params: { archive: true },
      }),
      sessionId,
    );
    for (let attempt = 0; attempt < 3; attempt++) {
      if (["exit", "error", "suspended"].includes(session.status)) return true;
      if (attempt < 2) {
        await this.sleep(1000);
        session = await this.getSession(sessionId);
      }
    }
    return false;
  }

  async waitForSessionCompletion(
    sessionId: string,
    timeoutMs = 30 * 60 * 1000,
    pollIntervalMs = 5000,
  ): Promise<DevinSession> {
    if (
      !Number.isFinite(timeoutMs) ||
      timeoutMs <= 0 ||
      !Number.isFinite(pollIntervalMs) ||
      pollIntervalMs <= 0
    ) {
      throw new Error("Polling timeout and interval must be positive.");
    }
    const deadline = this.now() + timeoutMs;
    while (this.now() < deadline) {
      let session: DevinSession;
      try {
        session = await this.getSession(sessionId, deadline);
      } catch (error) {
        if (this.now() >= deadline) break;
        throw error; // retries exhausted or permanent error; do not poll forever
      }
      if (sessionOutcome(session) !== "active") return session;
      await this.sleep(
        Math.min(pollIntervalMs, Math.max(0, deadline - this.now())),
      );
    }
    let confirmed = false;
    try {
      confirmed = await this.terminateSession(sessionId);
    } catch {
      /* Report uncertainty explicitly. */
    }
    throw new SessionTimeoutError(sessionId, confirmed);
  }
}

export const devinClient = new DevinClient();
