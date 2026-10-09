// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <windows.h>
#include <msctf.h>
#include <wrl/client.h>

namespace jev {
// The service, context and pending flag belong to the same TSF apartment.
// Keep the slot occupied until TSF releases the session, including when a
// context is discarded without ever calling DoEditSession.
template <typename Service>
class PendingEditSession final : public ITfEditSession {
 public:
  PendingEditSession(Service* service, ITfContext* context,
                     unsigned long long generation, bool& pending)
      : service_(service), context_(context), generation_(generation), pending_(pending) {
    pending_ = true;
  }
  PendingEditSession(const PendingEditSession&) = delete;
  PendingEditSession& operator=(const PendingEditSession&) = delete;

  STDMETHODIMP QueryInterface(REFIID iid, void** out) override {
    if (!out) return E_INVALIDARG;
    *out = nullptr;
    if (iid != IID_IUnknown && iid != IID_ITfEditSession) return E_NOINTERFACE;
    *out = static_cast<ITfEditSession*>(this);
    AddRef();
    return S_OK;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return ++refs_; }
  STDMETHODIMP_(ULONG) Release() override {
    const auto remaining = --refs_;
    if (!remaining) delete this;
    return remaining;
  }
  STDMETHODIMP DoEditSession(TfEditCookie ec) override {
    return service_->JevEdit(ec, context_.Get(), generation_);
  }

 private:
  // Clear before releasing service_: the flag is owned by that service.
  ~PendingEditSession() { pending_ = false; }
  ULONG refs_ = 1;
  Microsoft::WRL::ComPtr<Service> service_;
  Microsoft::WRL::ComPtr<ITfContext> context_;
  unsigned long long generation_;
  bool& pending_;
};
}  // namespace jev
