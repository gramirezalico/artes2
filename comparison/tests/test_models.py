"""Tests for custom convolution models and the /detect-elements endpoint."""

import base64
import io
import numpy as np
import cv2
import pytest

from models.convolution_filters import ConvolutionFilters
from models.element_detector import ElementDetector, DetectedElement


# ─── Helpers ──────────────────────────────────────────────────────────────

def _make_test_image(width: int = 400, height: int = 400) -> np.ndarray:
    """Create a synthetic design image with text-like, flat, and textured regions."""
    img = np.ones((height, width, 3), dtype=np.uint8) * 240  # light background

    # Text-like region: many horizontal fine lines
    for y in range(50, 130, 8):
        cv2.line(img, (30, y), (200, y), (30, 30, 30), 1)

    # Flat colour block (CTA-like)
    cv2.rectangle(img, (250, 50), (380, 100), (0, 120, 255), -1)
    # Small text line inside
    cv2.line(img, (260, 75), (370, 75), (255, 255, 255), 1)

    # Icon-like small shape
    cv2.circle(img, (320, 200), 18, (50, 180, 50), 2)
    cv2.line(img, (310, 200), (330, 200), (50, 180, 50), 2)
    cv2.line(img, (320, 190), (320, 210), (50, 180, 50), 2)

    # Image-like textured region (random noise patch)
    noise = np.random.randint(0, 255, (100, 150, 3), dtype=np.uint8)
    img[250:350, 30:180] = noise

    # Logo-like compact graphic
    pts = np.array([[280, 280], [310, 250], [340, 280], [310, 310]], np.int32)
    cv2.fillPoly(img, [pts], (180, 0, 180))
    cv2.polylines(img, [pts], True, (80, 0, 80), 2)

    return img


def _img_to_b64(img: np.ndarray) -> str:
    _, buf = cv2.imencode('.jpg', img)
    return base64.b64encode(buf).decode('utf-8')


# ═══════════════════════════════════════════════════════════════════════════
# ConvolutionFilters unit tests
# ═══════════════════════════════════════════════════════════════════════════

class TestConvolutionFilters:

    def test_multi_edge_response_shape(self):
        gray = np.random.randint(0, 255, (100, 100), dtype=np.uint8)
        result = ConvolutionFilters.multi_edge_response(gray)
        assert result.shape == (100, 100)
        assert result.dtype == np.uint8

    def test_multi_edge_response_detects_edges(self):
        # Create image with a sharp vertical edge
        gray = np.zeros((100, 100), dtype=np.uint8)
        gray[:, 50:] = 200
        result = ConvolutionFilters.multi_edge_response(gray)
        # Edge should have high values near column 50
        assert np.max(result[:, 48:52]) > 100

    def test_gabor_bank_size(self):
        bank = ConvolutionFilters.build_gabor_bank(thetas=4, sigmas=(3.0,), lambdas=(8.0,))
        assert len(bank) == 4  # 1 sigma * 1 lambda * 4 thetas

    def test_gabor_texture_energy_shape(self):
        gray = np.random.randint(0, 255, (80, 80), dtype=np.uint8)
        energy = ConvolutionFilters.gabor_texture_energy(gray)
        assert energy.shape == (80, 80)
        assert energy.dtype == np.uint8

    def test_high_frequency_map(self):
        gray = np.zeros((100, 100), dtype=np.uint8)
        # Add some detail
        gray[30:35, 30:70] = 200
        hf = ConvolutionFilters.high_frequency_map(gray)
        assert hf.shape == (100, 100)
        # Region with detail should have non-zero high frequency
        assert np.sum(hf[30:35, 30:70]) > 0

    def test_text_density_map(self):
        gray = np.ones((200, 200), dtype=np.uint8) * 240
        # Draw horizontal lines to simulate text
        for y in range(40, 160, 8):
            cv2.line(gray, (20, y), (180, y), 30, 1)
        density = ConvolutionFilters.text_density_map(gray)
        assert density.shape == (200, 200)
        # Text region should be mostly filled
        assert np.mean(density[40:160, 20:180]) > 50

    def test_flat_color_mask(self):
        img = np.ones((100, 100, 3), dtype=np.uint8) * 128
        # Solid block
        img[20:80, 20:80] = [0, 100, 200]
        mask = ConvolutionFilters.flat_color_mask(img)
        assert mask.shape == (100, 100)
        # Flat regions should be white in mask
        assert np.mean(mask[30:70, 30:70]) > 200

    def test_kernel_shapes(self):
        """All static kernels should be 3x3 float32."""
        for name in ('EDGE_HORIZONTAL', 'EDGE_VERTICAL', 'EDGE_DIAGONAL_45',
                      'EDGE_DIAGONAL_135', 'SHARPEN', 'EMBOSS'):
            k = getattr(ConvolutionFilters, name)
            assert k.shape == (3, 3), f"{name} has wrong shape"
            assert k.dtype == np.float32, f"{name} has wrong dtype"


# ═══════════════════════════════════════════════════════════════════════════
# ElementDetector unit tests
# ═══════════════════════════════════════════════════════════════════════════

class TestElementDetector:

    def test_detect_returns_list(self):
        img = _make_test_image()
        detector = ElementDetector()
        elements = detector.detect(img)
        assert isinstance(elements, list)
        for elem in elements:
            assert isinstance(elem, DetectedElement)

    def test_detected_element_fields(self):
        img = _make_test_image()
        detector = ElementDetector()
        elements = detector.detect(img)
        if elements:
            e = elements[0]
            assert e.element_type in ElementDetector.ELEMENT_TYPES
            assert 0 <= e.confidence <= 1.0
            assert all(k in e.bbox for k in ('x', 'y', 'w', 'h'))
            assert e.area_percent >= 0

    def test_detect_finds_regions_in_complex_image(self):
        img = _make_test_image()
        detector = ElementDetector(min_area_ratio=0.001)
        elements = detector.detect(img)
        # We placed at least 4 distinct regions
        assert len(elements) >= 1

    def test_detect_and_compare(self):
        master = _make_test_image()
        # Slightly altered sample
        sample = master.copy()
        cv2.rectangle(sample, (30, 30), (120, 50), (0, 0, 255), -1)
        detector = ElementDetector()
        result = detector.detect_and_compare(master, sample)
        assert "master_elements" in result
        assert "sample_elements" in result
        assert "summary" in result
        assert "changes" in result

    def test_detect_blank_image(self):
        blank = np.ones((200, 200, 3), dtype=np.uint8) * 255
        detector = ElementDetector()
        elements = detector.detect(blank)
        # Blank image should have zero or very few detections
        assert len(elements) <= 1

    def test_to_dict(self):
        img = _make_test_image()
        detector = ElementDetector()
        elements = detector.detect(img)
        if elements:
            d = elements[0].to_dict()
            assert isinstance(d, dict)
            assert "element_type" in d
            assert "bbox" in d

    def test_merge_bboxes(self):
        detector = ElementDetector(merge_gap=10)
        bboxes = [(10, 10, 20, 20), (25, 10, 20, 20)]  # Adjacent, should merge
        merged = detector._merge_bboxes(bboxes)
        assert len(merged) == 1

    def test_merge_bboxes_separate(self):
        detector = ElementDetector(merge_gap=5)
        bboxes = [(10, 10, 20, 20), (100, 100, 20, 20)]  # Far apart
        merged = detector._merge_bboxes(bboxes)
        assert len(merged) == 2


# ═══════════════════════════════════════════════════════════════════════════
# FastAPI endpoint integration tests
# ═══════════════════════════════════════════════════════════════════════════

class TestDetectElementsEndpoint:

    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient
        from app import app
        return TestClient(app)

    def test_detect_single_image(self, client):
        img = _make_test_image()
        b64 = _img_to_b64(img)
        resp = client.post("/detect-elements", json={"image": b64})
        assert resp.status_code == 200
        data = resp.json()
        assert "elements" in data
        assert isinstance(data["elements"], list)

    def test_detect_compare_two_images(self, client):
        master = _make_test_image()
        sample = master.copy()
        cv2.rectangle(sample, (30, 30), (120, 50), (0, 0, 255), -1)
        resp = client.post("/detect-elements", json={
            "image": _img_to_b64(sample),
            "master_image": _img_to_b64(master),
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "master_elements" in data
        assert "sample_elements" in data
        assert "summary" in data

    def test_detect_invalid_image(self, client):
        # Valid base64 encoding but not a valid image
        b64_invalid = base64.b64encode(b"this is not an image").decode("utf-8")
        resp = client.post("/detect-elements", json={"image": b64_invalid})
        assert resp.status_code == 400

    def test_health_endpoint(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
