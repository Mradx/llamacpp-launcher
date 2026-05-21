@echo off
setlocal EnableExtensions DisableDelayedExpansion

title llamacpp-launcher

if /i not "%~1"=="--inside-cmd" (
  cmd /k ""%~f0" --inside-cmd %*"
  exit /b
)

shift /1
set "LAUNCHER_BAT=%~f0"
set "LAUNCHER_SCRIPT_DIR=%~dp0"
set "LAUNCHER_RUN_FILE=%TEMP%\llamacpp-launcher-run-%RANDOM%%RANDOM%.cmd"
set "LAUNCHER_SELF_TEST="
if /i "%~1"=="--self-test" set "LAUNCHER_SELF_TEST=1"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $content=Get-Content -Raw -LiteralPath $env:LAUNCHER_BAT; $marker=':__POWERSHELL_PAYLOAD__'; $idx=$content.LastIndexOf($marker); if($idx -lt 0){ throw 'PowerShell payload marker was not found.' }; $payload=$content.Substring($idx + $marker.Length).TrimStart([char]13,[char]10); $script=[ScriptBlock]::Create($payload); & $script -BatchPath $env:LAUNCHER_BAT -ScriptDir $env:LAUNCHER_SCRIPT_DIR"
set "PS_EXIT=%ERRORLEVEL%"

if "%PS_EXIT%"=="90" (
  if exist "%LAUNCHER_RUN_FILE%" (
    call "%LAUNCHER_RUN_FILE%"
    set "APP_EXIT=%ERRORLEVEL%"
    del "%LAUNCHER_RUN_FILE%" >nul 2>nul
    exit /b %APP_EXIT%
  )
  echo.
  echo [ERROR] Launcher handoff file was not created:
  echo         %LAUNCHER_RUN_FILE%
  exit /b 1
)

if exist "%LAUNCHER_RUN_FILE%" del "%LAUNCHER_RUN_FILE%" >nul 2>nul
exit /b %PS_EXIT%

:__POWERSHELL_PAYLOAD__
param(
  [Parameter(Mandatory = $true)]
  [string] $BatchPath,

  [Parameter(Mandatory = $true)]
  [string] $ScriptDir
)

$ErrorActionPreference = 'Stop'

$script:AppName = 'llamacpp-launcher'
$script:NodeRequirement = '20.19+, 22.13+, or 24+'
$script:BatchPath = [IO.Path]::GetFullPath($BatchPath)
$script:ScriptDir = [IO.Path]::GetFullPath($ScriptDir)
if (-not $script:ScriptDir.EndsWith([IO.Path]::DirectorySeparatorChar)) {
  $script:ScriptDir = $script:ScriptDir + [IO.Path]::DirectorySeparatorChar
}

$script:LogFile = Join-Path $script:ScriptDir 'llamacpp-launcher.log'
$script:FailureCode = 1
$script:InstallRoot = $null
$script:NpmPrefix = $null
$script:NpmCache = $null
$script:AppDir = $null
$script:AppEntry = $null
$script:AppPackageJson = $null
$script:AppVersionMarker = $null
$script:NodeExe = $null
$script:NpmCmd = $null
$script:NodeVersion = $null
$script:GitExe = $null
$script:GitVersion = $null
$script:RunFile = $env:LAUNCHER_RUN_FILE
$script:LaunchDelegated = $false
$script:DelegatedLaunchExitCode = 90

try {
  $Host.UI.RawUI.WindowTitle = 'llamacpp-launcher'
} catch {
}

function Get-Timestamp {
  return (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
}

function Start-Log {
  try {
    Set-Content -LiteralPath $script:LogFile -Encoding UTF8 -Value ("[{0}] {1} started" -f (Get-Timestamp), $script:AppName)
  } catch {
    $script:LogFile = Join-Path ([IO.Path]::GetTempPath()) 'llamacpp-launcher.log'
    Set-Content -LiteralPath $script:LogFile -Encoding UTF8 -Value ("[{0}] {1} started" -f (Get-Timestamp), $script:AppName)
  }

  Write-Log ("Batch path: {0}" -f $script:BatchPath)
  Write-Log ("Script directory: {0}" -f $script:ScriptDir)
}

function Write-Log {
  param([string] $Message)

  try {
    Add-Content -LiteralPath $script:LogFile -Encoding UTF8 -Value ("[{0}] {1}" -f (Get-Timestamp), $Message)
  } catch {
  }
}

function Write-Ui {
  param(
    [string] $Text = '',
    [ConsoleColor] $Color = [ConsoleColor]::Gray
  )

  if ([Console]::IsOutputRedirected) {
    Write-Output $Text
  } else {
    Write-Host $Text -ForegroundColor $Color
  }
}

function Write-Header {
  try {
    if (-not [Console]::IsOutputRedirected) {
      Clear-Host
    }
  } catch {
  }

  Write-Ui ''
  Write-Ui '============================================================' Cyan
  Write-Ui ' LLAMACPP-LAUNCHER' White
  Write-Ui '============================================================' Cyan
  Write-Ui ''
  Write-KeyValue 'Script' $script:BatchPath
  Write-KeyValue 'Install root' $script:InstallRoot
  Write-KeyValue 'Log file' $script:LogFile
  Write-Ui ''
}

function Write-Section {
  param([string] $Title)

  Write-Ui ''
  Write-Ui ("-- {0} {1}" -f $Title, ('-' * [Math]::Max(1, 57 - $Title.Length))) Cyan
}

function Write-KeyValue {
  param(
    [string] $Key,
    [string] $Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    $Value = 'n/a'
  }

  Write-Ui ("  {0,-14} {1}" -f $Key, $Value) DarkGray
}

function Write-Status {
  param(
    [ValidateSet('OK', 'WARN', 'ERROR', 'INFO', 'STEP')]
    [string] $State,
    [string] $Message,
    [string] $Detail = ''
  )

  $label = '[INFO]'
  $color = [ConsoleColor]::Gray

  switch ($State) {
    'OK' {
      $label = '[OK]'
      $color = [ConsoleColor]::Green
    }
    'WARN' {
      $label = '[WARN]'
      $color = [ConsoleColor]::Yellow
    }
    'ERROR' {
      $label = '[ERROR]'
      $color = [ConsoleColor]::Red
    }
    'STEP' {
      $label = '[RUN]'
      $color = [ConsoleColor]::Cyan
    }
  }

  if ([Console]::IsOutputRedirected) {
    Write-Output ("  {0,-7} {1}" -f $label, $Message)
  } else {
    Write-Host ("  {0,-7} " -f $label) -ForegroundColor $color -NoNewline
    Write-Host $Message -ForegroundColor Gray
  }

  if (-not [string]::IsNullOrWhiteSpace($Detail)) {
    Write-Ui ("          {0}" -f $Detail) DarkGray
  }
}

function Stop-Launcher {
  param(
    [string] $Message,
    [int] $Code = 1
  )

  $script:FailureCode = $Code
  throw $Message
}

function Pause-IfInteractive {
  if ($script:LaunchDelegated) {
    return
  }

  if ($env:LAUNCHER_SELF_TEST -eq '1') {
    return
  }

  try {
    if (-not [Console]::IsInputRedirected) {
      Write-Ui ''
      Write-Ui 'Press any key to close this window...' DarkGray
      [void] [Console]::ReadKey($true)
    }
  } catch {
  }
}

function ConvertTo-BatchLiteral {
  param([string] $Value)

  if ($null -eq $Value) {
    return ''
  }

  return ([string] $Value).Replace('^', '^^').Replace('%', '%%')
}

function Initialize-Paths {
  $fallbackRoot = Join-Path $script:ScriptDir '.llamacpp-launcher-data'
  if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $root = $fallbackRoot
  } else {
    $root = Join-Path $env:LOCALAPPDATA $script:AppName
  }

  try {
    New-Item -ItemType Directory -Force -Path $root | Out-Null
  } catch {
  }

  if (-not (Test-Path -LiteralPath $root -PathType Container)) {
    $root = $fallbackRoot
    New-Item -ItemType Directory -Force -Path $root | Out-Null
  }

  $script:InstallRoot = [IO.Path]::GetFullPath($root)
  $script:NpmPrefix = Join-Path $script:InstallRoot 'npm-prefix'
  $script:NpmCache = Join-Path $script:InstallRoot 'npm-cache'
  $script:AppDir = Join-Path (Join-Path $script:NpmPrefix 'node_modules') $script:AppName
  $script:AppEntry = Join-Path (Join-Path $script:AppDir 'dist') 'index.js'
  $script:AppPackageJson = Join-Path $script:AppDir 'package.json'
  $script:AppVersionMarker = Join-Path $script:InstallRoot 'installed-version.txt'
  $env:LLAMACPP_LAUNCHER_HOME = $script:InstallRoot
}

function Test-SupportedNodeVersion {
  param([string] $Version)

  if ($Version -notmatch '^v?(\d+)\.(\d+)\.(\d+)') {
    return $false
  }

  $major = [int] $Matches[1]
  $minor = [int] $Matches[2]

  return (($major -eq 20 -and $minor -ge 19) -or ($major -eq 22 -and $minor -ge 13) -or ($major -ge 24))
}

function Add-UniquePath {
  param(
    [hashtable] $Seen,
    [string] $Path
  )

  if ([string]::IsNullOrWhiteSpace($Path)) {
    return
  }

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return
  }

  try {
    $full = (Resolve-Path -LiteralPath $Path).Path
    $key = $full.ToLowerInvariant()
    if (-not $Seen.ContainsKey($key)) {
      $Seen[$key] = $full
    }
  } catch {
  }
}

function Get-NormalizedPathKey {
  param([string] $Path)

  if ([string]::IsNullOrWhiteSpace($Path)) {
    return ''
  }

  try {
    $normalized = (Resolve-Path -LiteralPath $Path).Path
  } catch {
    try {
      $normalized = [IO.Path]::GetFullPath($Path)
    } catch {
      $normalized = $Path
    }
  }

  return $normalized.TrimEnd([char] '\', [char] '/').ToLowerInvariant()
}

function Get-NodeIdentityKey {
  param([string] $Path)

  $full = Get-NormalizedPathKey -Path $Path
  if ([string]::IsNullOrWhiteSpace($full)) {
    return ''
  }

  try {
    $dir = Split-Path -Parent $full
    $leaf = Split-Path -Leaf $full
    $dirItem = Get-Item -LiteralPath $dir -Force -ErrorAction Stop

    $targetValue = $null
    $targetProperty = $dirItem.PSObject.Properties['Target']
    if ($targetProperty) {
      $targetValue = $targetProperty.Value
    }
    if ($null -eq $targetValue) {
      $targetProperty = $dirItem.PSObject.Properties['LinkTarget']
      if ($targetProperty) {
        $targetValue = $targetProperty.Value
      }
    }

    if ($targetValue) {
      if ($targetValue -is [array]) {
        $target = [string] $targetValue[0]
      } else {
        $target = [string] $targetValue
      }

      if (-not [string]::IsNullOrWhiteSpace($target)) {
        if (-not [IO.Path]::IsPathRooted($target)) {
          $target = Join-Path (Split-Path -Parent $dirItem.FullName) $target
        }

        $targetNode = Join-Path $target $leaf
        $targetKey = Get-NormalizedPathKey -Path $targetNode
        if (-not [string]::IsNullOrWhiteSpace($targetKey)) {
          return ("path:{0}" -f $targetKey)
        }
      }
    }
  } catch {
  }

  return ("path:{0}" -f $full)
}

function Get-NvmRuntimeKey {
  param(
    [string] $Node,
    [string] $Version
  )

  if ($Version -notmatch '^v?\d+\.\d+\.\d+') {
    return ''
  }

  $nodeKey = Get-NormalizedPathKey -Path $Node
  if ([string]::IsNullOrWhiteSpace($nodeKey)) {
    return ''
  }

  if ($env:NVM_SYMLINK) {
    $nvmSymlinkKey = Get-NormalizedPathKey -Path (Join-Path $env:NVM_SYMLINK 'node.exe')
    if ($nodeKey -eq $nvmSymlinkKey) {
      return ("nvm:{0}" -f $Version.ToLowerInvariant())
    }
  }

  $nvmRoots = @()
  if ($env:NVM_HOME) {
    $nvmRoots += $env:NVM_HOME
  }
  if ($env:APPDATA) {
    $nvmRoots += Join-Path $env:APPDATA 'nvm'
  }
  if ($env:LOCALAPPDATA) {
    $nvmRoots += Join-Path $env:LOCALAPPDATA 'nvm'
  }

  foreach ($root in $nvmRoots) {
    $rootKey = Get-NormalizedPathKey -Path $root
    if (-not [string]::IsNullOrWhiteSpace($rootKey) -and
        $nodeKey.StartsWith($rootKey + '\') -and
        $nodeKey -match '\\v\d+\.\d+\.\d+\\node\.exe$') {
      return ("nvm:{0}" -f $Version.ToLowerInvariant())
    }
  }

  if ($nodeKey -match '\\nvm4w\\nodejs\\node\.exe$') {
    return ("nvm:{0}" -f $Version.ToLowerInvariant())
  }

  return ''
}

function Get-NodeDedupeKey {
  param(
    [string] $Node,
    [string] $Version
  )

  $nvmKey = Get-NvmRuntimeKey -Node $Node -Version $Version
  if (-not [string]::IsNullOrWhiteSpace($nvmKey)) {
    return $nvmKey
  }

  return (Get-NodeIdentityKey -Path $Node)
}

function Get-NodeCandidates {
  $seen = @{}

  try {
    Get-Command node.exe -All -ErrorAction SilentlyContinue | ForEach-Object {
      Add-UniquePath -Seen $seen -Path $_.Source
    }
  } catch {
  }

  $candidateFiles = @()
  if ($env:ProgramFiles) {
    $candidateFiles += Join-Path $env:ProgramFiles 'nodejs\node.exe'
    $candidateFiles += Join-Path $env:ProgramFiles 'Nodist\bin\node.exe'
  }
  if (${env:ProgramFiles(x86)}) {
    $candidateFiles += Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'
    $candidateFiles += Join-Path ${env:ProgramFiles(x86)} 'Nodist\bin\node.exe'
  }
  if ($env:LOCALAPPDATA) {
    $candidateFiles += Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'
    $candidateFiles += Join-Path $env:LOCALAPPDATA 'Volta\bin\node.exe'
  }
  if ($env:NVM_SYMLINK) {
    $candidateFiles += Join-Path $env:NVM_SYMLINK 'node.exe'
  }

  foreach ($path in $candidateFiles) {
    Add-UniquePath -Seen $seen -Path $path
  }

  $versionRoots = @()
  if ($env:NVM_HOME) {
    $versionRoots += $env:NVM_HOME
  }
  if ($env:APPDATA) {
    $versionRoots += Join-Path $env:APPDATA 'nvm'
  }
  if ($env:LOCALAPPDATA) {
    $versionRoots += Join-Path $env:LOCALAPPDATA 'nvm'
  }

  foreach ($root in $versionRoots) {
    if (Test-Path -LiteralPath $root -PathType Container) {
      Get-ChildItem -LiteralPath $root -Directory -Filter 'v*' -ErrorAction SilentlyContinue | ForEach-Object {
        Add-UniquePath -Seen $seen -Path (Join-Path $_.FullName 'node.exe')
      }
    }
  }

  $fnmRoots = @()
  if ($env:LOCALAPPDATA) {
    $fnmRoots += Join-Path $env:LOCALAPPDATA 'fnm\node-versions'
  }
  if ($env:APPDATA) {
    $fnmRoots += Join-Path $env:APPDATA 'fnm\node-versions'
  }

  foreach ($root in $fnmRoots) {
    if (Test-Path -LiteralPath $root -PathType Container) {
      Get-ChildItem -LiteralPath $root -Recurse -File -Filter node.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\installation\\node\.exe$' } |
        ForEach-Object { Add-UniquePath -Seen $seen -Path $_.FullName }
    }
  }

  $rows = @()
  foreach ($node in $seen.Values) {
    $dir = Split-Path -Parent $node
    $npm = Join-Path $dir 'npm.cmd'
    $version = 'unknown'
    $major = 0
    $minor = 0
    $patch = 0

    try {
      $raw = & $node --version 2>$null | Select-Object -First 1
      if ($raw) {
        $version = ([string] $raw).Trim()
      }
    } catch {
    }

    if ($version -match '^v?(\d+)\.(\d+)\.(\d+)') {
      $major = [int] $Matches[1]
      $minor = [int] $Matches[2]
      $patch = [int] $Matches[3]
    } elseif ($version -match '^v?(\d+)') {
      $major = [int] $Matches[1]
    }

    $status = 'unsupported'
    if (-not (Test-Path -LiteralPath $npm -PathType Leaf)) {
      $status = 'missing-npm'
    } elseif (Test-SupportedNodeVersion -Version $version) {
      $status = 'supported'
    }

    $rank = 50
    if ($node -match '\\nvm\\v\d+\.\d+\.\d+\\node\.exe$') {
      $rank = 0
    } elseif ($node -match '\\nodejs\\node\.exe$') {
      $rank = 10
    } elseif ($node -match '\\Volta\\bin\\node\.exe$') {
      $rank = 20
    } elseif ($node -match '\\fnm\\node-versions\\') {
      $rank = 30
    }

    $rows += [pscustomobject] @{
      Status = $status
      Major = $major
      Minor = $minor
      Patch = $patch
      Version = $version
      Node = $node
      Npm = $npm
      Rank = $rank
      DedupeKey = Get-NodeDedupeKey -Node $node -Version $version
    }
  }

  $sortedRows = @($rows | Sort-Object `
    @{ Expression = { if ($_.Status -eq 'supported') { 0 } else { 1 } } }, `
    Rank, `
    @{ Expression = 'Major'; Descending = $true }, `
    @{ Expression = 'Minor'; Descending = $true }, `
    @{ Expression = 'Patch'; Descending = $true }, `
    Node)

  $uniqueRows = @()
  $seenRuntimes = @{}
  foreach ($row in $sortedRows) {
    $key = $row.DedupeKey
    if ([string]::IsNullOrWhiteSpace($key)) {
      $key = ("path:{0}" -f (Get-NormalizedPathKey -Path $row.Node))
    }

    if (-not $seenRuntimes.ContainsKey($key)) {
      $seenRuntimes[$key] = $row.Node
      $uniqueRows += $row
    } else {
      Write-Log ("Skipping duplicate Node.js runtime alias: {0} ({1}); keeping {2}" -f $row.Node, $row.Version, $seenRuntimes[$key])
    }
  }

  return @($uniqueRows)
}

function Show-Menu {
  param(
    [string] $Title,
    [array] $Items,
    [int] $DefaultIndex = 0
  )

  if ($Items.Count -eq 0) {
    return $null
  }

  if ($DefaultIndex -lt 0 -or $DefaultIndex -ge $Items.Count) {
    $DefaultIndex = 0
  }

  if (-not [Console]::IsInputRedirected -and -not [Console]::IsOutputRedirected) {
    try {
      return Invoke-InteractiveMenu -Title $Title -Items $Items -DefaultIndex $DefaultIndex
    } catch {
      Write-Log ("Interactive menu failed: {0}" -f $_.Exception.Message)
      Write-Status WARN 'Interactive menu is unavailable.' 'Falling back to numbered input.'
    }
  }

  return Invoke-NumberedMenu -Title $Title -Items $Items -DefaultIndex $DefaultIndex
}

function Invoke-InteractiveMenu {
  param(
    [string] $Title,
    [array] $Items,
    [int] $DefaultIndex
  )

  $selected = $DefaultIndex
  $top = [Console]::CursorTop
  $height = $Items.Count + 4
  [Console]::CursorVisible = $false

  try {
    while ($true) {
      $width = [Math]::Max(40, [Console]::WindowWidth - 1)
      for ($row = 0; $row -lt $height; $row++) {
        [Console]::SetCursorPosition(0, $top + $row)
        [Console]::Write((' ' * $width))
      }

      [Console]::SetCursorPosition(0, $top)
      Write-Ui ''
      Write-Ui ("  {0}" -f $Title) Cyan
      Write-Ui '  Up/Down: move  Enter: select  Esc: cancel' DarkGray

      for ($i = 0; $i -lt $Items.Count; $i++) {
        $label = [string] $Items[$i].Label
        $maxLabel = [Math]::Max(16, $width - 6)
        if ($label.Length -gt $maxLabel) {
          $label = $label.Substring(0, $maxLabel - 3) + '...'
        }

        $line = ("  {0} {1}" -f $(if ($i -eq $selected) { '>' } else { ' ' }), $label).PadRight($width)
        if ($i -eq $selected) {
          Write-Host $line -ForegroundColor Black -BackgroundColor Cyan
        } else {
          Write-Host $line -ForegroundColor Gray
        }
      }

      $key = [Console]::ReadKey($true)
      switch ($key.Key) {
        'UpArrow' {
          $selected--
          if ($selected -lt 0) {
            $selected = $Items.Count - 1
          }
        }
        'DownArrow' {
          $selected++
          if ($selected -ge $Items.Count) {
            $selected = 0
          }
        }
        'Enter' {
          Write-Ui ''
          return $Items[$selected].Value
        }
        'Escape' {
          Write-Ui ''
          return $null
        }
      }
    }
  } finally {
    try {
      [Console]::CursorVisible = $true
    } catch {
    }
  }
}

function Invoke-NumberedMenu {
  param(
    [string] $Title,
    [array] $Items,
    [int] $DefaultIndex
  )

  Write-Ui ''
  Write-Ui ("  {0}" -f $Title) Cyan
  for ($i = 0; $i -lt $Items.Count; $i++) {
    $suffix = ''
    if ($i -eq $DefaultIndex) {
      $suffix = ' (recommended)'
    }
    Write-Ui ("  [{0}] {1}{2}" -f ($i + 1), $Items[$i].Label, $suffix) Gray
  }

  if ([Console]::IsInputRedirected) {
    Write-Status WARN 'Input is redirected.' ("Using default: {0}" -f $Items[$DefaultIndex].Label)
    return $Items[$DefaultIndex].Value
  }

  while ($true) {
    $answer = Read-Host ("Select number [{0}]" -f ($DefaultIndex + 1))
    if ([string]::IsNullOrWhiteSpace($answer)) {
      return $Items[$DefaultIndex].Value
    }

    $number = 0
    if ([int]::TryParse($answer, [ref] $number) -and $number -ge 1 -and $number -le $Items.Count) {
      return $Items[$number - 1].Value
    }

    Write-Status ERROR 'Invalid selection.' 'Enter one of the listed numbers.'
  }
}

function Ensure-Node {
  Write-Section 'Node.js'
  Write-Status STEP 'Scanning installed Node.js runtimes.'
  Write-Log 'Scanning installed Node.js runtimes'

  $candidates = Get-NodeCandidates
  Show-NodeCandidates -Candidates $candidates

  $supported = @($candidates | Where-Object { $_.Status -eq 'supported' })
  if ($supported.Count -eq 0) {
    if ($candidates.Count -eq 0) {
      Write-Status WARN 'Node.js was not found.' ("Required: {0}" -f $script:NodeRequirement)
      Write-Log 'Node.js was not found'
    } else {
      Write-Status WARN 'No supported Node.js runtime was found.' ("Required: {0}" -f $script:NodeRequirement)
      Write-Log 'No supported Node.js runtime was found'
    }

    Install-WingetPackage -Id 'OpenJS.NodeJS.LTS' -Name 'Node.js LTS'
    $candidates = Get-NodeCandidates
    Show-NodeCandidates -Candidates $candidates
    $supported = @($candidates | Where-Object { $_.Status -eq 'supported' })
  }

  if ($supported.Count -eq 0) {
    Stop-Launcher 'Node.js installation finished, but a supported node.exe with npm.cmd was not found. Open a new command prompt and run this launcher again.'
  }

  if ($supported.Count -eq 1) {
    $selected = $supported[0]
  } else {
    $items = @()
    foreach ($node in $supported) {
      $items += [pscustomobject] @{
        Label = ("{0}  {1}" -f $node.Version, $node.Node)
        Value = $node
      }
    }
    $selected = Show-Menu -Title 'Select Node.js runtime' -Items $items -DefaultIndex 0
    if ($null -eq $selected) {
      Stop-Launcher 'Node.js selection was cancelled.'
    }
  }

  $script:NodeExe = $selected.Node
  $script:NpmCmd = $selected.Npm
  $script:NodeVersion = $selected.Version
  Write-Status OK ("Node.js selected: {0}" -f $script:NodeVersion) $script:NodeExe
  Write-Log ("Selected Node.js: {0} ({1})" -f $script:NodeVersion, $script:NodeExe)
}

function Show-NodeCandidates {
  param([array] $Candidates)

  if ($Candidates.Count -eq 0) {
    Write-Status WARN 'No Node.js candidates were detected.'
    return
  }

  foreach ($candidate in $Candidates) {
    if ($candidate.Status -eq 'supported') {
      Write-Status OK ("{0}  {1}" -f $candidate.Version, $candidate.Node)
    } elseif ($candidate.Status -eq 'missing-npm') {
      Write-Status WARN ("{0}  {1}" -f $candidate.Version, $candidate.Node) 'npm.cmd was not found next to node.exe.'
    } else {
      Write-Status WARN ("{0}  {1}" -f $candidate.Version, $candidate.Node) ("Requires Node.js {0}." -f $script:NodeRequirement)
    }
  }
}

function Ensure-Git {
  Write-Section 'Git'
  Write-Status STEP 'Checking Git for Windows.'
  Write-Log 'Checking Git'

  $git = Find-Git
  if ($null -eq $git) {
    Write-Status WARN 'Git was not found.'
    Write-Log 'Git was not found'
    Install-WingetPackage -Id 'Git.Git' -Name 'Git'
    $git = Find-Git
  }

  if ($null -eq $git) {
    Stop-Launcher 'Git installation finished, but git.exe was not found. Open a new command prompt and run this launcher again.'
  }

  $script:GitExe = $git.Path
  $script:GitVersion = $git.Version
  $gitBin = Split-Path -Parent $script:GitExe
  $env:PATH = "$gitBin;$env:PATH"
  Write-Status OK ("Git ready: {0}" -f $script:GitVersion) $script:GitExe
  Write-Log ("Git ready: {0} ({1})" -f $script:GitVersion, $script:GitExe)
}

function Find-Git {
  $seen = @{}
  $common = @()
  if ($env:ProgramFiles) {
    $common += Join-Path $env:ProgramFiles 'Git\cmd\git.exe'
  }
  if (${env:ProgramFiles(x86)}) {
    $common += Join-Path ${env:ProgramFiles(x86)} 'Git\cmd\git.exe'
  }
  if ($env:LOCALAPPDATA) {
    $common += Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe'
  }

  foreach ($path in $common) {
    Add-UniquePath -Seen $seen -Path $path
  }

  try {
    Get-Command git.exe -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object {
      Add-UniquePath -Seen $seen -Path $_.Source
    }
  } catch {
  }

  foreach ($path in $seen.Values) {
    $version = 'version check failed'
    try {
      $raw = & $path --version 2>$null | Select-Object -First 1
      if ($raw) {
        $version = ([string] $raw).Trim()
      }
    } catch {
    }

    return [pscustomobject] @{
      Path = $path
      Version = $version
    }
  }

  return $null
}

function Find-CommandPath {
  param([string] $Name)

  try {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) {
      return $cmd.Source
    }
  } catch {
  }

  return $null
}

function Install-WingetPackage {
  param(
    [string] $Id,
    [string] $Name
  )

  $winget = Find-CommandPath -Name 'winget.exe'
  if ($winget) {
    Write-Status STEP ("Installing {0} with winget." -f $Name) 'Windows may show an installer or UAC prompt.'
    Write-Log ("Installing {0} with winget id {1}" -f $Name, $Id)

    $code = Invoke-LoggedProcess -FilePath $winget -Arguments @(
      'install',
      '--id', $Id,
      '-e',
      '--source', 'winget',
      '--accept-source-agreements',
      '--accept-package-agreements'
    )

    if ($code -eq 0) {
      Refresh-Path
      return
    }

    Write-Status WARN ("winget failed to install {0}." -f $Name) 'Trying the official installer fallback.'
    Write-Log ("winget install failed for {0} with exit code {1}" -f $Name, $code)
  } else {
    Write-Status WARN 'winget was not found.' ("Using the official {0} installer fallback." -f $Name)
    Write-Log ("winget was not found for {0}" -f $Name)
  }

  Install-DirectPackage -Id $Id -Name $Name
  Refresh-Path
}

function Install-DirectPackage {
  param(
    [string] $Id,
    [string] $Name
  )

  if ($Id -eq 'OpenJS.NodeJS.LTS') {
    Install-NodeDirect
    return
  }

  if ($Id -eq 'Git.Git') {
    Install-GitDirect
    return
  }

  Stop-Launcher ("No direct installer fallback is available for {0}." -f $Name)
}

function Install-NodeDirect {
  $nodeMsi = Join-Path ([IO.Path]::GetTempPath()) ("llamacpp-node-lts-{0}.msi" -f $PID)

  try {
    if (Test-Path -LiteralPath $nodeMsi) {
      Remove-Item -LiteralPath $nodeMsi -Force -ErrorAction SilentlyContinue
    }

    Write-Status STEP 'Downloading Node.js LTS MSI from nodejs.org.'
    Write-Log 'Downloading Node.js LTS MSI from nodejs.org'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $data = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 20
    $versionInfo = $data | Where-Object { $_.lts -ne $false -and $_.files -contains 'win-x64-msi' } | Select-Object -First 1
    if (-not $versionInfo) {
      Stop-Launcher 'No Node.js LTS MSI was found on nodejs.org.'
    }

    $installVersion = ([string] $versionInfo.version).TrimStart('v')
    $url = "https://nodejs.org/dist/$($versionInfo.version)/node-v$installVersion-x64.msi"
    Invoke-WebRequest -Uri $url -OutFile $nodeMsi -UseBasicParsing

    if (-not (Test-Path -LiteralPath $nodeMsi -PathType Leaf)) {
      Stop-Launcher ("Node.js MSI was not downloaded: {0}" -f $nodeMsi)
    }

    Write-Status STEP ("Installing Node.js {0}." -f $installVersion) 'Windows may show an installer or UAC prompt.'
    Write-Log ("Installing Node.js MSI: {0}" -f $nodeMsi)
    $code = Invoke-LoggedProcess -FilePath 'msiexec.exe' -Arguments @('/i', $nodeMsi, '/passive', '/norestart')
    if ($code -ne 0 -and $code -ne 3010) {
      Stop-Launcher ("Node.js MSI installation failed with exit code {0}." -f $code)
    }
  } catch {
    Write-Log ("Node.js direct installer failed: {0}" -f $_.Exception.Message)
    throw
  } finally {
    Remove-Item -LiteralPath $nodeMsi -Force -ErrorAction SilentlyContinue
  }
}

function Install-GitDirect {
  $gitInstaller = Join-Path ([IO.Path]::GetTempPath()) ("llamacpp-git-{0}.exe" -f $PID)

  try {
    if (Test-Path -LiteralPath $gitInstaller) {
      Remove-Item -LiteralPath $gitInstaller -Force -ErrorAction SilentlyContinue
    }

    Write-Status STEP 'Downloading Git for Windows from GitHub releases.'
    Write-Log 'Downloading Git for Windows installer from GitHub releases'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/git-for-windows/git/releases/latest' -TimeoutSec 20 -Headers @{ 'User-Agent' = $script:AppName }
    $asset = $release.assets | Where-Object { $_.name -match '^Git-\d+(\.\d+)+-64-bit\.exe$' } | Select-Object -First 1
    if (-not $asset) {
      Stop-Launcher 'Git for Windows 64-bit installer asset was not found.'
    }

    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $gitInstaller -UseBasicParsing
    if (-not (Test-Path -LiteralPath $gitInstaller -PathType Leaf)) {
      Stop-Launcher ("Git installer was not downloaded: {0}" -f $gitInstaller)
    }

    Write-Status STEP ("Installing {0}." -f $asset.name) 'Windows may show an installer or UAC prompt.'
    Write-Log ("Installing Git for Windows: {0}" -f $gitInstaller)
    $code = Invoke-LoggedProcess -FilePath $gitInstaller -Arguments @(
      '/VERYSILENT',
      '/NORESTART',
      '/NOCANCEL',
      '/SP-',
      '/CLOSEAPPLICATIONS',
      '/RESTARTAPPLICATIONS',
      '/o:PathOption=Cmd'
    )

    if ($code -ne 0) {
      Stop-Launcher ("Git installer failed with exit code {0}." -f $code)
    }
  } catch {
    Write-Log ("Git direct installer failed: {0}" -f $_.Exception.Message)
    throw
  } finally {
    Remove-Item -LiteralPath $gitInstaller -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-LoggedProcess {
  param(
    [string] $FilePath,
    [string[]] $Arguments
  )

  Write-Log ("Running: {0} {1}" -f $FilePath, ($Arguments -join ' '))
  & $FilePath @Arguments *>> $script:LogFile
  if ($null -eq $global:LASTEXITCODE) {
    return 0
  }

  return [int] $global:LASTEXITCODE
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:PATH = "$machine;$user;$env:PATH"
  Write-Log 'PATH refreshed from machine and user environment'
}

function Apply-NodePath {
  Write-Section 'Environment'
  if ([string]::IsNullOrWhiteSpace($script:NodeExe)) {
    Stop-Launcher 'Node.js path was not resolved.'
  }

  $nodeBin = Split-Path -Parent $script:NodeExe
  $npmBin = Join-Path $script:NpmPrefix 'node_modules\.bin'
  $env:PATH = "$nodeBin;$script:NpmPrefix;$npmBin;$env:PATH"
  $env:npm_config_prefix = $script:NpmPrefix
  $env:npm_config_cache = $script:NpmCache
  Write-Status OK 'PATH updated for Node.js and npm.' $nodeBin
  Write-Log 'PATH updated with Node.js and npm prefix'
}

function Prepare-NpmDirs {
  foreach ($dir in @($script:NpmPrefix, $script:NpmCache)) {
    try {
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
    } catch {
      Stop-Launcher ("Failed to create directory: {0}" -f $dir)
    }

    if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
      Stop-Launcher ("Directory was not created: {0}" -f $dir)
    }
  }

  Write-Status OK 'npm directories are ready.' $script:NpmPrefix
  Write-Log 'npm directories are ready'
}

function Select-Package {
  Write-Section 'Package'
  $regex = '^' + [regex]::Escape($script:AppName) + '-(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?<suffix>[-+][0-9A-Za-z.-]+)?\.tgz$'
  $packages = Get-ChildItem -LiteralPath $script:ScriptDir -Filter ($script:AppName + '-*.tgz') -File -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.Name -match $regex) {
      $suffix = ''
      if ($Matches['suffix']) {
        $suffix = $Matches['suffix']
      }

      [pscustomobject] @{
        Path = $_.FullName
        Name = $_.Name
        Version = ('{0}.{1}.{2}{3}' -f $Matches['major'], $Matches['minor'], $Matches['patch'], $suffix)
        Major = [int] $Matches['major']
        Minor = [int] $Matches['minor']
        Patch = [int] $Matches['patch']
        Time = $_.LastWriteTimeUtc
      }
    }
  }

  $package = $packages | Sort-Object `
    @{ Expression = 'Major'; Descending = $true }, `
    @{ Expression = 'Minor'; Descending = $true }, `
    @{ Expression = 'Patch'; Descending = $true }, `
    @{ Expression = 'Time'; Descending = $true } |
    Select-Object -First 1

  if ($package) {
    Write-Status OK ("Package found: {0}" -f $package.Name) ("Version {0}" -f $package.Version)
    Write-Log ("Selected package: {0} (version {1})" -f $package.Path, $package.Version)
    return $package
  }

  Write-Status WARN ("No {0}-*.tgz package was found next to the launcher." -f $script:AppName)
  Write-Log 'No package archive found next to launcher'
  return $null
}

function Resolve-InstalledVersion {
  $version = $null
  $source = $null

  if (Test-Path -LiteralPath $script:AppPackageJson -PathType Leaf) {
    try {
      $pkg = Get-Content -Raw -LiteralPath $script:AppPackageJson | ConvertFrom-Json
      if ($pkg.version) {
        $version = [string] $pkg.version
        $source = 'package.json'
      }
    } catch {
      Write-Log ("Failed to read installed package.json: {0}" -f $_.Exception.Message)
    }
  }

  if (-not $version -and (Test-Path -LiteralPath $script:AppVersionMarker -PathType Leaf)) {
    try {
      $version = (Get-Content -LiteralPath $script:AppVersionMarker -ErrorAction Stop | Select-Object -First 1).Trim()
      if ($version) {
        $source = 'version marker'
      }
    } catch {
      Write-Log ("Failed to read version marker: {0}" -f $_.Exception.Message)
    }
  }

  if ($version) {
    Write-Status OK ("Installed version: {0}" -f $version) $source
    Write-Log ("Installed package version: {0} ({1})" -f $version, $source)
  } else {
    Write-Status WARN 'Installed version could not be detected.'
    Write-Log 'Installed package version could not be detected'
  }

  return [pscustomobject] @{
    Version = $version
    Source = $source
  }
}

function Get-VersionParts {
  param([string] $Version)

  $base = ([string] $Version -split '[+-]', 2)[0]
  $raw = @($base -split '\.')
  $parts = @(0, 0, 0)
  for ($i = 0; $i -lt 3; $i++) {
    if ($i -lt $raw.Count) {
      $parsed = 0
      if ([int]::TryParse($raw[$i], [ref] $parsed)) {
        $parts[$i] = $parsed
      }
    }
  }

  return $parts
}

function Test-IsNewerVersion {
  param(
    [string] $Candidate,
    [string] $Installed
  )

  $a = Get-VersionParts -Version $Candidate
  $b = Get-VersionParts -Version $Installed
  for ($i = 0; $i -lt 3; $i++) {
    if ($a[$i] -gt $b[$i]) {
      return $true
    }
    if ($a[$i] -lt $b[$i]) {
      return $false
    }
  }

  return $false
}

function Get-InstallDecision {
  param(
    $Package,
    $Installed
  )

  if (-not (Test-Path -LiteralPath $script:AppEntry -PathType Leaf)) {
    return [pscustomobject] @{
      NeedInstall = $true
      Reason = 'launcher is not installed'
    }
  }

  if ($null -eq $Package) {
    return [pscustomobject] @{
      NeedInstall = $false
      Reason = 'installed launcher will be used; no local package was found'
    }
  }

  if (-not $Installed.Version) {
    return [pscustomobject] @{
      NeedInstall = $true
      Reason = 'installed version could not be detected'
    }
  }

  if ($Package.Version -ieq $Installed.Version) {
    return [pscustomobject] @{
      NeedInstall = $false
      Reason = 'installed version matches the local package'
    }
  }

  if (Test-IsNewerVersion -Candidate $Package.Version -Installed $Installed.Version) {
    return [pscustomobject] @{
      NeedInstall = $true
      Reason = ("package {0} is newer than installed {1}" -f $Package.Version, $Installed.Version)
    }
  }

  return [pscustomobject] @{
    NeedInstall = $false
    Reason = ("package {0} is not newer than installed {1}" -f $Package.Version, $Installed.Version)
  }
}

function Preserve-LauncherState {
  if (-not (Test-Path -LiteralPath $script:AppDir -PathType Container)) {
    return
  }

  foreach ($name in @('config.json', 'params-history.json', 'template-overrides.json')) {
    $source = Join-Path $script:AppDir $name
    $target = Join-Path $script:InstallRoot $name
    if ((Test-Path -LiteralPath $source -PathType Leaf) -and -not (Test-Path -LiteralPath $target)) {
      try {
        Copy-Item -LiteralPath $source -Destination $target -Force
        Write-Log ("Preserved {0} to {1}" -f $name, $script:InstallRoot)
      } catch {
        Write-Log ("Failed to preserve {0}: {1}" -f $name, $_.Exception.Message)
      }
    }
  }
}

function Install-Launcher {
  param($Package)

  if ($null -eq $Package) {
    Stop-Launcher ("{0} is not installed and no {0}-*.tgz package was found next to the launcher: {1}" -f $script:AppName, $script:ScriptDir)
  }

  Write-Status STEP ("Installing {0} {1}." -f $script:AppName, $Package.Version)
  Write-KeyValue 'Package' $Package.Path
  Write-KeyValue 'npm prefix' $script:NpmPrefix
  Write-Log 'Installing package with npm'

  Preserve-LauncherState

  $code = Invoke-LoggedProcess -FilePath $script:NpmCmd -Arguments @(
    'install',
    '--prefix', $script:NpmPrefix,
    '--cache', $script:NpmCache,
    '-g', $Package.Path,
    '--no-audit',
    '--no-fund',
    '--fetch-retries', '2',
    '--fetch-retry-maxtimeout', '20000',
    '--fetch-timeout', '120000'
  )

  if ($code -ne 0) {
    Stop-Launcher ("npm failed to install {0}. Check the log for details." -f $script:AppName)
  }

  if (-not (Test-Path -LiteralPath $script:AppEntry -PathType Leaf)) {
    Stop-Launcher ("Installed launcher entry was not found: {0}" -f $script:AppEntry)
  }

  Set-Content -LiteralPath $script:AppVersionMarker -Encoding ASCII -Value $Package.Version
  Write-Status OK ("{0} installed." -f $script:AppName) ("Version {0}" -f $Package.Version)
  Write-Log ("{0} installed successfully" -f $script:AppName)
}

function Start-LauncherApp {
  if (-not (Test-Path -LiteralPath $script:AppEntry -PathType Leaf)) {
    Stop-Launcher ("Installed launcher entry was not found: {0}" -f $script:AppEntry)
  }

  Write-Section 'Launch'
  Write-Status STEP ("Preparing interactive launch for {0}." -f $script:AppName)
  Write-KeyValue 'Node.js' $script:NodeExe
  Write-KeyValue 'Entry' $script:AppEntry
  Write-KeyValue 'Working dir' $script:AppDir
  Write-Status STEP 'Handing off to cmd.exe for the interactive TUI.' 'This avoids Windows PowerShell swallowing Ink input or screen updates.'
  Write-Log ("Preparing delegated launch: {0} {1}" -f $script:NodeExe, $script:AppEntry)

  Write-LaunchHandoff
  $script:LaunchDelegated = $true
  return $script:DelegatedLaunchExitCode
}

function Write-LaunchHandoff {
  if ([string]::IsNullOrWhiteSpace($script:RunFile)) {
    Stop-Launcher 'Launcher handoff path was not provided.'
  }

  $nodeBin = Split-Path -Parent $script:NodeExe
  $npmBin = Join-Path $script:NpmPrefix 'node_modules\.bin'
  $gitBin = ''
  if ($script:GitExe) {
    $gitBin = Split-Path -Parent $script:GitExe
  }

  $pathPrefix = @($nodeBin, $script:NpmPrefix, $npmBin, $gitBin) |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    ForEach-Object { ConvertTo-BatchLiteral $_ }

  $lines = @(
    '@echo off',
    'setlocal EnableExtensions DisableDelayedExpansion',
    'title llamacpp-launcher',
    ('set "PATH={0};%PATH%"' -f ($pathPrefix -join ';')),
    ('set "LLAMACPP_LAUNCHER_HOME={0}"' -f (ConvertTo-BatchLiteral $script:InstallRoot)),
    ('set "npm_config_prefix={0}"' -f (ConvertTo-BatchLiteral $script:NpmPrefix)),
    ('set "npm_config_cache={0}"' -f (ConvertTo-BatchLiteral $script:NpmCache)),
    ('cd /d "{0}"' -f (ConvertTo-BatchLiteral $script:AppDir)),
    'cls',
    ('>> "{0}" echo [%DATE% %TIME%] Starting {1} from delegated cmd handoff' -f (ConvertTo-BatchLiteral $script:LogFile), $script:AppName),
    ('"{0}" "{1}"' -f (ConvertTo-BatchLiteral $script:NodeExe), (ConvertTo-BatchLiteral $script:AppEntry)),
    'set "APP_EXIT=%ERRORLEVEL%"',
    ('>> "{0}" echo [%DATE% %TIME%] {1} exited with code %APP_EXIT%' -f (ConvertTo-BatchLiteral $script:LogFile), $script:AppName),
    'echo.',
    'echo -- Stopped ------------------------------------------------',
    ('if "%APP_EXIT%"=="0" (echo   [OK]    {0} exited with code 0.) else (echo   [WARN]  {0} exited with code %APP_EXIT%.)' -f $script:AppName),
    ('echo   Log file: {0}' -f (ConvertTo-BatchLiteral $script:LogFile)),
    'echo.',
    'pause',
    'exit /b %APP_EXIT%'
  )

  try {
    Set-Content -LiteralPath $script:RunFile -Encoding ASCII -Value $lines
    Write-Log ("Delegated launch file written: {0}" -f $script:RunFile)
  } catch {
    Stop-Launcher ("Failed to write launcher handoff file: {0}" -f $_.Exception.Message)
  }
}

function Invoke-SelfTest {
  Write-Header
  Write-Section 'Self-test'
  if (-not (Test-Path -LiteralPath $script:BatchPath -PathType Leaf)) {
    Stop-Launcher ("Batch path does not exist: {0}" -f $script:BatchPath)
  }

  if (-not (Test-IsNewerVersion -Candidate '1.0.2' -Installed '1.0.1')) {
    Stop-Launcher 'Version comparison self-test failed.'
  }

  if (Test-IsNewerVersion -Candidate '1.0.1' -Installed '1.0.2') {
    Stop-Launcher 'Reverse version comparison self-test failed.'
  }

  $package = Select-Package
  if ($package) {
    Write-Status OK 'Package discovery self-test passed.' $package.Name
  } else {
    Write-Status WARN 'Package discovery self-test passed with no package found.'
  }

  $originalRunFile = $script:RunFile
  $originalNodeExe = $script:NodeExe
  $originalNpmCmd = $script:NpmCmd
  $originalGitExe = $script:GitExe
  $originalAppDir = $script:AppDir
  $originalAppEntry = $script:AppEntry
  $testRunFile = Join-Path ([IO.Path]::GetTempPath()) ("llamacpp-launcher-self-test-{0}.cmd" -f $PID)
  try {
    $script:RunFile = $testRunFile
    $script:NodeExe = $env:ComSpec
    $script:NpmCmd = $env:ComSpec
    $script:GitExe = $env:ComSpec
    $script:AppDir = $script:ScriptDir
    $script:AppEntry = $script:BatchPath
    Write-LaunchHandoff
    if (-not (Test-Path -LiteralPath $testRunFile -PathType Leaf)) {
      Stop-Launcher 'Launch handoff self-test failed.'
    }
    Write-Status OK 'Launch handoff self-test passed.'
  } finally {
    $script:RunFile = $originalRunFile
    $script:NodeExe = $originalNodeExe
    $script:NpmCmd = $originalNpmCmd
    $script:GitExe = $originalGitExe
    $script:AppDir = $originalAppDir
    $script:AppEntry = $originalAppEntry
    Remove-Item -LiteralPath $testRunFile -Force -ErrorAction SilentlyContinue
  }

  Write-Status OK 'PowerShell payload parsed successfully.'
  Write-Status OK 'Launcher self-test completed.'
  return 0
}

function Invoke-Main {
  Initialize-Paths
  Start-Log
  Write-Log ("Install root: {0}" -f $script:InstallRoot)

  if ($env:LAUNCHER_SELF_TEST -eq '1') {
    return Invoke-SelfTest
  }

  Write-Header
  Write-Status INFO 'This launcher checks prerequisites, installs or updates the packaged app, and starts it.'

  Ensure-Node
  Ensure-Git
  Apply-NodePath
  Prepare-NpmDirs

  $package = Select-Package
  $installed = Resolve-InstalledVersion
  $decision = Get-InstallDecision -Package $package -Installed $installed

  Write-Section 'Install decision'
  if ($decision.NeedInstall) {
    Write-Status STEP 'Installation or update is required.' $decision.Reason
    Install-Launcher -Package $package
    $installed = Resolve-InstalledVersion
  } else {
    Write-Status OK 'Installed launcher is ready.' $decision.Reason
  }

  return Start-LauncherApp
}

$exitCode = 1
try {
  $exitCode = Invoke-Main
} catch {
  $message = $_.Exception.Message
  Write-Log ("Failed: {0}" -f $message)
  Write-Section 'Failure'
  Write-Status ERROR 'Launcher failed.' $message
  Write-KeyValue 'Log file' $script:LogFile
  $exitCode = $script:FailureCode
  if ($exitCode -eq 0) {
    $exitCode = 1
  }
} finally {
  Pause-IfInteractive
}

exit $exitCode
