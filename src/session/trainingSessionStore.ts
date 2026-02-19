import { randomUUID } from "node:crypto";

export type SessionMode = "discussion" | "help_ja" | "shadowing";

export interface TrainingSession {
  sessionId: string;
  articleTitle: string;
  articleText: string;
  summary: string;
  history: Array<{ role: "user" | "assistant"; text: string; mode: SessionMode }>;
  expiresAt: number;
}

interface CreateSessionInput {
  articleTitle: string;
  articleText: string;
  summary: string;
}

export class TrainingSessionStore {
  private readonly sessions = new Map<string, TrainingSession>();

  constructor(private readonly ttlMs = 60 * 60 * 1000, private readonly now = () => Date.now()) {}

  createSession(input: CreateSessionInput): TrainingSession {
    const session: TrainingSession = {
      sessionId: randomUUID(),
      articleTitle: input.articleTitle,
      articleText: input.articleText,
      summary: input.summary,
      history: [],
      expiresAt: this.now() + this.ttlMs
    };

    this.sessions.set(session.sessionId, session);
    return session;
  }

  getSession(sessionId: string): TrainingSession | null {
    this.cleanupExpired();
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(sessionId);
      return null;
    }
    return session;
  }

  appendMessage(sessionId: string, entry: TrainingSession["history"][number]): void {
    const session = this.getSession(sessionId);
    if (!session) {
      return;
    }
    session.history.push(entry);
    session.expiresAt = this.now() + this.ttlMs;
  }

  cleanupExpired(): void {
    const now = this.now();
    for (const [key, value] of this.sessions.entries()) {
      if (value.expiresAt <= now) {
        this.sessions.delete(key);
      }
    }
  }
}
