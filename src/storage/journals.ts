import { world } from "@minecraft/server";
import { parseJSON, serializeDynamicJson } from "./dynamic-json";

// ---------------------------------------------------------------------------
// Durable append-only transaction journal.
// Keys: tau:journal:<store>:head (sequence pointer) and
// tau:journal:<store>:<seq> (envelopes). Ring-capped to the last
// JOURNAL_MAX_ENTRIES_PER_STORE entries per store; every key is
// size-checked before writing. Intended for marketplace/TPA/combat and
// cross-store team/plot transactions: append before mutating, ack after the
// matching split flush verifies, replay on load to resume or roll back.
// This module only provides the mechanism; feature call sites are wired
// separately by the owning workers.
// ---------------------------------------------------------------------------

export const JOURNAL_MAX_ENTRIES_PER_STORE = 50;
export const JOURNAL_MAX_ENTRY_BYTES = 8000;

export type JournalEnvelope = {
  seq: number;
  at: number;
  payload: unknown;
};

function sanitizeStoreName(store: string): string {
  const cleaned = String(store ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (cleaned || "default").slice(0, 32);
}

export function journalHeadKeyFor(store: string): string {
  return `tau:journal:${sanitizeStoreName(store)}:head`;
}

export function journalEntryKeyFor(store: string, seq: number): string {
  return `tau:journal:${sanitizeStoreName(store)}:${seq}`;
}

export function journalHead(store: string): number {
  try {
    const raw = world.getDynamicProperty(journalHeadKeyFor(store)) as number | string | undefined;
    if (raw === undefined) return 0;
    const num = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(num) && num >= 0 ? Math.floor(num) : 0;
  } catch {
    return 0;
  }
}

function setJournalHead(store: string, seq: number): boolean {
  try {
    world.setDynamicProperty(journalHeadKeyFor(store), Math.floor(seq));
    return true;
  } catch {
    return false;
  }
}

// Append a payload envelope and advance the head pointer. Prunes entries
// older than the ring window using exact key names (no id scans).
export function journalAppend(store: string, entry: unknown): boolean {
  try {
    const head = journalHead(store);
    const seq = head + 1;
    const envelope: JournalEnvelope = { seq, at: Date.now(), payload: entry };
    const key = journalEntryKeyFor(store, seq);
    const serialized = serializeDynamicJson(key, envelope);
    if (serialized === undefined) return false;
    if (serialized.length > JOURNAL_MAX_ENTRY_BYTES) {
      console.warn(
        `[TauUtils] Journal entry for ${sanitizeStoreName(store)} seq ${seq} exceeds ${JOURNAL_MAX_ENTRY_BYTES} bytes; not journaled.`
      );
      return false;
    }
    world.setDynamicProperty(key, serialized);
    if (!setJournalHead(store, seq)) return false;
    // Ring maintenance: clear slots that fell out of the replay window.
    // Bounded to a few exact keys per append; no id scans.
    const windowStart = seq - JOURNAL_MAX_ENTRIES_PER_STORE + 1;
    for (let oldSeq = windowStart - 1; oldSeq >= Math.max(1, windowStart - 10); oldSeq--) {
      try {
        if (world.getDynamicProperty(journalEntryKeyFor(store, oldSeq)) !== undefined) {
          world.setDynamicProperty(journalEntryKeyFor(store, oldSeq), undefined);
        }
      } catch {
        break;
      }
    }
    return true;
  } catch {
    return false;
  }
}

// Replay unacked payloads oldest-first. Skips missing/corrupt slots.
export function journalReplay(store: string): unknown[] {
  const payloads: unknown[] = [];
  try {
    const head = journalHead(store);
    if (head <= 0) return payloads;
    const first = Math.max(1, head - JOURNAL_MAX_ENTRIES_PER_STORE + 1);
    for (let seq = first; seq <= head; seq++) {
      try {
        const raw = world.getDynamicProperty(journalEntryKeyFor(store, seq)) as string | undefined;
        if (!raw) continue;
        const envelope = parseJSON<JournalEnvelope | undefined>(raw, undefined);
        if (!envelope || envelope.seq !== seq) continue;
        payloads.push(envelope.payload);
      } catch {
        continue;
      }
    }
  } catch {
    // return whatever was collected
  }
  return payloads;
}

// Acknowledge (delete) all entries with seq <= upto. Never moves the head
// backwards; replay after a full ack returns [].
export function journalAck(store: string, upto: number): void {
  try {
    const head = journalHead(store);
    const limit = Math.min(Math.floor(upto), head);
    if (!(limit >= 1)) return;
    const first = Math.max(1, head - JOURNAL_MAX_ENTRIES_PER_STORE + 1);
    for (let seq = first; seq <= limit; seq++) {
      try {
        world.setDynamicProperty(journalEntryKeyFor(store, seq), undefined);
      } catch {
        continue;
      }
    }
  } catch {
    // ack is best-effort; unacked entries simply replay again
  }
}
