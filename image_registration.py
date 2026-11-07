"""Validate a known input canvas when feature-based geometry is unobservable."""
from __future__ import annotations

import cv2
import numpy as np


def frame_alignment(original, redraw):
    """Use frame coordinates only when local visible content supports that choice.

    This does not estimate an unobservable affine. Compare low frequencies at
    input resolution so added super-resolution detail does not become an error.
    Local worst-case checks keep small missing words or new objects observable.
    """
    height, width = original.shape[:2]
    edge = min(1.0, 768 / max(width, height))
    size = (max(1, round(width * edge)), max(1, round(height * edge)))
    reference = cv2.resize(original, size, interpolation=cv2.INTER_AREA)
    returned = cv2.resize(redraw, size, interpolation=cv2.INTER_AREA)
    reference = cv2.GaussianBlur(reference.astype(np.float32), (0, 0), 2.0)
    returned = cv2.GaussianBlur(returned.astype(np.float32), (0, 0), 2.0)
    difference = np.max(np.abs(reference - returned), axis=2)
    window = max(4, min(32, min(size) // 8))
    local = cv2.boxFilter(difference, -1, (window, window), normalize=True,
                          borderType=cv2.BORDER_REFLECT_101)
    mean_error = float(difference.mean())
    local_error = float(local.max())

    def edges(image):
        gray = cv2.cvtColor(np.clip(image, 0, 255).astype(np.uint8), cv2.COLOR_BGR2GRAY)
        return cv2.Canny(gray, 20, 60)

    reference_edges, returned_edges = edges(reference), edges(returned)
    tolerance = max(1.0, 2.5 * edge)

    def unmatched(source, target):
        if not np.any(source):
            return 0, 0
        distance = cv2.distanceTransform(255 - target, cv2.DIST_L2, 3)
        missing = ((source > 0) & (distance > tolerance)).astype(np.uint8)
        count = int(missing.sum())
        _, _, components, _ = cv2.connectedComponentsWithStats(missing, connectivity=8)
        largest = int(components[1:, cv2.CC_STAT_AREA].max()) if len(components) > 1 else 0
        return count, largest

    lost, lost_segment = unmatched(reference_edges, returned_edges)
    added, added_segment = unmatched(returned_edges, reference_edges)
    segment_limit = max(6, round(min(size) * .015))
    # Inspect native coordinates as well: a thumbnail may erase a small glyph.
    native = cv2.resize(redraw, (width, height), interpolation=cv2.INTER_AREA)
    largest_change = 0
    for top in range(0, height, 512):
        for left in range(0, width, 512):
            bottom, right = min(height, top + 512), min(width, left + 512)
            y0, x0 = max(0, top - 8), max(0, left - 8)
            y1, x1 = min(height, bottom + 8), min(width, right + 8)
            a = cv2.GaussianBlur(original[y0:y1, x0:x1], (0, 0), 2.0)
            b = cv2.GaussianBlur(native[y0:y1, x0:x1], (0, 0), 2.0)
            delta = np.max(cv2.absdiff(a, b), axis=2)[top-y0:bottom-y0, left-x0:right-x0]
            _, _, components, _ = cv2.connectedComponentsWithStats((delta > 40).astype(np.uint8), connectivity=8)
            if len(components) > 1:
                largest_change = max(largest_change, int(components[1:, cv2.CC_STAT_AREA].max()))
    accepted = mean_error <= 18 and local_error <= 32 and max(lost_segment, added_segment) <= segment_limit and largest_change < 4
    matrix = np.array([[1., 0., 0.], [0., 1., 0.]])
    return matrix, {
        'method': 'frame_coordinates/visible_content',
        'geometry_evidence': 'frame_only',
        'warning': '特征不足以估计全局仿射，按已知画幅落位并验证局部可见内容；仍需视觉审核',
        'mean_color_error': mean_error,
        'worst_local_color_error': local_error,
        'unmatched_reference_edges': lost,
        'unmatched_returned_edges': added,
        'largest_unmatched_edge_segment': max(lost_segment, added_segment),
        'edge_segment_limit': segment_limit,
        'largest_native_color_change': largest_change,
        'edge_tolerance_original_pixels': tolerance / edge,
        'validation_size': list(size),
        'matrix': matrix.tolist(),
        'accepted': accepted,
    }
