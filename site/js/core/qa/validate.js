import { diffTokens, findTokens, stripProtected, tagsBalanced } from './placeholders.js';
import { termRegex } from '../glossary/glossary.js';
const VI_DIACRITIC_RE = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹàáãèéìíòóùúýÀÁÃÈÉÌÍÒÓÙÚÝ]/i;
const EN_STOP = new Set('the and you your to of is are in on for with that this it will be have has from at by not can all or as if when but an we they he she his her their was were been would could should just now into more your our us'.split(' '));
const FOREIGN_SCRIPT_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Thai}\p{Script=Hebrew}]/u;
const PREAMBLE_RE = /^\s*(?:dưới đây là|đây là bản dịch|bản dịch(?: tiếng việt)?\s*[:：]|tiếng việt\s*[:：]|dịch\s*[:：]|translation\s*[:：]|here(?:'s| is)\b|sure[,!]|tất nhiên|chắc chắn rồi)/i;
const words = (s) => s.match(/\p{L}[\p{L}'’-]*/gu) ?? [];
const digitsOf = (s) => (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, ''));
export function leadingWs(s) { return /^\s*/.exec(s)?.[0] ?? ''; }
export function trailingWs(s) { return /\s*$/.exec(s)?.[0] ?? ''; }
export function runQa(original, translation, ctx) {
    const issues = [];
    const add = (code, severity, message, evidence) => issues.push({ code, severity, message, ...(evidence !== undefined ? { evidence } : {}) });
    if (translation === null || translation.trim() === '') {
        add('EMPTY', 'BLOCKER', 'Bản dịch trống.');
        return finish(issues, ctx.now);
    }
    // --- Placeholder / tag / entity / escape (BLOCKER) ---
    const srcTok = findTokens(original);
    const dstTok = findTokens(translation);
    const phDiff = diffTokens(srcTok.filter((t) => t.type === 'placeholder' || t.type === 'escape'), dstTok.filter((t) => t.type === 'placeholder' || t.type === 'escape'));
    if (phDiff.missing.length)
        add('PLACEHOLDER_MISSING', 'BLOCKER', `Thiếu placeholder: ${phDiff.missing.join(' ')}`, phDiff.missing.join(' '));
    if (phDiff.extra.length)
        add('PLACEHOLDER_EXTRA', 'BLOCKER', `Thừa/sai placeholder: ${phDiff.extra.join(' ')}`, phDiff.extra.join(' '));
    const tagDiff = diffTokens(srcTok.filter((t) => t.type === 'tag' || t.type === 'entity'), dstTok.filter((t) => t.type === 'tag' || t.type === 'entity'));
    if (tagDiff.missing.length)
        add('TAG_MISSING', 'BLOCKER', `Thiếu thẻ/entity: ${tagDiff.missing.join(' ')}`, tagDiff.missing.join(' '));
    if (tagDiff.extra.length)
        add('TAG_EXTRA', 'BLOCKER', `Thừa/sai thẻ/entity: ${tagDiff.extra.join(' ')}`, tagDiff.extra.join(' '));
    if (tagsBalanced(original) && !tagsBalanced(translation))
        add('TAG_UNBALANCED', 'BLOCKER', 'Thẻ mở/đóng không cân bằng.');
    // --- Định dạng ---
    const nl = (s) => (s.match(/\n/g) ?? []).length;
    if (nl(original) !== nl(translation))
        add('NEWLINE_MISMATCH', 'MAJOR', `Số dòng khác nhau (gốc ${nl(original)}, dịch ${nl(translation)}).`);
    if (leadingWs(original) !== leadingWs(translation) || trailingWs(original) !== trailingWs(translation)) {
        add('WHITESPACE_EDGE', 'MINOR', 'Khoảng trắng/xuống dòng ở đầu hoặc cuối khác bản gốc.');
    }
    if (translation !== translation.normalize('NFC'))
        add('NOT_NFC', 'MINOR', 'Chưa chuẩn hoá Unicode NFC.');
    // --- Rác từ AI ---
    const t0 = translation.trim();
    if (PREAMBLE_RE.test(t0) && !PREAMBLE_RE.test(original.trim()))
        add('AI_PREAMBLE', 'MAJOR', 'Có lời dẫn của AI trong bản dịch.', t0.slice(0, 40));
    if (/^```|```$/.test(t0))
        add('AI_CODE_FENCE', 'MAJOR', 'Bản dịch bị bọc trong code fence.');
    const wrapped = /^(["“«]).*(["”»])$/s.test(t0);
    if (wrapped && !/^(["“«]).*(["”»])$/s.test(original.trim()))
        add('AI_WRAP_QUOTES', 'MAJOR', 'Bản dịch bị bọc thêm dấu ngoặc kép.');
    // --- Còn tiếng Anh ---
    const srcPlain = stripProtected(original).trim();
    const dstPlain = stripProtected(translation).trim();
    const srcWords = words(srcPlain);
    const dstWords = words(dstPlain);
    const keepTerms = ctx.glossary.filter((g) => g.keepAsIs && termRegex(g).test(original));
    const coveredByKeep = keepTerms.some((g) => srcPlain.toLowerCase() === g.source.toLowerCase());
    if (srcWords.length >= 1 && !coveredByKeep && dstPlain.toLowerCase() === srcPlain.toLowerCase()) {
        if (srcWords.length >= 3)
            add('UNTRANSLATED', 'MAJOR', 'Bản dịch giống hệt bản gốc.');
        else
            add('SAME_AS_SOURCE', 'INFO', 'Bản dịch giống bản gốc (có thể là tên riêng/thuật ngữ).');
    }
    else if (dstWords.length >= 4 && !VI_DIACRITIC_RE.test(dstPlain)) {
        // Loại từ thuộc glossary keepAsIs khi đếm
        const keepWords = new Set(keepTerms.flatMap((k) => words(k.source.toLowerCase())));
        const cand = dstWords.map((w) => w.toLowerCase()).filter((w) => !keepWords.has(w));
        const stop = cand.filter((w) => EN_STOP.has(w)).length;
        if (cand.length >= 4 && stop / cand.length >= 0.25)
            add('STILL_ENGLISH', 'MAJOR', 'Bản dịch có vẻ vẫn là tiếng Anh.');
    }
    // --- Ký tự lạ ---
    if (FOREIGN_SCRIPT_RE.test(translation) && !FOREIGN_SCRIPT_RE.test(original))
        add('FOREIGN_SCRIPT', 'MAJOR', 'Bản dịch chứa chữ viết ngoài Latin (CJK/Cyrillic/...) không có trong bản gốc.');
    // --- Độ dài / lặp ---
    if (original.trim().length >= 8) {
        const ratio = translation.trim().length / original.trim().length;
        if (ratio > ctx.settings.maxLengthRatio) {
            const uiShort = ctx.kind === 'UI' && original.trim().length <= 30;
            add('TOO_LONG', uiShort ? 'MAJOR' : 'MINOR', `Bản dịch dài gấp ${ratio.toFixed(1)} lần gốc.`);
        }
        if (original.trim().length >= 20 && ratio < 0.25)
            add('TOO_SHORT', 'MAJOR', 'Bản dịch ngắn bất thường, có thể thiếu nội dung.');
        if (ratio > 3.5)
            add('RUNAWAY_LENGTH', 'MAJOR', 'Bản dịch dài bất thường so với gốc.');
    }
    if (/((?:\p{L}+\s+){0,2}\p{L}+)(?:\s+\1){3,}/iu.test(translation))
        add('REPETITION', 'MAJOR', 'Có từ lặp lại bất thường.');
    // --- Số ---
    const sd = digitsOf(srcPlain).sort();
    const dd = digitsOf(dstPlain).sort();
    if (sd.join(',') !== dd.join(','))
        add('NUMBER_MISMATCH', 'MAJOR', `Số không khớp (gốc: ${sd.join(' ') || '—'}; dịch: ${dd.join(' ') || '—'}).`);
    // --- Glossary ---
    const dstNfc = translation.normalize('NFC');
    for (const g of ctx.glossary) {
        if (g.source.trim() === '' || !termRegex(g).test(original))
            continue;
        if (g.keepAsIs) {
            const has = g.caseSensitive ? dstNfc.includes(g.source) : dstNfc.toLowerCase().includes(g.source.toLowerCase());
            if (!has)
                add('GLOSSARY_KEEP', 'MAJOR', `Thuật ngữ "${g.source}" cần giữ nguyên.`, g.source);
        }
        else if (g.target.trim() !== '') {
            const tgt = g.target.normalize('NFC');
            const has = g.caseSensitive ? dstNfc.includes(tgt) : dstNfc.toLowerCase().includes(tgt.toLowerCase());
            if (!has)
                add('GLOSSARY_MISMATCH', 'MAJOR', `Thuật ngữ "${g.source}" phải dịch là "${g.target}".`, g.source);
        }
    }
    return finish(issues, ctx.now);
}
function finish(issues, now = Date.now()) {
    let score = 100;
    for (const i of issues)
        score -= i.severity === 'BLOCKER' ? 100 : i.severity === 'MAJOR' ? 25 : i.severity === 'MINOR' ? 5 : 0;
    const passed = !issues.some((i) => i.severity === 'BLOCKER' || i.severity === 'MAJOR');
    return { passed, score: Math.max(0, score), issues, checkedAt: now };
}
export function describeIssues(qa) {
    return qa.issues.filter((i) => i.severity !== 'INFO').map((i) => i.message).join(' | ');
}
