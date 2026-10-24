import importlib.util
import io
from pathlib import Path
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('build', ROOT / 'tools/build.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class PackageTests(unittest.TestCase):
    def test_flat_import_layout_and_exact_payload(self):
        payload = build.archive_bytes(build.release_files())
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            self.assertEqual(set(archive.namelist()), set(build.PROFILE) | {'LICENSE', 'NOTICE.md'})
            self.assertEqual(archive.read('scripts/main.lua'), build.entry())
            self.assertIsNone(archive.testzip())
            self.assertTrue(all(not x.startswith(('/', '../')) and '\\' not in x for x in archive.namelist()))
        self.assertEqual(build.ARCHIVE, 'Ratshaker-Win64-Shipping.zip')

    def test_reproducible(self):
        files = build.release_files()
        self.assertEqual(build.archive_bytes(files), build.archive_bytes(dict(reversed(list(files.items())))))

    def test_profile_is_portable(self):
        for name, data in build.release_files().items():
            self.assertNotIn(b'C:\\Users\\', data, name)
            self.assertNotIn(b'/Users/', data, name)
            self.assertNotIn(b'can-x20', data, name)
        config = (ROOT / 'profile/config.txt').read_text()
        self.assertNotIn('VR_RenderingResolution', config)
        self.assertNotIn('VR_SnapTurnAngle', config)
        self.assertIn('UObjectHook_EnabledAtStartup=true', config)


if __name__ == '__main__':
    unittest.main()
