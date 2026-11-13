import { DEFAULT_SETTINGS } from '../../contracts/defaults.js';
export function isBackup(x) {
    const b = x;
    return !!b && b.format === 'en-json-translator-backup' && b.version === 1 && !!b.meta && Array.isArray(b.entries);
}
const mergeSettings = (s) => ({
    ...DEFAULT_SETTINGS, ...(s ?? {}),
    batch: { ...DEFAULT_SETTINGS.batch, ...(s?.batch ?? {}) },
    retry: { ...DEFAULT_SETTINGS.retry, ...(s?.retry ?? {}) },
    qa: { ...DEFAULT_SETTINGS.qa, ...(s?.qa ?? {}) },
    budget: { ...DEFAULT_SETTINGS.budget, ...(s?.budget ?? {}) },
});
// ---------------- Memory ----------------
export class MemoryStorage {
    meta = null;
    entries = new Map();
    glossary = [];
    characters = [];
    examples = [];
    settings = DEFAULT_SETTINGS;
    tm = new Map();
    audit = [];
    async loadProject() {
        if (!this.meta)
            return null;
        return { meta: this.meta, entries: [...this.entries.values()].sort((a, b) => a.span.start - b.span.start), glossary: this.glossary, characters: this.characters, examples: this.examples, settings: mergeSettings(this.settings) };
    }
    async createProject(meta, entries) { await this.clearProject(); this.meta = meta; for (const e of entries)
        this.entries.set(e.id, e); }
    async putEntries(entries) { for (const e of entries)
        this.entries.set(e.id, structuredClone(e)); }
    async appendAudit(r) { this.audit.push(...r); }
    async saveGlossary(t) { this.glossary = structuredClone(t); }
    async saveCharacters(c) { this.characters = structuredClone(c); }
    async saveExamples(e) { this.examples = structuredClone(e); }
    async saveSettings(s) { this.settings = structuredClone(s); }
    async loadTm() { return [...this.tm.values()]; }
    async putTm(r) { for (const x of r)
        this.tm.set(x.key, x); }
    async clearProject() { this.meta = null; this.entries.clear(); this.glossary = []; this.characters = []; this.examples = []; this.audit = []; }
    async exportBackup() {
        const p = await this.loadProject();
        return p ? { format: 'en-json-translator-backup', version: 1, ...p, tm: await this.loadTm(), exportedAt: Date.now() } : null;
    }
    async importBackup(b) {
        await this.createProject(b.meta, b.entries);
        await this.saveGlossary(b.glossary ?? []);
        await this.saveCharacters(b.characters ?? []);
        await this.saveExamples(b.examples ?? []);
        await this.saveSettings(mergeSettings(b.settings));
        await this.putTm(b.tm ?? []);
    }
}
// ---------------- IndexedDB ----------------
const DB_NAME = 'entr';
const DB_VERSION = 1;
const STORES = ['meta', 'entries', 'glossary', 'characters', 'tm', 'audit', 'kv'];
function req(r) {
    return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
function txDone(tx) {
    return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
}
export class IdbStorage {
    dbp = null;
    open() {
        if (!this.dbp) {
            this.dbp = new Promise((resolve, reject) => {
                const r = indexedDB.open(DB_NAME, DB_VERSION);
                r.onupgradeneeded = () => {
                    const db = r.result;
                    // Migration: thêm store mới theo version ở đây. Không xoá store cũ.
                    if (!db.objectStoreNames.contains('meta'))
                        db.createObjectStore('meta');
                    if (!db.objectStoreNames.contains('entries'))
                        db.createObjectStore('entries', { keyPath: 'id' });
                    if (!db.objectStoreNames.contains('glossary'))
                        db.createObjectStore('glossary', { keyPath: 'id' });
                    if (!db.objectStoreNames.contains('characters'))
                        db.createObjectStore('characters', { keyPath: 'id' });
                    if (!db.objectStoreNames.contains('tm'))
                        db.createObjectStore('tm', { keyPath: 'key' });
                    if (!db.objectStoreNames.contains('audit'))
                        db.createObjectStore('audit', { autoIncrement: true });
                    if (!db.objectStoreNames.contains('kv'))
                        db.createObjectStore('kv');
                };
                r.onsuccess = () => resolve(r.result);
                r.onerror = () => reject(r.error);
                r.onblocked = () => reject(new Error('IndexedDB bị chặn bởi tab khác. Hãy đóng các tab cũ.'));
            });
        }
        return this.dbp;
    }
    async run(stores, mode, fn) {
        const db = await this.open();
        const tx = db.transaction(stores, mode);
        const done = txDone(tx);
        const out = await fn(tx);
        await done;
        return out;
    }
    async requestPersistence() {
        try {
            return (await navigator.storage?.persist?.()) ?? false;
        }
        catch {
            return false;
        }
    }
    async loadProject() {
        return this.run(['meta', 'entries', 'glossary', 'characters', 'kv'], 'readonly', async (tx) => {
            const meta = (await req(tx.objectStore('meta').get('project')));
            if (!meta)
                return null;
            const entries = (await req(tx.objectStore('entries').getAll()));
            entries.sort((a, b) => a.span.start - b.span.start);
            const glossary = (await req(tx.objectStore('glossary').getAll()));
            const characters = (await req(tx.objectStore('characters').getAll()));
            const settings = (await req(tx.objectStore('kv').get('settings')));
            const examples = (await req(tx.objectStore('kv').get('examples'))) ?? [];
            return { meta, entries, glossary, characters, examples, settings: mergeSettings(settings) };
        });
    }
    async createProject(meta, entries) {
        await this.run(['meta', 'entries', 'glossary', 'characters', 'audit', 'kv'], 'readwrite', (tx) => {
            for (const s of ['entries', 'glossary', 'characters', 'audit'])
                tx.objectStore(s).clear();
            tx.objectStore('kv').delete('examples');
            tx.objectStore('meta').put(meta, 'project');
            const es = tx.objectStore('entries');
            for (const e of entries)
                es.put(e);
        });
    }
    async putEntries(entries) {
        if (!entries.length)
            return;
        await this.run(['entries', 'meta'], 'readwrite', async (tx) => {
            const es = tx.objectStore('entries');
            for (const e of entries)
                es.put(e);
            const m = (await req(tx.objectStore('meta').get('project')));
            if (m)
                tx.objectStore('meta').put({ ...m, updatedAt: Date.now() }, 'project');
        });
    }
    async appendAudit(records) {
        if (!records.length)
            return;
        await this.run(['audit'], 'readwrite', (tx) => { const s = tx.objectStore('audit'); for (const r of records)
            s.add(r); });
    }
    async replaceStore(name, rows) {
        await this.run([name], 'readwrite', (tx) => { const s = tx.objectStore(name); s.clear(); for (const r of rows)
            s.put(r); });
    }
    saveGlossary(t) { return this.replaceStore('glossary', t); }
    saveCharacters(c) { return this.replaceStore('characters', c); }
    async saveExamples(e) { await this.run(['kv'], 'readwrite', (tx) => { tx.objectStore('kv').put(e, 'examples'); }); }
    async saveSettings(s) { await this.run(['kv'], 'readwrite', (tx) => { tx.objectStore('kv').put(s, 'settings'); }); }
    async loadTm() { return this.run(['tm'], 'readonly', (tx) => req(tx.objectStore('tm').getAll())); }
    async putTm(records) {
        if (!records.length)
            return;
        await this.run(['tm'], 'readwrite', (tx) => { const s = tx.objectStore('tm'); for (const r of records)
            s.put(r); });
    }
    async clearProject() {
        await this.run(['meta', 'entries', 'glossary', 'characters', 'audit', 'kv'], 'readwrite', (tx) => {
            for (const s of ['meta', 'entries', 'glossary', 'characters', 'audit', 'kv'])
                tx.objectStore(s).clear();
        });
    }
    async exportBackup() {
        const p = await this.loadProject();
        return p ? { format: 'en-json-translator-backup', version: 1, ...p, tm: await this.loadTm(), exportedAt: Date.now() } : null;
    }
    async importBackup(b) {
        await this.createProject(b.meta, b.entries);
        await this.saveGlossary(b.glossary ?? []);
        await this.saveCharacters(b.characters ?? []);
        await this.saveExamples(b.examples ?? []);
        await this.saveSettings(mergeSettings(b.settings));
        await this.putTm(b.tm ?? []);
    }
}
