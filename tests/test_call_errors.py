import unittest

from call_errors import authentication_status_error


class CallErrorTests(unittest.TestCase):
    def test_real_status_codes_remain_permanent(self):
        for message in ('HTTP 401', '403 Forbidden', '{"status_code":401}', 'request to /api/images returned 403'):
            with self.subTest(message=message):
                self.assertTrue(authentication_status_error(message))

    def test_numeric_ids_and_timestamps_are_not_authentication_errors(self):
        for message in ('invalid image 1793264013831838877', 'job abc403xyz failed', 'pixels 1403x2401'):
            self.assertFalse(authentication_status_error(message))

    def test_image_paths_are_not_authentication_statuses(self):
        for path in ('/tmp/jobs/401/calls/tile-0-1793264013831838877-1/output.png', r'C:\studio\403\tile-401\output.png'):
            self.assertFalse(authentication_status_error(f'cannot identify image file {path!r}'))
