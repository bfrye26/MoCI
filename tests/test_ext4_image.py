"""Exercise the exact OpenWrt image generator and ext4 resize on a Linux runner."""
import importlib.util
import gzip
import hashlib
import json
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
    def test_combined_image_keeps_boot_gpt_and_updates_exported_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory);data=folder/'data';data.mkdir()
            (data/'sentinel.txt').write_text('preserve root contents')
            root=folder/'root.ext4'
            subprocess.run([os.environ['MOCI_MAKE_EXT4FS'],'-l','32M','-b','4096',str(root),str(data)],check=True)
            disk=folder/'disk.img'
            with disk.open('wb') as target: target.truncate(64*1024**2)
            layout=f'label: gpt\nunit: sectors\nfirst-lba: 34\n\n{disk}1 : start=512, size=32768, type=linux\n{disk}2 : start=33280, size=65536, type=linux\n{disk}128 : start=34, size=478, type=21686148-6449-6e6f-744e-656564454649\n'
            subprocess.run(['sfdisk',str(disk)],input=layout,text=True,capture_output=True,check=True)
            offset=33280*512
            with disk.open('r+b') as target,root.open('rb') as source:
                target.seek(512*512);target.write(b'MoCI boot partition sentinel')
                target.seek(offset);shutil.copyfileobj(source,target)
            original=disk.read_bytes()
            image=folder/'openwrt-x86-64-generic-ext4-combined-efi.img.gz'
            with gzip.open(image,'wb') as target: target.write(original)
            (folder/'sha256sums').write_text('0'*64+'  '+image.name+'\n')
            (folder/'profiles.json').write_text(json.dumps({'profiles':{'generic':{'images':[{'name':image.name,'sha256':'old','size':0}]}}}))
            normalize.normalize(image)
            with gzip.open(image,'rb') as source: updated=source.read()
            self.assertEqual(updated[:offset],original[:offset])
            self.assertEqual(updated[offset+32*1024**2:],original[offset+32*1024**2:])
            self.assertEqual(len(updated),len(original))
            root.write_bytes(updated[offset:offset+32*1024**2])
            normalize.check_filesystem(root)
            checksum=hashlib.sha256(image.read_bytes()).hexdigest()
            self.assertTrue((folder/'sha256sums').read_text().startswith(checksum))
            entry=json.loads((folder/'profiles.json').read_text())['profiles']['generic']['images'][0]
            self.assertEqual(entry['sha256'],checksum);self.assertEqual(entry['size'],image.stat().st_size)

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
