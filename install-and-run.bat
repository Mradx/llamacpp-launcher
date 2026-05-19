@echo off
setlocal EnableExtensions EnableDelayedExpansion

title llamacpp-launcher

if /i not "%~1"=="--inside-cmd" (
  cmd /k ""%~f0" --inside-cmd"
  exit /b
)

set "APP_NAME=llamacpp-launcher"
set "NODE_REQUIREMENT=20.19+, 22.13+, or 24+"
set "SCRIPT_DIR=%~dp0"
set "PROGRAM_FILES=%ProgramFiles%"
set "PROGRAM_FILES_X86=%ProgramFiles(x86)%"
set "INSTALL_ROOT=%LOCALAPPDATA%\llamacpp-launcher"
set "LOG_FILE=%SCRIPT_DIR%llamacpp-launcher.log"

if "%LOCALAPPDATA%"=="" set "INSTALL_ROOT=%SCRIPT_DIR%.llamacpp-launcher-data"
if not exist "%INSTALL_ROOT%" mkdir "%INSTALL_ROOT%" >nul 2>nul
if not exist "%INSTALL_ROOT%" (
  set "INSTALL_ROOT=%SCRIPT_DIR%.llamacpp-launcher-data"
  if not exist "%INSTALL_ROOT%" mkdir "%INSTALL_ROOT%" >nul 2>nul
)

set "NPM_PREFIX=%INSTALL_ROOT%\npm-prefix"
set "NPM_CACHE=%INSTALL_ROOT%\npm-cache"
set "LLAMACPP_LAUNCHER_HOME=%INSTALL_ROOT%"
set "APP_DIR=%NPM_PREFIX%\node_modules\%APP_NAME%"
set "APP_ENTRY=%APP_DIR%\dist\index.js"
set "APP_PACKAGE_JSON=%APP_DIR%\package.json"
set "APP_VERSION_MARKER=%INSTALL_ROOT%\installed-version.txt"
set "FAIL_CODE="

> "%LOG_FILE%" echo [%DATE% %TIME%] %APP_NAME% started
call :log "Script path: %~f0"
call :log "Script directory: %SCRIPT_DIR%"
call :log "Install root: %INSTALL_ROOT%"

cls
echo.
echo ============================================================
echo  LLAMACPP-LAUNCHER
echo ============================================================
echo.
echo This script checks system Node.js and Git, installs missing
echo prerequisites with winget, updates %APP_NAME% from the newest
echo local .tgz package when its version is newer, and starts it.
echo.

call :ensure_node
if errorlevel 1 goto fail

call :ensure_git
if errorlevel 1 goto fail

call :apply_node_path
if errorlevel 1 goto fail

call :prepare_npm_dirs
if errorlevel 1 goto fail

call :select_package
if errorlevel 1 goto fail

call :resolve_installed_version
call :decide_install
if errorlevel 1 goto fail

if defined NEED_INSTALL (
  if not defined PACKAGE_FILE (
    echo.
    echo %APP_NAME% is not installed and no %APP_NAME%-*.tgz package was found.
    echo Put a package archive next to this .bat file:
    echo %SCRIPT_DIR%
    call :log "Install required, but no package was found"
    set "FAIL_CODE=1"
    goto fail
  )

  echo.
  echo Installing %APP_NAME% %PACKAGE_VERSION%...
  if defined INSTALL_REASON echo Reason: %INSTALL_REASON%
  call :preserve_launcher_state
  call :install_launcher
  if errorlevel 1 goto fail
  call :resolve_installed_version
) else (
  echo.
  echo Installed %APP_NAME% is up to date.
  if defined INSTALLED_VERSION echo Version: %INSTALLED_VERSION%
)

if not exist "%APP_ENTRY%" (
  echo.
  echo Installed launcher entry was not found:
  echo %APP_ENTRY%
  call :log "Launcher entry not found: %APP_ENTRY%"
  set "FAIL_CODE=1"
  goto fail
)

echo.
echo Starting %APP_NAME%...
echo.
call :log "Starting %APP_NAME%: %NODE_EXE% %APP_ENTRY%"
pushd "%APP_DIR%" >nul
"%NODE_EXE%" "%APP_ENTRY%"
set "APP_EXIT=%ERRORLEVEL%"
popd >nul

call :log "%APP_NAME% exited with code %APP_EXIT%"
echo.
echo %APP_NAME% exited with code %APP_EXIT%.
echo Log file:
echo %LOG_FILE%
echo.
pause
exit /b %APP_EXIT%

:log
>> "%LOG_FILE%" echo [%DATE% %TIME%] %~1
exit /b 0

:ensure_node
call :select_node
if defined NODE_SUPPORTED (
  echo Node.js selected: %NODE_VERSION% ^(%NODE_EXE%^)
  call :log "Node.js selected: %NODE_VERSION% (%NODE_EXE%)"
  exit /b 0
)

echo.
if "%NODE_CANDIDATE_COUNT%"=="0" (
  echo Node.js was not found.
  call :log "Node.js was not found"
) else (
  echo No supported Node.js installation was selected.
  echo %APP_NAME% requires Node.js %NODE_REQUIREMENT% with npm.cmd.
  call :log "No supported Node.js installation was selected"
)

call :install_winget_package "OpenJS.NodeJS.LTS" "Node.js LTS"
if errorlevel 1 exit /b 1

call :select_node
if defined NODE_SUPPORTED (
  echo Node.js ready: %NODE_VERSION% ^(%NODE_EXE%^)
  call :log "Node.js ready: %NODE_VERSION% (%NODE_EXE%)"
  exit /b 0
)

echo Node.js installation finished, but node.exe/npm.cmd were not found in PATH.
echo Close this window, open a new command prompt, and run this script again.
call :log "Node.js was not found after installation"
exit /b 1

:select_node
set "NODE_EXE="
set "NPM_CMD="
set "NODE_VERSION="
set "NODE_SUPPORTED="
set "NODE_CANDIDATE_COUNT=0"
set "SUPPORTED_NODE_COUNT=0"
set "NODE_LIST_FILE=%TEMP%\llamacpp-node-candidates-%RANDOM%.txt"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; $seen=@{}; function AddNode([string]$p){ if([string]::IsNullOrWhiteSpace($p)){ return }; if(Test-Path -LiteralPath $p){ $full=(Resolve-Path -LiteralPath $p).Path; $key=$full.ToLowerInvariant(); if(-not $seen.ContainsKey($key)){ $seen[$key]=$full } } }; function IsSupportedNode([int]$major,[int]$minor){ return (($major -eq 20 -and $minor -ge 19) -or ($major -eq 22 -and $minor -ge 13) -or ($major -ge 24)) }; Get-Command node.exe -All | ForEach-Object { AddNode $_.Source }; $pf=[Environment]::GetFolderPath('ProgramFiles'); $pf86=[Environment]::GetFolderPath('ProgramFilesX86'); $local=$env:LOCALAPPDATA; $app=$env:APPDATA; $candidateFiles=@(); if($pf){ $candidateFiles += Join-Path $pf 'nodejs\node.exe'; $candidateFiles += Join-Path $pf 'Nodist\bin\node.exe' }; if($pf86){ $candidateFiles += Join-Path $pf86 'nodejs\node.exe'; $candidateFiles += Join-Path $pf86 'Nodist\bin\node.exe' }; if($local){ $candidateFiles += Join-Path $local 'Programs\nodejs\node.exe'; $candidateFiles += Join-Path $local 'Volta\bin\node.exe' }; if($env:NVM_SYMLINK){ $candidateFiles += Join-Path $env:NVM_SYMLINK 'node.exe' }; foreach($p in $candidateFiles){ AddNode $p }; $versionRoots=@($env:NVM_HOME); if($app){ $versionRoots += Join-Path $app 'nvm' }; if($local){ $versionRoots += Join-Path $local 'nvm' }; foreach($root in $versionRoots){ if($root -and (Test-Path -LiteralPath $root)){ Get-ChildItem -LiteralPath $root -Directory -Filter 'v*' | ForEach-Object { AddNode (Join-Path $_.FullName 'node.exe') } } }; $fnmRoots=@(); if($local){ $fnmRoots += Join-Path $local 'fnm\node-versions' }; if($app){ $fnmRoots += Join-Path $app 'fnm\node-versions' }; foreach($root in $fnmRoots){ if($root -and (Test-Path -LiteralPath $root)){ Get-ChildItem -LiteralPath $root -Recurse -File -Filter node.exe | Where-Object { $_.FullName -match '\\installation\\node\.exe$' } | ForEach-Object { AddNode $_.FullName } } }; $rows=@(); foreach($node in $seen.Values){ $dir=Split-Path -Parent $node; $npm=Join-Path $dir 'npm.cmd'; $version='unknown'; try{ $raw=(& $node --version 2>$null); if($raw){ $version=$raw.Trim() } }catch{}; $major=0; $minor=0; $patch=0; if($version -match '^v?(\d+)\.(\d+)\.(\d+)'){ $major=[int]$Matches[1]; $minor=[int]$Matches[2]; $patch=[int]$Matches[3] } elseif($version -match '^v?(\d+)'){ $major=[int]$Matches[1] }; $status='unsupported'; if(-not (Test-Path -LiteralPath $npm)){ $status='missing-npm' } elseif(IsSupportedNode $major $minor){ $status='supported' }; $rank=50; if($node -match '\\nvm\\v\d+\.\d+\.\d+\\node\.exe$'){ $rank=0 } elseif($node -match '\\nodejs\\node\.exe$'){ $rank=10 } elseif($node -match '\\Volta\\bin\\node\.exe$'){ $rank=20 } elseif($node -match '\\fnm\\node-versions\\'){ $rank=30 }; $rows += [pscustomobject]@{ Status=$status; Major=$major; Minor=$minor; Patch=$patch; Version=$version; Node=$node; Npm=$npm; Rank=$rank } }; foreach($row in ($rows | Sort-Object @{Expression={ if($_.Status -eq 'supported'){0}else{1} }}, Rank, @{Expression={$_.Major};Descending=$true}, @{Expression={$_.Minor};Descending=$true}, @{Expression={$_.Patch};Descending=$true}, Node)){ [Console]::Out.WriteLine(($row.Status+'|'+$row.Major+'|'+$row.Version+'|'+$row.Node+'|'+$row.Npm)) }" > "%NODE_LIST_FILE%" 2>> "%LOG_FILE%"

if exist "%NODE_LIST_FILE%" (
  for /f "usebackq tokens=1-5 delims=|" %%A in ("%NODE_LIST_FILE%") do (
    set /a NODE_CANDIDATE_COUNT+=1
    set "NODE_STATUS_!NODE_CANDIDATE_COUNT!=%%A"
    set "NODE_MAJOR_!NODE_CANDIDATE_COUNT!=%%B"
    set "NODE_VERSION_!NODE_CANDIDATE_COUNT!=%%C"
    set "NODE_PATH_!NODE_CANDIDATE_COUNT!=%%D"
    set "NPM_PATH_!NODE_CANDIDATE_COUNT!=%%E"
    if /i "%%A"=="supported" (
      set /a SUPPORTED_NODE_COUNT+=1
      set "SUPPORTED_NODE_INDEX_!SUPPORTED_NODE_COUNT!=!NODE_CANDIDATE_COUNT!"
    )
  )
  del "%NODE_LIST_FILE%" >nul 2>nul
)

if "%NODE_CANDIDATE_COUNT%"=="0" exit /b 1

echo.
echo Detected Node.js installations:
for /l %%I in (1,1,%NODE_CANDIDATE_COUNT%) do (
  call set "CURRENT_STATUS=%%NODE_STATUS_%%I%%"
  call set "CURRENT_VERSION=%%NODE_VERSION_%%I%%"
  call set "CURRENT_PATH=%%NODE_PATH_%%I%%"
  if /i "!CURRENT_STATUS!"=="supported" (
    echo   [OK] !CURRENT_VERSION!  !CURRENT_PATH!
  ) else if /i "!CURRENT_STATUS!"=="missing-npm" (
    echo   [--] !CURRENT_VERSION!  !CURRENT_PATH!  ^(npm.cmd not found^)
  ) else (
    echo   [--] !CURRENT_VERSION!  !CURRENT_PATH!  ^(requires Node.js %NODE_REQUIREMENT%^)
  )
)

if "%SUPPORTED_NODE_COUNT%"=="0" exit /b 1

if "%SUPPORTED_NODE_COUNT%"=="1" (
  set "NODE_CHOICE=1"
) else (
  echo.
  echo Select Node.js version to use:
  for /l %%I in (1,1,%SUPPORTED_NODE_COUNT%) do (
    call set "CURRENT_INDEX=%%SUPPORTED_NODE_INDEX_%%I%%"
    call set "CURRENT_VERSION=%%NODE_VERSION_!CURRENT_INDEX!%%"
    call set "CURRENT_PATH=%%NODE_PATH_!CURRENT_INDEX!%%"
    if "%%I"=="1" (
      echo   [%%I] !CURRENT_VERSION!  !CURRENT_PATH! ^(recommended^)
    ) else (
      echo   [%%I] !CURRENT_VERSION!  !CURRENT_PATH!
    )
  )
  echo.
  set "NODE_CHOICE="
  set /p "NODE_CHOICE=Choose Node.js [1]: "
  if "!NODE_CHOICE!"=="" set "NODE_CHOICE=1"
)

set "INVALID_NODE_CHOICE="
for /f "delims=0123456789" %%A in ("%NODE_CHOICE%") do set "INVALID_NODE_CHOICE=1"
if defined INVALID_NODE_CHOICE (
  echo Invalid Node.js option.
  exit /b 1
)

if %NODE_CHOICE% LSS 1 (
  echo Invalid Node.js option.
  exit /b 1
)
if %NODE_CHOICE% GTR %SUPPORTED_NODE_COUNT% (
  echo Invalid Node.js option.
  exit /b 1
)

call set "SELECTED_NODE_INDEX=%%SUPPORTED_NODE_INDEX_%NODE_CHOICE%%%"
call set "NODE_EXE=%%NODE_PATH_%SELECTED_NODE_INDEX%%%"
call set "NPM_CMD=%%NPM_PATH_%SELECTED_NODE_INDEX%%%"
call set "NODE_VERSION=%%NODE_VERSION_%SELECTED_NODE_INDEX%%%"
set "NODE_SUPPORTED=1"

call :log "Selected Node.js: %NODE_VERSION% (%NODE_EXE%)"
exit /b 0

:ensure_git
echo.
echo Checking Git...
call :log "Checking Git"
call :find_git
if defined GIT_EXE (
  echo Git found: %GIT_VERSION% ^(%GIT_EXE%^)
  call :log "Git found: %GIT_VERSION% (%GIT_EXE%)"
  exit /b 0
)

echo.
echo Git was not found.
call :log "Git was not found"

call :install_winget_package "Git.Git" "Git"
if errorlevel 1 exit /b 1

call :find_git
if defined GIT_EXE (
  echo Git ready: %GIT_VERSION% ^(%GIT_EXE%^)
  call :log "Git ready: %GIT_VERSION% (%GIT_EXE%)"
  exit /b 0
)

echo Git installation finished, but git.exe was not found in PATH.
echo Close this window, open a new command prompt, and run this script again.
call :log "Git was not found after installation"
exit /b 1

:find_git
set "GIT_EXE="
set "GIT_VERSION="

if not defined GIT_EXE if exist "!PROGRAM_FILES!\Git\cmd\git.exe" set "GIT_EXE=!PROGRAM_FILES!\Git\cmd\git.exe"
if not defined GIT_EXE if exist "!PROGRAM_FILES_X86!\Git\cmd\git.exe" set "GIT_EXE=!PROGRAM_FILES_X86!\Git\cmd\git.exe"
if not defined GIT_EXE if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" set "GIT_EXE=%LOCALAPPDATA%\Programs\Git\cmd\git.exe"

if not defined GIT_EXE (
  set "GIT_LOOKUP_FILE=%TEMP%\llamacpp-git-lookup-%RANDOM%.txt"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; $job=Start-Job -ScriptBlock { $cmd=Get-Command git.exe -ErrorAction SilentlyContinue | Select-Object -First 1; if($cmd){ $cmd.Source } }; if(Wait-Job $job -Timeout 5){ Receive-Job $job | Select-Object -First 1 }; Remove-Job $job -Force" > "!GIT_LOOKUP_FILE!" 2>> "%LOG_FILE%"
  if exist "!GIT_LOOKUP_FILE!" (
    for /f "usebackq delims=" %%P in ("!GIT_LOOKUP_FILE!") do (
      if not defined GIT_EXE set "GIT_EXE=%%P"
    )
    del "!GIT_LOOKUP_FILE!" >nul 2>nul
  )
)

if not defined GIT_EXE exit /b 0

echo Found Git candidate: %GIT_EXE%
call :log "Found Git candidate: %GIT_EXE%"
set "GIT_VERSION_FILE=%TEMP%\llamacpp-git-version-%RANDOM%.txt"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; $git=$env:GIT_EXE; $job=Start-Job -ScriptBlock { param($exe) & $exe --version 2>$null } -ArgumentList $git; if(Wait-Job $job -Timeout 5){ Receive-Job $job | Select-Object -First 1 }; Remove-Job $job -Force" > "%GIT_VERSION_FILE%" 2>> "%LOG_FILE%"
if exist "%GIT_VERSION_FILE%" (
  for /f "usebackq delims=" %%V in ("%GIT_VERSION_FILE%") do (
    if not defined GIT_VERSION set "GIT_VERSION=%%V"
  )
  del "%GIT_VERSION_FILE%" >nul 2>nul
)
if not defined GIT_VERSION set "GIT_VERSION=version check timed out"

for %%D in ("%GIT_EXE%") do set "GIT_BIN=%%~dpD"
if defined GIT_BIN set "PATH=%GIT_BIN%;%PATH%"
exit /b 0

:install_winget_package
set "WINGET_ID=%~1"
set "WINGET_NAME=%~2"

call :find_winget
if not defined WINGET_EXE (
  echo winget was not found. Falling back to the official %WINGET_NAME% installer...
  call :log "winget was not found for %WINGET_NAME%; using direct installer fallback"
  call :install_direct_package "%WINGET_ID%" "%WINGET_NAME%"
  exit /b !ERRORLEVEL!
)

echo Installing %WINGET_NAME% with winget...
echo This may show a Windows installer or UAC prompt.
call :log "Installing %WINGET_NAME% with winget id %WINGET_ID%"

"%WINGET_EXE%" install --id "%WINGET_ID%" -e --source winget --accept-source-agreements --accept-package-agreements >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo winget failed to install %WINGET_NAME%. Trying the official installer fallback...
  call :log "winget install failed for %WINGET_NAME%; trying direct installer fallback"
  call :install_direct_package "%WINGET_ID%" "%WINGET_NAME%"
  exit /b !ERRORLEVEL!
)

call :refresh_path
exit /b 0

:install_direct_package
set "DIRECT_ID=%~1"
set "DIRECT_NAME=%~2"

if /i "%DIRECT_ID%"=="OpenJS.NodeJS.LTS" (
  call :install_node_direct
  exit /b !ERRORLEVEL!
)

if /i "%DIRECT_ID%"=="Git.Git" (
  call :install_git_direct
  exit /b !ERRORLEVEL!
)

echo No direct installer fallback is available for %DIRECT_NAME%.
call :log "No direct installer fallback for %DIRECT_ID%"
exit /b 1

:install_node_direct
set "NODE_MSI=%TEMP%\llamacpp-node-lts-%RANDOM%.msi"
set "NODE_VERSION_FILE=%TEMP%\llamacpp-node-lts-%RANDOM%.txt"
set "NODE_INSTALL_VERSION="

echo Downloading Node.js LTS MSI from nodejs.org...
call :log "Downloading Node.js LTS MSI from nodejs.org"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $data=Invoke-RestMethod 'https://nodejs.org/dist/index.json' -TimeoutSec 20; $v=$data | Where-Object { $_.lts -ne $false -and $_.files -contains 'win-x64-msi' } | Select-Object -First 1; if(-not $v){ throw 'No Node.js LTS MSI found' }; $version=$v.version.TrimStart('v'); $url='https://nodejs.org/dist/'+$v.version+'/node-v'+$version+'-x64.msi'; Invoke-WebRequest -Uri $url -OutFile $env:NODE_MSI -UseBasicParsing; [Console]::Out.Write($version)" > "%NODE_VERSION_FILE%" 2>> "%LOG_FILE%"
if errorlevel 1 (
  echo Failed to download Node.js LTS MSI. See:
  echo %LOG_FILE%
  call :log "Node.js direct download failed"
  del "%NODE_VERSION_FILE%" >nul 2>nul
  exit /b 1
)

if exist "%NODE_VERSION_FILE%" (
  for /f "usebackq delims=" %%V in ("%NODE_VERSION_FILE%") do (
    if not defined NODE_INSTALL_VERSION set "NODE_INSTALL_VERSION=%%V"
  )
  del "%NODE_VERSION_FILE%" >nul 2>nul
)

if not exist "%NODE_MSI%" (
  echo Node.js MSI was not downloaded:
  echo %NODE_MSI%
  call :log "Node.js MSI was not downloaded"
  exit /b 1
)

echo Installing Node.js %NODE_INSTALL_VERSION% with msiexec...
echo This may show a Windows installer or UAC prompt.
call :log "Installing Node.js MSI: %NODE_MSI%"

msiexec /i "%NODE_MSI%" /passive /norestart >> "%LOG_FILE%" 2>&1
set "NODE_MSI_EXIT=%ERRORLEVEL%"
del "%NODE_MSI%" >nul 2>nul

if not "%NODE_MSI_EXIT%"=="0" if not "%NODE_MSI_EXIT%"=="3010" (
  echo Node.js MSI installation failed with exit code %NODE_MSI_EXIT%. See:
  echo %LOG_FILE%
  call :log "Node.js MSI failed with exit code %NODE_MSI_EXIT%"
  exit /b 1
)

call :refresh_path
exit /b 0

:install_git_direct
set "GIT_INSTALLER=%TEMP%\llamacpp-git-%RANDOM%.exe"
set "GIT_ASSET_FILE=%TEMP%\llamacpp-git-%RANDOM%.txt"
set "GIT_ASSET_NAME="

echo Downloading Git for Windows installer from github.com...
call :log "Downloading Git for Windows installer from GitHub releases"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $release=Invoke-RestMethod 'https://api.github.com/repos/git-for-windows/git/releases/latest' -TimeoutSec 20; $asset=$release.assets | Where-Object { $_.name -match '^Git-\d+(\.\d+)+-64-bit\.exe$' } | Select-Object -First 1; if(-not $asset){ throw 'Git 64-bit installer asset not found' }; Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $env:GIT_INSTALLER -UseBasicParsing; [Console]::Out.Write($asset.name)" > "%GIT_ASSET_FILE%" 2>> "%LOG_FILE%"
if errorlevel 1 (
  echo Failed to download Git for Windows installer. See:
  echo %LOG_FILE%
  call :log "Git direct download failed"
  del "%GIT_ASSET_FILE%" >nul 2>nul
  exit /b 1
)

if exist "%GIT_ASSET_FILE%" (
  for /f "usebackq delims=" %%V in ("%GIT_ASSET_FILE%") do (
    if not defined GIT_ASSET_NAME set "GIT_ASSET_NAME=%%V"
  )
  del "%GIT_ASSET_FILE%" >nul 2>nul
)

if not exist "%GIT_INSTALLER%" (
  echo Git installer was not downloaded:
  echo %GIT_INSTALLER%
  call :log "Git installer was not downloaded"
  exit /b 1
)

echo Installing %GIT_ASSET_NAME%...
echo This may show a Windows installer or UAC prompt.
call :log "Installing Git for Windows: %GIT_INSTALLER%"

"%GIT_INSTALLER%" /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /o:PathOption=Cmd >> "%LOG_FILE%" 2>&1
set "GIT_INSTALL_EXIT=%ERRORLEVEL%"
del "%GIT_INSTALLER%" >nul 2>nul

if not "%GIT_INSTALL_EXIT%"=="0" (
  echo Git installer failed with exit code %GIT_INSTALL_EXIT%. See:
  echo %LOG_FILE%
  call :log "Git installer failed with exit code %GIT_INSTALL_EXIT%"
  exit /b 1
)

call :refresh_path
exit /b 0

:find_winget
set "WINGET_EXE="
for /f "delims=" %%P in ('where winget 2^>nul') do (
  if not defined WINGET_EXE set "WINGET_EXE=%%P"
)
exit /b 0

:refresh_path
set "FRESH_PATH="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$machine=[Environment]::GetEnvironmentVariable('Path','Machine'); $user=[Environment]::GetEnvironmentVariable('Path','User'); [Console]::Out.Write($machine + ';' + $user)" 2^>nul`) do (
  if not defined FRESH_PATH set "FRESH_PATH=%%P"
)
if defined FRESH_PATH set "PATH=%FRESH_PATH%;%PATH%"
call :log "PATH refreshed from system and user environment"
exit /b 0

:apply_node_path
set "NODE_BIN="
for %%D in ("%NODE_EXE%") do set "NODE_BIN=%%~dpD"
if not defined NODE_BIN (
  echo Failed to resolve Node.js directory.
  call :log "Failed to resolve Node.js directory"
  exit /b 1
)

set "PATH=%NODE_BIN%;%NPM_PREFIX%;%NPM_PREFIX%\node_modules\.bin;%PATH%"
call :log "PATH updated with Node.js and npm prefix"
exit /b 0

:prepare_npm_dirs
if not exist "%NPM_PREFIX%" mkdir "%NPM_PREFIX%" >nul 2>nul
if not exist "%NPM_CACHE%" mkdir "%NPM_CACHE%" >nul 2>nul

if not exist "%NPM_PREFIX%" (
  echo Failed to create npm prefix:
  echo %NPM_PREFIX%
  call :log "Failed to create npm prefix: %NPM_PREFIX%"
  exit /b 1
)
if not exist "%NPM_CACHE%" (
  echo Failed to create npm cache:
  echo %NPM_CACHE%
  call :log "Failed to create npm cache: %NPM_CACHE%"
  exit /b 1
)
exit /b 0

:preserve_launcher_state
if not exist "%APP_DIR%" exit /b 0

for %%F in (config.json params-history.json template-overrides.json) do (
  if exist "%APP_DIR%\%%F" (
    if not exist "%INSTALL_ROOT%\%%F" (
      copy /Y "%APP_DIR%\%%F" "%INSTALL_ROOT%\%%F" >nul 2>nul
      if errorlevel 1 (
        call :log "Failed to preserve %%F"
      ) else (
        call :log "Preserved %%F to %INSTALL_ROOT%"
      )
    )
  )
)
exit /b 0

:select_package
set "PACKAGE_FILE="
set "PACKAGE_NAME="
set "PACKAGE_VERSION="

for /f "tokens=1,* delims=|" %%A in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$dir=$env:SCRIPT_DIR; $name=$env:APP_NAME; $re='^'+[regex]::Escape($name)+'-(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?<suffix>[-+][0-9A-Za-z.-]+)?\.tgz$'; $pkg=Get-ChildItem -LiteralPath $dir -Filter ($name+'-*.tgz') -File | ForEach-Object { if ($_.Name -match $re) { [pscustomobject]@{ Path=$_.FullName; Version=($Matches.major+'.'+$Matches.minor+'.'+$Matches.patch+$Matches.suffix); Major=[int]$Matches.major; Minor=[int]$Matches.minor; Patch=[int]$Matches.patch; Time=$_.LastWriteTimeUtc } } } | Sort-Object Major,Minor,Patch,Time -Descending | Select-Object -First 1; if($pkg){ [Console]::Out.Write($pkg.Path + '|' + $pkg.Version) }" 2^>nul') do (
  if not defined PACKAGE_FILE (
    set "PACKAGE_FILE=%%A"
    set "PACKAGE_VERSION=%%B"
  )
)

if not defined PACKAGE_FILE (
  call :log "No package archive found next to script"
  exit /b 0
)

for %%F in ("%PACKAGE_FILE%") do set "PACKAGE_NAME=%%~nxF"

echo Package found: %PACKAGE_NAME%
call :log "Selected package: %PACKAGE_FILE% (version %PACKAGE_VERSION%)"
exit /b 0

:resolve_installed_version
set "INSTALLED_VERSION="
set "INSTALLED_VERSION_SOURCE="
set "INSTALLED_VERSION_FILE=%TEMP%\llamacpp-installed-version-%RANDOM%.txt"

if exist "%APP_PACKAGE_JSON%" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $pkg=Get-Content -Raw -LiteralPath $env:APP_PACKAGE_JSON | ConvertFrom-Json; [Console]::Out.Write($pkg.version)" > "%INSTALLED_VERSION_FILE%" 2>> "%LOG_FILE%"
  if exist "%INSTALLED_VERSION_FILE%" (
    for /f "usebackq delims=" %%V in ("%INSTALLED_VERSION_FILE%") do (
      if not defined INSTALLED_VERSION set "INSTALLED_VERSION=%%V"
    )
  )
  if defined INSTALLED_VERSION set "INSTALLED_VERSION_SOURCE=package.json"
)

if not defined INSTALLED_VERSION if exist "%APP_VERSION_MARKER%" (
  for /f "usebackq delims=" %%V in ("%APP_VERSION_MARKER%") do (
    if not defined INSTALLED_VERSION set "INSTALLED_VERSION=%%V"
  )
  if defined INSTALLED_VERSION set "INSTALLED_VERSION_SOURCE=version marker"
)

del "%INSTALLED_VERSION_FILE%" >nul 2>nul

if defined INSTALLED_VERSION (
  call :log "Installed package version: %INSTALLED_VERSION% (%INSTALLED_VERSION_SOURCE%)"
) else (
  call :log "Installed package version could not be detected"
)
exit /b 0

:decide_install
set "NEED_INSTALL="
set "INSTALL_REASON="

if not exist "%APP_ENTRY%" (
  set "NEED_INSTALL=1"
  set "INSTALL_REASON=launcher is not installed"
  call :log "Install required: launcher entry is missing"
  exit /b 0
)

if not defined PACKAGE_FILE exit /b 0

if not defined INSTALLED_VERSION (
  set "NEED_INSTALL=1"
  set "INSTALL_REASON=installed version could not be detected"
  call :log "Install required: installed version missing"
  exit /b 0
)

if /i "%PACKAGE_VERSION%"=="%INSTALLED_VERSION%" (
  call :log "Installed version matches package version"
  exit /b 0
)

call :is_newer_version "%PACKAGE_VERSION%" "%INSTALLED_VERSION%"
if errorlevel 1 (
  echo Package %PACKAGE_VERSION% is not newer than installed %INSTALLED_VERSION%; keeping installed version.
  call :log "Package version %PACKAGE_VERSION% is not newer than installed %INSTALLED_VERSION%"
  exit /b 0
)

set "NEED_INSTALL=1"
set "INSTALL_REASON=package %PACKAGE_VERSION% is newer than installed %INSTALLED_VERSION%"
call :log "Install required: %INSTALL_REASON%"
exit /b 0

:is_newer_version
"%NODE_EXE%" -e "const a=process.argv[1],b=process.argv[2];const p=v=>String(v).split(/[+-]/)[0].split('.').map(n=>parseInt(n,10)||0);const A=p(a),B=p(b);for(let i=0;i<3;i++){if((A[i]||0)>(B[i]||0))process.exit(0);if((A[i]||0)<(B[i]||0))process.exit(1)}process.exit(1)" "%~1" "%~2" >nul 2>nul
exit /b %ERRORLEVEL%

:install_launcher
echo Package: %PACKAGE_FILE%
echo Install root: %NPM_PREFIX%
call :log "Installing package with npm"

call "%NPM_CMD%" install --prefix "%NPM_PREFIX%" --cache "%NPM_CACHE%" -g "%PACKAGE_FILE%" --no-audit --no-fund --fetch-retries 2 --fetch-retry-maxtimeout 20000 --fetch-timeout 120000 >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo Failed to install %APP_NAME%. See:
  echo %LOG_FILE%
  echo.
  echo Most common causes:
  echo   - no internet access for npm dependencies
  echo   - antivirus blocked npm cache writes
  echo   - corrupted .tgz package
  call :log "npm install failed"
  exit /b 1
)

if not exist "%APP_ENTRY%" (
  echo Installed launcher entry was not found:
  echo %APP_ENTRY%
  call :log "Launcher entry not found after npm install: %APP_ENTRY%"
  exit /b 1
)

if defined PACKAGE_VERSION (
  > "%APP_VERSION_MARKER%" echo %PACKAGE_VERSION%
  call :log "Version marker written: %APP_VERSION_MARKER% = %PACKAGE_VERSION%"
)

echo %APP_NAME% installed.
call :log "%APP_NAME% installed successfully"
exit /b 0

:fail
if not defined FAIL_CODE set "FAIL_CODE=%ERRORLEVEL%"
if "%FAIL_CODE%"=="0" set "FAIL_CODE=1"
echo.
echo Failed.
echo Log file:
echo %LOG_FILE%
call :log "Failed with exit code %FAIL_CODE%"
echo.
pause
exit /b %FAIL_CODE%
