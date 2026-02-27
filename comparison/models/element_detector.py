"""
Design element detector that uses custom convolution filters to identify
and classify regions of an artwork image.

Detectable element types
------------------------
- **text**    – text blocks / paragraphs
- **image**   – photographic or raster imagery
- **logo**    – compact graphical marks (high edge density, small aspect)
- **icon**    – small symbolic graphics
- **cta**     – call-to-action buttons (flat colour + centred text)
- **graphic** – other decorative/vector graphic regions
"""

from __future__ import annotations

import cv2
import numpy as np
from dataclasses import dataclass, asdict
from typing import List

from .convolution_filters import ConvolutionFilters


@dataclass
class DetectedElement:
    """A single design element detected in the image."""
    element_type: str
    confidence: float
    bbox: dict          # {x, y, w, h} normalised 0-1
    area_percent: float
    attributes: dict    # type-specific metadata

    def to_dict(self) -> dict:
        return asdict(self)


class ElementDetector:
    """
    Detect and classify design elements in an image using custom
    convolution filter pipelines.

    Parameters
    ----------
    min_area_ratio : float
        Minimum contour area as fraction of image area to keep (default 0.002).
    merge_gap : int
        Pixel gap to merge nearby contours (default 20).
    """

    ELEMENT_TYPES = ("text", "image", "logo", "icon", "cta", "graphic")

    def __init__(self, min_area_ratio: float = 0.002, merge_gap: int = 20):
        self.min_area_ratio = min_area_ratio
        self.merge_gap = merge_gap
        self._gabor_bank = ConvolutionFilters.build_gabor_bank()

    # ── Public API ────────────────────────────────────────────────────────

    def detect(self, img_bgr: np.ndarray) -> List[DetectedElement]:
        """Run full detection pipeline and return classified elements."""
        h, w = img_bgr.shape[:2]
        total_area = h * w
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)

        # Pre-compute feature maps via convolution filters
        edge_map = ConvolutionFilters.multi_edge_response(gray)
        texture_energy = ConvolutionFilters.gabor_texture_energy(gray, self._gabor_bank)
        text_density = ConvolutionFilters.text_density_map(gray)
        hf_map = ConvolutionFilters.high_frequency_map(gray)
        flat_mask = ConvolutionFilters.flat_color_mask(img_bgr)

        # Extract candidate regions from edges + threshold
        combined = cv2.addWeighted(edge_map, 0.5, hf_map, 0.5, 0)
        _, binary = cv2.threshold(combined, 20, 255, cv2.THRESH_BINARY)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
        binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=2)
        binary = cv2.dilate(binary, kernel, iterations=1)

        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        min_area = int(total_area * self.min_area_ratio)
        bboxes = [cv2.boundingRect(c) for c in contours if cv2.contourArea(c) > min_area]
        bboxes = self._merge_bboxes(bboxes)

        elements: List[DetectedElement] = []
        for (bx, by, bw, bh) in bboxes:
            roi_gray = gray[by:by + bh, bx:bx + bw]
            roi_bgr = img_bgr[by:by + bh, bx:bx + bw]
            roi_edge = edge_map[by:by + bh, bx:bx + bw]
            roi_texture = texture_energy[by:by + bh, bx:bx + bw]
            roi_text = text_density[by:by + bh, bx:bx + bw]
            roi_flat = flat_mask[by:by + bh, bx:bx + bw]

            etype, conf, attrs = self._classify_region(
                roi_gray, roi_bgr, roi_edge, roi_texture,
                roi_text, roi_flat, bw, bh, total_area,
            )

            elements.append(DetectedElement(
                element_type=etype,
                confidence=round(conf, 3),
                bbox={
                    "x": round(bx / w, 4),
                    "y": round(by / h, 4),
                    "w": round(bw / w, 4),
                    "h": round(bh / h, 4),
                },
                area_percent=round(bw * bh / total_area * 100, 2),
                attributes=attrs,
            ))

        # Sort by area descending
        elements.sort(key=lambda e: e.area_percent, reverse=True)
        return elements

    def detect_and_compare(
        self, master_bgr: np.ndarray, sample_bgr: np.ndarray
    ) -> dict:
        """
        Detect elements in both images and produce a comparative inventory
        summarising what changed between master and sample.
        """
        master_elems = self.detect(master_bgr)
        sample_elems = self.detect(sample_bgr)

        summary = {t: {"master": 0, "sample": 0} for t in self.ELEMENT_TYPES}
        for e in master_elems:
            if e.element_type in summary:
                summary[e.element_type]["master"] += 1
        for e in sample_elems:
            if e.element_type in summary:
                summary[e.element_type]["sample"] += 1

        changes: list = []
        for t in self.ELEMENT_TYPES:
            m_count = summary[t]["master"]
            s_count = summary[t]["sample"]
            if m_count != s_count:
                changes.append({
                    "element_type": t,
                    "master_count": m_count,
                    "sample_count": s_count,
                    "delta": s_count - m_count,
                })

        return {
            "master_elements": [e.to_dict() for e in master_elems],
            "sample_elements": [e.to_dict() for e in sample_elems],
            "summary": summary,
            "changes": changes,
        }

    # ── Classification logic ──────────────────────────────────────────────

    def _classify_region(
        self,
        roi_gray: np.ndarray,
        roi_bgr: np.ndarray,
        roi_edge: np.ndarray,
        roi_texture: np.ndarray,
        roi_text: np.ndarray,
        roi_flat: np.ndarray,
        bw: int,
        bh: int,
        total_area: int,
    ) -> tuple:
        """
        Classify a single region based on convolution feature maps.

        Returns (element_type, confidence, attributes_dict).
        """
        area = bw * bh
        aspect = bw / max(bh, 1)
        area_ratio = area / max(total_area, 1)

        # Feature statistics from convolution maps
        edge_density = float(np.mean(roi_edge) / 255.0)
        texture_mean = float(np.mean(roi_texture) / 255.0)
        text_coverage = float(np.mean(roi_text) / 255.0)
        flat_coverage = float(np.mean(roi_flat) / 255.0)
        intensity_std = float(np.std(roi_gray))

        # Colour uniqueness (number of distinct hues)
        hsv = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2HSV)
        hue_std = float(np.std(hsv[:, :, 0]))
        saturation_mean = float(np.mean(hsv[:, :, 1]) / 255.0)

        attrs = {
            "edge_density": round(edge_density, 3),
            "texture_energy": round(texture_mean, 3),
            "text_coverage": round(text_coverage, 3),
            "flat_coverage": round(flat_coverage, 3),
            "intensity_std": round(intensity_std, 1),
            "aspect_ratio": round(aspect, 2),
            "hue_std": round(hue_std, 1),
            "saturation_mean": round(saturation_mean, 3),
        }

        # ── Decision tree based on convolution features ───────────────────

        # 1) Text blocks: high text density, moderate edge density
        if text_coverage > 0.35 and edge_density > 0.05:
            conf = min(1.0, 0.5 + text_coverage * 0.5)
            return "text", conf, attrs

        # 2) CTA buttons: flat colour + some centred text + wide aspect
        if flat_coverage > 0.50 and text_coverage > 0.15 and 1.5 < aspect < 8.0:
            conf = min(1.0, 0.4 + flat_coverage * 0.3 + text_coverage * 0.3)
            return "cta", conf, attrs

        # 3) Icon: small area, compact shape, high edge density
        if area_ratio < 0.02 and 0.5 < aspect < 2.0 and edge_density > 0.10:
            conf = min(1.0, 0.5 + edge_density * 0.4)
            return "icon", conf, attrs

        # 4) Logo: moderate area, high edge density, moderate texture
        if area_ratio < 0.08 and edge_density > 0.08 and texture_mean > 0.05:
            conf = min(1.0, 0.4 + edge_density * 0.3 + texture_mean * 0.3)
            return "logo", conf, attrs

        # 5) Photographic image: high texture energy, broad hue distribution
        if texture_mean > 0.10 and hue_std > 15 and intensity_std > 30:
            conf = min(1.0, 0.4 + texture_mean * 0.3 + min(hue_std / 60, 0.3))
            return "image", conf, attrs

        # 6) Generic graphic (vector art, decorative element)
        if edge_density > 0.06 or texture_mean > 0.06:
            conf = min(1.0, 0.3 + edge_density * 0.3 + texture_mean * 0.3)
            return "graphic", conf, attrs

        # Fallback
        return "graphic", 0.3, attrs

    # ── Bounding box merge ────────────────────────────────────────────────

    def _merge_bboxes(self, bboxes: list) -> list:
        """Merge nearby bounding boxes."""
        if not bboxes:
            return []

        rects = [[x, y, x + w, y + h] for (x, y, w, h) in bboxes]
        merged = True
        gap = self.merge_gap
        while merged:
            merged = False
            new_rects: list = []
            used: set = set()
            for i in range(len(rects)):
                if i in used:
                    continue
                rx1, ry1, rx2, ry2 = rects[i]
                for j in range(i + 1, len(rects)):
                    if j in used:
                        continue
                    bx1, by1, bx2, by2 = rects[j]
                    if (bx1 - gap <= rx2 and bx2 + gap >= rx1
                            and by1 - gap <= ry2 and by2 + gap >= ry1):
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
