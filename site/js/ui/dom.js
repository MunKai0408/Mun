export function h(tag, props = null, ...children) {
    const el = document.createElement(tag);
    if (props) {
        for (const [k, v] of Object.entries(props)) {
            if (v === undefined || v === null || v === false)
                continue;
            if (k === 'class')
                el.className = String(v);
            else if (k === 'on')
                for (const [ev, fn] of Object.entries(v))
                    el.addEventListener(ev, fn);
            else if (k === 'value')
                el.value = String(v);
            else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open')
                el[k] = !!v;
            else
                el.setAttribute(k, v === true ? '' : String(v));
        }
    }
    const add = (c) => {
        if (c === null || c === undefined || c === false)
            return;
        if (Array.isArray(c))
            c.forEach(add);
        else
            el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    };
    children.forEach(add);
    return el;
}
export function download(name, content, type = 'application/json;charset=utf-8') {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
export function toast(msg, kind = 'info', ms = 4500) {
    let box = document.getElementById('toasts');
    if (!box) {
        box = h('div', { id: 'toasts', 'aria-live': 'polite' });
        document.body.append(box);
    }
    const t = h('div', { class: `toast ${kind}` }, msg);
    box.append(t);
    setTimeout(() => t.remove(), ms);
}
export const fmt = (n) => n.toLocaleString('vi-VN');
export const pct = (n) => `${n.toFixed(n >= 99.95 || n === 0 ? 0 : 1)}%`;
export function readFileText(file) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(r.error);
        r.readAsText(file, 'utf-8');
    });
}
export function pickFile(accept) {
    return new Promise((res) => {
        const i = h('input', { type: 'file', accept, class: 'hidden' });
        i.addEventListener('change', () => { res(i.files?.[0] ?? null); i.remove(); });
        document.body.append(i);
        i.click();
    });
}
