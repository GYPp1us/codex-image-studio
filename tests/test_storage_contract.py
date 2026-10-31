"""Capacity and path-safety contracts, isolated under the workspace build cache."""
import os
import subprocess
import tempfile
import unittest
from collections import namedtuple
from pathlib import Path
from unittest.mock import patch

from storage_manager import Storage, StorageFull, tree_bytes

Disk = namedtuple('Disk', 'total used free')


class StorageContractTests(unittest.TestCase):
    def setUp(self):
        base = Path(__file__).resolve().parent.parent / '.build-cache' / 'overhaul' / 'test-data'
        base.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='storage-', dir=base)
        self.base = Path(self.temp.name)
        self.root = self.base / 'studio'
        self.root.mkdir()
        (self.root / 'assets').mkdir()
        (self.root / 'assets' / 'one.bin').write_bytes(b'a' * 100)
        self.limit = 0
        self.storage = Storage(self.root, lambda: self.limit)

    def tearDown(self):
        self.temp.cleanup()

    def test_disk_fields_unlimited_and_limited_availability(self):
        with patch('storage_manager.shutil.disk_usage', return_value=Disk(1000, 700, 300)):
            state = self.storage.usage(True)
            self.assertEqual(state['bytes'], 100)
            self.assertEqual((state['disk_total_bytes'], state['disk_used_bytes'], state['free_bytes']), (1000, 700, 300))
            self.assertEqual(state['available_bytes'], 300)
            self.limit = 250
            self.assertEqual(self.storage.usage(True)['available_bytes'], 150)
            self.limit = 1000
            self.assertEqual(self.storage.usage(True)['available_bytes'], 300)
            self.limit = 50
            self.assertEqual(self.storage.usage(True)['available_bytes'], 0)

    def test_cached_usage_recomputes_limit_without_recount_and_clamps_overage(self):
        with patch('storage_manager.shutil.disk_usage', return_value=Disk(1000, 700, 300)) as disk:
            self.storage.usage(True)
            for limit, available in ((0,300), (250,150), (50,0), (1000,300), (0,300)):
                self.limit = limit
                state = self.storage.usage()
                self.assertEqual((state['limit_bytes'], state['available_bytes']), (limit, available))
            self.assertEqual(disk.call_count, 1)

    def test_require_distinguishes_quota_from_actual_disk(self):
        with patch('storage_manager.shutil.disk_usage', return_value=Disk(1000, 700, 300)):
            self.limit = 150
            self.storage.require(50)
            with self.assertRaises(StorageFull): self.storage.require(51)
            self.limit = 0
            self.storage.require(300)
            with self.assertRaises(StorageFull): self.storage.require(301)

    def test_outside_root_refused_and_directory_link_not_followed(self):
        outside = self.base / 'outside'
        outside.mkdir()
        victim = outside / 'keep.txt'
        victim.write_bytes(b'secret' * 100)
        with self.assertRaises(ValueError): self.storage.remove(victim)
        self.assertTrue(victim.is_file())
        link = self.root / 'jobs' / 'link'
        link.parent.mkdir()
        try:
            link.symlink_to(outside, target_is_directory=True)
        except OSError as error:
            self.skipTest(f'directory symlink unavailable: {error}')
        self.assertEqual(tree_bytes(link.parent), 0)
        self.storage.remove(link)
        self.assertTrue(victim.is_file())
        self.assertFalse(link.exists())

    @unittest.skipUnless(os.name == 'nt', 'Windows junction case')
    def test_windows_junction_is_never_followed_or_removed_outside_root(self):
        outside = self.base / 'outside-junction'
        outside.mkdir()
        victim = outside / 'keep.txt'
        victim.write_bytes(b'secret' * 100)
        folder = self.root / 'jobs'
        folder.mkdir()
        junction = folder / 'junction'
        result = subprocess.run(['cmd', '/c', 'mklink', '/J', str(junction), str(outside)], capture_output=True, text=True)
        if result.returncode:
            self.skipTest('junction creation unavailable')
        try:
            self.assertEqual(tree_bytes(junction), 0, 'direct accounting must not traverse a junction')
            self.assertEqual(tree_bytes(folder), 0, 'accounting must not traverse a junction')
            try:
                self.storage.remove(junction)
            except ValueError:
                pass
            self.assertTrue(victim.is_file())
        finally:
            if junction.exists():
                os.rmdir(junction)

    @unittest.skipUnless(os.name == 'nt', 'Windows junction case')
    def test_recursive_delete_parent_does_not_delete_junction_target(self):
        outside = self.base / 'outside-recursive'
        outside.mkdir()
        victim = outside / 'keep.txt'
        victim.write_bytes(b'keep')
        folder = self.root / 'jobs'
        folder.mkdir()
        junction = folder / 'junction'
        result = subprocess.run(['cmd', '/c', 'mklink', '/J', str(junction), str(outside)], capture_output=True, text=True)
        if result.returncode:
            self.skipTest('junction creation unavailable')
        try:
            self.storage.remove(folder)
            self.assertTrue(victim.is_file())
            self.assertEqual(victim.read_bytes(), b'keep')
        finally:
            if junction.exists():
                os.rmdir(junction)
