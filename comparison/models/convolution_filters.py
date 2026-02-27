"""
Custom convolution kernels and filter pipelines for design element analysis.

Includes edge detectors, texture analysers (Gabor bank), and
morphological helpers used by ElementDetector.
"""

import numpy as np
import cv2


class ConvolutionFilters:
    """Library of convolution kernels and composite filter operations."""

    # ── Custom edge kernels ───────────────────────────────────────────────

    EDGE_HORIZONTAL = np.array([[-1, -1, -1],
                                 [ 0,  0,  0],
                                 [ 1,  1,  1]], dtype=np.float32)

    EDGE_VERTICAL = np.array([[-1, 0, 1],
                               [-1, 0, 1],
                               [-1, 0, 1]], dtype=np.float32)

    EDGE_DIAGONAL_45 = np.array([[ 0,  1,  1],
                                  [-1,  0,  1],
                                  [-1, -1,  0]], dtype=np.float32)

    EDGE_DIAGONAL_135 = np.array([[ 1,  1,  0],
                                   [ 1,  0, -1],
                                   [ 0, -1, -1]], dtype=np.float32)

    SHARPEN = np.array([[ 0, -1,  0],
                         [-1,  5, -1],
                         [ 0, -1,  0]], dtype=np.float32)

    EMBOSS = np.array([[-2, -1, 0],
                        [-1,  1, 1],
                        [ 0,  1, 2]], dtype=np.float32)

    # ── Gabor filter bank ─────────────────────────────────────────────────

    @staticmethod
    def build_gabor_bank(
        ksize: int = 31,
        sigmas: tuple = (3.0, 5.0),
        thetas: int = 8,
        lambdas: tuple = (8.0, 12.0),
        gamma: float = 0.5,
    ) -> list:
        """Return a list of Gabor kernels spanning orientations and scales."""
        bank = []
        for sigma in sigmas:
            for lam in lambdas:
                for i in range(thetas):
                    theta = i * np.pi / thetas
                    kernel = cv2.getGaborKernel(
                        (ksize, ksize), sigma, theta, lam, gamma, 0, ktype=cv2.CV_32F
                    )
                    kernel /= kernel.sum() + 1e-7
                    bank.append(kernel)
        return bank

    # ── Composite operations ──────────────────────────────────────────────

    @classmethod
    def multi_edge_response(cls, gray: np.ndarray) -> np.ndarray:
        """Combine four directional edge kernels into a single edge map."""
        responses = []
        for kernel in (cls.EDGE_HORIZONTAL, cls.EDGE_VERTICAL,
                       cls.EDGE_DIAGONAL_45, cls.EDGE_DIAGONAL_135):
            resp = cv2.filter2D(gray, cv2.CV_32F, kernel)
            responses.append(np.abs(resp))
        combined = np.max(responses, axis=0)
        combined = np.clip(combined, 0, 255).astype(np.uint8)
        return combined

    @classmethod
    def gabor_texture_energy(cls, gray: np.ndarray, bank: list | None = None) -> np.ndarray:
        """Compute mean texture energy across a Gabor filter bank."""
        if bank is None:
            bank = cls.build_gabor_bank()
        energies = []
        for kernel in bank:
            filtered = cv2.filter2D(gray, cv2.CV_32F, kernel)
            energies.append(np.abs(filtered))
        energy = np.mean(energies, axis=0)
        energy = cv2.normalize(energy, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
        return energy

    @classmethod
    def high_frequency_map(cls, gray: np.ndarray, ksize: int = 5) -> np.ndarray:
        """Isolate high-frequency content (detail/texture regions)."""
        blurred = cv2.GaussianBlur(gray, (ksize, ksize), 0)
        high_freq = cv2.absdiff(gray, blurred)
        return high_freq

    @classmethod
    def text_density_map(cls, gray: np.ndarray) -> np.ndarray:
        """
        Produce a density map highlighting probable text regions
        using morphological closing on edge output.
        """
        edges = cls.multi_edge_response(gray)
        _, binary = cv2.threshold(edges, 30, 255, cv2.THRESH_BINARY)
        # Horizontal closing to merge characters into lines
        kernel_h = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 3))
        closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel_h)
        # Vertical closing to merge lines into blocks
        kernel_v = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 8))
        closed = cv2.morphologyEx(closed, cv2.MORPH_CLOSE, kernel_v)
        # Dilate to consolidate
        kernel_d = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        closed = cv2.dilate(closed, kernel_d, iterations=1)
        return closed

    @classmethod
    def flat_color_mask(cls, img_bgr: np.ndarray, variance_thresh: float = 12.0) -> np.ndarray:
        """
        Mask of regions with low local colour variance (solid/flat colour fills).
        Useful for detecting image backgrounds, colour blocks, and CTA buttons.
        """
        lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
        local_var = cv2.blur(lab ** 2, (15, 15)) - cv2.blur(lab, (15, 15)) ** 2
        total_var = np.sqrt(np.sum(local_var, axis=2))
        mask = (total_var < variance_thresh).astype(np.uint8) * 255
        # Clean up noise
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        return mask
