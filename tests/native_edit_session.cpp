// Test the production COM session without loading or activating a Weasel TIP.
#include "JevEditSession.h"
#include "tsf_stubs.h"
#include <cstdlib>
#include <iostream>

using Microsoft::WRL::ComPtr;

static void check(bool condition, const char* message) {
  if (!condition) {
    std::cerr << "FAIL: " << message << '\n';
    std::exit(1);
  }
}

struct Observations {
  unsigned callbacks = 0, applied = 0, destroyed = 0;
  bool pending_at_destruction = true;
};

struct Service {
  ULONG refs = 1;
  bool pending = false;
  unsigned long long generation = 1;
  HRESULT callback_result = S_OK;
  Observations& observed;
  explicit Service(Observations& value) : observed(value) {}
  ULONG AddRef() { return ++refs; }
  ULONG Release() { auto remaining = --refs; if (!remaining) delete this; return remaining; }
  ~Service() {
    ++observed.destroyed;
    observed.pending_at_destruction = pending;
  }
  HRESULT JevEdit(TfEditCookie ec, ITfContext* context, unsigned long long captured) {
    check(pending, "the callback must still own the slot (no reentrant poll)");
    check(ec == 7 && context != nullptr, "callback lost its document lock/context");
    ++observed.callbacks;
    if (captured == generation) ++observed.applied;
    return callback_result;
  }
};

struct Context : ITfContextStub {
  ComPtr<ITfEditSession> queued;
  HRESULT request_result = S_OK, session_result = TF_S_ASYNC;
  STDMETHODIMP RequestEditSession(TfClientId, ITfEditSession* edit, DWORD flags, HRESULT* result) override {
    check(flags == (TF_ES_ASYNC | TF_ES_READWRITE), "unexpected lock flags");
    check(!queued, "another edit is already queued");
    *result = session_result;
    if (SUCCEEDED(request_result) && SUCCEEDED(session_result)) queued = edit;
    return request_result;
  }
};

static HRESULT submit(Service* service, Context* context, HRESULT& session_result) {
  check(!service->pending, "a previous edit still owns the slot");
  auto edit = new jev::PendingEditSession<Service>(service, context, service->generation, service->pending);
  auto result = context->RequestEditSession(1, edit, TF_ES_ASYNC | TF_ES_READWRITE, &session_result);
  edit->Release();
  return result;
}

int main() {
  Observations observed;
  ComPtr<Service> service; service.Attach(new Service(observed));
  ComPtr<Context> context; context.Attach(new Context());
  HRESULT result = E_FAIL;

  check(SUCCEEDED(submit(service.Get(), context.Get(), result)) && result == TF_S_ASYNC, "request not queued");
  check(service->pending && service->refs == 2, "queued session must retain its service");
  context->queued.Reset(); // TSF may discard a request without a callback.
  check(!service->pending && observed.callbacks == 0 && service->refs == 1,
        "discarding an uncalled session must release the polling slot");

  check(SUCCEEDED(submit(service.Get(), context.Get(), result)), "could not queue after cancellation");
  check(SUCCEEDED(context->queued->DoEditSession(7)), "callback failed");
  check(service->pending && observed.applied == 1, "callback returned the slot before final Release");
  context->queued.Reset();
  check(!service->pending, "completed session did not release the slot");

  context->request_result = E_FAIL;
  check(FAILED(submit(service.Get(), context.Get(), result)) && !service->pending,
        "outer RequestEditSession failure leaked the slot");
  context->request_result = S_OK; context->session_result = TS_E_READONLY;
  check(SUCCEEDED(submit(service.Get(), context.Get(), result)) && FAILED(result) && !service->pending,
        "per-session lock denial leaked the slot");
  context->session_result = TF_S_ASYNC;

  check(SUCCEEDED(submit(service.Get(), context.Get(), result)), "could not queue stale-generation test");
  ++service->generation;
  check(SUCCEEDED(context->queued->DoEditSession(7)) && observed.applied == 1,
        "a late callback must retain its original generation");
  context->queued.Reset();
  check(!service->pending, "stale callback leaked the slot");

  service->callback_result = E_FAIL;
  check(SUCCEEDED(submit(service.Get(), context.Get(), result)), "could not queue callback failure");
  check(FAILED(context->queued->DoEditSession(7)) && service->pending, "failed callback lost ownership");
  context->queued.Reset();
  check(!service->pending, "failed callback leaked the slot");

  check(SUCCEEDED(submit(service.Get(), context.Get(), result)), "could not queue COM lifetime test");
  check(context->queued->QueryInterface(IID_IUnknown, nullptr) == E_INVALIDARG, "null QI output not rejected");
  void* unsupported = service.Get();
  check(context->queued->QueryInterface(IID_ITfContext, &unsupported) == E_NOINTERFACE && !unsupported,
        "unsupported QI must clear its output");
  ComPtr<IUnknown> retained;
  check(SUCCEEDED(context->queued.As(&retained)), "IUnknown identity missing");
  context->queued.Reset();
  check(service->pending, "nonfinal Release returned the slot");
  retained.Reset();
  check(!service->pending, "final QI reference did not return the slot");

  check(SUCCEEDED(submit(service.Get(), context.Get(), result)), "could not queue owner-lifetime test");
  service.Reset();
  check(observed.destroyed == 0, "queued session lost its service owner");
  context->queued.Reset();
  check(observed.destroyed == 1 && !observed.pending_at_destruction,
        "slot must clear before releasing the last service reference");
  check(context->refs == 1, "session retained the text context after cancellation");
  std::cout << "native async edit-session lifetime tests PASS (controlled COM queue)\n";
}
