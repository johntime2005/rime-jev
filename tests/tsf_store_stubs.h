// Unimplemented text-store methods for the Windows TSF-manager integration fixture.
#pragma once
#include <textstor.h>
#pragma warning(push)
#pragma warning(disable: 4100)
struct ITextStoreACPStub : ITextStoreACP {
  STDMETHODIMP QueryInterface(REFIID iid, void** out) override {
    *out = nullptr; if (iid != IID_IUnknown && iid != IID_ITextStoreACP) return E_NOINTERFACE;
    *out = static_cast<ITextStoreACP*>(this); AddRef(); return S_OK;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return ++refs; }
  STDMETHODIMP_(ULONG) Release() override { auto n = --refs; if (!n) delete this; return n; }
  virtual ~ITextStoreACPStub() {}
  ULONG refs = 1;
  HRESULT STDMETHODCALLTYPE AdviseSink(REFIID riid, IUnknown *punk, DWORD dwMask) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE UnadviseSink(IUnknown *punk) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE RequestLock(DWORD dwLockFlags, HRESULT *phrSession) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE GetStatus(TS_STATUS *pdcs) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE QueryInsert(LONG acpTestStart, LONG acpTestEnd, ULONG cch, LONG *pacpResultStart, LONG *pacpResultEnd) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE GetSelection(ULONG ulIndex, ULONG ulCount, TS_SELECTION_ACP *pSelection, ULONG *pcFetched) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE SetSelection(ULONG ulCount, const TS_SELECTION_ACP *pSelection) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE GetText(LONG acpStart, LONG acpEnd, WCHAR *pchPlain, ULONG cchPlainReq, ULONG *pcchPlainRet, TS_RUNINFO *prgRunInfo, ULONG cRunInfoReq, ULONG *pcRunInfoRet, LONG *pacpNext) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE SetText(DWORD dwFlags, LONG acpStart, LONG acpEnd, const WCHAR *pchText, ULONG cch, TS_TEXTCHANGE *pChange) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE GetFormattedText(LONG acpStart, LONG acpEnd, IDataObject **ppDataObject) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE GetEmbedded(LONG acpPos, REFGUID rguidService, REFIID riid, IUnknown **ppunk) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE QueryInsertEmbedded(const GUID *pguidService, const FORMATETC *pFormatEtc, BOOL *pfInsertable) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE InsertEmbedded(DWORD dwFlags, LONG acpStart, LONG acpEnd, IDataObject *pDataObject, TS_TEXTCHANGE *pChange) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE InsertTextAtSelection(DWORD dwFlags, const WCHAR *pchText, ULONG cch, LONG *pacpStart, LONG *pacpEnd, TS_TEXTCHANGE *pChange) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE InsertEmbeddedAtSelection(DWORD dwFlags, IDataObject *pDataObject, LONG *pacpStart, LONG *pacpEnd, TS_TEXTCHANGE *pChange) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE RequestSupportedAttrs(DWORD dwFlags, ULONG cFilterAttrs, const TS_ATTRID *paFilterAttrs) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE RequestAttrsAtPosition(LONG acpPos, ULONG cFilterAttrs, const TS_ATTRID *paFilterAttrs, DWORD dwFlags) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE RequestAttrsTransitioningAtPosition(LONG acpPos, ULONG cFilterAttrs, const TS_ATTRID *paFilterAttrs, DWORD dwFlags) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE FindNextAttrTransition(LONG acpStart, LONG acpHalt, ULONG cFilterAttrs, const TS_ATTRID *paFilterAttrs, DWORD dwFlags, LONG *pacpNext, BOOL *pfFound, LONG *plFoundOffset) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE RetrieveRequestedAttrs(ULONG ulCount, TS_ATTRVAL *paAttrVals, ULONG *pcFetched) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE GetEndACP(LONG *pacp) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE GetActiveView(TsViewCookie *pvcView) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE GetACPFromPoint(TsViewCookie vcView, const POINT *ptScreen, DWORD dwFlags, LONG *pacp) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE GetTextExt(TsViewCookie vcView, LONG acpStart, LONG acpEnd, RECT *prc, BOOL *pfClipped) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE GetScreenExt(TsViewCookie vcView, RECT *prc) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE GetWnd(TsViewCookie vcView, HWND *phwnd) override { return E_NOTIMPL; }
};
#pragma warning(pop)
