"""Conservative classification and non-sharpening expansion of smooth backgrounds."""
from __future__ import annotations

import cv2
import numpy as np

VERSION = 1


def classify(image):
    height, width = image.shape[:2]
    scale = min(1., 192 / max(width, height))
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    sample = cv2.resize(image, size, interpolation=cv2.INTER_AREA).astype(np.float32)
    yy, xx = np.mgrid[:size[1], :size[0]]
    powers = [(i, degree-i) for degree in range(5) for i in range(degree+1)]
    def basis(x,y):
        return [x**i * y**j for i,j in powers]
    coordinates = np.stack(basis((xx+.5)/size[0],(yy+.5)/size[1]),axis=-1).reshape(-1,len(powers))
    surface = np.linalg.lstsq(coordinates, sample.reshape(-1, 3), rcond=None)[0]
    error, edges = 0., 0
    # Native windows prevent small text and objects disappearing in the sample.
    for top in range(0, height, 512):
        for left in range(0, width, 512):
            bottom, right = min(height, top + 512), min(width, left + 512)
            y0, x0 = max(0, top - 4), max(0, left - 4)
            y1, x1 = min(height, bottom + 4), min(width, right + 4)
            block = cv2.GaussianBlur(image[y0:y1, x0:x1], (0, 0), .7)
            core = block[top-y0:bottom-y0, left-x0:right-x0]
            x=((np.arange(left,right)+.5)/width)[None,:]
            y=((np.arange(top,bottom)+.5)/height)[:,None]
            expected=sum(weight[...,None]*coefficient for weight,coefficient in zip(basis(x,y),surface))
            error = max(error, float(np.max(np.abs(core.astype(float) - expected))))
            detected = cv2.Canny(cv2.cvtColor(block, cv2.COLOR_BGR2GRAY), 12, 28)
            edges += int(np.count_nonzero(detected[top-y0:bottom-y0, left-x0:right-x0]))
            if error > 6 or edges:
                return {'eligible': False, 'version': VERSION, 'max_smooth_error': error, 'edge_pixels': edges}
    return {'eligible': True, 'version': VERSION, 'method': 'bilinear', 'max_smooth_error': error, 'edge_pixels': edges}
