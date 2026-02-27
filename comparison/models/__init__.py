"""
Custom convolution models for design element detection and analysis.

Provides convolution-based filters and classifiers to identify
design elements (text blocks, images, logos, icons, CTAs) in artwork
for quality inspection review.
"""

from .convolution_filters import ConvolutionFilters
from .element_detector import ElementDetector

__all__ = ["ConvolutionFilters", "ElementDetector"]
