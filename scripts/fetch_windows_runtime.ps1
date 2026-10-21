# Build-machine preparation only. Download, verify and record; never install here.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$dest = Join-Path $root '.tools/redist'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$file = Join-Path $dest 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
$url = 'https://go.microsoft.com/fwlink/?linkid=2124701'
Invoke-WebRequest -Uri $url -OutFile $file
if ((Get-Item $file).Length -lt 20MB) { throw 'Expected the full offline runtime, not a bootstrapper.' }
$signature = Get-AuthenticodeSignature -LiteralPath $file
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
    throw 'WebView2 installer does not have a valid Microsoft signature.'
}
@{
    filename = (Split-Path $file -Leaf)
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant()
    version = (Get-Item $file).VersionInfo.ProductVersion
    source = $url
    architecture = 'x64'
    signature = 'Valid Microsoft Corporation'
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $dest 'webview2.json')
