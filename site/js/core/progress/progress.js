export function computeProgress(entries) {
    const s = {
        total: entries.length, pending: 0, translating: 0, translated: 0, qaFailed: 0, retrying: 0,
        reviewRequired: 0, verified: 0, excluded: 0, needsClassifyReview: 0, translatedPct: 0, verifiedPct: 0,
    };
    for (const e of entries) {
        switch (e.status) {
            case 'PENDING':
                s.pending++;
                break;
            case 'TRANSLATING':
                s.translating++;
                break;
            case 'TRANSLATED':
                s.translated++;
                break;
            case 'QA_FAILED':
                s.qaFailed++;
                break;
            case 'RETRYING':
                s.retrying++;
                break;
            case 'REVIEW_REQUIRED':
                s.reviewRequired++;
                break;
            case 'VERIFIED':
                s.verified++;
                break;
            case 'EXCLUDED':
                s.excluded++;
                break;
        }
        if (e.needsClassifyReview && e.status === 'PENDING')
            s.needsClassifyReview++;
    }
    const need = s.total - s.excluded;
    s.translatedPct = need > 0 ? ((s.translated + s.verified + s.qaFailed + s.reviewRequired) / need) * 100 : 100;
    s.verifiedPct = need > 0 ? (s.verified / need) * 100 : 100;
    return s;
}
export function checkCompleteness(entries) {
    const r = {
        total: entries.length, toTranslate: 0, pending: 0, inProgress: 0, translated: 0, verifiedAuto: 0, verifiedHuman: 0,
        excluded: 0, excludedWithoutReason: 0, reviewRequired: 0, qaFailed: 0, unclassified: 0, blockerOpen: 0, majorOpen: 0,
        canFinalize: false, blockers: [],
    };
    for (const e of entries) {
        if (e.status !== 'EXCLUDED')
            r.toTranslate++;
        switch (e.status) {
            case 'PENDING':
                r.pending++;
                if (e.needsClassifyReview)
                    r.unclassified++;
                break;
            case 'TRANSLATING':
            case 'RETRYING':
                r.inProgress++;
                break;
            case 'TRANSLATED':
                r.translated++;
                break;
            case 'VERIFIED':
                if (e.verifiedLevel === 'HUMAN')
                    r.verifiedHuman++;
                else
                    r.verifiedAuto++;
                break;
            case 'EXCLUDED':
                r.excluded++;
                if (!e.excludeReason)
                    r.excludedWithoutReason++;
                break;
            case 'REVIEW_REQUIRED':
                r.reviewRequired++;
                break;
            case 'QA_FAILED':
                r.qaFailed++;
                break;
        }
        if (e.status === 'TRANSLATED' || e.status === 'VERIFIED' || e.status === 'QA_FAILED') {
            for (const i of e.qa?.issues ?? []) {
                if (e.status === 'VERIFIED' && e.verifiedLevel === 'HUMAN')
                    continue; // người dùng đã chấp nhận
                if (i.severity === 'BLOCKER')
                    r.blockerOpen++;
                else if (i.severity === 'MAJOR')
                    r.majorOpen++;
            }
        }
    }
    if (r.pending > 0)
        r.blockers.push(`Còn ${r.pending} chuỗi chưa dịch (PENDING)${r.unclassified ? `, trong đó ${r.unclassified} chuỗi cần xác nhận phân loại` : ''}.`);
    if (r.inProgress > 0)
        r.blockers.push(`Còn ${r.inProgress} chuỗi đang xử lý.`);
    if (r.qaFailed > 0)
        r.blockers.push(`Còn ${r.qaFailed} chuỗi không đạt QA.`);
    if (r.reviewRequired > 0)
        r.blockers.push(`Còn ${r.reviewRequired} chuỗi cần người xem (REVIEW_REQUIRED).`);
    if (r.excludedWithoutReason > 0)
        r.blockers.push(`${r.excludedWithoutReason} chuỗi bị loại trừ nhưng thiếu lý do.`);
    if (r.blockerOpen > 0)
        r.blockers.push(`Còn ${r.blockerOpen} lỗi BLOCKER chưa xử lý.`);
    if (r.majorOpen > 0)
        r.blockers.push(`Còn ${r.majorOpen} lỗi MAJOR chưa xử lý.`);
    r.canFinalize = r.blockers.length === 0 && r.total > 0;
    return r;
}
