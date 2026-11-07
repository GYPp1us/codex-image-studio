"""Local interpolation is limited to smooth, structure-free tiles."""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import cv2
import numpy as np

import image_runtime as imaging
import smooth_background
import stitch_engine as engine
import upscale_workflow as workflow


class SmoothBackgroundTests(unittest.TestCase):
    def test_classification_rejects_visible_details(self):
        flat = np.full((256, 320, 3), 128, np.uint8)
        gradient = np.tile(np.linspace(70, 180, 320, dtype=np.uint8), (256, 1))
        gradient = np.repeat(gradient[:, :, None], 3, axis=2)
        x = np.linspace(0, 1, 320, dtype=np.float32)
        curved = np.repeat(np.tile((50 + 150*x*x).astype(np.uint8), (256, 1))[:, :, None], 3, axis=2)
        cosine = np.repeat(np.tile((50 + 75*(1-np.cos(x*np.pi))).astype(np.uint8), (256, 1))[:, :, None], 3, axis=2)
        for image in (flat, gradient, curved, cosine):
            self.assertTrue(smooth_background.classify(image)['eligible'])
        line = flat.copy(); cv2.line(line, (40, 110), (280, 110), (0, 0, 0), 1)
        text = flat.copy(); cv2.putText(text, 'Hi', (130, 130), cv2.FONT_HERSHEY_SIMPLEX, .35, (0, 0, 0), 1)
        dot = flat.copy(); cv2.rectangle(dot, (158, 126), (161, 129), (0, 0, 0), -1)
        for image in (line, text, dot):
            self.assertFalse(smooth_background.classify(image)['eligible'])

    def test_interpolation_is_linear_and_preserves_constant_range(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            gradient = np.tile(np.linspace(20, 220, 320, dtype=np.uint8), (256, 1))
            image = np.repeat(gradient[:, :, None], 3, axis=2)
            engine.write_png(folder / 'base.png', image)
            plan = engine.prepare(folder, 4)
            for tile in plan['tiles']:
                index = tile['index']
                result = engine.interpolate_tile(folder, index)
                crop = engine.read_bgr(folder / 'crops' / f'{index}.png')
                actual = engine.read_bgr(folder / 'redraw' / f'{index}.png')
                expected = cv2.resize(crop, tuple(tile['size']), interpolation=cv2.INTER_LINEAR_EXACT)
                self.assertTrue(np.array_equal(actual, expected))
                self.assertGreaterEqual(int(actual.min()), int(crop.min()))
                self.assertLessEqual(int(actual.max()), int(crop.max()))
                self.assertEqual(result['processing'], 'local_interpolation')

    def _exercise_level(self, mixed, repair=False, replace_source=False, repair_after=False, cached_ai=False, local_failure=None):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            image = np.full((256, 320, 3), 128, np.uint8)
            if mixed: cv2.rectangle(image, (35, 35), (85, 85), (0, 0, 0), 2)
            engine.write_png(folder / 'base.png', image)
            plan = engine.layout(320, 256, 4)
            (folder / 'plan.json').write_text(json.dumps(plan), encoding='utf-8')
            if cached_ai:
                engine.prepare(folder, 4)
                for tile in plan['tiles']:
                    crop = engine.read_bgr(folder / 'crops' / f"{tile['index']}.png")
                    engine.write_png(folder / 'redraw' / f"{tile['index']}.png",
                                     cv2.resize(crop, tuple(tile['size']), interpolation=cv2.INTER_CUBIC))
            stage = {'index': 1, 'input_size': [320, 256], 'output_size': [640, 512], 'review_budget': 1}
            manifest = {'stages': [stage]}
            studio = SimpleNamespace(MODEL='fixture', EFFORT='low', DEFAULT_CALL_PROMPT='', CODEX_HOME=folder / 'codex',
                                     STORAGE=SimpleNamespace(require=lambda *args: None),
                                     make_instruction=lambda *args: 'fixture')
            calls = []
            published = []
            def record_progress(*args, **kwargs):
                published.extend(dict(child) for child in kwargs.get('children', []))
            async def run_engine(proxy, jid, directory, command, *args):
                if command == 'prepare': engine.prepare(directory, 4)
                elif command == 'interpolate':
                    if local_failure: raise local_failure('fixture interpolation stopped')
                    engine.interpolate_tile(directory, int(args[1]))
                elif command == 'register': engine.register_tile(directory, int(args[1]))
                elif command == 'compose': engine.compose(directory)
                else: raise AssertionError(command)
            async def call(proxy, jid, directory, name, instruction, refs, model, effort, *args, image=True, expected_size=None, **kwargs):
                calls.append(image)
                proxy.record_cli_call(image)
                if not image: return '{"pass":true,"issues":[]}'
                crop = engine.read_bgr(refs[0])
                result = directory / f'{name}.png'
                engine.write_png(result, cv2.resize(crop, tuple(expected_size), interpolation=cv2.INTER_CUBIC))
                return result
            async def run():
                with patch.object(workflow, 'engine', run_engine), patch.object(workflow, 'cli_call', call), \
                     patch.object(workflow, 'progress', side_effect=record_progress), patch.object(workflow, 'ensure_active'), \
                     patch.object(workflow.upscale_prompts, 'repair_for', side_effect=lambda options, level, index: {'id': 'repair'} if repair and index == 0 else None):
                    return await workflow.run_level(studio, 'fixture', {'max_attempts': 1, 'prompt': ''}, {}, folder,
                                                    stage, manifest, folder / 'manifest.json')
            if local_failure:
                with self.assertRaises(local_failure): asyncio.run(run())
                self.assertEqual(calls, [])
                expected = 'cancelled' if local_failure is asyncio.CancelledError else 'failed'
                self.assertTrue(any(child['state'] == expected for child in published))
                self.assertFalse((folder / 'candidate.png').exists())
                return
            asyncio.run(run())
            if repair_after:
                repair = True
                asyncio.run(run())
            if replace_source:
                engine.write_png(folder / 'base.png', np.full_like(image, 180))
                asyncio.run(run())
                self.assertGreater(float(engine.read_bgr(folder / 'candidate.png').mean()), 175)
                for tile in plan['tiles']:
                    index = tile['index']
                    diag = json.loads((folder / 'diagnostics' / f'local-{index}.json').read_text(encoding='utf-8'))
                    self.assertEqual(diag['source_sha256'], imaging.file_sha(folder / 'crops' / f'{index}.png'))
            return stage, calls, json.loads((folder / 'diagnostics' / 'visual-review.json').read_text(encoding='utf-8'))

    def test_all_smooth_uses_no_model_calls(self):
        stage, calls, review = self._exercise_level(False)
        self.assertEqual(calls, [])
        self.assertEqual(stage['local_tile_count'], 4)
        self.assertEqual(stage['budget']['images'], 0)
        self.assertEqual(stage['budget']['reviews'], 0)
        self.assertEqual(review['method'], 'deterministic_interpolation')

    def test_existing_ai_returns_keep_review_budget_and_origin(self):
        stage, calls, review = self._exercise_level(False, cached_ai=True)
        self.assertEqual(calls, [False])
        self.assertEqual(stage['local_tile_count'], 0)
        self.assertEqual(stage['budget']['reviews'], 1)
        self.assertNotEqual(review.get('method'), 'deterministic_interpolation')

    def test_local_cancellation_preserves_truthful_progress(self):
        self._exercise_level(False, local_failure=asyncio.CancelledError)

    def test_changed_source_invalidates_local_and_composition_checkpoints(self):
        stage, calls, review = self._exercise_level(False, replace_source=True)
        self.assertEqual(calls, [])
        self.assertEqual(stage['budget']['reviews'], 0)
        self.assertEqual(review['method'], 'deterministic_interpolation')

    def test_repair_request_invalidates_legacy_local_checkpoint(self):
        stage, calls, review = self._exercise_level(False, repair_after=True)
        self.assertEqual(calls.count(True), 1)
        self.assertEqual(calls.count(False), 1)
        self.assertEqual(stage['local_tile_count'], 3)
        self.assertEqual(stage['budget']['reviews'], 1)

    def test_smooth_tile_with_repair_request_calls_model_and_review(self):
        stage, calls, review = self._exercise_level(False, repair=True)
        self.assertEqual(stage['local_tile_count'], 3)
        self.assertEqual(calls.count(True), 1)
        self.assertEqual(calls.count(False), 1)
        self.assertEqual(stage['budget']['images'], 1)
        self.assertEqual(stage['budget']['reviews'], 1)

    def test_mixed_tiles_preserve_model_review_and_budget(self):
        stage, calls, review = self._exercise_level(True)
        self.assertGreater(stage['local_tile_count'], 0)
        self.assertLess(stage['local_tile_count'], 4)
        self.assertEqual(calls.count(True), 4 - stage['local_tile_count'])
        self.assertEqual(calls.count(False), 1)
        self.assertEqual(stage['budget']['images'], calls.count(True))
        self.assertEqual(stage['budget']['reviews'], 1)
        self.assertTrue(review['pass'])


if __name__ == '__main__': unittest.main()
