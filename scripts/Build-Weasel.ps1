$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$source = Join-Path $project 'upstream\weasel'
& python (Join-Path $PSScriptRoot 'Prepare-Weasel.py')
if ($LASTEXITCODE -ne 0) { throw 'Patch failed.' }
Push-Location $source
try {
    $boost = Join-Path $source 'deps\boost_1_84_0'
    if (-not (Test-Path -LiteralPath (Join-Path $boost 'boost\version.hpp'))) {
        New-Item -ItemType Directory -Force -Path deps | Out-Null
        Invoke-WebRequest 'https://archives.boost.io/release/1.84.0/source/boost_1_84_0.7z' -OutFile deps/boost.7z
        & 7z x deps/boost.7z '-odeps' -y | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Boost extraction failed.' }
    }
    Push-Location $boost
    try {
        if (-not (Test-Path -LiteralPath b2.exe)) {
            & cmd /c bootstrap.bat
            if ($LASTEXITCODE -ne 0) { throw 'Boost bootstrap failed.' }
        }
        & .\b2.exe '-j4' --with-filesystem --with-json --with-locale --with-regex --with-serialization --with-system --with-thread toolset=msvc-14.3 architecture=x86 address-model=64 variant=release link=static runtime-link=static threading=multi stage
        if ($LASTEXITCODE -ne 0) { throw 'Boost build failed.' }
    } finally { Pop-Location }
    $archive = 'rime-1c23358-Windows-msvc-x64.7z'
    if (-not (Test-Path -LiteralPath $archive)) {
        Invoke-WebRequest "https://github.com/rime/librime/releases/download/1.13.1/$archive" -OutFile $archive
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne '05FCF8CC2D058A0186DD9F04D6E021AD41687DB50DC81E85CF655DFABFDF0009') {
        throw 'Pinned librime SDK checksum mismatch.'
    }
    & 7z x $archive '-ojevsdk' -y | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'SDK extraction failed.' }
    Copy-Item jevsdk/dist/include/rime_*.h include
    Copy-Item jevsdk/dist/lib/rime.lib lib64
    $props = [IO.File]::ReadAllText((Join-Path $source 'weasel.props.template'))
    $values = @{ BOOST_ROOT=$boost; PLATFORM_TOOLSET='v143'; VERSION_MAJOR='0'; VERSION_MINOR='17'; VERSION_PATCH='4'; PRODUCT_VERSION='0.17.4.1'; FILE_VERSION='0.17.4.1' }
    foreach ($key in $values.Keys) { $props = $props.Replace('$' + $key, $values[$key]) }
    [IO.File]::WriteAllText((Join-Path $source 'weasel.props'), $props)
    foreach ($target in @('WeaselServer', 'WeaselTSF')) {
        & msbuild weasel.sln /m /nologo "/t:$target" /p:Configuration=Release /p:Platform=x64 /p:WindowsTargetPlatformVersion=10.0 /v:minimal
        if ($LASTEXITCODE -ne 0) { throw "Native build failed: $target" }
    }
} finally { Pop-Location }
