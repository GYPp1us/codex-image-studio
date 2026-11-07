"""Deferred overlap requires real neighbouring mask coverage before release."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np

import stitch_engine as engine


class OverlapCoverageTests(unittest.TestCase):
    def run_case(self, gaps):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            source = np.full((256, 320, 3), 120, np.uint8)
            engine.write_png(folder / 'base.png', source)
            plan = engine.prepare(folder, 4)
            for tile in plan['tiles']:
                crop = engine.read_bgr(folder / 'crops' / f"{tile['index']}.png")
                engine.write_png(folder / 'redraw' / f"{tile['index']}.png", cv2.resize(crop, tuple(tile['size'])))
            for tile in plan['tiles']:
                index = tile['index']
                matrix = np.array([[1., 0., gaps.get(index, 0)], [0., 1., 0.]])
                with patch.object(engine, 'affine_register', return_value=(matrix, {'accepted': True, 'matrix': matrix.tolist()})):
                    metrics = engine.register_tile(folder, index)
                if index in gaps: self.assertGreater(metrics['pending_overlap_pixels'], 0)
            if len(gaps) == 1:
                engine.compose(folder)
                quality = json.loads((folder / 'diagnostics' / 'quality.json').read_text(encoding='utf-8'))
                self.assertEqual(quality['uncovered_pixels'], 0)
            else:
                with self.assertRaisesRegex(engine.StitchError, r'第 \d+ 块.*覆盖.*缺失'):
                    engine.compose(folder)
                self.assertFalse((folder / 'diagnostics' / 'quality.json').exists())

    def test_overlap_real_neighbour_mask_covers_the_gap(self):
        self.run_case({0: -40})

    def test_overlapping_planned_boxes_do_not_prove_real_coverage(self):
        self.run_case({0: -40, 1: 40})

    def test_no_neighbour_in_plan_rejects_immediately(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            engine.write_png(folder / 'base.png', np.full((256, 320, 3), 120, np.uint8))
            plan = engine.prepare(folder, 4)
            crop = engine.read_bgr(folder / 'crops/0.png')
            engine.write_png(folder / 'redraw/0.png', cv2.resize(crop, tuple(plan['tiles'][0]['size'])))
            matrix = np.array([[1., 0., -140.], [0., 1., 0.]])
            with patch.object(engine, 'affine_register', return_value=(matrix, {'accepted': True})):
                with self.assertRaisesRegex(engine.StitchError, '无相邻块可覆盖'):
                    engine.register_tile(folder, 0)


if __name__ == '__main__': unittest.main()
