#!/usr/bin/env python3
"""Check fresh, unmounted image ext4 metadata before publishing a MoCI image."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import zlib

LINUX='af3dc60f838472478e793d69d8477de4'
BIOS='4861682149646f6e744e656564454649'


def geometry(header):
    if header[512:520]!=b'EFI PART': raise RuntimeError('GPT signature missing')
    length=struct.unpack_from('<I',header,524)[0]
    if not 92<=length<=512: raise RuntimeError('Invalid GPT header length')
    check=bytearray(header[512:512+length]);expected=struct.unpack_from('<I',check,16)[0]
    check[16:20]=b'\0'*4
    if zlib.crc32(check)!=expected: raise RuntimeError('GPT header checksum failed')
    entries_lba,count,size,checksum=struct.unpack_from('<QIII',header,584)
    if count!=128 or size!=128: raise RuntimeError('Unrecognised GPT table geometry')
    entries=header[entries_lba*512:entries_lba*512+count*size]
    if len(entries)!=count*size or zlib.crc32(entries)!=checksum: raise RuntimeError('GPT entries checksum failed')
    parts={}
    for index in range(count):
        entry=entries[index*size:(index+1)*size]
        if entry[:16]==bytes(16): continue
        start,end=struct.unpack_from('<QQ',entry,32)
        parts[index+1]=(entry[:16].hex(),start,end-start+1)
    if set(parts)!={1,2,128} or parts[1]!=(LINUX,512,32768) or parts[128]!=(BIOS,34,478):
        raise RuntimeError('Only stock MoCI boot/root/BIOS partitions qualify')
    kind,start,sectors=parts[2]
    if kind!=LINUX or start!=33280 or not 32768<=sectors<=33554432:
        raise RuntimeError('Unexpected root geometry')
    return start*512,sectors*512


def filesystem_identity(path):
    with open(path,'rb') as source:
        source.seek(1024);sb=source.read(1024)
    if sb[56:58]!=b'\x53\xef': raise RuntimeError('Expected ext4 superblock')
    return sb[104:120].hex(),struct.unpack_from('<I',sb,4)[0]


def check_filesystem(path):
    # This path is always a private regular file, never a mounted device.
    path=Path(path)
    if not path.is_file() or path.is_symlink(): raise RuntimeError('Expected private regular filesystem image')
    before=filesystem_identity(path)
    logs=[]
    # make_ext4fs writes reserved resize-inode/GDT metadata that can pass fsck
    # yet fail kernel reserve_backup_gdb. Remove that legacy feature OFFLINE.
    # Modern ext4 grows via meta_bg without the reserved resize inode.
    tune=subprocess.run(['tune2fs','-O','^resize_inode',str(path)],capture_output=True,text=True,timeout=60)
    logs.append({'tool':'tune2fs','exit_code':tune.returncode,'stdout':tune.stdout,'stderr':tune.stderr})
    if tune.returncode: raise RuntimeError('Could not prepare image resize metadata: '+json.dumps(logs))
    for flags,allowed in ((['-f','-y'],(0,1)),(['-f','-n'],(0,))):
        result=subprocess.run(['e2fsck',*flags,str(path)],capture_output=True,text=True,timeout=600)
        logs.append({'flags':flags,'exit_code':result.returncode,'stdout':result.stdout[-12000:],'stderr':result.stderr[-3000:]})
        if result.returncode not in allowed: raise RuntimeError('Offline image filesystem check failed: '+json.dumps(logs))
    if filesystem_identity(path)!=before: raise RuntimeError('Filesystem identity or block count changed')
    return logs


def transfer(source,target,length=None,sparse=False):
    remaining=length
    while remaining is None or remaining:
        data=source.read(min(1024*1024,remaining) if remaining is not None else 1024*1024)
        if not data:
            if remaining: raise RuntimeError('Truncated filesystem image')
            break
        if sparse and not data.strip(b'\0'): target.seek(len(data),1)
        else: target.write(data)
        if remaining is not None: remaining-=len(data)
    if sparse: target.truncate(target.tell())


def normalize(image):
    image=Path(image).resolve(strict=True)
    if not image.name.endswith('ext4-combined-efi.img.gz'): raise RuntimeError('Expected a fresh MoCI ext4 UEFI gzip image')
    with tempfile.TemporaryDirectory(prefix='moci-ext4-',dir=image.parent) as directory:
        root=Path(directory)/'root.ext4';packed=Path(directory)/image.name
        with gzip.open(image,'rb') as source:
            offset,length=geometry(source.read(1024*1024))
            source.seek(offset)
            with root.open('wb') as target: transfer(source,target,length,sparse=True)
        logs=check_filesystem(root)
        with gzip.open(image,'rb') as source, packed.open('wb') as raw:
            with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0,compresslevel=6) as target:
                transfer(source,target,offset)
                source.seek(offset+length)
                with root.open('rb') as checked: transfer(checked,target,length)
                transfer(source,target)
            raw.flush();os.fsync(raw.fileno())
        os.replace(packed,image)
    with image.open('rb') as checked: digest=hashlib.file_digest(checked,'sha256').hexdigest()
    # Keep OpenWrt's exported metadata consistent with the processed image.
    sums=image.parent/'sha256sums'
    if sums.is_file():
        lines=sums.read_text().splitlines()
        lines=[digest+'  '+image.name if line.split(maxsplit=1)[-1].lstrip('*')==image.name else line for line in lines]
        sums.write_text('\n'.join(lines)+'\n')
    profiles=image.parent/'profiles.json'
    if profiles.is_file():
        metadata=json.loads(profiles.read_text())
        for profile in metadata.get('profiles',{}).values():
            for entry in profile.get('images',[]):
                if entry.get('name')==image.name:
                    entry['sha256']=digest
                    if 'size' in entry: entry['size']=image.stat().st_size
        profiles.write_text(json.dumps(metadata,indent=2)+'\n')
    report={'schema':1,'success':True,'release_ready':False,'image':image.name,'sha256':digest,'offline_ext4_checks':logs}
    image.with_name(image.name+'.ext4-check.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('image')
    normalize(parser.parse_args().image)
