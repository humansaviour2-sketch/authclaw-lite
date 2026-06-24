import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

// File path outside src to prevent hot-reload loops
const SESSIONS_FILE = path.join(process.cwd(), "sessions.json");

export interface SessionData {
  sessionId: string;
  userId: string;
  tenantId: string;
  scopes: string[];
  role: string;
  apiKey: string;
  createdAt: number;
}

class SessionStore {
  private readSessions(): Map<string, SessionData> {
    try {
      if (fs.existsSync(SESSIONS_FILE)) {
        const content = fs.readFileSync(SESSIONS_FILE, "utf-8");
        const obj = JSON.parse(content);
        return new Map(Object.entries(obj));
      }
    } catch (err) {
      console.error("Failed to read sessions file:", err);
    }
    return new Map();
  }

  private writeSessions(sessions: Map<string, SessionData>) {
    try {
      const obj = Object.fromEntries(sessions.entries());
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2), "utf-8");
    } catch (err) {
      console.error("Failed to write sessions file:", err);
    }
  }

  createSession(data: Omit<SessionData, "sessionId" | "createdAt">): SessionData {
    const sessionId = randomUUID();
    const session: SessionData = {
      ...data,
      sessionId,
      createdAt: Date.now(),
    };
    const sessions = this.readSessions();
    sessions.set(sessionId, session);
    this.writeSessions(sessions);
    return session;
  }

  getSession(sessionId: string): SessionData | undefined {
    const sessions = this.readSessions();
    const session = sessions.get(sessionId);
    if (!session) return undefined;

    // Check TTL (e.g. 24 hours)
    const oneDay = 24 * 60 * 60 * 1000;
    if (Date.now() - session.createdAt > oneDay) {
      sessions.delete(sessionId);
      this.writeSessions(sessions);
      return undefined;
    }

    return session;
  }

  deleteSession(sessionId: string): boolean {
    const sessions = this.readSessions();
    const deleted = sessions.delete(sessionId);
    if (deleted) {
      this.writeSessions(sessions);
    }
    return deleted;
  }
}

export const sessionStore = new SessionStore();
