# One-click setup for the video-studio Claude Code skill (Windows 10/11).
# Run it by double-clicking setup-video-studio.bat next to this file.
#
# It installs what is missing (Git, Node.js LTS, FFmpeg, Python, Claude Code) with winget, sets up
# HyperFrames (its skills and a render browser), copies the skill into your Claude skills folder,
# and checks everything. Safe to run again: it skips what is already there and updates the skill.

param([switch]$DepsOnly, [switch]$NoPause)

$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$skillSrc = Join-Path $here "video-studio"
$skillDst = Join-Path $env:USERPROFILE ".claude\skills\video-studio"
$failed = @()

function Say($text, $color = "Gray") { Write-Host $text -ForegroundColor $color }
function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }

function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $links = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links"
    $local = Join-Path $env:USERPROFILE ".local\bin"
    # Keep the current Path too, so nothing already on it is lost; the new folders go first.
    $env:PATH = (@($links, $local, $machine, $user, $env:PATH) | Where-Object { $_ }) -join [IO.Path]::PathSeparator
}

function Have($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

function Winget-Install($id, $label) {
    Say "    Installing $label (this can take a few minutes)..."
    & winget install -e --id $id --silent --accept-source-agreements --accept-package-agreements | Out-Host
    # winget exits non-zero when the package is already installed; check for the program instead.
    Refresh-Path
}

function Node-Major {
    if (-not (Have "node")) { return 0 }
    $v = (& node --version) 2>$null
    if ($v -match "v(\d+)") { return [int]$Matches[1] } else { return 0 }
}

Write-Host ""
Write-Host "  video-studio setup" -ForegroundColor White
Write-Host "  Studio-quality videos in Claude Code. This takes 5-15 minutes the first time." -ForegroundColor DarkGray

if (-not $DepsOnly -and -not (Test-Path (Join-Path $skillSrc "SKILL.md"))) {
    Say "Can't find the 'video-studio' folder next to this installer. Unzip the whole zip first, then run the installer from the unzipped folder." "Red"
    if (-not $NoPause) { Read-Host "Press Enter to close" }
    exit 1
}

Step "Checking winget (Windows' own app installer)"
if (-not (Have "winget")) {
    Say "winget is missing. Install 'App Installer' from the Microsoft Store (search: App Installer), then run this again." "Red"
    try { Start-Process "ms-windows-store://pdp/?productid=9NBLGGH4NNS1" } catch { }
    if (-not $NoPause) { Read-Host "Press Enter to close" }
    exit 1
}
Say "    ok"
Refresh-Path

Step "Git (Claude Code uses Git Bash on Windows)"
if (Have "git") { Say "    ok: $(& git --version)" } else { Winget-Install "Git.Git" "Git"; if (-not (Have "git")) { $failed += "Git" } }

Step "Node.js 22 or newer"
if ((Node-Major) -ge 22) { Say "    ok: $(& node --version)" } else {
    Winget-Install "OpenJS.NodeJS.LTS" "Node.js LTS"
    if ((Node-Major) -lt 22) { $failed += "Node.js 22+" }
}

Step "FFmpeg"
if ((Have "ffmpeg") -and (Have "ffprobe")) { Say "    ok" } else {
    Winget-Install "Gyan.FFmpeg" "FFmpeg"
    if (-not ((Have "ffmpeg") -and (Have "ffprobe"))) { $failed += "FFmpeg" }
}

Step "Python 3"
$py = $null
foreach ($c in @("py", "python")) {
    if (Have $c) {
        $out = (& $c --version) 2>&1
        if ("$out" -match "Python 3\.(\d+)" -and [int]$Matches[1] -ge 10) { $py = $c; break }
    }
}
if ($py) { Say "    ok: $(& $py --version)" } else {
    Winget-Install "Python.Python.3.12" "Python 3.12"
    foreach ($c in @("py", "python")) { if (Have $c) { $py = $c; break } }
    if (-not $py) { $failed += "Python" }
}

Step "Claude Code"
if (Have "claude") { Say "    ok: $(& claude --version)" } else {
    Say "    Installing Claude Code..."
    try { Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression } catch { Say "    $($_.Exception.Message)" "Yellow" }
    Refresh-Path
    if (-not (Have "claude")) { $failed += "Claude Code (install it from https://claude.com/claude-code)" }
}

if (Have "npx") {
    Step "HyperFrames skills (the video engine Claude uses)"
    & npx --yes hyperframes skills | Out-Host
    if ($LASTEXITCODE -ne 0) { $failed += "HyperFrames skills" }

    Step "Render browser (headless Chrome for HyperFrames)"
    & npx --yes hyperframes browser ensure | Out-Host
    if ($LASTEXITCODE -ne 0) { $failed += "Render browser" }
} else {
    $failed += "HyperFrames (needs Node.js)"
}

if (-not $DepsOnly) {
    Step "Installing the video-studio skill"
    $parent = Split-Path -Parent $skillDst
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    if (Test-Path $skillDst) { Remove-Item -Recurse -Force $skillDst }
    Copy-Item -Recurse -Force $skillSrc $skillDst
    Say "    copied to $skillDst"
}

Step "Final check"
if ($py) {
    $doctor = if ($DepsOnly) { Join-Path $skillSrc "scripts\doctor.py" } else { Join-Path $skillDst "scripts\doctor.py" }
    if ($py -eq "py") { & py -3 $doctor | Out-Host } else { & python $doctor | Out-Host }
    if ($LASTEXITCODE -ne 0) { $failed += "final check (see the lines marked MISS above)" }
}

Write-Host ""
if ($failed.Count -eq 0) {
    Write-Host "  All set." -ForegroundColor Green
    Write-Host "  1. Close Claude Code if it is open, then open it again (new programs need a fresh start)."
    Write-Host "  2. In any project folder, type:   /video-studio make a 20 second launch video for this"
} else {
    Write-Host "  Almost there. These need attention:" -ForegroundColor Yellow
    foreach ($f in $failed) { Write-Host "   - $f" -ForegroundColor Yellow }
    Write-Host "  Close this window, restart the computer if a program was just installed, and run the installer again."
    Write-Host "  Still stuck? Open Claude Code and type: /video-studio help me finish setup"
}
Write-Host ""
if (-not $NoPause) { Read-Host "Press Enter to close" }
if ($failed.Count -eq 0) { exit 0 } else { exit 1 }
