#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace jev {
// Protocol counts Unicode scalar values, not glyphs or UTF-16 code units.
// No normalization, whitespace trimming, or hard/soft-wrap reconstruction.
inline bool Tail(const std::wstring& input, bool at_start, std::wstring& output) {
  std::vector<size_t> starts;
  for (size_t i = 0; i < input.size(); ++i) {
    const auto c = static_cast<uint32_t>(input[i]);
    if (i == 0 && c >= 0xdc00 && c <= 0xdfff && !at_start) continue;
    starts.push_back(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      if (++i == input.size() || input[i] < 0xdc00 || input[i] > 0xdfff) return false;
    } else if ((c >= 0xdc00 && c <= 0xdfff) || c == 0 || c == 0xfffc ||
               (c < 32 && c != 9 && c != 10 && c != 13) || c == 127) {
      return false;
    }
  }
  output = starts.empty() ? L"" : input.substr(starts[starts.size() > 80 ? starts.size() - 80 : 0]);
  return at_start || starts.size() >= 80;
}

inline std::wstring Hex(const std::wstring& input) {
  const wchar_t* digits = L"0123456789abcdef";
  std::wstring result;
  for (auto c : input) for (int shift = 12; shift >= 0; shift -= 4)
    result += digits[(static_cast<unsigned>(c) >> shift) & 15];
  return result;
}

inline bool Unhex(const std::wstring& input, std::wstring& output) {
  if (input.size() > 640 || input.size() % 4) return false;
  output.clear();
  for (size_t i = 0; i < input.size(); i += 4) {
    unsigned c = 0;
    for (size_t j = i; j < i + 4; ++j) {
      auto d = input[j];
      if (!((d >= L'0' && d <= L'9') || (d >= L'a' && d <= L'f'))) return false;
      c = c * 16 + (d <= L'9' ? d - L'0' : d - L'a' + 10);
    }
    output += static_cast<wchar_t>(c);
  }
  std::wstring checked;
  return Tail(output, true, checked) && checked == output;
}

struct Snapshot {
  std::wstring stamp;
  std::wstring quality = L"unavailable";
  std::wstring text;
  std::wstring Wire() const { return L"JCTX1|" + stamp + L"|" + quality + L"|" + Hex(text); }
};

inline bool Parse(const std::wstring& wire, Snapshot& out) {
  if (wire.size() > 740 || wire.substr(0, 6) != L"JCTX1|") return false;
  auto p = wire.find(L'|', 6), q = p == std::wstring::npos ? p : wire.find(L'|', p + 1);
  if (q == std::wstring::npos) return false;
  out.stamp = wire.substr(6, p - 6);
  if (out.stamp.empty() || out.stamp.size() > 60 || out.stamp.find_first_not_of(L"0123456789-") != std::wstring::npos) return false;
  out.quality = wire.substr(p + 1, q - p - 1);
  if (out.quality != L"exact" && out.quality != L"unavailable" && out.quality != L"sensitive") return false;
  if (!Unhex(wire.substr(q + 1), out.text)) return false;
  return out.quality == L"exact" || out.text.empty();
}
}  // namespace jev
