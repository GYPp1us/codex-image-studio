"""Regression examples for low-evidence frame-coordinate placement."""
import json
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

import stitch_engine as engine
from image_registration import frame_alignment


def samples():
    flat = np.full((256, 320, 3), 128, np.uint8)
    gradient = np.tile(np.linspace(50, 200, 320, dtype=np.uint8), (256, 1))
    gradient = np.repeat(gradient[:, :, None], 3, axis=2)
    line = flat.copy()
    cv2.line(line, (40, 110), (280, 110), (0, 0, 0), 2)
    text = flat.copy()
    cv2.putText(text, 'Hi', (130, 130), cv2.FONT_HERSHEY_SIMPLEX, .35, (0, 0, 0), 1)
    return flat, gradient, line, text


class FrameAlignmentTests(unittest.TestCase):
    def test_prepare_and_register_low_texture(self):
        for original in samples():
            with self.subTest(image=int(original.sum())), tempfile.TemporaryDirectory() as temporary:
                folder = Path(temporary)
                engine.write_png(folder / 'base.png', original)
                plan = engine.prepare(folder, 4)
                self.assertEqual(len(list((folder / 'crops').glob('*.png'))), 4)
                for tile in plan['tiles']:
                    index = tile['index']
                    crop = engine.read_bgr(folder / 'crops' / f'{index}.png')
                    image = cv2.resize(crop, tuple(tile['size']), interpolation=cv2.INTER_CUBIC)
                    engine.write_png(folder / 'redraw' / f'{index}.png', image)
                    metrics = engine.register_tile(folder, index)
                    self.assertTrue(metrics['accepted'])
                    self.assertTrue(engine.alignment_current(folder, index))

    def test_flat_tiles_compose_with_complete_coverage(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            engine.write_png(folder / 'base.png', samples()[0])
            plan = engine.prepare(folder, 4)
            for tile in plan['tiles']:
                index = tile['index']
                crop = engine.read_bgr(folder / 'crops' / f'{index}.png')
                redraw = cv2.resize(crop, tuple(tile['size']), interpolation=cv2.INTER_CUBIC)
                engine.write_png(folder / 'redraw' / f'{index}.png', redraw)
            engine.compose(folder)
            quality = json.loads((folder / 'diagnostics' / 'quality.json').read_text(encoding='utf-8'))
            self.assertEqual(quality['uncovered_pixels'], 0)
            self.assertEqual(quality['dimensions'], plan['output_size'])
            self.assertTrue(all(item['geometry_evidence'] == 'frame_only' for item in quality['alignments']))

    def test_matching_content_and_moderate_color_shift(self):
        for original in samples():
            with self.subTest(image=int(original.sum())):
                redraw = cv2.resize(original, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
                _, metrics = frame_alignment(original, redraw)
                self.assertTrue(metrics['accepted'], metrics)
                self.assertEqual(metrics['geometry_evidence'], 'frame_only')
        flat = samples()[0]
        _, metrics = frame_alignment(flat, np.full_like(flat, 143))
        self.assertTrue(metrics['accepted'], metrics)

    def test_changed_content_and_geometry_are_rejected(self):
        flat, gradient, line, text = samples()
        square = flat.copy()
        cv2.rectangle(square, (158, 126), (163, 131), (0, 0, 0), -1)
        cases = [(flat, square), (square, flat), (text, flat),
                 (line, np.roll(line, 8, axis=0)), (gradient, gradient[:, ::-1]),
                 (flat, np.full_like(flat, 220))]
        for case, (original, redraw) in enumerate(cases):
            with self.subTest(case=case):
                _, metrics = frame_alignment(original, redraw)
                self.assertFalse(metrics['accepted'], metrics)

    def test_small_object_at_large_input_resolution(self):
        original = np.full((2048, 2048, 3), 128, np.uint8)
        redraw = original.copy()
        cv2.rectangle(redraw, (1024, 1024), (1029, 1029), (0, 0, 0), -1)
        _, metrics = frame_alignment(original, redraw)
        self.assertFalse(metrics['accepted'], metrics)

    def test_added_fine_grain_does_not_imply_changed_structure(self):
        flat = samples()[0]
        noise = np.random.default_rng(101).integers(-35, 36, flat.shape)
        redraw = np.clip(flat.astype(np.int16) + noise, 0, 255).astype(np.uint8)
        _, metrics = frame_alignment(flat, redraw)
        self.assertTrue(metrics['accepted'], metrics)


if __name__ == '__main__':
    unittest.main()
