// SDK interface stubs for the controlled text-store fixture. No live application access.
#pragma once
#include <msctf.h>
#pragma warning(push)
#pragma warning(disable: 4100)
struct ITfContextStub : ITfContext {
  STDMETHODIMP QueryInterface(REFIID, void** out) override { *out = nullptr; return E_NOINTERFACE; }
  STDMETHODIMP_(ULONG) AddRef() override { return ++refs; }
  STDMETHODIMP_(ULONG) Release() override { auto n = --refs; if (!n) delete this; return n; }
  virtual ~ITfContextStub() {}
  ULONG refs = 1;
  HRESULT STDMETHODCALLTYPE RequestEditSession(TfClientId tid, ITfEditSession *pes, DWORD dwFlags, HRESULT *phrSession) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE InWriteSession(TfClientId tid, BOOL *pfWriteSession) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE GetSelection(TfEditCookie ec, ULONG ulIndex, ULONG ulCount, TF_SELECTION *pSelection, ULONG *pcFetched) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE SetSelection(TfEditCookie ec, ULONG ulCount, const TF_SELECTION *pSelection) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE GetStart(TfEditCookie ec, ITfRange **ppStart) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE GetEnd(TfEditCookie ec, ITfRange **ppEnd) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE GetActiveView(ITfContextView **ppView) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE EnumViews(IEnumTfContextViews **ppEnum) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE GetStatus(TF_STATUS *pdcs) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE GetProperty(REFGUID guidProp, ITfProperty **ppProp) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE GetAppProperty(REFGUID guidProp, ITfReadOnlyProperty **ppProp) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE TrackProperties(const GUID **prgProp, ULONG cProp, const GUID **prgAppProp, ULONG cAppProp, ITfReadOnlyProperty **ppProperty) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE EnumProperties(IEnumTfProperties **ppEnum) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE GetDocumentMgr(ITfDocumentMgr **ppDm) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE CreateRangeBackup(TfEditCookie ec, ITfRange *pRange, ITfRangeBackup **ppBackup) override { return E_NOTIMPL; }
};
struct ITfRangeStub : ITfRange {
  STDMETHODIMP QueryInterface(REFIID, void** out) override { *out = nullptr; return E_NOINTERFACE; }
  STDMETHODIMP_(ULONG) AddRef() override { return ++refs; }
  STDMETHODIMP_(ULONG) Release() override { auto n = --refs; if (!n) delete this; return n; }
  virtual ~ITfRangeStub() {}
  ULONG refs = 1;
  HRESULT STDMETHODCALLTYPE GetText(TfEditCookie ec, DWORD dwFlags, WCHAR *pchText, ULONG cchMax, ULONG *pcch) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE SetText(TfEditCookie ec, DWORD dwFlags, const WCHAR *pchText, LONG cch) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE GetFormattedText(TfEditCookie ec, IDataObject **ppDataObject) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE GetEmbedded(TfEditCookie ec, REFGUID rguidService, REFIID riid, IUnknown **ppunk) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE InsertEmbedded(TfEditCookie ec, DWORD dwFlags, IDataObject *pDataObject) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE ShiftStart(TfEditCookie ec, LONG cchReq, LONG *pcch, const TF_HALTCOND *pHalt) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE ShiftEnd(TfEditCookie ec, LONG cchReq, LONG *pcch, const TF_HALTCOND *pHalt) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE ShiftStartToRange(TfEditCookie ec, ITfRange *pRange, TfAnchor aPos) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE ShiftEndToRange(TfEditCookie ec, ITfRange *pRange, TfAnchor aPos) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE ShiftStartRegion(TfEditCookie ec, TfShiftDir dir, BOOL *pfNoRegion) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE ShiftEndRegion(TfEditCookie ec, TfShiftDir dir, BOOL *pfNoRegion) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE IsEmpty(TfEditCookie ec, BOOL *pfEmpty) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE Collapse(TfEditCookie ec, TfAnchor aPos) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE IsEqualStart(TfEditCookie ec, ITfRange *pWith, TfAnchor aPos, BOOL *pfEqual) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE IsEqualEnd(TfEditCookie ec, ITfRange *pWith, TfAnchor aPos, BOOL *pfEqual) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE CompareStart(TfEditCookie ec, ITfRange *pWith, TfAnchor aPos, LONG *plResult) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE CompareEnd(TfEditCookie ec, ITfRange *pWith, TfAnchor aPos, LONG *plResult) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE AdjustForInsert(TfEditCookie ec, ULONG cchInsert, BOOL *pfInsertOk) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE GetGravity(TfGravity *pgStart, TfGravity *pgEnd) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE SetGravity(TfEditCookie ec, TfGravity gStart, TfGravity gEnd) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE Clone(ITfRange **ppClone) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE GetContext(ITfContext **ppContext) override { return E_NOTIMPL; }
};
#pragma warning(pop)
