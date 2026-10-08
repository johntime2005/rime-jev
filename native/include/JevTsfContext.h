#pragma once
#include "JevContext.h"
#include <windows.h>
#include <msctf.h>
#include <inputscope.h>
#include <textstor.h>
#include <wrl/client.h>

namespace jev {
// InputScope.h declares this GUID without a definition in uuid.lib.
inline constexpr GUID kInputScope = {0x1713dd5a, 0x68e7, 0x4a5b, {0x9a, 0xf6, 0x59, 0x2a, 0x59, 0x5c, 0x77, 0x8d}};
struct ScopedVariant {
  VARIANT value;
  ScopedVariant() { VariantInit(&value); }
  ~ScopedVariant() { VariantClear(&value); }
};
// Called only in an authorized edit session, for an explicitly opted-in app.
// The application is the text authority. Misbehaving text stores cannot be
// made trustworthy here; unknown/transitory stores deliberately abstain.
inline Snapshot Read(ITfContext* context, ITfRange* anchor, TfEditCookie ec) {
  Snapshot result;
  TF_STATUS status = {};
  if (!context || !anchor || FAILED(context->GetStatus(&status)) ||
      (status.dwStaticFlags & TS_SS_TRANSITORY) ||
      (status.dwDynamicFlags & TS_SD_READONLY)) return result;

  Microsoft::WRL::ComPtr<ITfReadOnlyProperty> property;
  HRESULT hr = context->GetAppProperty(kInputScope, &property);
  if (FAILED(hr)) return result;
  if (hr == S_OK && property) {
    ScopedVariant variant;
    auto& value = variant.value;
    hr = property->GetValue(ec, anchor, &value);
    if (FAILED(hr)) return result;
    if (value.vt != VT_EMPTY) {
      Microsoft::WRL::ComPtr<ITfInputScope> scope;
      if (value.vt != VT_UNKNOWN || !value.punkVal || FAILED(value.punkVal->QueryInterface(IID_PPV_ARGS(&scope)))) return result;
      InputScope* scopes = nullptr;
      UINT count = 0;
      hr = scope->GetInputScopes(&scopes, &count);
      bool sensitive = false;
      if (SUCCEEDED(hr) && count <= 64 && (scopes || !count)) {
        for (UINT i = 0; i < count; ++i) if (scopes[i] == IS_PASSWORD || scopes[i] == IS_PRIVATE ||
            scopes[i] == IS_NUMERIC_PASSWORD || scopes[i] == IS_NUMERIC_PIN ||
            scopes[i] == IS_ALPHANUMERIC_PIN || scopes[i] == IS_ALPHANUMERIC_PIN_SET) sensitive = true;
      } else { CoTaskMemFree(scopes); return result; }
      CoTaskMemFree(scopes);
      if (sensitive) { result.quality = L"sensitive"; return result; }
    }
  }
  Microsoft::WRL::ComPtr<ITfRange> range, start;
  if (FAILED(anchor->Clone(&range)) || FAILED(range->Collapse(ec, TF_ANCHOR_START))) return result;
  LONG shifted = 0, comparison = 1;
  // 161 units cover 80 supplementary scalars plus a possibly split pair.
  if (FAILED(range->ShiftStart(ec, -161, &shifted, nullptr)) || shifted > 0 || shifted < -161 ||
      FAILED(context->GetStart(ec, &start)) ||
      FAILED(range->CompareStart(ec, start.Get(), TF_ANCHOR_START, &comparison))) return result;
  WCHAR buffer[162] = {};
  ULONG read = 0;
  if (FAILED(range->GetText(ec, 0, buffer, 162, &read)) || read > 161 || read != static_cast<ULONG>(-shifted)) return result;
  if (!Tail(std::wstring(buffer, read), comparison == 0, result.text)) { result.text.clear(); return result; }
  result.quality = L"exact";
  return result;
}
}  // namespace jev
