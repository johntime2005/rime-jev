#include "JevTsfContext.h"
#include "tsf_stubs.h"
#include <cassert>
#include <algorithm>
#include <iostream>

struct Store {
  std::wstring text;
  LONG boundary = 0;
  bool locked = true, fail_read = false;
  int reads = 0;
};
struct Range : ITfRangeStub {
  Store& store;
  LONG begin, end;
  Range(Store& s, LONG a, LONG b) : store(s), begin(a), end(b) {}
  HRESULT STDMETHODCALLTYPE Clone(ITfRange** out) override { *out = new Range(store, begin, end); return S_OK; }
  HRESULT STDMETHODCALLTYPE Collapse(TfEditCookie, TfAnchor a) override {
    if (!store.locked) return TF_E_NOLOCK;
    if (a == TF_ANCHOR_START) end = begin; else begin = end;
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE ShiftStart(TfEditCookie, LONG count, LONG* shifted, const TF_HALTCOND*) override {
    if (!store.locked) return TF_E_NOLOCK;
    LONG next = (std::max)(store.boundary, begin + count);
    *shifted = next - begin; begin = next; return S_OK;
  }
  HRESULT STDMETHODCALLTYPE CompareStart(TfEditCookie, ITfRange* other, TfAnchor, LONG* comparison) override {
    *comparison = begin - static_cast<Range*>(other)->begin; return S_OK;
  }
  HRESULT STDMETHODCALLTYPE GetText(TfEditCookie, DWORD, WCHAR* out, ULONG max, ULONG* read) override {
    ++store.reads;
    if (!store.locked) return TF_E_NOLOCK;
    if (store.fail_read) return E_FAIL;
    *read = (std::min)(max, static_cast<ULONG>(end - begin));
    store.text.copy(out, *read, begin); return S_OK;
  }
};
struct Context : ITfContextStub {
  Store store;
  DWORD flags = 0, dynamic = 0;
  bool property_failure = false;
  HRESULT STDMETHODCALLTYPE GetStatus(TF_STATUS* out) override {
    out->dwStaticFlags = flags; out->dwDynamicFlags = dynamic; return S_OK;
  }
  HRESULT STDMETHODCALLTYPE GetAppProperty(REFGUID, ITfReadOnlyProperty** out) override {
    *out = nullptr; return property_failure ? E_FAIL : S_FALSE;
  }
  HRESULT STDMETHODCALLTYPE GetStart(TfEditCookie, ITfRange** out) override {
    *out = new Range(store, 0, 0); return S_OK;
  }
  jev::Snapshot read(LONG start, LONG end = -1) {
    Range anchor(store, start, end == -1 ? start : end);
    return jev::Read(this, &anchor, 1);
  }
};

int main() {
  Context c;
  c.store.text = L"prefix  \nni suffix";
  auto s = c.read(9, 11); // Entire composition is excluded, not its internal caret.
  assert(s.quality == L"exact" && s.text == L"prefix  \n");
  assert(c.read(0).quality == L"exact" && c.read(0).text.empty());
  assert(c.read(3, 8).text == L"pre"); // Replacement selection anchor.
  c.store.text = std::wstring(200, L'x') + L"tail";
  assert(c.read(204).text == std::wstring(76, L'x') + L"tail");
  c.store.boundary = 190;
  assert(c.read(204).quality == L"unavailable"); // Region boundary is not document start.
  c.store.boundary = 0;
  c.store.locked = false;
  assert(c.read(204).quality == L"unavailable");
  c.store.locked = true; c.store.fail_read = true;
  assert(c.read(204).quality == L"unavailable");
  c.store.fail_read = false; c.store.reads = 0; c.flags = TS_SS_TRANSITORY;
  assert(c.read(204).quality == L"unavailable" && c.store.reads == 0);
  c.flags = 0; c.dynamic = TS_SD_READONLY;
  assert(c.read(204).quality == L"unavailable" && c.store.reads == 0);
  c.dynamic = 0; c.property_failure = true;
  assert(c.read(204).quality == L"unavailable" && c.store.reads == 0);
  c.property_failure = false;
  c.store.text = L"before ni";
  auto before = c.read(7);
  c.store.text = L"edited ni"; // Same selection, different preceding text.
  assert(c.read(7).text != before.text);
  std::cout << "controlled COM text-store tests PASS (not live GUI acceptance)\n";
}
