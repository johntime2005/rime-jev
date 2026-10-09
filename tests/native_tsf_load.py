"""Load the x64 TSF binary in a disposable process without COM registration.

This checks DLL dependencies and COM object lifetime, NOT TSF activation,
candidate rendering, or asynchronous edit sessions in an application.
"""
import argparse
import ctypes as C
import json
from pathlib import Path
import uuid
import winreg


class GUID(C.Structure):
    _fields_ = [('data', C.c_ubyte * 16)]

    @classmethod
    def parse(cls, value):
        return cls.from_buffer_copy(uuid.UUID(value).bytes_le)


def method(pointer, index, result, *arguments):
    table = C.cast(pointer, C.POINTER(C.POINTER(C.c_void_p))).contents
    return C.WINFUNCTYPE(result, C.c_void_p, *arguments)(table[index])


def check(hr, operation):
    if hr < 0:
        raise RuntimeError(f'{operation} failed: 0x{hr & 0xffffffff:08x}')


def run(binary):
    if C.sizeof(C.c_void_p) != 8:
        raise RuntimeError('Use 64-bit Python for the x64 TSF binary.')
    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\WOW6432Node\Rime\Weasel') as key:
        install = Path(winreg.QueryValueEx(key, 'WeaselRoot')[0])
    import os
    # Resolve matching existing Weasel runtime dependencies without copying or
    # executing the installed server, and never search the working directory.
    directory = os.add_dll_directory(str(install))
    ole = C.OleDLL('ole32')
    ole.CoInitializeEx.argtypes = [C.c_void_p, C.c_ulong]
    ole.CoInitializeEx.restype = C.c_long
    ole.CoUninitialize.argtypes = []
    check(ole.CoInitializeEx(None, 2), 'CoInitializeEx')
    factory, service = C.c_void_p(), C.c_void_p()
    try:
        dll = C.WinDLL(str(binary.resolve()), winmode=0x1100)
        clsid = GUID.parse('a3f4cded-b1e9-41ee-9ca6-7b4d0de6cb0a')
        iid_factory = GUID.parse('00000001-0000-0000-c000-000000000046')
        iid_unknown = GUID.parse('00000000-0000-0000-c000-000000000046')
        dll.DllGetClassObject.argtypes = [C.POINTER(GUID), C.POINTER(GUID), C.POINTER(C.c_void_p)]
        dll.DllGetClassObject.restype = C.c_long
        check(dll.DllGetClassObject(C.byref(clsid), C.byref(iid_factory), C.byref(factory)), 'DllGetClassObject')
        create = method(factory, 3, C.c_long, C.c_void_p, C.POINTER(GUID), C.POINTER(C.c_void_p))
        check(create(factory, None, C.byref(iid_unknown), C.byref(service)), 'CreateInstance')
        if not service.value:
            raise RuntimeError('CreateInstance returned a null service.')
        remaining_refs = method(service, 2, C.c_ulong)(service)
        service = C.c_void_p()
        method(factory, 2, C.c_ulong)(factory)
        factory = C.c_void_p()
        dll.DllCanUnloadNow.argtypes = []
        dll.DllCanUnloadNow.restype = C.c_long
        unload = dll.DllCanUnloadNow()
        return {'native_tsf_load': 'PASS', 'binary': str(binary.resolve()),
                'com_create_release': True, 'remaining_service_refs': remaining_refs,
                'can_unload': unload == 0, 'unload_hresult': unload,
                'registered': False, 'gui_tested': False}
    finally:
        if service.value:
            method(service, 2, C.c_ulong)(service)
        if factory.value:
            method(factory, 2, C.c_ulong)(factory)
        ole.CoUninitialize()
        directory.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('binary', type=Path)
    parser.add_argument('--report', type=Path)
    parser.add_argument('--require-unload', action='store_true',
                        help='Fail if the COM service remains retained after Release.')
    args = parser.parse_args()
    evidence = run(args.binary)
    result = json.dumps(evidence, indent=2)
    if args.report:
        args.report.write_text(result + '\n', encoding='utf-8')
    print(result)
    if args.require_unload and not evidence['can_unload']:
        raise SystemExit('Lifetime check failed: the service remains retained after Release.')
