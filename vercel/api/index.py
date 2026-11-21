#!/usr/bin/env python3
"""Screen-translation server — drop-in replacement for api.phimtat.vn/dich-man-hinh.

Contract:
  POST /dich-man-hinh  (multipart: image file, source, target)
  -> {"imageBase64": "<raw base64 JPEG>"}  or  {"error": true, "message": "..."}

Pipeline: Gemini Vision (primary) -> OCR + Google Translate fallback.
Renderer blends translated text into the photo (blurred local
background + feathered edge) instead of flat solid boxes.
"""
import base64
import io
import json
import os
import re
import statistics
import sys
import time
import urllib.request

import requests
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# Primary engine: Gemini Vision via the custom.gemini connector (the real
# API key stays in the vault; requests carry a surrogate credential).
# On a hosted deploy (e.g. Hugging Face Spaces) the connector is absent,
# so GEMINI_API_KEY from the host's secret/env is used instead — the key
# is never written into this file. Set it in the host's Secrets panel.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
GEMINI_HOST = "generativelanguage.googleapis.com"
# Probed 2026-11-20 with Hazie's key: the 2.5 family returns 404 for new
# users; gemini-3-flash-preview 429-ed under heavy testing while
# gemini-3.1-flash-lite stayed fast and clean — lite leads.
GEMINI_MODELS = ["gemini-3.1-flash-lite", "gemini-3-flash-preview"]
GEMINI_PROMPT = """You are a professional game localizer. The screenshot contains
text in English or Chinese (Simplified or Traditional). Translate it
into Vietnamese.

Scan the ENTIRE image — it may be portrait or landscape. It may contain
20-40 text elements, including small ones near the bottom. Do not stop
early: include every single text element you can see. Pay special
attention to SMALL text on cards, buttons and labels — read it carefully
instead of skipping it.
If the same text appears in several places, include EVERY occurrence —
never deduplicate.

Include card names and titles (the large stylized text at the top of
each card), headings, tab names and menu labels - do not skip titles
or names. Each box must fully contain the glyphs of its line,
including ascenders, descenders and diacritics - never clip the top
or bottom of the text.

Group the words of one visual line into ONE element with ONE box that
covers the whole line. For each element output:
- "box": its tight bounding box as [ymin, xmin, ymax, xmax], coordinates
  normalized to 0-1000.
- "vi": its translation into Vietnamese — natural, concise game-UI style.
  Keep numbers, stats and proper names unchanged. Translate each element
  on its own: never merge text from separate elements, columns or tiles,
  and never join two elements into one entry.
Skip elements that are already Vietnamese, pure icons, or pure numbers.
Output ONLY a JSON array, no markdown, no commentary:
[{"box": [ymin, xmin, ymax, xmax], "vi": "..."}]"""


def _gemini_parse_items(text):
    """Parse the model's JSON array; salvage complete objects when the
    array itself is malformed (unescaped quote, truncated tail)."""
    try:
        return json.loads(text)
    except Exception:  # noqa: BLE001
        pass
    items = []
    for m in re.finditer(r"\{[^{}]*\}", text):
        try:
            items.append(json.loads(m.group(0)))
        except Exception:  # noqa: BLE001
            continue
    if items:
        return items
    raise ValueError("unparseable model output")


def _gemini_direct_call(model, image_b64, mime):
    body = {
        "contents": [{
            "parts": [
                {"text": GEMINI_PROMPT},
                {"inlineData": {"mimeType": mime, "data": image_b64}},
            ],
        }],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.1,
            "maxOutputTokens": 8192,
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    url = f"https://{GEMINI_HOST}/v1beta/models/{model}:generateContent"
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json",
                 "x-goog-api-key": GEMINI_API_KEY},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"gemini {e.code}: {e.read()[:80]!r}") from e
    return data


def gemini_translate_image_direct(image_bytes, mime="image/jpeg",
                                  models=None):
    """Same return shape as the connector's translate_image, but with
    the key read from the GEMINI_API_KEY env var (host secret)."""
    image_b64 = base64.b64encode(image_bytes).decode()
    last_err = None
    for model in (models or GEMINI_MODELS):
        t0 = time.time()
        try:
            data = _gemini_direct_call(model, image_b64, mime)
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            items = _gemini_parse_items(text)
            out = []
            for it in items:
                box = it.get("box") or []
                vi = (it.get("vi") or "").strip()
                if len(box) == 4 and vi:
                    out.append({"box": [int(round(float(v))) for v in box],
                                "vi": vi})
            print(f"[gemini-direct] {model} ok: {len(out)} items, "
                  f"{time.time()-t0:.1f}s", flush=True)
            return out
        except Exception as e:  # try the next model
            print(f"[gemini-direct] {model} failed "
                  f"({time.time()-t0:.1f}s): {e}", flush=True)
            last_err = e
    raise RuntimeError(f"gemini failed: {last_err}")


sys.path.insert(
    0, os.path.expanduser("~/workspace/custom-connectors/custom.gemini/bin"))
try:
    import gemini_vision
    _connector_translate = gemini_vision.translate_image
except Exception:  # noqa: BLE001
    gemini_vision = None
    _connector_translate = None

# Direct env-key path wins on a host (no connector there); locally the
# connector path keeps working exactly as before.
if GEMINI_API_KEY:
    gemini_translate_image = gemini_translate_image_direct
else:
    gemini_translate_image = _connector_translate

def _resolve_font():
    sys_font = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    if os.path.exists(sys_font):
        return sys_font
    try:  # serverless hosts ship no fonts: unpack the bundled one to /tmp
        import base64 as _b64
        b64_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "font.b64")
        out = "/tmp/DejaVuSans-Bold.ttf"
        if not os.path.exists(out):
            with open(b64_path, "rb") as f:
                data = _b64.b64decode(f.read())
            with open(out, "wb") as f:
                f.write(data)
        return out
    except Exception:
        return sys_font


FONT_PATH = _resolve_font()
OCR_URL = "https://api.ocr.space/parse/image"
OCR_KEY = "helloworld"
GTX_URL = "https://clients5.google.com/translate_a/t"
UA = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"}

OCR_LANG = {
    "auto": "chs", "zh": "chs", "zh-cn": "chs", "zh-tw": "cht",
    "ja": "jpn", "ko": "kor", "en": "eng", "vi": "vie",
}
GTX_SL = {"auto": "zh-CN", "zh": "zh-CN", "zh-cn": "zh-CN", "zh-tw": "zh-TW"}

app = FastAPI()


def err(msg: str):
    return JSONResponse({"error": True, "message": msg})


# ---------------------------------------------------------------- OCR
def ocr_words(img_bytes: bytes, lang: str):
    """Return list of words {text,left,top,width,height} using ocr.space overlay."""
    last_exc = None
    for engine in ("2", "1"):
        try:
            r = requests.post(
                OCR_URL,
                files={"file": ("screen.jpg", img_bytes, "image/jpeg")},
                data={
                    "apikey": OCR_KEY,
                    "isOverlayRequired": "true",
                    "language": lang,
                    "OCREngine": engine,
                    "scale": "true",
                },
                timeout=90,
            )
            data = r.json()
            if data.get("IsErroredOnProcessing"):
                last_exc = RuntimeError(str(data.get("ErrorMessage"))[:120])
                continue
            results = data.get("ParsedResults") or []
            if not results:
                continue
            overlay = results[0].get("TextOverlay") or {}
            words = []
            for line in overlay.get("Lines", []):
                for w in line.get("Words", []):
                    words.append({
                        "text": w["WordText"],
                        "left": int(w["Left"]), "top": int(w["Top"]),
                        "width": int(w["Width"]), "height": int(w["Height"]),
                    })
            if words:
                return words
        except Exception as e:  # noqa: BLE001
            last_exc = e
    if last_exc:
        raise RuntimeError(f"OCR loi: {last_exc}") from last_exc
    return []


def _is_cjk(ch):
    return ("一" <= ch <= "鿿" or "぀" <= ch <= "ヿ"
            or "가" <= ch <= "힯")


def join_words(words):
    """Join OCR words: tight between CJK chars, spaced otherwise."""
    out = ""
    for w in words:
        t = w["text"]
        if not out:
            out = t
            continue
        if _is_cjk(out[-1]) and _is_cjk(t[0]):
            out += t
        else:
            out += " " + t
    return out


def group_lines(words):
    """Group words into lines by vertical overlap AND horizontal proximity."""
    words = sorted(words, key=lambda w: (w["top"], w["left"]))
    lines = []
    for w in words:
        placed = False
        for ln in lines:
            top = min(x["top"] for x in ln)
            bot = max(x["top"] + x["height"] for x in ln)
            left = min(x["left"] for x in ln)
            right = max(x["left"] + x["width"] for x in ln)
            wbot = w["top"] + w["height"]
            overlap = min(bot, wbot) - max(top, w["top"])
            gap = max(w["left"] - right, left - (w["left"] + w["width"]), 0)
            if overlap > 0.4 * min(w["height"], bot - top) \
                    and gap < max(60, 1.6 * (bot - top)):
                ln.append(w)
                placed = True
                break
        if not placed:
            lines.append([w])
    out = []
    for ln in lines:
        ln.sort(key=lambda w: w["left"])
        left = min(x["left"] for x in ln)
        top = min(x["top"] for x in ln)
        right = max(x["left"] + x["width"] for x in ln)
        bot = max(x["top"] + x["height"] for x in ln)
        out.append({"text": join_words(ln), "left": left, "top": top,
                    "width": right - left, "height": bot - top})
    out.sort(key=lambda l: l["top"])
    return out


# ---------------------------------------------------------------- translate
def gtx_translate(texts, sl, tl):
    """Google Translate via the clients5 (dict-chrome-ex) endpoint.

    Supports multiple q params per request -> one batched call for all lines.
    Returns a list of translations aligned with `texts`.
    """
    def call(qs):
        params = [("client", "dict-chrome-ex"), ("sl", sl), ("tl", tl)]
        params += [("q", q) for q in qs]
        r = requests.get(GTX_URL, params=params, headers=UA, timeout=20)
        data = r.json()
        if isinstance(data, str):
            return [data]
        return [str(x) for x in data]

    def one(q):
        return call([q])[0]

    if len(texts) == 1:
        return [one(texts[0])]
    # batch in chunks so the URL stays well under limits
    out = []
    chunk, chunk_len = [], 0
    chunks = []
    for t in texts:
        chunk.append(t)
        chunk_len += len(t) + 10
        if chunk_len > 1500:
            chunks.append(chunk)
            chunk, chunk_len = [], 0
    if chunk:
        chunks.append(chunk)
    try:
        for ch in chunks:
            res = call(ch)
            if len(res) != len(ch):
                raise ValueError("batch count mismatch")
            out.extend(x.strip() for x in res)
        return out
    except Exception:  # noqa: BLE001
        return [one(t).strip() for t in texts]


# ---------------------------------------------------------------- render
def median_border_color(img, box):
    x0, y0, x1, y1 = box
    px = img.load()
    W, H = img.size
    rs, gs, bs = [], [], []
    for x in range(max(0, x0), min(W, x1 + 1), 2):
        for y in (y0, y1):
            if 0 <= y < H:
                r, g, b = px[x, y][:3]
                rs.append(r); gs.append(g); bs.append(b)
    for y in range(max(0, y0), min(H, y1 + 1), 2):
        for x in (x0, x1):
            if 0 <= x < W:
                r, g, b = px[x, y][:3]
                rs.append(r); gs.append(g); bs.append(b)
    if not rs:
        return (0, 0, 0)
    return (int(statistics.median(rs)), int(statistics.median(gs)),
            int(statistics.median(bs)))


def fit_font(draw, text, box_w, start_size):
    size = max(8, int(start_size))
    while size > 8:
        font = ImageFont.truetype(FONT_PATH, size)
        w = draw.textlength(text, font=font)
        if w <= box_w:
            return font
        size = int(size * 0.9)
    return ImageFont.truetype(FONT_PATH, 8)


def wrap_text(draw, text, font, max_w):
    words = text.split()
    lines, cur = [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=font) <= max_w or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def blended_patch(img, box, feather=10):
    """Erase the source text inside `box` without leaving a visible
    solid square: fill the box with a strongly blurred copy of the
    original region (local colours and gradients survive, glyphs are
    destroyed), blended with the local median colour to kill any
    residual glyph ghosts, and paste it back through a feathered mask
    so the edge melts into the surrounding art."""
    W, H = img.size
    x0, y0, x1, y1 = box
    fx0, fy0 = max(0, x0 - feather), max(0, y0 - feather)
    fx1, fy1 = min(W, x1 + feather), min(H, y1 + feather)
    if fx1 <= fx0 or fy1 <= fy0:
        return
    crop = img.crop((fx0, fy0, fx1, fy1)).copy()
    blur_r = max(8, int(max(1, y1 - y0) * 0.9))
    blurred = crop.filter(ImageFilter.GaussianBlur(blur_r))
    blurred = blurred.filter(ImageFilter.GaussianBlur(blur_r))
    solid = Image.new(crop.mode, crop.size,
                      median_border_color(img, (x0, y0, x1, y1)))
    fill = Image.blend(blurred, solid, 0.45)
    mask = Image.new("L", crop.size, 0)
    mdraw = ImageDraw.Draw(mask)
    mdraw.rectangle([x0 - fx0, y0 - fy0, x1 - fx0, y1 - fy0], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(max(2, feather // 2)))
    img.paste(fill, (fx0, fy0), mask)


def render(img, lines, translations):
    W, H = img.size
    jobs = []
    for ln, tr in zip(lines, translations):
        if not tr.strip():
            continue
        # Erase box: generous padding around the line's own box so no
        # glyph of the original text peeks out above or below the
        # translation. The text itself is drawn inside the line's own
        # (unpadded) box, where the original text sat.
        epad_x = max(3, int(ln["width"] * 0.05))
        epad_y = max(2, int(ln["height"] * 0.30))
        ex0 = max(0, ln["left"] - epad_x)
        ey0 = max(0, ln["top"] - epad_y)
        ex1 = min(W - 1, ln["left"] + ln["width"] + epad_x)
        ey1 = min(H - 1, ln["top"] + ln["height"] + epad_y)
        bg = median_border_color(img, (ex0, ey0, ex1, ey1))
        jobs.append((ln, tr, (ex0, ey0, ex1, ey1), bg))
    # Pass 1: erase every box first, so no patch can paint over a
    # translation drawn for a neighbouring line.
    for _, _, ebox, _ in jobs:
        blended_patch(img, ebox)
    # Pass 2: draw the translations.
    draw = ImageDraw.Draw(img)
    for ln, tr, ebox, bg in jobs:
        lum = (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) / 255.0
        fg = (0, 0, 0) if lum > 0.55 else (255, 255, 255)
        x0, y0 = ln["left"], ln["top"]
        box_w, box_h = ln["width"], ln["height"]
        font = fit_font(draw, tr, box_w * 1.15, box_h * 0.92)
        if font.size < box_h * 0.45 and len(tr) > 12:
            # Multi-line block (e.g. card description): wrap at a
            # readable size instead of one shrunken line. The block may
            # use the erased padding above/below, never more.
            size = max(9, int(box_h * 0.30))
            f2 = ImageFont.truetype(FONT_PATH, size)
            wrapped = wrap_text(draw, tr, f2, box_w * 1.02)
            max_h = (ebox[3] - ebox[1]) * 0.98
            while size > 8 and len(wrapped) * size * 1.25 > max_h:
                size = int(size * 0.9)
                f2 = ImageFont.truetype(FONT_PATH, size)
                wrapped = wrap_text(draw, tr, f2, box_w * 1.02)
            ty = y0 + max(0, (box_h - len(wrapped) * f2.size * 1.25) / 2)
            for wline in wrapped:
                draw.text((x0 + 1, ty), wline, font=f2, fill=fg)
                ty += f2.size * 1.25
            continue
        tw = draw.textlength(tr, font=font)
        tx = x0 + max(0, (box_w - tw) / 2)
        th = font.size * 1.25
        ty = y0 + max(0, (box_h - th) / 2)
        draw.text((tx, ty), tr, font=font, fill=fg)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


# ---------------------------------------------------------------- gemini
def _iou(a, b):
    x0 = max(a["left"], b["left"])
    y0 = max(a["top"], b["top"])
    x1 = min(a["left"] + a["width"], b["left"] + b["width"])
    y1 = min(a["top"] + a["height"], b["top"] + b["height"])
    inter = max(0, x1 - x0) * max(0, y1 - y0)
    union = (a["width"] * a["height"] + b["width"] * b["height"] - inter)
    return inter / union if union else 0.0


def gemini_lines(img):
    """OCR + translate via Gemini Vision: ONE call per screenshot (the
    free tier rate-limits when one screenshot burns several calls). If
    the model returns a lazy near-empty result (<4 items), retry ONCE
    with the alternate model and union both reads. Analysis runs on an
    upscaled copy when the short side is small (landscape screenshots
    arrive ~1600x740; card text is a few px tall at native size)."""
    W, H = img.size
    scale = 1.0
    if min(W, H) < 1100:
        scale = 1100 / min(W, H)
    work = img
    if scale > 1.0:
        work = img.resize((int(W * scale), int(H * scale)), Image.LANCZOS)
    W, H = work.size
    buf = io.BytesIO()
    work.save(buf, format="JPEG", quality=88)
    data = buf.getvalue()

    def to_lines(items):
        out = []
        for it in items:
            ymin, xmin, ymax, xmax = it["box"]
            out.append({
                "left": int(xmin / 1000 * W), "top": int(ymin / 1000 * H),
                "width": int((xmax - xmin) / 1000 * W),
                "height": int((ymax - ymin) / 1000 * H),
                "text": " ".join(it["vi"].split())})
        return out

    lines = to_lines(gemini_translate_image(data, "image/jpeg"))
    if 0 < len(lines) < 4 and len(GEMINI_MODELS) > 1:
        print(f"[gemini] lazy result ({len(lines)}), retry alt model",
              flush=True)
        try:
            alt = gemini_translate_image(
                data, "image/jpeg", models=GEMINI_MODELS[1:])
            lines += to_lines(alt)
        except Exception as e:  # noqa: BLE001
            print(f"[gemini] alt retry failed: {e}", flush=True)
    # Zero lines is a valid answer (screen already Vietnamese): the
    # endpoint returns the original image instead of the OCR fallback.
    if scale > 1.0:
        for ln in lines:
            for k in ("left", "top", "width", "height"):
                ln[k] = int(ln[k] / scale)
    lines.sort(key=lambda l: (l["top"], l["left"]))
    kept = []
    for ln in lines:
        dup = None
        for k in kept:
            if _iou(ln, k) > 0.5:
                dup = k
                break
        if dup is None:
            kept.append(ln)
        elif len(ln["text"]) > len(dup["text"]):
            dup["text"] = ln["text"]
    return kept


# ---------------------------------------------------------------- endpoint
GEMINI_COOLDOWN_UNTIL = 0.0  # skip Gemini while Google rate-limits it


@app.get("/")
def health():
    return {"ok": True, "service": "dich-man-hinh"}


@app.post("/dich-man-hinh")
async def dich(image: UploadFile = File(...), source: str = Form("auto"),
               target: str = Form("vi")):
    global GEMINI_COOLDOWN_UNTIL
    t0 = time.time()
    try:
        raw = await image.read()
        if not raw:
            return err("Khong nhan duoc anh")
        try:  # keep recent request images for debugging
            dbg_dir = os.path.join(
                os.path.dirname(os.path.abspath(__file__)), "debug")
            os.makedirs(dbg_dir, exist_ok=True)
            with open(os.path.join(
                    dbg_dir, f"req_{int(time.time())}.jpg"), "wb") as f:
                f.write(raw)
        except Exception:  # noqa: BLE001
            pass
        img = Image.open(io.BytesIO(raw)).convert("RGB")

        # Gemini Vision first: OCR + translation in one call. Skipped
        # during a rate-limit cooldown so shots go straight to the
        # Google Translate fallback instead of waiting on 429 retries.
        if gemini_translate_image is not None \
                and time.time() >= GEMINI_COOLDOWN_UNTIL:
            try:
                glines = gemini_lines(img)
                if glines:
                    out = render(img, glines, [l["text"] for l in glines])
                    print(f"[dich] gemini {len(glines)} lines, "
                          f"{time.time()-t0:.1f}s", flush=True)
                    return {"imageBase64": base64.b64encode(out).decode()}
                # Nothing to translate (e.g. screen already Vietnamese):
                # hand the original image straight back.
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=85)
                print(f"[dich] nothing to translate, "
                      f"{time.time()-t0:.1f}s", flush=True)
                return {"imageBase64":
                        base64.b64encode(buf.getvalue()).decode()}
            except Exception as e:  # noqa: BLE001
                print(f"[dich] gemini failed, fallback OCR: {e}", flush=True)
                if "429" in str(e):
                    GEMINI_COOLDOWN_UNTIL = time.time() + 60

        lang = OCR_LANG.get((source or "auto").lower(), "chs")
        words = ocr_words(raw, lang)
        if not words:
            return err("Khong doc duoc chu tren anh")
        lines = group_lines(words)
        lines = [l for l in lines if re.search(r"[^\s\W_]", l["text"], re.UNICODE)]
        if not lines:
            return err("Khong doc duoc chu tren anh")

        sl = GTX_SL.get((source or "auto").lower(), source or "zh-CN")
        if (source or "auto").lower() == "auto" and lines:
            alltext = "".join(l["text"] for l in lines)
            cjk = sum(1 for ch in alltext if _is_cjk(ch))
            if alltext and cjk / len(alltext) < 0.15:
                # Probably an English screen: the Chinese OCR engine
                # garbles Latin text, so re-read with the English one.
                words2 = ocr_words(raw, "eng")
                if words2:
                    lines2 = [l for l in group_lines(words2)
                              if re.search(r"[^\s\W_]", l["text"],
                                           re.UNICODE)]
                    if lines2 and sum(len(l["text"]) for l in lines2) \
                            >= len(alltext):
                        lines, sl = lines2, "en"
        translations = gtx_translate([l["text"] for l in lines], sl, target or "vi")

        out = render(img, lines, translations)
        print(f"[dich] {len(lines)} lines, {time.time()-t0:.1f}s", flush=True)
        return {"imageBase64": base64.b64encode(out).decode()}
    except Exception as e:  # noqa: BLE001
        print(f"[dich] ERROR {e}", flush=True)
        return err(str(e)[:120])
