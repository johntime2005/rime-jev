#pragma once
#include "JevTsfContext.h"

struct TestScope : ITfInputScope {
  ULONG refs = 1;
  InputScope scope = IS_DEFAULT;
  STDMETHODIMP QueryInterface(REFIID iid, void** out) override {
    *out = nullptr;
    if (iid != IID_IUnknown && iid != __uuidof(ITfInputScope)) return E_NOINTERFACE;
    *out = static_cast<ITfInputScope*>(this); AddRef(); return S_OK;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return ++refs; }
  STDMETHODIMP_(ULONG) Release() override { auto n = --refs; if (!n) delete this; return n; }
  STDMETHODIMP GetInputScopes(InputScope** out, UINT* count) override {
    *out = static_cast<InputScope*>(CoTaskMemAlloc(sizeof(InputScope)));
    if (!*out) return E_OUTOFMEMORY;
    **out = scope; *count = 1; return S_OK;
  }
  STDMETHODIMP GetPhrase(BSTR**, UINT*) override { return E_NOTIMPL; }
  STDMETHODIMP GetRegularExpression(BSTR*) override { return E_NOTIMPL; }
  STDMETHODIMP GetSRGS(BSTR*) override { return E_NOTIMPL; }
  STDMETHODIMP GetXML(BSTR*) override { return E_NOTIMPL; }
};
