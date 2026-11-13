// SP-1.3 Lưu trữ bền vững: IndexedDB (trình duyệt) + MemoryStorage (test). Tiến độ không mất khi tải lại trang.
import type { AppSettings, AuditRecord, CharacterProfile, GlossaryTerm, StringEntry, TmRecord } from '../../contracts/types.js';
import { DEFAULT_SETTINGS } from '../../contracts/defaults.js';

export interface ProjectMeta {
  id: string;
  fileName: string;
  source: string;        // văn bản en.json gốc, bất biến (có BOM nếu có)
  createdAt: number;
  updatedAt: number;
}

export interface ProjectSnapshot {
  meta: ProjectMeta;
  entries: StringEntry[];
  glossary: GlossaryTerm[];
  characters: CharacterProfile[];
  examples: { source: string; target: string }[];
  settings: AppSettings;
}

export interface Backup extends ProjectSnapshot { format: 'en-json-translator-backup'; version: 1; tm: TmRecord[]; exportedAt: number }

export interface Storage {
  loadProject(): Promise<ProjectSnapshot | null>;
  createProject(meta: ProjectMeta, entries: StringEntry[]): Promise<void>;
  putEntries(entries: StringEntry[]): Promise<void>;
  appendAudit(records: AuditRecord[]): Promise<void>;
  saveGlossary(terms: GlossaryTerm[]): Promise<void>;
  saveCharacters(chars: CharacterProfile[]): Promise<void>;
  saveExamples(ex: { source: string; target: string }[]): Promise<void>;
  saveSettings(s: AppSettings): Promise<void>;
  loadTm(): Promise<TmRecord[]>;
  putTm(records: TmRecord[]): Promise<void>;
  clearProject(): Promise<void>;
  exportBackup(): Promise<Backup | null>;
  importBackup(b: Backup): Promise<void>;
}

export function isBackup(x: unknown): x is Backup {
  const b = x as Backup;
  return !!b && b.format === 'en-json-translator-backup' && b.version === 1 && !!b.meta && Array.isArray(b.entries);
}

const mergeSettings = (s: Partial<AppSettings> | undefined): AppSettings => ({
  ...DEFAULT_SETTINGS, ...(s ?? {}),
  batch: { ...DEFAULT_SETTINGS.batch, ...(s?.batch ?? {}) },
  retry: { ...DEFAULT_SETTINGS.retry, ...(s?.retry ?? {}) },
  qa: { ...DEFAULT_SETTINGS.qa, ...(s?.qa ?? {}) },
  budget: { ...DEFAULT_SETTINGS.budget, ...(s?.budget ?? {}) },
});

// ---------------- Memory ----------------
export class MemoryStorage implements Storage {
  meta: ProjectMeta | null = null;
  entries = new Map<string, StringEntry>();
  glossary: GlossaryTerm[] = [];
  characters: CharacterProfile[] = [];
  examples: { source: string; target: string }[] = [];
  settings: AppSettings = DEFAULT_SETTINGS;
  tm = new Map<string, TmRecord>();
  audit: AuditRecord[] = [];

  async loadProject() {
    if (!this.meta) return null;
    return { meta: this.meta, entries: [...this.entries.values()].sort((a, b) => a.span.start - b.span.start), glossary: this.glossary, characters: this.characters, examples: this.examples, settings: mergeSettings(this.settings) };
  }
  async createProject(meta: ProjectMeta, entries: StringEntry[]) { await this.clearProject(); this.meta = meta; for (const e of entries) this.entries.set(e.id, e); }
  async putEntries(entries: StringEntry[]) { for (const e of entries) this.entries.set(e.id, structuredClone(e)); }
  async appendAudit(r: AuditRecord[]) { this.audit.push(...r); }
  async saveGlossary(t: GlossaryTerm[]) { this.glossary = structuredClone(t); }
  async saveCharacters(c: CharacterProfile[]) { this.characters = structuredClone(c); }
  async saveExamples(e: { source: string; target: string }[]) { this.examples = structuredClone(e); }
  async saveSettings(s: AppSettings) { this.settings = structuredClone(s); }
  async loadTm() { return [...this.tm.values()]; }
  async putTm(r: TmRecord[]) { for (const x of r) this.tm.set(x.key, x); }
  async clearProject() { this.meta = null; this.entries.clear(); this.glossary = []; this.characters = []; this.examples = []; this.audit = []; }
  async exportBackup(): Promise<Backup | null> {
    const p = await this.loadProject();
    return p ? { format: 'en-json-translator-backup', version: 1, ...p, tm: await this.loadTm(), exportedAt: Date.now() } : null;
  }
  async importBackup(b: Backup) {
    await this.createProject(b.meta, b.entries);
    await this.saveGlossary(b.glossary ?? []); await this.saveCharacters(b.characters ?? []);
    await this.saveExamples(b.examples ?? []); await this.saveSettings(mergeSettings(b.settings));
    await this.putTm(b.tm ?? []);
  }
}

// ---------------- IndexedDB ----------------
const DB_NAME = 'entr';
const DB_VERSION = 1;
const STORES = ['meta', 'entries', 'glossary', 'characters', 'tm', 'audit', 'kv'] as const;
type StoreName = (typeof STORES)[number];

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
}

export class IdbStorage implements Storage {
  private dbp: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.dbp) {
      this.dbp = new Promise((resolve, reject) => {
        const r = indexedDB.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = () => {
          const db = r.result;
          // Migration: thêm store mới theo version ở đây. Không xoá store cũ.
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
          if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('glossary')) db.createObjectStore('glossary', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('characters')) db.createObjectStore('characters', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('tm')) db.createObjectStore('tm', { keyPath: 'key' });
          if (!db.objectStoreNames.contains('audit')) db.createObjectStore('audit', { autoIncrement: true });
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.onblocked = () => reject(new Error('IndexedDB bị chặn bởi tab khác. Hãy đóng các tab cũ.'));
      });
    }
    return this.dbp;
  }

  private async run<T>(stores: StoreName[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T> | T): Promise<T> {
    const db = await this.open();
    const tx = db.transaction(stores, mode);
    const done = txDone(tx);
    const out = await fn(tx);
    await done;
    return out;
  }

  async requestPersistence(): Promise<boolean> {
    try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
  }

  async loadProject(): Promise<ProjectSnapshot | null> {
    return this.run(['meta', 'entries', 'glossary', 'characters', 'kv'], 'readonly', async (tx) => {
      const meta = (await req(tx.objectStore('meta').get('project'))) as ProjectMeta | undefined;
      if (!meta) return null;
      const entries = (await req(tx.objectStore('entries').getAll())) as StringEntry[];
      entries.sort((a, b) => a.span.start - b.span.start);
      const glossary = (await req(tx.objectStore('glossary').getAll())) as GlossaryTerm[];
      const characters = (await req(tx.objectStore('characters').getAll())) as CharacterProfile[];
      const settings = (await req(tx.objectStore('kv').get('settings'))) as AppSettings | undefined;
      const examples = ((await req(tx.objectStore('kv').get('examples'))) as { source: string; target: string }[] | undefined) ?? [];
      return { meta, entries, glossary, characters, examples, settings: mergeSettings(settings) };
    });
  }

  async createProject(meta: ProjectMeta, entries: StringEntry[]): Promise<void> {
    await this.run(['meta', 'entries', 'glossary', 'characters', 'audit', 'kv'], 'readwrite', (tx) => {
      for (const s of ['entries', 'glossary', 'characters', 'audit'] as const) tx.objectStore(s).clear();
      tx.objectStore('kv').delete('examples');
      tx.objectStore('meta').put(meta, 'project');
      const es = tx.objectStore('entries');
      for (const e of entries) es.put(e);
    });
  }

  async putEntries(entries: StringEntry[]): Promise<void> {
    if (!entries.length) return;
    await this.run(['entries', 'meta'], 'readwrite', async (tx) => {
      const es = tx.objectStore('entries');
      for (const e of entries) es.put(e);
      const m = (await req(tx.objectStore('meta').get('project'))) as ProjectMeta | undefined;
      if (m) tx.objectStore('meta').put({ ...m, updatedAt: Date.now() }, 'project');
    });
  }

  async appendAudit(records: AuditRecord[]): Promise<void> {
    if (!records.length) return;
    await this.run(['audit'], 'readwrite', (tx) => { const s = tx.objectStore('audit'); for (const r of records) s.add(r); });
  }

  private async replaceStore<T>(name: 'glossary' | 'characters', rows: T[]): Promise<void> {
    await this.run([name], 'readwrite', (tx) => { const s = tx.objectStore(name); s.clear(); for (const r of rows) s.put(r); });
  }
  saveGlossary(t: GlossaryTerm[]) { return this.replaceStore('glossary', t); }
  saveCharacters(c: CharacterProfile[]) { return this.replaceStore('characters', c); }
  async saveExamples(e: { source: string; target: string }[]) { await this.run(['kv'], 'readwrite', (tx) => { tx.objectStore('kv').put(e, 'examples'); }); }
  async saveSettings(s: AppSettings) { await this.run(['kv'], 'readwrite', (tx) => { tx.objectStore('kv').put(s, 'settings'); }); }
  async loadTm(): Promise<TmRecord[]> { return this.run(['tm'], 'readonly', (tx) => req(tx.objectStore('tm').getAll()) as Promise<TmRecord[]>); }
  async putTm(records: TmRecord[]): Promise<void> {
    if (!records.length) return;
    await this.run(['tm'], 'readwrite', (tx) => { const s = tx.objectStore('tm'); for (const r of records) s.put(r); });
  }
  async clearProject(): Promise<void> {
    await this.run(['meta', 'entries', 'glossary', 'characters', 'audit', 'kv'], 'readwrite', (tx) => {
      for (const s of ['meta', 'entries', 'glossary', 'characters', 'audit', 'kv'] as const) tx.objectStore(s).clear();
    });
  }
  async exportBackup(): Promise<Backup | null> {
    const p = await this.loadProject();
    return p ? { format: 'en-json-translator-backup', version: 1, ...p, tm: await this.loadTm(), exportedAt: Date.now() } : null;
  }
  async importBackup(b: Backup): Promise<void> {
    await this.createProject(b.meta, b.entries);
    await this.saveGlossary(b.glossary ?? []);
    await this.saveCharacters(b.characters ?? []);
    await this.saveExamples(b.examples ?? []);
    await this.saveSettings(mergeSettings(b.settings));
    await this.putTm(b.tm ?? []);
  }
}
