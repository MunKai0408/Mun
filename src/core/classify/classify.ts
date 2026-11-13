// SP-2.4 Classifier: phân loại + phát hiện chuỗi không cần dịch. Không chắc → needsClassifyReview (không tự loại lặng lẽ).
import type { ExcludeReason, StringEntry, StringKind } from '../../contracts/types.js';
import { stripProtected } from '../qa/placeholders.js';

export interface UserRule {
  id: string;
  /** Regex áp lên JSON Pointer */
  pointerRegex?: string;
  /** Regex áp lên giá trị chuỗi */
  valueRegex?: string;
  action: 'EXCLUDE' | 'TRANSLATE';
  kind?: StringKind;
}

export interface ClassifyResult {
  kind: StringKind;
  confidence: number;
  needsReview: boolean;
  exclude?: ExcludeReason;
}

const KIND_WORDS: [StringKind, string[]][] = [
  ['DIALOGUE', ['dialogue', 'dialog', 'dialogs', 'conversation', 'talk', 'speech', 'say', 'says', 'chat', 'cutscene', 'line', 'lines', 'npc_line', 'subtitle', 'subtitles']],
  ['TUTORIAL', ['tutorial', 'tutorials', 'tip', 'tips', 'hint', 'hints', 'guide', 'howto', 'loading', 'help']],
  ['QUEST', ['quest', 'quests', 'mission', 'missions', 'objective', 'objectives', 'achievement', 'achievements', 'task', 'tasks']],
  ['SKILL', ['skill', 'skills', 'ability', 'abilities', 'spell', 'spells', 'talent', 'talents', 'perk', 'perks', 'passive', 'buff', 'debuff']],
  ['ITEM', ['item', 'items', 'weapon', 'weapons', 'armor', 'armour', 'equipment', 'consumable', 'potion', 'material', 'materials', 'gear', 'artifact']],
  ['CHARACTER', ['character', 'characters', 'hero', 'heroes', 'npc', 'npcs', 'enemy', 'enemies', 'monster', 'monsters', 'class', 'classes', 'race', 'races']],
  ['SYSTEM', ['error', 'errors', 'system', 'message', 'messages', 'msg', 'notification', 'notifications', 'warning', 'alert', 'status', 'toast']],
  ['UI', ['ui', 'button', 'buttons', 'btn', 'menu', 'label', 'labels', 'tab', 'tabs', 'hud', 'settings', 'options', 'popup', 'tooltip', 'common', 'general', 'screen', 'window', 'dialog_title']],
  ['DESCRIPTION', ['desc', 'description', 'descriptions', 'flavor', 'flavour', 'lore', 'summary', 'details', 'detail', 'text', 'body']],
];

function splitKeyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function kindFromPath(keyPath: string[]): { kind: StringKind; confidence: number } {
  // Duyệt từ lá lên gốc; key generic (name/title/label chung) không quyết định.
  for (let i = keyPath.length - 1; i >= 0; i--) {
    const seg = keyPath[i] ?? '';
    if (/^\d+$/.test(seg)) continue;
    const tokens = splitKeyTokens(seg);
    for (const [kind, words] of KIND_WORDS) {
      if (tokens.some((t) => words.includes(t)) || words.includes(tokens.join('_'))) {
        return { kind, confidence: i === keyPath.length - 1 ? 0.85 : 0.7 };
      }
    }
  }
  return { kind: 'OTHER', confidence: 0.3 };
}

const ID_KEY_RE = /(^|[_\-.])(id|uid|guid|type|tag|tags|class_name|icon|sprite|prefab|path|url|uri|file|filename|asset|texture|sound|sfx|bgm|color|colour|font|code|slug|locale|lang|version)$/i;
const HEX_COLOR_RE = /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|0x[0-9a-f]{6,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i;
const URL_RE = /^(?:https?:\/\/|ftp:\/\/|www\.|mailto:|res:\/\/|file:\/\/)\S+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const PATH_RE = /^(?:\.{0,2}\/|[A-Za-z]:\\)?[\w\-.@ ]*[\/\\][\w\-.@\/\\ ]*$/;
const FILE_EXT_RE = /^\S+\.(?:png|jpe?g|gif|webp|svg|ogg|mp3|wav|mp4|webm|json|xml|txt|csv|ttf|otf|woff2?|prefab|unity|asset|mat|fbx|obj|ini|cfg|lua|js|ts|css|html?)$/i;
const SNAKE_RE = /^[a-z0-9]+(?:_[a-z0-9]+)+$/i;
const UPPER_SNAKE_RE = /^[A-Z0-9]+(?:_[A-Z0-9]+)+$/;
const CAMEL_RE = /^[a-z]+(?:[A-Z][a-z0-9]*)+$/;
const PASCAL_MULTI_RE = /^(?:[A-Z][a-z0-9]+){2,}$/;
const DOTTED_RE = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;
const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALNUM_MIX_RE = /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9]+$/;
const VI_ONLY_RE = /[ăâđêôơưĂÂĐÊÔƠƯạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ]/;

function nonLatinRatio(s: string): number {
  let letters = 0, nonLatin = 0;
  for (const ch of s) {
    if (/\p{L}/u.test(ch)) {
      letters++;
      if (!/\p{Script=Latin}/u.test(ch)) nonLatin++;
    }
  }
  return letters === 0 ? 0 : nonLatin / letters;
}

export function classifyText(
  original: string,
  keyPath: string[],
  pointer: string,
  rules: UserRule[] = [],
): ClassifyResult {
  const { kind: pathKind, confidence } = kindFromPath(keyPath);
  let kind = pathKind;
  let conf = confidence;
  const base = (over: Partial<ClassifyResult> = {}): ClassifyResult => ({ kind, confidence: conf, needsReview: false, ...over });

  // 1. Luật người dùng (ưu tiên cao nhất)
  for (const r of rules) {
    let hit = true;
    try {
      if (r.pointerRegex && !new RegExp(r.pointerRegex).test(pointer)) hit = false;
      if (r.valueRegex && !new RegExp(r.valueRegex, 'u').test(original)) hit = false;
    } catch { hit = false; }
    if (!r.pointerRegex && !r.valueRegex) hit = false;
    if (hit) {
      if (r.kind) { kind = r.kind; conf = 1; }
      if (r.action === 'EXCLUDE') return base({ exclude: 'USER_RULE', confidence: 1 });
      return base({ confidence: 1 });
    }
  }

  const trimmed = original.trim();
  if (trimmed === '') return base({ exclude: 'EMPTY', confidence: 1 });

  // 2. Không có chữ cái sau khi bỏ placeholder/tag
  const stripped = stripProtected(trimmed).trim();
  if (!/\p{L}/u.test(stripped)) {
    const numeric = /^[\s\d.,:;%+\-*/()×x]+$/u.test(stripped) && /\d/.test(stripped);
    return base({ exclude: numeric ? 'NUMERIC' : 'NO_LETTERS', confidence: 0.95 });
  }

  const noSpace = !/\s/.test(trimmed);

  // 3. Màu / URL / đường dẫn / email
  if (HEX_COLOR_RE.test(trimmed)) return base({ exclude: 'COLOR_OR_HEX', confidence: 0.95 });
  if (URL_RE.test(trimmed) || EMAIL_RE.test(trimmed)) return base({ exclude: 'PATH_OR_URL', confidence: 0.95 });
  if (noSpace && (FILE_EXT_RE.test(trimmed) || (PATH_RE.test(trimmed) && /[\/\\]/.test(trimmed)))) {
    return base({ exclude: 'PATH_OR_URL', confidence: 0.9 });
  }

  // 4. ID / mã kỹ thuật
  if (noSpace) {
    if (UUID_RE.test(trimmed) || UPPER_SNAKE_RE.test(trimmed) || SNAKE_RE.test(trimmed) || CAMEL_RE.test(trimmed) || PASCAL_MULTI_RE.test(trimmed)) {
      // PascalCase nhiều từ ("DarkKnight") có thể là tên riêng → chỉ yêu cầu xem lại
      if (PASCAL_MULTI_RE.test(trimmed) && !CAMEL_RE.test(trimmed)) return base({ needsReview: true, confidence: 0.4 });
      return base({ exclude: 'ID_OR_CODE', confidence: 0.9 });
    }
    if (ALNUM_MIX_RE.test(trimmed) && /\d/.test(trimmed) && trimmed.length >= 4) return base({ exclude: 'ID_OR_CODE', confidence: 0.7, needsReview: true });
    if (DOTTED_RE.test(trimmed) || KEBAB_RE.test(trimmed)) return base({ needsReview: true, confidence: 0.4 });
    const leaf = keyPath[keyPath.length - 1] ?? '';
    if (ID_KEY_RE.test(leaf)) return base({ exclude: 'ID_OR_CODE', confidence: 0.8, needsReview: true });
  }

  // 5. Ngôn ngữ
  if (VI_ONLY_RE.test(trimmed)) return base({ exclude: 'ALREADY_VIETNAMESE', confidence: 0.85 });
  if (nonLatinRatio(stripped) > 0.5) return base({ exclude: 'NOT_ENGLISH', confidence: 0.85 });
  if (/[éèêëñüöäßçåøæœ¿¡]/i.test(stripped) && !/\s/.test(stripped) === false && stripped.split(/\s+/).length >= 3) {
    return base({ needsReview: true, confidence: Math.min(conf, 0.5) });
  }

  // 6. Nội dung gợi ý loại nếu key không rõ
  if (kind === 'OTHER') {
    if (/["“”].+["“”]|^\s*[-—]/.test(trimmed) && trimmed.split(/\s+/).length > 4) { kind = 'DIALOGUE'; conf = 0.45; }
    else if (trimmed.split(/\s+/).length <= 3 && trimmed.length <= 24) { kind = 'UI'; conf = 0.4; }
    else if (trimmed.split(/\s+/).length > 12) { kind = 'DESCRIPTION'; conf = 0.4; }
  }
  return base();
}

/** Áp phân loại cho danh sách entry. Không tạo mảng nếu không đổi (trả bản sao nông). */
export function classifyEntries(entries: StringEntry[], rules: UserRule[] = [], now = Date.now()): StringEntry[] {
  return entries.map((e) => {
    if (e.locked || e.excludeReason === 'USER_MANUAL') return e;
    const r = classifyText(e.original, e.keyPath, e.pointer, rules);
    const next: StringEntry = { ...e, kind: r.kind, kindConfidence: r.confidence, needsClassifyReview: r.needsReview, updatedAt: now };
    if (r.exclude && !r.needsReview) {
      next.status = 'EXCLUDED';
      next.excludeReason = r.exclude;
      next.translation = null;
    } else if (r.exclude && r.needsReview) {
      // Chắc chắn chưa đủ: giữ PENDING nhưng gắn nhãn lý do dự kiến để người dùng quyết định.
      next.excludeReason = r.exclude;
      next.status = 'PENDING';
    }
    return next;
  });
}
