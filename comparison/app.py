"""
QC Print Inspection — Computer Vision Comparison Engine v2

Pixel-level diff (SSIM + absdiff), color Delta-E, OCR text comparison,
contour detection → precise bounding boxes, spelling check, PDF report.
Custom convolution models for design element detection and inventory.
"""

import os, io, base64, logging, math, textwrap, re
from typing import List, Optional
from datetime import datetime

import cv2
import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

# Optional OCR
try:
    import pytesseract
    HAS_OCR = True
except Exception:
    HAS_OCR = False

# Spell checker
try:
    from spellchecker import SpellChecker
    HAS_SPELL = True
except Exception:
    HAS_SPELL = False

# PDF generation
try:
    from reportlab.lib.pagesizes import letter, A4
    from reportlab.lib.units import mm, inch
    from reportlab.lib.colors import HexColor, black, white
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
        Image as RLImage, PageBreak, HRFlowable
    )
    from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
    HAS_PDF = True
except Exception:
    HAS_PDF = False

from models import ElementDetector

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
logger = logging.getLogger("qc-engine")

app = FastAPI(title="QC Comparison Engine", version="2.0.0")

# Default detector instance (re-used when min_area_ratio is the default)
_element_detector = ElementDetector()

# Pre-initialize spell checkers
_spell_cache = {}
def get_spell_checker(lang: str) -> SpellChecker:
    if lang not in _spell_cache:
        _spell_cache[lang] = SpellChecker(language=lang)
    return _spell_cache[lang]


# ═══════════════════════════════════════════════════════════════════════════
# Models
# ═══════════════════════════════════════════════════════════════════════════

class BBox(BaseModel):
    x: float
    y: float
    w: float
    h: float

class Zone(BaseModel):
    x: float
    y: float
    w: float
    h: float

class CompareRequest(BaseModel):
    master_image: str
    sample_image: str
    tolerance: int = 50
    accuracy: int = 50
    zones: List[Zone] = []
    page: int = 1
    check_spelling: bool = False
    spelling_language: str = "es"
    spelling_level: int = 50

class Difference(BaseModel):
    bbox: BBox
    type: str
    severity_suggestion: str
    pixel_diff_percent: float
    color_delta_e: float
    description: str
    master_crop: str
    sample_crop: str

class CompareResponse(BaseModel):
    differences: List[Difference]
    overall_ssim: float
    diff_image: str
    heatmap: str
    master_palette: list
    sample_palette: list
    page: int
    spelling_errors: list = []

class ReportFinding(BaseModel):
    index: int
    type: str
    severity: str
    description: str
    page: int = 1
    pixel_diff_percent: float = 0
    color_delta_e: float = 0
    comment: str = ""
    master_crop: str = ""
    sample_crop: str = ""

class ReportRequest(BaseModel):
    product_name: str
    product_id: str = ""
    description: str = ""
    date: str = ""
    verdict: str = "review"
    overall_ssim: float = 0
    total_findings: int = 0
    critical_count: int = 0
    important_count: int = 0
    minor_count: int = 0
    ignored_count: int = 0
    summary: str = ""
    findings: List[ReportFinding] = []
    master_thumbnail: str = ""
    sample_thumbnail: str = ""


class OcrRequest(BaseModel):
    image: str                     # base64 encoded image (full resolution)
    zone: Optional[Zone] = None    # optional region to crop before OCR
    spelling_language: str = "es"
    check_spelling: bool = True

class OcrWord(BaseModel):
    text: str
    bbox: BBox
    confidence: int

class OcrSpellingError(BaseModel):
    word: str
    bbox: BBox
    confidence: int
    suggestions: list = []

class OcrResponse(BaseModel):
    full_text: str
    words: List[OcrWord] = []
    spelling_errors: List[OcrSpellingError] = []
    annotated_image: str = ""      # base64 annotated crop/image

class DetectElementsRequest(BaseModel):
    image: str                     # base64 encoded image
    master_image: str = ""         # optional second image for comparison
    min_area_ratio: float = 0.002

class DetectedElementModel(BaseModel):
    element_type: str
    confidence: float
    bbox: BBox
    area_percent: float
    attributes: dict

class ElementSummary(BaseModel):
    master: int = 0
    sample: int = 0

class ElementChange(BaseModel):
    element_type: str
    master_count: int
    sample_count: int
    delta: int

class DetectElementsResponse(BaseModel):
    elements: List[DetectedElementModel] = []
    master_elements: List[DetectedElementModel] = []
    sample_elements: List[DetectedElementModel] = []
    summary: dict = {}
    changes: List[ElementChange] = []


# ═══════════════════════════════════════════════════════════════════════════
# Image Utilities
# ═══════════════════════════════════════════════════════════════════════════

def b64_to_cv2(b64_str: str) -> np.ndarray:
    img_bytes = base64.b64decode(b64_str)
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Could not decode image")
    return img

def cv2_to_b64(img: np.ndarray, quality: int = 85) -> str:
    _, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return base64.b64encode(buf).decode('utf-8')

def crop_b64(img: np.ndarray, x: int, y: int, w: int, h: int, max_dim: int = 250) -> str:
    crop = img[max(0,y):y+h, max(0,x):x+w]
    if crop.size == 0:
        return ""
    ch, cw = crop.shape[:2]
    if max(ch, cw) > max_dim:
        scale = max_dim / max(ch, cw)
        crop = cv2.resize(crop, (int(cw * scale), int(ch * scale)))
    return cv2_to_b64(crop, quality=80)

def b64_to_pil(b64_str: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(b64_str)))


def align_sample_to_master(master: np.ndarray, sample: np.ndarray) -> np.ndarray:
    """
    Resize sample to match master dimensions preserving aspect ratio (pad if
    needed), then apply ECC-based alignment to correct small translational
    offsets caused by different scan/render resolutions.
    """
    h, w = master.shape[:2]
    sh, sw = sample.shape[:2]

    # 1. Aspect-ratio-preserving resize + centering
    scale = min(w / sw, h / sh)
    interp = cv2.INTER_AREA if scale < 1 else cv2.INTER_LANCZOS4
    new_sw, new_sh = int(sw * scale), int(sh * scale)
    resized = cv2.resize(sample, (new_sw, new_sh), interpolation=interp)

    if new_sw == w and new_sh == h:
        aligned = resized
    else:
        # Determine background color from master edges for padding
        border = np.concatenate([
            master[0, :].reshape(-1, 3),
            master[-1, :].reshape(-1, 3),
            master[:, 0].reshape(-1, 3),
            master[:, -1].reshape(-1, 3),
        ])
        bg = border.mean(axis=0).astype(np.uint8)
        canvas = np.full((h, w, 3), bg, dtype=np.uint8)
        y_off = (h - new_sh) // 2
        x_off = (w - new_sw) // 2
        canvas[y_off:y_off + new_sh, x_off:x_off + new_sw] = resized
        aligned = canvas

    # 2. ECC translational alignment for sub-pixel correction
    try:
        m_gray = cv2.cvtColor(master, cv2.COLOR_BGR2GRAY)
        a_gray = cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY)
        warp_matrix = np.eye(2, 3, dtype=np.float32)
        criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 50, 1e-4)
        _, warp_matrix = cv2.findTransformECC(
            m_gray, a_gray, warp_matrix, cv2.MOTION_TRANSLATION, criteria
        )
        aligned = cv2.warpAffine(
            aligned, warp_matrix, (w, h),
            flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP,
            borderMode=cv2.BORDER_REPLICATE,
        )
    except cv2.error:
        pass  # ECC may fail on very different images; fall back to resize-only

    return aligned


def crop_design_area(img: np.ndarray, margin_pct: float = 0.03) -> tuple:
    """
    Return a cropped version of *img* that excludes the outer margin where
    print guides, crop marks, and registration marks typically appear.

    Returns (cropped_img, x_offset, y_offset) so callers can map coordinates
    back to the original image.
    """
    h, w = img.shape[:2]
    mx = max(1, int(w * margin_pct))
    my = max(1, int(h * margin_pct))
    return img[my:h - my, mx:w - mx], mx, my


# ═══════════════════════════════════════════════════════════════════════════
# Color Analysis
# ═══════════════════════════════════════════════════════════════════════════

def compute_delta_e(master_crop: np.ndarray, sample_crop: np.ndarray) -> float:
    try:
        m_lab = cv2.cvtColor(master_crop, cv2.COLOR_BGR2LAB).astype(np.float64)
        s_lab = cv2.cvtColor(sample_crop, cv2.COLOR_BGR2LAB).astype(np.float64)
        m_lab[:,:,0] *= 100.0 / 255.0
        m_lab[:,:,1] -= 128.0
        m_lab[:,:,2] -= 128.0
        s_lab[:,:,0] *= 100.0 / 255.0
        s_lab[:,:,1] -= 128.0
        s_lab[:,:,2] -= 128.0
        m_mean = m_lab.reshape(-1, 3).mean(axis=0)
        s_mean = s_lab.reshape(-1, 3).mean(axis=0)
        return float(np.sqrt(np.sum((m_mean - s_mean) ** 2)))
    except Exception:
        return 0.0


def extract_palette(img: np.ndarray, n_colors: int = 6) -> list:
    try:
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        pixels = rgb.reshape(-1, 3).astype(np.float32)
        if len(pixels) > 10000:
            idx = np.random.choice(len(pixels), 10000, replace=False)
            pixels = pixels[idx]
        criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
        _, labels, centers = cv2.kmeans(
            pixels, n_colors, None, criteria, 3, cv2.KMEANS_PP_CENTERS
        )
        centers = centers.astype(int)
        counts = np.bincount(labels.flatten())
        total = len(labels)
        palette = []
        for c, count in sorted(zip(centers, counts), key=lambda x: -x[1]):
            palette.append({
                "hex": "#{:02x}{:02x}{:02x}".format(c[0], c[1], c[2]),
                "usage": f"{round(count / total * 100)}%"
            })
        return palette
    except Exception:
        return []


# ═══════════════════════════════════════════════════════════════════════════
# Spelling Check
# ═══════════════════════════════════════════════════════════════════════════

MAX_MIXED_LANGUAGES = 3

# Mapping from language codes used in the UI to Tesseract language codes
LANG_TO_TESS = {
    'es': 'spa', 'en': 'eng', 'fr': 'fra', 'de': 'deu', 'it': 'ita',
    'pt': 'por', 'nl': 'nld', 'ru': 'rus', 'zh': 'chi_sim', 'ja': 'jpn',
    'ko': 'kor', 'ar': 'ara', 'hi': 'hin', 'pl': 'pol', 'tr': 'tur',
    'vi': 'vie', 'th': 'tha', 'sv': 'swe', 'da': 'dan', 'fi': 'fin',
    'no': 'nor', 'cs': 'ces', 'ro': 'ron', 'hu': 'hun', 'el': 'ell',
    'he': 'heb', 'id': 'ind', 'ms': 'msa', 'uk': 'ukr', 'ca': 'cat',
    # Allow Tesseract native codes to pass through
    'spa': 'spa', 'eng': 'eng', 'fra': 'fra', 'deu': 'deu', 'por': 'por',
}

# Mapping from language codes to SpellChecker language codes
LANG_TO_SPELL = {
    'es': 'es', 'en': 'en', 'fr': 'fr', 'de': 'de', 'it': 'it',
    'pt': 'pt', 'ru': 'ru', 'ar': 'ar', 'pl': 'pl', 'tr': 'tr',
    'spa': 'es', 'eng': 'en', 'fra': 'fr', 'deu': 'de', 'por': 'pt',
}


def build_tesseract_lang(languages: list) -> str:
    """Convert a list of language codes to a Tesseract lang string (e.g. 'spa+eng')."""
    tess_codes = []
    for lang in languages:
        code = LANG_TO_TESS.get(lang.strip(), lang.strip())
        if code and code not in tess_codes:
            tess_codes.append(code)
    return '+'.join(tess_codes) if tess_codes else 'eng'


_IGNORE_WORDS = {
    'mg', 'ml', 'kg', 'oz', 'gr', 'lb', 'no', 'si', 'el', 'la', 'en', 'de',
    'un', 'es', 'al', 'lo', 'su', 'por', 'con', 'del', 'los', 'las', 'una',
    'nos', 'les', 'se', 'me', 'te', 'le', 'ii', 'iii', 'iv', 'vi', 'vii',
    'viii', 'ix', 'xi', 'xii', 'etc', 'vs', 'rx', 'ph', 'usp', 'nf',
    'tab', 'cap', 'sol', 'amp', 'vit', 'max', 'min', 'lbs',
}

def _clean_word(w: str) -> str:
    return re.sub(r'^[^\w]+|[^\w]+$', '', w, flags=re.UNICODE)


def check_spelling_in_image(img: np.ndarray, language: str, img_h: int, img_w: int, min_confidence: int = 30) -> list:
    """OCR the image, spell-check extracted text, return misspelled words with bboxes."""
    if not HAS_OCR or not HAS_SPELL:
        return []

    # Build Tesseract lang string from selected languages
    languages = [l.strip() for l in language.split(',') if l.strip()]
    tess_lang = build_tesseract_lang(languages)

    try:
        pil_img = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        data = pytesseract.image_to_data(
            pil_img, lang=tess_lang, config='--psm 6',
            output_type=pytesseract.Output.DICT
        )
    except Exception as e:
        logger.warning(f"OCR failed for spelling: {e}")
        return []

    # Build spell checkers for supported languages
    checkers = []
    for lang in languages[:MAX_MIXED_LANGUAGES]:
        spell_code = LANG_TO_SPELL.get(lang.strip())
        if spell_code:
            try:
                checkers.append(get_spell_checker(spell_code))
            except Exception:
                pass
    if not checkers:
        try:
            checkers.append(get_spell_checker('es'))
        except Exception:
            return []

    # Detect if any CJK language is selected
    has_cjk = any(l.strip() in ('zh', 'ja', 'ko') for l in languages)

    errors = []
    seen_words = set()

    for i in range(len(data['text'])):
        raw = data['text'][i].strip()
        if not raw:
            continue

        word = _clean_word(raw)
        if not word:
            continue

        # Allow standalone/individual words (min length 1 for all languages including CJK single characters)
        if len(word) < 1:
            continue

        # Accept letters from Latin, Cyrillic, CJK, and Korean scripts
        if not re.match(
            r'^[\w\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF'
            r'\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]+$',
            word, flags=re.UNICODE
        ):
            continue

        lower = word.lower()
        if lower in _IGNORE_WORDS or lower in seen_words:
            continue
        seen_words.add(lower)

        # Skip spell check for CJK characters (no spell checker available)
        is_cjk_word = bool(re.match(
            r'^[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]+$', word
        ))
        if is_cjk_word:
            continue  # CJK words are detected by OCR but not spell-checked

        is_known = any(lower in ch or word in ch for ch in checkers)
        if is_known:
            continue

        suggestions = []
        for checker in checkers:
            candidates = checker.candidates(lower)
            if candidates:
                suggestions.extend(list(candidates)[:3])
        suggestions = list(dict.fromkeys(suggestions))[:5]

        conf = int(data['conf'][i]) if data['conf'][i] != '-1' else 0
        if conf < min_confidence:
            continue

        bx = data['left'][i]
        by = data['top'][i]
        bw = data['width'][i]
        bh = data['height'][i]

        errors.append({
            "word": word,
            "bbox": {
                "x": round(bx / img_w, 4),
                "y": round(by / img_h, 4),
                "w": round(bw / img_w, 4),
                "h": round(bh / img_h, 4)
            },
            "suggestions": suggestions,
            "confidence": conf,
            "source": "sample"
        })

    return errors


def check_spelling_both(master: np.ndarray, sample: np.ndarray, language: str, min_confidence: int = 30) -> list:
    """
    Spell-check both documents. Classify errors:
      - In sample only → introduced error (critical)
      - In both → pre-existing error (minor)
      - In master only → was fixed (info)
    """
    h, w = master.shape[:2]
    master_errors = check_spelling_in_image(master, language, h, w, min_confidence)
    sample_errors = check_spelling_in_image(sample, language, h, w, min_confidence)

    master_words = {e['word'].lower() for e in master_errors}
    sample_words = {e['word'].lower() for e in sample_errors}

    results = []
    for err in sample_errors:
        wl = err['word'].lower()
        if wl in master_words:
            err['category'] = 'preexisting'
            err['severity'] = 'minor'
        else:
            err['category'] = 'introduced'
            err['severity'] = 'critical'
        results.append(err)

    for err in master_errors:
        wl = err['word'].lower()
        if wl not in sample_words:
            err['source'] = 'master'
            err['category'] = 'fixed'
            err['severity'] = 'info'
            results.append(err)

    return results


# ═══════════════════════════════════════════════════════════════════════════
# Difference Classification
# ═══════════════════════════════════════════════════════════════════════════

def classify_difference(master_crop: np.ndarray, sample_crop: np.ndarray, delta_e: float, ocr_lang: str = "eng") -> tuple:
    if master_crop.size == 0 or sample_crop.size == 0:
        return "content", "minor", "Diferencia detectada"

    try:
        m_gray = cv2.cvtColor(master_crop, cv2.COLOR_BGR2GRAY)
        s_gray = cv2.cvtColor(sample_crop, cv2.COLOR_BGR2GRAY)
    except Exception:
        return "content", "minor", "Diferencia detectada"

    m_edges = cv2.Canny(m_gray, 50, 150)
    s_edges = cv2.Canny(s_gray, 50, 150)
    edge_diff = cv2.absdiff(m_edges, s_edges)
    edge_change = float(np.mean(edge_diff) / 255.0)

    m_edge_density = float(np.mean(m_edges) / 255.0)
    s_edge_density = float(np.mean(s_edges) / 255.0)
    avg_edge_density = (m_edge_density + s_edge_density) / 2.0

    pixel_diff_val = float(np.mean(cv2.absdiff(m_gray, s_gray)))

    text_changed = False
    master_text = ""
    sample_text = ""
    if HAS_OCR and avg_edge_density > 0.06:
        try:
            master_text = pytesseract.image_to_string(
                Image.fromarray(cv2.cvtColor(master_crop, cv2.COLOR_BGR2RGB)),
                lang=ocr_lang, config='--psm 6'
            ).strip()
            sample_text = pytesseract.image_to_string(
                Image.fromarray(cv2.cvtColor(sample_crop, cv2.COLOR_BGR2RGB)),
                lang=ocr_lang, config='--psm 6'
            ).strip()
            if master_text and sample_text and master_text != sample_text:
                text_changed = True
            elif master_text and not sample_text:
                text_changed = True
            elif not master_text and sample_text:
                text_changed = True
        except Exception:
            pass

    if text_changed:
        mt = master_text[:40] if master_text else "(vacío)"
        st = sample_text[:40] if sample_text else "(vacío)"
        return "typography", "critical", f"Cambio de texto: «{mt}» → «{st}»"

    if edge_change < 0.06 and delta_e > 8:
        sev = "important" if delta_e > 15 else "minor"
        return "color", sev, f"Variación de color (ΔE={delta_e:.1f})"

    if avg_edge_density > 0.10 and edge_change > 0.08:
        return "typography", "critical", "Diferencia en texto o tipografía"

    if edge_change > 0.15:
        return "graphic", "important", "Diferencia en elemento gráfico"

    if pixel_diff_val > 25:
        sev = "important" if pixel_diff_val > 50 else "minor"
        return "content", sev, "Diferencia de contenido detectada"

    return "layout", "minor", "Diferencia menor de diseño"


# ═══════════════════════════════════════════════════════════════════════════
# Bounding Box Merging
# ═══════════════════════════════════════════════════════════════════════════

def merge_bboxes(bboxes: list, min_gap: int = 30) -> list:
    if not bboxes:
        return []

    rects = [[x, y, x + w, y + h] for (x, y, w, h) in bboxes]
    merged = True
    while merged:
        merged = False
        new_rects = []
        used = set()
        for i in range(len(rects)):
            if i in used:
                continue
            rx1, ry1, rx2, ry2 = rects[i]
            for j in range(i + 1, len(rects)):
                if j in used:
                    continue
                bx1, by1, bx2, by2 = rects[j]
                if (bx1 - min_gap <= rx2 and bx2 + min_gap >= rx1 and
                    by1 - min_gap <= ry2 and by2 + min_gap >= ry1):
                    rx1 = min(rx1, bx1)
                    ry1 = min(ry1, by1)
                    rx2 = max(rx2, bx2)
                    ry2 = max(ry2, by2)
                    used.add(j)
                    merged = True
            new_rects.append([rx1, ry1, rx2, ry2])
            used.add(i)
        rects = new_rects

    return [(r[0], r[1], r[2] - r[0], r[3] - r[1]) for r in rects]


# ═══════════════════════════════════════════════════════════════════════════
# Main Comparison Endpoint
# ═══════════════════════════════════════════════════════════════════════════

SEVERITY_COLORS_BGR = {
    "critical":  (71, 71, 255),
    "important": (0, 200, 255),
    "minor":     (237, 82, 83),
}
SPELLING_COLOR_BGR = (0, 140, 255)

# Spelling level → OCR confidence mapping range
SPELL_CONF_MIN = 20
SPELL_CONF_MAX = 80
SPELL_CONF_RANGE = SPELL_CONF_MAX - SPELL_CONF_MIN

@app.post("/compare", response_model=CompareResponse)
async def compare_images(req: CompareRequest):
    logger.info(f"Comparing page {req.page}, tol={req.tolerance}, acc={req.accuracy}, "
                f"zones={len(req.zones)}, spell={req.check_spelling}, lang={req.spelling_language}, "
                f"spell_level={req.spelling_level}")

    master = b64_to_cv2(req.master_image)
    sample = b64_to_cv2(req.sample_image)

    h, w = master.shape[:2]
    sample = align_sample_to_master(master, sample)

    m_gray = cv2.cvtColor(master, cv2.COLOR_BGR2GRAY)
    s_gray = cv2.cvtColor(sample, cv2.COLOR_BGR2GRAY)

    blur_k = max(1, 7 - int(req.accuracy / 100 * 6))
    if blur_k % 2 == 0:
        blur_k += 1
    m_blur = cv2.GaussianBlur(m_gray, (blur_k, blur_k), 0)
    s_blur = cv2.GaussianBlur(s_gray, (blur_k, blur_k), 0)

    win = max(3, min(11, 3 + int(req.accuracy / 100 * 8)))
    if win % 2 == 0:
        win += 1
    win = min(win, min(h, w) - 1)
    if win % 2 == 0:
        win -= 1
    win = max(3, win)

    score, diff_map = structural_similarity(m_blur, s_blur, full=True, win_size=win)
    diff_uint8 = ((1.0 - diff_map) * 255).astype(np.uint8)
    abs_diff = cv2.absdiff(m_gray, s_gray)
    combined = cv2.addWeighted(diff_uint8, 0.6, abs_diff, 0.4, 0)

    thresh_val = max(8, int((req.tolerance / 100) * 70) + 15)
    _, thresh = cv2.threshold(combined, thresh_val, 255, cv2.THRESH_BINARY)

    if req.zones:
        zone_mask = np.zeros((h, w), dtype=np.uint8)
        for z in req.zones:
            zx, zy = int(z.x * w), int(z.y * h)
            zw, zh = int(z.w * w), int(z.h * h)
            zone_mask[zy:zy+zh, zx:zx+zw] = 255
        thresh = cv2.bitwise_and(thresh, zone_mask)

    ks = max(2, 5 - int(req.accuracy / 100 * 3))
    kernel = np.ones((ks, ks), np.uint8)
    thresh = cv2.dilate(thresh, kernel, iterations=2)
    thresh = cv2.erode(thresh, kernel, iterations=1)

    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = max(80, int(w * h * 0.00008))
    bboxes = [cv2.boundingRect(c) for c in contours if cv2.contourArea(c) > min_area]
    merge_gap = max(15, int(min(w, h) * 0.025))
    merged = merge_bboxes(bboxes, min_gap=merge_gap)

    differences = []
    annotated = sample.copy()
    heatmap_color = cv2.applyColorMap(combined, cv2.COLORMAP_JET)
    heatmap_blend = cv2.addWeighted(sample, 0.55, heatmap_color, 0.45, 0)

    # Build Tesseract language string for OCR in difference classification
    sel_languages = [l.strip() for l in req.spelling_language.split(',') if l.strip()]
    ocr_lang = build_tesseract_lang(sel_languages[:MAX_MIXED_LANGUAGES])

    for idx, (bx, by, bw, bh) in enumerate(merged):
        pad = max(8, int(min(bw, bh) * 0.15))
        x1 = max(0, bx - pad)
        y1 = max(0, by - pad)
        x2 = min(w, bx + bw + pad)
        y2 = min(h, by + bh + pad)
        rw, rh = x2 - x1, y2 - y1

        m_crop = master[y1:y2, x1:x2]
        s_crop = sample[y1:y2, x1:x2]
        if m_crop.size == 0 or s_crop.size == 0:
            continue

        delta_e = compute_delta_e(m_crop, s_crop)
        pixel_pct = float(np.mean(cv2.absdiff(
            cv2.cvtColor(m_crop, cv2.COLOR_BGR2GRAY),
            cv2.cvtColor(s_crop, cv2.COLOR_BGR2GRAY)
        )) / 255.0 * 100)

        diff_type, severity, description = classify_difference(m_crop, s_crop, delta_e, ocr_lang)

        color = SEVERITY_COLORS_BGR.get(severity, (200, 200, 200))
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 3)

        label = str(idx + 1)
        fs = 0.65
        th = 2
        (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, fs, th)
        cv2.rectangle(annotated, (x1, y1 - lh - 12), (x1 + lw + 12, y1), color, -1)
        cv2.putText(annotated, label, (x1 + 6, y1 - 6), cv2.FONT_HERSHEY_SIMPLEX, fs, (0, 0, 0), th)
        cv2.rectangle(heatmap_blend, (x1, y1), (x2, y2), (255, 255, 255), 2)

        differences.append(Difference(
            bbox=BBox(x=round(x1/w, 4), y=round(y1/h, 4), w=round(rw/w, 4), h=round(rh/h, 4)),
            type=diff_type,
            severity_suggestion=severity,
            pixel_diff_percent=round(pixel_pct, 2),
            color_delta_e=round(delta_e, 2),
            description=description,
            master_crop=crop_b64(master, x1, y1, rw, rh),
            sample_crop=crop_b64(sample, x1, y1, rw, rh),
        ))

    # ── Spelling check (dual: master vs sample, design area only) ──────
    spelling_errors = []
    if req.check_spelling and HAS_OCR and HAS_SPELL:
        try:
            # Map spelling_level (0-100) to OCR confidence threshold (20-80)
            min_conf = max(SPELL_CONF_MIN, min(SPELL_CONF_MAX,
                          int(SPELL_CONF_MIN + (req.spelling_level / 100) * SPELL_CONF_RANGE)))

            # Crop margins to exclude print guides/marks before OCR
            master_design, mx_off, my_off = crop_design_area(master)
            sample_design, _, _ = crop_design_area(sample)
            dh, dw = master_design.shape[:2]

            raw_errors = check_spelling_both(master_design, sample_design,
                                             req.spelling_language, min_conf)

            # Re-map bboxes from cropped coordinates to full-image coordinates
            for err in raw_errors:
                bb = err['bbox']
                abs_x = bb['x'] * dw + mx_off
                abs_y = bb['y'] * dh + my_off
                abs_w = bb['w'] * dw
                abs_h = bb['h'] * dh
                err['bbox'] = {
                    'x': round(abs_x / w, 4),
                    'y': round(abs_y / h, 4),
                    'w': round(abs_w / w, 4),
                    'h': round(abs_h / h, 4),
                }

            # Only include sample-side errors (introduced and preexisting)
            spelling_errors = [e for e in raw_errors if e.get('source') != 'master']
            logger.info(f"Spelling check: {len(spelling_errors)} issues found (level={req.spelling_level}, conf>={min_conf})")

            for sp_err in spelling_errors:
                bb = sp_err['bbox']
                sx1 = int(bb['x'] * w)
                sy1 = int(bb['y'] * h)
                sx2 = sx1 + int(bb['w'] * w)
                sy2 = sy1 + int(bb['h'] * h)
                cv2.rectangle(annotated, (sx1 - 2, sy1 - 2), (sx2 + 2, sy2 + 2), SPELLING_COLOR_BGR, 2)
                cv2.putText(annotated, "Aa", (sx1, sy1 - 4),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.4, SPELLING_COLOR_BGR, 1)

            for sp_err in spelling_errors:
                sug_text = ', '.join(sp_err.get('suggestions', [])[:3])
                category = sp_err.get('category', 'introduced')
                sev = sp_err.get('severity', 'critical')
                desc = f"Ortografía: «{sp_err['word']}»"
                if category == 'preexisting':
                    desc += " (preexistente)"
                if sug_text:
                    desc += f" · Sugerencias: {sug_text}"

                bb = sp_err['bbox']
                bx_px = int(bb['x'] * w)
                by_px = int(bb['y'] * h)
                bw_px = int(bb['w'] * w)
                bh_px = int(bb['h'] * h)

                differences.append(Difference(
                    bbox=BBox(x=bb['x'], y=bb['y'], w=bb['w'], h=bb['h']),
                    type="spelling",
                    severity_suggestion=sev if sev in ("critical", "important", "minor") else "critical",
                    pixel_diff_percent=0,
                    color_delta_e=0,
                    description=desc,
                    master_crop="",
                    sample_crop=crop_b64(sample, bx_px, by_px, bw_px, bh_px) if bw_px > 0 and bh_px > 0 else "",
                ))
        except Exception as e:
            logger.warning(f"Spelling check failed: {e}")

    severity_order = {"critical": 0, "important": 1, "minor": 2}
    differences.sort(key=lambda d: severity_order.get(d.severity_suggestion, 3))

    master_palette = extract_palette(master)
    sample_palette = extract_palette(sample)

    logger.info(f"Page {req.page}: SSIM={score:.4f}, diffs={len(differences)}, spelling={len(spelling_errors)}")

    return CompareResponse(
        differences=differences,
        overall_ssim=round(float(score), 4),
        diff_image=cv2_to_b64(annotated),
        heatmap=cv2_to_b64(heatmap_blend),
        master_palette=master_palette,
        sample_palette=sample_palette,
        page=req.page,
        spelling_errors=spelling_errors,
    )


# ═══════════════════════════════════════════════════════════════════════════
# PDF Report Generation
# ═══════════════════════════════════════════════════════════════════════════

@app.post("/generate-report")
async def generate_report(req: ReportRequest):
    if not HAS_PDF:
        raise HTTPException(500, "reportlab not installed")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=20*mm, bottomMargin=15*mm,
                            leftMargin=15*mm, rightMargin=15*mm)

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle('Title2', parent=styles['Title'], fontSize=18,
                              textColor=HexColor('#1a1a24'), spaceAfter=6))
    styles.add(ParagraphStyle('SubHead', parent=styles['Heading2'], fontSize=12,
                              textColor=HexColor('#333333'), spaceBefore=10, spaceAfter=5))
    styles.add(ParagraphStyle('Body2', parent=styles['Normal'], fontSize=9,
                              textColor=HexColor('#555555'), leading=13))
    styles.add(ParagraphStyle('SmallCenter', parent=styles['Normal'], fontSize=8,
                              textColor=HexColor('#888888'), alignment=TA_CENTER))

    elements = []

    elements.append(Paragraph("INFORME DE INSPECCIÓN DE CALIDAD", styles['Title2']))
    elements.append(HRFlowable(width="100%", thickness=2, color=HexColor('#E8FF47'), spaceAfter=8))

    date_str = req.date or datetime.now().strftime("%d/%m/%Y %H:%M")
    verdict_map = {"pass": "APROBADO", "review": "EN REVISIÓN", "fail": "RECHAZADO"}
    verdict_text = verdict_map.get(req.verdict, req.verdict.upper())

    meta_data = [
        ["Producto:", req.product_name, "ID:", req.product_id or "N/A"],
        ["Fecha:", date_str, "Veredicto:", verdict_text],
        ["SSIM Global:", f"{req.overall_ssim:.4f}", "Descripción:", req.description or "—"],
    ]
    meta_table = Table(meta_data, colWidths=[70, 150, 70, 150])
    meta_table.setStyle(TableStyle([
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('TEXTCOLOR', (0, 0), (0, -1), HexColor('#888888')),
        ('TEXTCOLOR', (2, 0), (2, -1), HexColor('#888888')),
        ('FONTNAME', (1, 0), (1, -1), 'Helvetica-Bold'),
        ('FONTNAME', (3, 0), (3, -1), 'Helvetica-Bold'),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    elements.append(meta_table)
    elements.append(Spacer(1, 10))

    elements.append(Paragraph("RESUMEN ESTADÍSTICO", styles['SubHead']))
    stats_data = [
        ["Total", "Críticas", "Importantes", "Menores", "Ignoradas"],
        [str(req.total_findings), str(req.critical_count), str(req.important_count),
         str(req.minor_count), str(req.ignored_count)],
    ]
    stats_table = Table(stats_data, colWidths=[88] * 5)
    colors_row = [HexColor('#333'), HexColor('#FF4757'), HexColor('#FFA502'),
                  HexColor('#5352ED'), HexColor('#999999')]
    style_cmds = [
        ('FONTSIZE', (0, 0), (-1, 0), 8),
        ('FONTSIZE', (0, 1), (-1, 1), 16),
        ('FONTNAME', (0, 1), (-1, 1), 'Helvetica-Bold'),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#DDDDDD')),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
    ]
    for i, c in enumerate(colors_row):
        style_cmds.append(('TEXTCOLOR', (i, 1), (i, 1), c))
    stats_table.setStyle(TableStyle(style_cmds))
    elements.append(stats_table)
    elements.append(Spacer(1, 8))

    if req.summary:
        elements.append(Paragraph(f"<b>Resumen:</b> {req.summary}", styles['Body2']))
        elements.append(Spacer(1, 8))

    if req.findings:
        elements.append(Paragraph("DETALLE DE DIFERENCIAS", styles['SubHead']))
        elements.append(HRFlowable(width="100%", thickness=1, color=HexColor('#DDDDDD'), spaceAfter=6))

        severity_colors = {
            "critical": "#FF4757", "important": "#FFA502",
            "minor": "#5352ED", "ignore": "#999999"
        }
        type_labels = {
            "typography": "Tipografía", "color": "Color", "graphic": "Gráfico",
            "content": "Contenido", "layout": "Diseño", "spelling": "Ortografía"
        }

        for f in req.findings:
            sev_color = severity_colors.get(f.severity, "#888")
            type_label = type_labels.get(f.type, f.type)
            sev_label = {"critical": "CRÍTICO", "important": "IMPORTANTE",
                         "minor": "MENOR", "ignore": "IGNORADO"}.get(f.severity, f.severity.upper())

            header_text = (
                f'<font color="{sev_color}"><b>#{f.index}</b></font> '
                f'<font color="#555">[{type_label}]</font> '
                f'<font color="{sev_color}"><b>{sev_label}</b></font> '
                f'<font color="#888">| p.{f.page} | ΔE={f.color_delta_e:.1f} | Diff={f.pixel_diff_percent:.1f}%</font>'
            )
            elements.append(Paragraph(header_text, styles['Body2']))

            desc_text = f.description
            if f.comment:
                desc_text += f"  —  <i>Comentario: {f.comment}</i>"
            elements.append(Paragraph(desc_text, styles['Body2']))

            row_items = []
            crop_w, crop_h = 85*mm/2, 55*mm

            if f.master_crop:
                try:
                    m_io = io.BytesIO(base64.b64decode(f.master_crop))
                    row_items.append(RLImage(m_io, width=crop_w, height=crop_h, kind='proportional'))
                except Exception:
                    row_items.append(Paragraph("(sin imagen)", styles['SmallCenter']))
            else:
                row_items.append(Paragraph("(sin imagen)", styles['SmallCenter']))

            if f.sample_crop:
                try:
                    s_io = io.BytesIO(base64.b64decode(f.sample_crop))
                    row_items.append(RLImage(s_io, width=crop_w, height=crop_h, kind='proportional'))
                except Exception:
                    row_items.append(Paragraph("(sin imagen)", styles['SmallCenter']))
            else:
                row_items.append(Paragraph("(sin imagen)", styles['SmallCenter']))

            if len(row_items) == 2:
                crops_table = Table(
                    [
                        [Paragraph("<b>Maestro</b>", styles['SmallCenter']),
                         Paragraph("<b>Muestra</b>", styles['SmallCenter'])],
                        row_items
                    ],
                    colWidths=[90*mm, 90*mm]
                )
                crops_table.setStyle(TableStyle([
                    ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                    ('BOX', (0, 0), (-1, -1), 0.5, HexColor('#DDDDDD')),
                    ('INNERGRID', (0, 0), (-1, -1), 0.5, HexColor('#EEEEEE')),
                    ('TOPPADDING', (0, 0), (-1, -1), 4),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                ]))
                elements.append(crops_table)

            elements.append(Spacer(1, 8))

    elements.append(Spacer(1, 15))
    elements.append(HRFlowable(width="100%", thickness=1, color=HexColor('#DDDDDD'), spaceAfter=6))
    elements.append(Paragraph(
        f"Generado por QC Inspector — {datetime.now().strftime('%d/%m/%Y %H:%M')}",
        styles['SmallCenter']
    ))

    doc.build(elements)
    pdf_bytes = buf.getvalue()

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="inspeccion_{req.product_id or "reporte"}.pdf"'
        }
    )


# ═══════════════════════════════════════════════════════════════════════════
# Design Element Detection (convolution models)
# ═══════════════════════════════════════════════════════════════════════════

@app.post("/detect-elements", response_model=DetectElementsResponse)
async def detect_elements(req: DetectElementsRequest):
    """
    Detect and classify design elements in an image (or compare two images)
    using custom convolution filter models.

    Returns an inventory of elements: text blocks, images, logos, icons,
    CTAs, and generic graphic regions.
    """
    if req.min_area_ratio == 0.002:
        detector = _element_detector
    else:
        detector = ElementDetector(min_area_ratio=req.min_area_ratio)

    if req.master_image:
        master = b64_to_cv2(req.master_image)
        sample = b64_to_cv2(req.image)
        sample = align_sample_to_master(master, sample)

        result = detector.detect_and_compare(master, sample)
        logger.info(
            f"Element detection (compare): master={len(result['master_elements'])}, "
            f"sample={len(result['sample_elements'])}, changes={len(result['changes'])}"
        )
        return DetectElementsResponse(
            master_elements=[DetectedElementModel(
                element_type=e["element_type"],
                confidence=e["confidence"],
                bbox=BBox(**e["bbox"]),
                area_percent=e["area_percent"],
                attributes=e["attributes"],
            ) for e in result["master_elements"]],
            sample_elements=[DetectedElementModel(
                element_type=e["element_type"],
                confidence=e["confidence"],
                bbox=BBox(**e["bbox"]),
                area_percent=e["area_percent"],
                attributes=e["attributes"],
            ) for e in result["sample_elements"]],
            summary=result["summary"],
            changes=[ElementChange(**c) for c in result["changes"]],
        )
    else:
        img = b64_to_cv2(req.image)
        elements = detector.detect(img)
        logger.info(f"Element detection (single): {len(elements)} elements found")
        return DetectElementsResponse(
            elements=[DetectedElementModel(
                element_type=e.element_type,
                confidence=e.confidence,
                bbox=BBox(**e.bbox),
                area_percent=e.area_percent,
                attributes=e.attributes,
            ) for e in elements],
        )


# ═══════════════════════════════════════════════════════════════════════════
# Standalone OCR + Spell Check (full resolution)
# ═══════════════════════════════════════════════════════════════════════════

SPELLING_ERROR_COLOR_BGR = (0, 140, 255)  # orange for spelling errors

@app.post("/ocr", response_model=OcrResponse)
async def ocr_spell_check(req: OcrRequest):
    """
    Run OCR at full resolution on an image (or a selected region).
    Returns extracted text, word-level bounding boxes, and spelling errors.
    """
    img = b64_to_cv2(req.image)
    h, w = img.shape[:2]

    # Crop to zone if specified (coordinates are normalized 0-1)
    if req.zone:
        zx = max(0, int(req.zone.x * w))
        zy = max(0, int(req.zone.y * h))
        zw = max(1, int(req.zone.w * w))
        zh = max(1, int(req.zone.h * h))
        img = img[zy:zy+zh, zx:zx+zw]
        if img.size == 0:
            raise HTTPException(400, "Selected zone is empty")
        h, w = img.shape[:2]

    if not HAS_OCR:
        raise HTTPException(503, "OCR (Tesseract) is not available")

    languages = [l.strip() for l in req.spelling_language.split(',') if l.strip()]
    tess_lang = build_tesseract_lang(languages[:MAX_MIXED_LANGUAGES])

    try:
        pil_img = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        data = pytesseract.image_to_data(
            pil_img, lang=tess_lang, config='--psm 6',
            output_type=pytesseract.Output.DICT
        )
    except Exception as e:
        logger.warning(f"OCR failed: {e}")
        raise HTTPException(500, f"OCR processing failed: {e}")

    # Collect all words
    words = []
    full_text_parts = []
    for i in range(len(data['text'])):
        raw = data['text'][i].strip()
        if not raw:
            continue
        conf = int(data['conf'][i]) if data['conf'][i] != '-1' else 0
        if conf < 20:
            continue
        bx = data['left'][i]
        by = data['top'][i]
        bw_px = data['width'][i]
        bh_px = data['height'][i]
        words.append(OcrWord(
            text=raw,
            bbox=BBox(
                x=round(bx / w, 4),
                y=round(by / h, 4),
                w=round(bw_px / w, 4),
                h=round(bh_px / h, 4)
            ),
            confidence=conf
        ))
        full_text_parts.append(raw)

    full_text = ' '.join(full_text_parts)

    # Spell checking
    spelling_errors = []
    if req.check_spelling and HAS_SPELL:
        checkers = []
        for lang in languages[:MAX_MIXED_LANGUAGES]:
            spell_code = LANG_TO_SPELL.get(lang.strip())
            if spell_code:
                try:
                    checkers.append(get_spell_checker(spell_code))
                except Exception:
                    pass
        if not checkers:
            try:
                checkers.append(get_spell_checker('es'))
            except Exception:
                pass

        seen_words = set()
        for word_obj in words:
            cleaned = _clean_word(word_obj.text)
            if not cleaned or len(cleaned) < 2:
                continue
            if not re.match(
                r'^[\w\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF'
                r'\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]+$',
                cleaned, flags=re.UNICODE
            ):
                continue
            lower = cleaned.lower()
            if lower in _IGNORE_WORDS or lower in seen_words:
                continue
            seen_words.add(lower)

            # Skip CJK
            if re.match(r'^[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]+$', cleaned):
                continue

            is_known = any(lower in ch or cleaned in ch for ch in checkers)
            if is_known:
                continue

            suggestions = []
            for checker in checkers:
                candidates = checker.candidates(lower)
                if candidates:
                    suggestions.extend(list(candidates)[:3])
            suggestions = list(dict.fromkeys(suggestions))[:5]

            if word_obj.confidence < 30:
                continue

            spelling_errors.append(OcrSpellingError(
                word=cleaned,
                bbox=word_obj.bbox,
                confidence=word_obj.confidence,
                suggestions=suggestions
            ))

    # Build annotated image
    annotated = img.copy()
    for sp_err in spelling_errors:
        bb = sp_err.bbox
        sx1 = int(bb.x * w)
        sy1 = int(bb.y * h)
        sx2 = sx1 + int(bb.w * w)
        sy2 = sy1 + int(bb.h * h)
        cv2.rectangle(annotated, (sx1 - 2, sy1 - 2), (sx2 + 2, sy2 + 2), SPELLING_ERROR_COLOR_BGR, 2)
        cv2.putText(annotated, "Aa", (sx1, sy1 - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, SPELLING_ERROR_COLOR_BGR, 1)

    logger.info(f"OCR: {len(words)} words, {len(spelling_errors)} spelling errors, lang={req.spelling_language}")

    return OcrResponse(
        full_text=full_text,
        words=words,
        spelling_errors=spelling_errors,
        annotated_image=cv2_to_b64(annotated, quality=90)
    )


# ═══════════════════════════════════════════════════════════════════════════
# Health
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "qc-comparison-engine",
        "version": "2.0.0",
        "ocr": HAS_OCR,
        "spell": HAS_SPELL,
        "pdf": HAS_PDF
    }
