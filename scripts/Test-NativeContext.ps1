$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$output = Join-Path $project 'runtime\context-tests'
New-Item -ItemType Directory -Force -Path $output | Out-Null
Push-Location $output
try {
    foreach ($name in @('native_context', 'native_text_store', 'native_edit_session', 'native_tsf_manager')) {
        & cl /nologo /std:c++17 /EHsc /W4 /DUNICODE /D_UNICODE /I"$project\native\include" "$project\tests\$name.cpp" /link ole32.lib oleaut32.lib uuid.lib user32.lib
        if ($LASTEXITCODE -ne 0) { throw "Compile failed: $name" }
        & (Join-Path $output "$name.exe")
        if ($LASTEXITCODE -ne 0) { throw "Test failed: $name" }
    }
} finally { Pop-Location }
