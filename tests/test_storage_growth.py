import copy
import importlib.machinery
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

source=Path(__file__).parents[1]/'firmware/files/usr/libexec/moci-grow-root'
loader=importlib.machinery.SourceFileLoader('storage_growth',str(source))
spec=importlib.util.spec_from_loader(loader.name,loader)
grow=importlib.util.module_from_spec(spec);loader.exec_module(grow)


def stock():
    return {'label':'gpt','id':'disk-id','device':'/dev/sda','unit':'sectors','sectorsize':512,
            'partitions':[{'node':'/dev/sda1','start':512,'size':32768,'type':grow.LINUX,'uuid':'boot-id'},
                          {'node':'/dev/sda2','start':33280,'size':16777216,'type':grow.LINUX,'uuid':'root-id'},
                          {'node':'/dev/sda128','start':34,'size':478,'type':grow.BIOS,'uuid':'bios-id'}]}


class StorageGrowth(unittest.TestCase):
    def test_grows_root_only_into_tail_space(self):
        table=stock();plan=grow.growth_plan(table,64*1024**3,'/dev/sda2')
        self.assertTrue(plan['grow_partition']);self.assertEqual(plan['start'],33280)
        self.assertGreater(plan['after_sectors'],plan['before_sectors'])
        self.assertLess(plan['start']+plan['after_sectors'],64*1024**3//512-33)

    def test_custom_data_partition_is_refused(self):
        table=stock();table['partitions'].append({'node':'/dev/sda3','start':20000000,'size':1000,'type':grow.LINUX})
        with self.assertRaisesRegex(RuntimeError,'Custom/data'):
            grow.growth_plan(table,64*1024**3,'/dev/sda2')

    def test_wrong_root_and_nonstandard_boot_are_refused(self):
        with self.assertRaises(RuntimeError): grow.growth_plan(stock(),64*1024**3,'/dev/sdb2')
        table=stock();table['partitions'][0]['start']=2048
        with self.assertRaisesRegex(RuntimeError,'Boot layout'):
            grow.growth_plan(table,64*1024**3,'/dev/sda2')

    def test_never_shrinks_an_already_expanded_root(self):
        table=stock();disk_bytes=64*1024**3
        table['partitions'][1]['size']=disk_bytes//512-34-33280
        plan=grow.growth_plan(table,disk_bytes,'/dev/sda2')
        self.assertFalse(plan['grow_partition']);self.assertEqual(plan['after_sectors'],plan['before_sectors'])

    def test_preservation_rejects_uuid_or_boot_changes(self):
        before=stock();after=copy.deepcopy(before);after['partitions'][1]['size']+=2048
        grow.assert_preserved(before,after,'/dev/sda2',after['partitions'][1]['size'])
        after['partitions'][0]['uuid']='changed'
        with self.assertRaisesRegex(RuntimeError,'metadata'):
            grow.assert_preserved(before,after,'/dev/sda2',after['partitions'][1]['size'])

    def test_non_512_sector_layout_is_refused(self):
        table=stock();table['sectorsize']=4096
        with self.assertRaises(RuntimeError): grow.growth_plan(table,64*1024**3,'/dev/sda2')

    @unittest.skipUnless(shutil.which('sfdisk'),'Linux sfdisk integration requires util-linux')
    def test_sparse_disk_image_retains_boot_uuid_and_partition_starts(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            disk=str((Path(directory)/'disk.img').resolve())
            with open(disk,'wb') as target: target.truncate(64*1024**2)
            specification=f'label: gpt\nunit: sectors\n\n{disk}1 : start=512, size=32768, type={grow.LINUX}\n{disk}2 : start=33280, size=65536, type={grow.LINUX}\n{disk}128 : start=34, size=478, type={grow.BIOS}\n'
            subprocess.run(['sfdisk',disk],input=specification,text=True,capture_output=True,check=True)
            with open(disk,'r+b') as target: target.truncate(128*1024**2)
            before=json.loads(grow.command(['sfdisk','--json',disk]))['partitiontable']
            plan=grow.growth_plan(before,128*1024**2,disk+'2')
            grow.write_partition_table(disk,plan['start'],plan['after_sectors'])
            after=json.loads(grow.command(['sfdisk','--json',disk]))['partitiontable']
            grow.assert_preserved(before,after,disk+'2',plan['after_sectors'])
            self.assertGreater(after['partitions'][1]['size'],65536)


if __name__=='__main__': unittest.main()
