"""Exercise the exact OpenWrt image generator and ext4 resize on a Linux runner."""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('normalize',Path(__file__).parents[1]/'firmware/scripts/normalize-ext4-image.py')
normalize=importlib.util.module_from_spec(spec);spec.loader.exec_module(normalize)


class Ext4Image(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('MOCI_MAKE_EXT4FS'),'Needs pinned OpenWrt make_ext4fs on Linux')
    def test_generated_root_checks_clean_and_grows_online(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory);data=folder/'data';data.mkdir()
            (data/'sentinel.txt').write_text('MoCI filesystem contents must survive growth\n')
            image=folder/'root.ext4';mount=folder/'mounted';mount.mkdir()
            subprocess.run([os.environ['MOCI_MAKE_EXT4FS'],'-l','64M','-b','4096',str(image),str(data)],check=True)
            original=normalize.filesystem_identity(image)
            normalize.check_filesystem(image)
            self.assertEqual(normalize.filesystem_identity(image),original)
            with image.open('r+b') as target: target.truncate(512*1024**2)
            loop=subprocess.check_output(['sudo','losetup','--find','--show',str(image)],text=True).strip()
            mounted=False
            try:
                subprocess.run(['sudo','mount',loop,str(mount)],check=True);mounted=True
                before=os.statvfs(mount).f_blocks*os.statvfs(mount).f_frsize
                subprocess.run(['sudo','resize2fs',loop],check=True)
                after=os.statvfs(mount).f_blocks*os.statvfs(mount).f_frsize
                self.assertGreater(after,before*6)
                self.assertEqual((mount/'sentinel.txt').read_text(),'MoCI filesystem contents must survive growth\n')
            finally:
                if mounted: subprocess.run(['sudo','umount',str(mount)],check=True)
                subprocess.run(['sudo','losetup','--detach',loop],check=True)


if __name__=='__main__': unittest.main()
