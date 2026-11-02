import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import stitch_engine


class AtomicProgressTests(unittest.TestCase):
    def test_transient_permission_error_retries_atomic_replace(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / 'engine-progress.json'
            target.write_text('{"old": true}', encoding='utf-8')
            real_replace = stitch_engine.os.replace
            calls = []
            def replace(source, destination):
                calls.append((source, destination))
                if len(calls) < 3:
                    self.assertEqual(json.loads(target.read_text()), {'old': True})
                    raise PermissionError('reader holds destination')
                real_replace(source, destination)
            with mock.patch.object(stitch_engine.os, 'replace', side_effect=replace), mock.patch.object(stitch_engine.time, 'sleep'):
                stitch_engine.save_json(target, {'done': 1})
            self.assertEqual(len(calls), 3)
            self.assertEqual(json.loads(target.read_text()), {'done': 1})

    def test_persistent_permission_error_propagates_and_preserves_original(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / 'engine-progress.json'
            target.write_text('{"old": true}', encoding='utf-8')
            with mock.patch.object(stitch_engine.os, 'replace', side_effect=PermissionError('denied')) as replace, mock.patch.object(stitch_engine.time, 'sleep'):
                with self.assertRaises(PermissionError):
                    stitch_engine.save_json(target, {'done': 1})
            self.assertEqual(replace.call_count, 5)
            self.assertEqual(json.loads(target.read_text()), {'old': True})
