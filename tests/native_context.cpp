#include "JevTsfContext.h"
#include <cassert>
#include <iostream>

int main() {
  std::vector<char> first(12, 'a'), second(12, 'b'), body;
  first.insert(first.end(), {'J', 0, '1', 0});
  second.insert(second.end(), {'J', 0, '2', 0});
  assert(jev::PacketBody(first, body) && body == std::vector<char>({'J', 0, '1', 0}));
  auto saved = body;
  assert(jev::PacketBody(second, body) && body != saved);
  assert(jev::PacketBody(std::vector<char>(12), body) && body.empty());
  assert(!jev::PacketBody(std::vector<char>(11), body));
  assert(!jev::PacketBody(std::vector<char>(65537), body));
  std::wstring out;
  assert(jev::Tail(L"word  \r\nnext\t", true, out) && out == L"word  \r\nnext\t");
  assert(jev::Tail(L"", true, out) && out.empty());
  assert(!jev::Tail(L"short", false, out));
  assert(jev::Tail(std::wstring(100, L'a'), false, out) && out.size() == 80);
  std::wstring emoji;
  for (int i = 0; i < 81; ++i) emoji += L"\xd83d\xde00";
  assert(jev::Tail(emoji, false, out) && out.size() == 160);
  assert(jev::Tail(emoji.substr(1), false, out) && out.size() == 160);
  assert(!jev::Tail(emoji.substr(1), true, out));
  assert(!jev::Tail(L"\xd800", true, out));
  assert(!jev::Tail(L"\xdc00", true, out));
  assert(!jev::Tail(L"\xfffc", true, out));
  assert(!jev::Tail(std::wstring(1, 0), true, out));
  jev::Snapshot s;
  s.stamp = L"1-2-3"; s.quality = L"exact"; s.text = L"\x4f60\x597d  \n\xd83d\xde00";
  jev::Snapshot parsed;
  assert(jev::Parse(s.Wire(), parsed) && parsed.text == s.text && parsed.stamp == s.stamp);
  for (const auto wire : {L"JCTX1||exact|", L"JCTX1|1|exact|d800", L"JCTX1|1|exact|0000",
       L"JCTX1|1|sensitive|0061", L"JCTX1|1|exact|zzzz", L"JCTX1|1|partial|", L"JCTX1|1|exact|000"})
    assert(!jev::Parse(wire, parsed));
  std::cout << "native scalar/protocol tests PASS\n";
}
