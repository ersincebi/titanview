import { createSignal } from 'solid-js';

/**
 * Birleşik kabuk geri al / yinele yığını (Faz 29).
 * Yalnız çizimler değil; sembol, aralık, grafik stili, ölçek, gösterge,
 * karşılaştırma, düzen, ayarlar ve tema değişiklikleri tek zaman çizelgesinde geri alınır.
 */
export interface HistoryEntry {
  id: string;
  labelTr: string;
  labelEn: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
}

const MAX_HISTORY = 100;

const [undoStack, setUndoStack] = createSignal<HistoryEntry[]>([]);
const [redoStack, setRedoStack] = createSignal<HistoryEntry[]>([]);

let applyingDepth = 0;
let seq = 0;

export function isApplyingHistory(): boolean {
  return applyingDepth > 0;
}

/** İçine alınan mutasyonlar yeni geçmiş kaydı oluşturmaz (geri al/yinele veya önyükleme sırasında). */
export function withoutHistory<T>(fn: () => T): T {
  applyingDepth++;
  try {
    return fn();
  } finally {
    applyingDepth--;
  }
}

export function pushHistory(entry: Omit<HistoryEntry, 'id'>): void {
  if (applyingDepth > 0) return;
  const full: HistoryEntry = { ...entry, id: `h_${++seq}` };
  setUndoStack((prev) => {
    const next = [...prev, full];
    return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
  });
  setRedoStack([]);
}

export function canUndo(): boolean {
  return undoStack().length > 0;
}

export function canRedo(): boolean {
  return redoStack().length > 0;
}

export function peekUndo(): HistoryEntry | null {
  const s = undoStack();
  return s.length > 0 ? s[s.length - 1] : null;
}

export function peekRedo(): HistoryEntry | null {
  const s = redoStack();
  return s.length > 0 ? s[s.length - 1] : null;
}

export function undoCount(): number {
  return undoStack().length;
}

export function redoCount(): number {
  return redoStack().length;
}

export function undoHistory(): HistoryEntry | null {
  const cur = undoStack();
  if (cur.length === 0) return null;
  const entry = cur[cur.length - 1];
  setUndoStack(cur.slice(0, -1));
  setRedoStack((r) => [...r, entry]);
  applyingDepth++;
  try {
    void entry.undo();
  } finally {
    applyingDepth--;
  }
  return entry;
}

export function redoHistory(): HistoryEntry | null {
  const cur = redoStack();
  if (cur.length === 0) return null;
  const entry = cur[cur.length - 1];
  setRedoStack(cur.slice(0, -1));
  setUndoStack((u) => [...u, entry]);
  applyingDepth++;
  try {
    void entry.redo();
  } finally {
    applyingDepth--;
  }
  return entry;
}

export function clearHistory(): void {
  setUndoStack([]);
  setRedoStack([]);
}
