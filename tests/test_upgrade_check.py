import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('upgrade_check',Path(__file__).parents[1]/'scripts/router-upgrade-check.py')
upgrade=importlib.util.module_from_spec(spec)
spec.loader.exec_module(upgrade)


class UpgradeSafeguards(unittest.TestCase):
    def test_image_checksum_failure_prevents_platform_validation(self):
        with patch.object(upgrade,'digest',return_value='0'*64), patch.object(upgrade,'command') as command:
            with self.assertRaisesRegex(RuntimeError,'checksum'):
                upgrade.validate_image(Path('candidate.img.gz'))
            command.assert_not_called()

    def test_installer_iso_is_never_accepted(self):
        with patch.object(upgrade,'digest',return_value=upgrade.IMAGE_SHA), patch.object(upgrade,'command') as command:
            with self.assertRaisesRegex(RuntimeError,'checksum'):
                upgrade.validate_image(Path('installer.iso'))
            command.assert_not_called()

    def test_platform_rejection_propagates_without_flash(self):
        with patch.object(upgrade,'digest',return_value=upgrade.IMAGE_SHA), patch.object(upgrade,'command',side_effect=RuntimeError('Invalid image type')), patch.object(os,'execv') as flash:
            with self.assertRaisesRegex(RuntimeError,'Invalid image'):
                upgrade.validate_image(Path('candidate.img.gz'))
            flash.assert_not_called()

    def test_existing_containers_block_upgrade(self):
        with patch.object(upgrade,'command',return_value='existing-container'):
            with self.assertRaisesRegex(RuntimeError,'containers or volumes'):
                upgrade.empty_app_state()

    def test_existing_volumes_block_upgrade(self):
        with patch.object(upgrade,'command',side_effect=['','existing-volume']):
            with self.assertRaisesRegex(RuntimeError,'containers or volumes'):
                upgrade.empty_app_state()

    def test_flash_requires_saved_successful_preflight(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            previous=os.umask(0o077)
            try:
                with patch.object(upgrade,'__file__',str(Path(directory)/'check.py')), patch.object(upgrade,'identify'), patch.object(upgrade,'command',return_value=''), patch.object(upgrade,'empty_app_state'), patch.object(upgrade,'validate_image'), patch.object(os,'execv') as flash, patch('sys.argv',['check','--flash','--expect-hardware-uuid','97b3d07b-5b50-4662-9d1e-86f3fa22a857']), patch('sys.stdout',new_callable=io.StringIO):
                    self.assertEqual(upgrade.main(),1)
                    flash.assert_not_called()
                report=json.loads((Path(directory)/'upgrade-preflight.json').read_text())
                self.assertFalse(report['success'])
                self.assertFalse(report['release_ready'])
            finally:
                os.umask(previous)


if __name__=='__main__':
    unittest.main()
