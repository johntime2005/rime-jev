// Real Windows TSF manager + a synthetic app-owned text store. No registration,
// focus switching, keyboard input, or communication with the installed IME.
#include "JevTsfContext.h"
#include "JevEditSession.h"
#include "tsf_store_stubs.h"
#include "tsf_scope.h"
#include <cassert>
#include <iostream>
#include <algorithm>

using Microsoft::WRL::ComPtr;

struct TextStore : ITextStoreACPStub, ITfInputScope {
  std::wstring text = L"prefix  \r\nni suffix";
  TS_SELECTION_ACP selection = {10, 12, {TS_AE_END, FALSE}};
  ComPtr<ITextStoreACPSink> sink;
  bool locked = false;
  int reads = 0;
  TestScope input_scope;
  bool attrs_requested = false;
  STDMETHODIMP QueryInterface(REFIID iid, void** out) override {
    if (iid == __uuidof(ITfInputScope)) { *out = static_cast<ITfInputScope*>(this); AddRef(); return S_OK; }
    return ITextStoreACPStub::QueryInterface(iid, out);
  }
  STDMETHODIMP_(ULONG) AddRef() override { return ITextStoreACPStub::AddRef(); }
  STDMETHODIMP_(ULONG) Release() override { return ITextStoreACPStub::Release(); }
  STDMETHODIMP GetInputScopes(InputScope** out, UINT* count) override { return input_scope.GetInputScopes(out, count); }
  STDMETHODIMP GetPhrase(BSTR**, UINT*) override { return E_NOTIMPL; }
  STDMETHODIMP GetRegularExpression(BSTR*) override { return E_NOTIMPL; }
  STDMETHODIMP GetSRGS(BSTR*) override { return E_NOTIMPL; }
  STDMETHODIMP GetXML(BSTR*) override { return E_NOTIMPL; }
  STDMETHODIMP AdviseSink(REFIID iid, IUnknown* object, DWORD) override {
    if (iid != IID_ITextStoreACPSink) return E_INVALIDARG;
    return object->QueryInterface(IID_PPV_ARGS(&sink));
  }
  STDMETHODIMP UnadviseSink(IUnknown*) override { sink.Reset(); return S_OK; }
  STDMETHODIMP RequestLock(DWORD flags, HRESULT* result) override {
    if (locked || !sink) { *result = TS_E_SYNCHRONOUS; return S_OK; }
    locked = true; *result = sink->OnLockGranted(flags); locked = false; return S_OK;
  }
  STDMETHODIMP GetStatus(TS_STATUS* out) override { *out = {}; return S_OK; }
  STDMETHODIMP GetSelection(ULONG, ULONG count, TS_SELECTION_ACP* out, ULONG* fetched) override {
    if (!locked) return TS_E_NOLOCK;
    *fetched = count ? 1 : 0; if (count) *out = selection; return S_OK;
  }
  STDMETHODIMP GetText(LONG start, LONG end, WCHAR* out, ULONG max, ULONG* read,
      TS_RUNINFO* runs, ULONG run_max, ULONG* run_count, LONG* next) override {
    if (!locked) return TS_E_NOLOCK;
    ++reads;
    if (end < 0) end = static_cast<LONG>(text.size());
    if (start < 0 || end < start || end > static_cast<LONG>(text.size())) return TS_E_INVALIDPOS;
    ULONG available = static_cast<ULONG>(end - start);
    *read = (std::min)(available, max);
    if (*read) text.copy(out, *read, start);
    ULONG traversed = max ? *read : available;
    *run_count = run_max && traversed ? 1 : 0;
    if (*run_count) { runs[0].uCount = traversed; runs[0].type = TS_RT_PLAIN; }
    *next = start + traversed; return S_OK;
  }
  STDMETHODIMP GetEndACP(LONG* end) override { if (!locked) return TS_E_NOLOCK; *end = static_cast<LONG>(text.size()); return S_OK; }
  STDMETHODIMP GetActiveView(TsViewCookie* view) override { *view = 0; return S_OK; }
  STDMETHODIMP GetWnd(TsViewCookie, HWND* hwnd) override { *hwnd = nullptr; return S_OK; }
  STDMETHODIMP RequestSupportedAttrs(DWORD, ULONG count, const TS_ATTRID* attrs) override {
    attrs_requested = false;
    for (ULONG i = 0; i < count; ++i) if (attrs[i] == jev::kInputScope) attrs_requested = true;
    return S_OK;
  }
  STDMETHODIMP RequestAttrsAtPosition(LONG, ULONG count, const TS_ATTRID* attrs, DWORD flags) override {
    return RequestSupportedAttrs(flags, count, attrs);
  }
  STDMETHODIMP RequestAttrsTransitioningAtPosition(LONG, ULONG, const TS_ATTRID*, DWORD) override { return S_OK; }
  STDMETHODIMP FindNextAttrTransition(LONG, LONG halt, ULONG, const TS_ATTRID*, DWORD,
      LONG* next, BOOL* found, LONG* offset) override { *next = halt; *found = FALSE; *offset = 0; return S_OK; }
  STDMETHODIMP RetrieveRequestedAttrs(ULONG count, TS_ATTRVAL* attrs, ULONG* fetched) override {
    *fetched = 0;
    if (count && attrs_requested) {
      attrs[0].idAttr = jev::kInputScope; attrs[0].dwOverlapId = 0;
      VariantInit(&attrs[0].varValue); attrs[0].varValue.vt = VT_UNKNOWN;
      auto scope = new TestScope(); scope->scope = input_scope.scope;
      attrs[0].varValue.punkVal = scope; *fetched = 1;
    }
    attrs_requested = false;
    return S_OK;
  }
};

struct Reader : ITfEditSession {
  ULONG refs = 1;
  ITfContext* context;
  jev::Snapshot snapshot;
  bool allow = true;
  explicit Reader(ITfContext* c) : context(c) {}
  STDMETHODIMP QueryInterface(REFIID iid, void** out) override {
    *out = nullptr;
    if (iid != IID_IUnknown && iid != IID_ITfEditSession) return E_NOINTERFACE;
    *out = static_cast<ITfEditSession*>(this); AddRef(); return S_OK;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return ++refs; }
  STDMETHODIMP_(ULONG) Release() override { auto n = --refs; if (!n) delete this; return n; }
  STDMETHODIMP DoEditSession(TfEditCookie ec) override {
    TF_SELECTION selected = {}; ULONG fetched = 0;
    auto hr = context->GetSelection(ec, TF_DEFAULT_SELECTION, 1, &selected, &fetched);
    if (FAILED(hr) || fetched != 1) return E_FAIL;
    snapshot = jev::Read(context, selected.range, ec, allow);
    selected.range->Release(); return S_OK;
  }
};

struct EditObserver : ITfTextEditSink {
  ULONG refs = 1;
  TfClientId client;
  bool called = false, own = false;
  explicit EditObserver(TfClientId id) : client(id) {}
  STDMETHODIMP QueryInterface(REFIID iid, void** out) override {
    *out = nullptr;
    if (iid != IID_IUnknown && iid != IID_ITfTextEditSink) return E_NOINTERFACE;
    *out = static_cast<ITfTextEditSink*>(this); AddRef(); return S_OK;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return ++refs; }
  STDMETHODIMP_(ULONG) Release() override { auto n = --refs; if (!n) delete this; return n; }
  STDMETHODIMP OnEndEdit(ITfContext* context, TfEditCookie, ITfEditRecord*) override {
    BOOL writing = FALSE;
    called = true;
    own = SUCCEEDED(context->InWriteSession(client, &writing)) && writing;
    return S_OK;
  }
};

struct AsyncService {
  ULONG refs = 1;
  bool pending = false;
  unsigned calls = 0, applied = 0;
  unsigned long long generation = 1;
  ULONG AddRef() { return ++refs; }
  ULONG Release() { auto n = --refs; if (!n) delete this; return n; }
  HRESULT JevEdit(TfEditCookie ec, ITfContext* context, unsigned long long captured) {
    assert(pending); // A nested timer may not queue another edit during apply.
    ++calls;
    if (captured != generation) return S_OK;
    TF_SELECTION selection = {}; ULONG fetched = 0;
    assert(SUCCEEDED(context->GetSelection(ec, TF_DEFAULT_SELECTION, 1, &selection, &fetched)) && fetched == 1);
    selection.range->Release();
    ++applied;
    return S_OK;
  }
};

static void drain_async(AsyncService* service) {
  const auto deadline = GetTickCount64() + 3000;
  while (service->pending && GetTickCount64() < deadline) {
    MSG message;
    while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
    if (service->pending) Sleep(1);
  }
  assert(!service->pending && "TSF did not release its async session");
}

int main() {
  assert(SUCCEEDED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED)));
  {
    ComPtr<ITfThreadMgr> manager;
    assert(SUCCEEDED(CoCreateInstance(CLSID_TF_ThreadMgr, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&manager))));
    ComPtr<ITfThreadMgrEx> extended;
    assert(SUCCEEDED(manager.As(&extended)));
    TfClientId client = 0;
    // Explicitly prohibit activating installed TIPs or the keyboard layout.
    assert(SUCCEEDED(extended->ActivateEx(&client, TF_TMAE_NOACTIVATETIP | TF_TMAE_NOACTIVATEKEYBOARDLAYOUT)));
    ComPtr<ITfDocumentMgr> doc;
    assert(SUCCEEDED(manager->CreateDocumentMgr(&doc)));
    ComPtr<TextStore> store; store.Attach(new TextStore());
    ComPtr<ITfContext> context; TfEditCookie initial = 0;
    assert(SUCCEEDED(doc->CreateContext(client, 0, static_cast<ITextStoreACP*>(store.Get()), &context, &initial)));
    assert(SUCCEEDED(doc->Push(context.Get())));
    ComPtr<Reader> reader; reader.Attach(new Reader(context.Get()));
    ComPtr<ITfSource> source; assert(SUCCEEDED(context.As(&source)));
    ComPtr<EditObserver> observer; observer.Attach(new EditObserver(client));
    DWORD observer_cookie = TF_INVALID_COOKIE;
    assert(SUCCEEDED(source->AdviseSink(IID_ITfTextEditSink, observer.Get(), &observer_cookie)));
    auto read = [&]() {
      HRESULT result = E_FAIL;
      assert(SUCCEEDED(context->RequestEditSession(client, reader.Get(), TF_ES_SYNC | TF_ES_READ, &result)));
      assert(SUCCEEDED(result));
      return reader->snapshot;
    };
    auto snapshot = read();
    assert(snapshot.quality == L"exact" && snapshot.text == L"prefix  \r\n");
    assert(!store->locked);
    // Mutation + selection notifications originate in the app, not the IME.
    TS_TEXTCHANGE change = {0, static_cast<LONG>(store->text.size()), 204};
    store->text = std::wstring(200, L'x') + L"tail";
    store->selection.acpStart = store->selection.acpEnd = 204;
    store->sink->OnTextChange(0, &change);
    store->sink->OnSelectionChange();
    snapshot = read();
    assert(snapshot.quality == L"exact" && snapshot.text == std::wstring(76, L'x') + L"tail");
    reader->allow = false; store->reads = 0;
    assert(read().quality == L"unavailable" && store->reads == 0);
    store->input_scope.scope = IS_PASSWORD;
    TS_ATTRID changed_scope = jev::kInputScope;
    store->sink->OnAttrsChange(0, 204, 1, &changed_scope);
    assert(read().quality == L"sensitive" && store->reads == 0);
    reader->allow = true;
    assert(read().quality == L"sensitive" && store->reads == 0);
    HRESULT edit_result = E_FAIL;
    assert(SUCCEEDED(context->RequestEditSession(client, reader.Get(), TF_ES_SYNC | TF_ES_READWRITE, &edit_result)));
    assert(SUCCEEDED(edit_result) && observer->called && observer->own);
    assert(SUCCEEDED(source->UnadviseSink(observer_cookie)));

    ComPtr<AsyncService> service; service.Attach(new AsyncService());
    unsigned queued_count = 0;
    auto queue = [&]() {
      assert(!service->pending);
      const auto before = service->calls;
      auto edit = new jev::PendingEditSession<AsyncService>(service.Get(), context.Get(), service->generation, service->pending);
      HRESULT result = E_FAIL;
      const auto hr = context->RequestEditSession(client, edit, TF_ES_ASYNC | TF_ES_READWRITE, &result);
      edit->Release();
      ++queued_count;
      if (FAILED(hr) || result != TF_S_ASYNC || !service->pending || service->calls != before) {
        std::cerr << "async queue " << queued_count << ": hr=" << std::hex << hr << " session=" << result
                  << std::dec << " pending=" << service->pending << " calls=" << service->calls << '\n';
      }
      assert(SUCCEEDED(hr) && result == TF_S_ASYNC && service->pending && service->calls == before);
    };
    queue();
    assert(SUCCEEDED(doc->Pop(TF_POPF_ALL))); // No lock/callback after context removal.
    drain_async(service.Get());
    assert(service->calls == 0 && service->refs == 1);
    auto rejected = new jev::PendingEditSession<AsyncService>(service.Get(), context.Get(), service->generation, service->pending);
    HRESULT rejected_result = E_FAIL;
    const auto rejected_hr = context->RequestEditSession(client, rejected, TF_ES_ASYNC | TF_ES_READWRITE, &rejected_result);
    rejected->Release();
    assert(rejected_hr == TF_E_DISCONNECTED && !service->pending && service->refs == 1);
    // A popped context remains disconnected; a new composition gets a new one.
    source.Reset(); reader.Reset(); context.Reset(); store.Reset();
    store.Attach(new TextStore());
    assert(SUCCEEDED(doc->CreateContext(client, 0, static_cast<ITextStoreACP*>(store.Get()), &context, &initial)));
    assert(SUCCEEDED(doc->Push(context.Get())));
    queue();
    drain_async(service.Get());
    assert(service->calls == 1 && service->applied == 1);
    queue();
    ++service->generation;
    drain_async(service.Get());
    assert(service->calls == 2 && service->applied == 1);

    queue();
    ++service->generation;
    assert(SUCCEEDED(manager->Deactivate()));
    drain_async(service.Get());
    // An app-owned TSF client is not a registered TIP: manager shutdown may
    // dispatch its queued callback while unwinding, but it must be stale.
    assert(service->calls >= 2 && service->calls <= 3 && service->applied == 1 && service->refs == 1);
    assert(SUCCEEDED(doc->Pop(TF_POPF_ALL)));
  }
  CoUninitialize();
  std::cout << "Windows TSF-manager text-store + async cancellation integration PASS (no live IME GUI)\n";
}
