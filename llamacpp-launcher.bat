@echo off
setlocal EnableExtensions EnableDelayedExpansion

color 0B

set "SERVER_DIR=C:\Users\Arthur\ai\llama.cpp\build\bin\Release"
set "SERVER_EXE=llama-server.exe"
set "HF_CACHE=%USERPROFILE%\.cache\huggingface\hub"
set "HOST=0.0.0.0"
set "PORT=8484"
set "LAN_IP="
set "LAN_URL=unavailable"
set "CONTEXT_SIZE=64000"
set "GPU_LAYERS=99"
set "PARALLEL_SLOTS=1"
set "DRAFT_TOKENS=2"
set "LOG_FILE=%TEMP%\llama_cpp_server_launcher.log"

set "MODEL_MODE="
set "MODEL_SOURCE="
set "MODEL_FLAG="
set "MODEL_LABEL="
set "HF_FILE_NAME="
set "HF_FILE_SIZE="
set "HF_FILE="
set "GPU_NAME=Unknown GPU"
set "CPU_NAME=Unknown CPU"
set "VRAM_MB=0"
set "RAM_MB=0"
set "NVIDIA_SMI="
set "ENABLE_MTP=0"
set "MTP_STATUS=disabled"
set "EXTRA_ARGS="

> "%LOG_FILE%" echo [%DATE% %TIME%] llama.cpp launcher started

call :detect_hardware
call :detect_network
call :select_model
if errorlevel 1 exit /b 1

call :derive_model_label
call :detect_mtp

set /a _VRAM_GB=VRAM_MB/1024
set /a _RAM_GB=RAM_MB/1024

set "HARDWARE_LABEL=%GPU_NAME%"
if not "%CPU_NAME%"=="Unknown CPU" set "HARDWARE_LABEL=%GPU_NAME% + %CPU_NAME%"
if "%GPU_NAME%"=="Unknown GPU" if not "%CPU_NAME%"=="Unknown CPU" set "HARDWARE_LABEL=%CPU_NAME%"

title llama.cpp Server ^| %MODEL_LABEL% ^| %GPU_NAME% ^| :%PORT%

cls
echo.
echo  ============================================================
echo   LLAMA.CPP SERVER
echo  ============================================================
echo.
echo   Engine       llama.cpp
echo   Model        %MODEL_LABEL%
echo   Hardware     %HARDWARE_LABEL%
echo   Memory       %_VRAM_GB% GB VRAM, %_RAM_GB% GB RAM
echo   Local URL    http://localhost:%PORT%
echo   LAN URL      %LAN_URL%
echo   Bind         %HOST%:%PORT% (all interfaces)
echo.
echo  ------------------------------------------------------------
echo   Configuration
echo  ------------------------------------------------------------
echo   Source type  %MODEL_MODE%
echo   Model source %MODEL_SOURCE%
if defined HF_FILE_NAME echo   HF file      %HF_FILE_NAME%
if defined HF_FILE_SIZE echo   File size    %HF_FILE_SIZE% GB
echo   Context      %CONTEXT_SIZE% tokens
echo   GPU layers   %GPU_LAYERS%
echo   Slots        %PARALLEL_SLOTS%
echo   Draft MTP    %MTP_STATUS%
echo   Tools        enabled
echo.

if not exist "%SERVER_DIR%\" (
  echo  [ERROR] Server directory was not found:
  echo          %SERVER_DIR%
  echo.
  pause
  exit /b 1
)

cd /d "%SERVER_DIR%"

if not exist "%SERVER_EXE%" (
  echo  [ERROR] %SERVER_EXE% was not found in:
  echo          %SERVER_DIR%
  echo.
  pause
  exit /b 1
)

echo  [READY] Starting llama.cpp server...
if defined EXTRA_ARGS (
  echo  [DEBUG] Extra args: !EXTRA_ARGS!
) else (
  echo  [DEBUG] Extra args: ^<none^>
)
echo  ------------------------------------------------------------
echo.

%SERVER_EXE% ^
  --tools all ^
  --host %HOST% ^
  --port %PORT% ^
  %MODEL_FLAG% "%MODEL_SOURCE%" %HF_FILE% ^
  -c %CONTEXT_SIZE% ^
  -fa on ^
  -ngl %GPU_LAYERS% ^
  -np %PARALLEL_SLOTS% %EXTRA_ARGS%

echo.
echo  ------------------------------------------------------------
echo  [STOPPED] llama.cpp Server has stopped.
echo  Press any key to close this window.
echo  ------------------------------------------------------------
pause >nul
exit /b

:select_model
cls
echo.
echo  ============================================================
echo   LLAMA.CPP MODEL SELECTOR
echo  ============================================================
echo.
echo   Hugging Face cache:
echo   %HF_CACHE%
echo.
echo  ------------------------------------------------------------
echo   Downloaded GGUF models
echo  ------------------------------------------------------------

set "MODEL_COUNT=0"

if exist "%HF_CACHE%\" (
  for /f "delims=" %%F in ('where.exe /r "%HF_CACHE%" *.gguf 2^>nul') do (
    set "MODEL_PATH=%%~fF"
    set "MODEL_FILE_NAME=%%~nxF"
    if /i not "!MODEL_FILE_NAME:~0,6!"=="mmproj" (
      set "REL_PATH=!MODEL_PATH:%HF_CACHE%\=!"
      for /f "tokens=1 delims=\" %%R in ("!REL_PATH!") do (
        set "REPO_ID=%%R"
        set "REPO_ID=!REPO_ID:models--=!"
        set "REPO_ID=!REPO_ID:--=/!"
        set /a MODEL_COUNT+=1
        set "MODEL_FILE_!MODEL_COUNT!=!MODEL_PATH!"
        set "MODEL_REPO_!MODEL_COUNT!=!REPO_ID!"
        set "MODEL_NAME_!MODEL_COUNT!=!MODEL_FILE_NAME!"
        echo   [!MODEL_COUNT!] !REPO_ID! / !MODEL_FILE_NAME!
      )
    )
  )
)

if "%MODEL_COUNT%"=="0" (
  echo   No local GGUF models were found.
)

set /a HF_OPTION=MODEL_COUNT+1

echo.
echo  ------------------------------------------------------------
echo   Options
echo  ------------------------------------------------------------
echo   0           Quit
if "%MODEL_COUNT%"=="1" (
  echo   1           Use the downloaded local GGUF model
) else (
  if not "%MODEL_COUNT%"=="0" echo   1-%MODEL_COUNT%   Use a downloaded local GGUF model
)
echo   !HF_OPTION!           Enter a Hugging Face repo or URL
echo.

:select_model_prompt
set "MODEL_CHOICE="
ver >nul
set /p "MODEL_CHOICE=Select number: "
if errorlevel 1 (
  echo   [ERROR] Input stream was closed.
  exit /b 1
)

if "%MODEL_CHOICE%"=="" (
  echo   [ERROR] Enter a number.
  echo.
  goto :select_model_prompt
)

if "%MODEL_CHOICE%"=="0" (
  echo.
  echo   Startup cancelled.
  echo   Press any key to close this window.
  pause >nul
  exit /b 1
)

set "INVALID_CHOICE="
for /f "delims=0123456789" %%A in ("%MODEL_CHOICE%") do set "INVALID_CHOICE=1"

if defined INVALID_CHOICE (
  echo   [ERROR] Invalid number.
  echo.
  goto :select_model_prompt
)

set "SELECTED_MODEL="
set /a SELECTED_MODEL=%MODEL_CHOICE% 2>nul
if not defined SELECTED_MODEL (
  echo   [ERROR] Invalid model number.
  echo.
  goto :select_model_prompt
)
if !SELECTED_MODEL! LSS 1 (
  echo   [ERROR] Invalid model number.
  echo.
  goto :select_model_prompt
)
if !SELECTED_MODEL! GTR !HF_OPTION! (
  echo   [ERROR] Invalid model number.
  echo.
  goto :select_model_prompt
)

if !SELECTED_MODEL! EQU !HF_OPTION! (
  echo.
  set "CUSTOM_REF="
  ver >nul
  set /p "CUSTOM_REF=Hugging Face repo (user/repo[:quant]) or URL: "
  if errorlevel 1 (
    echo   [ERROR] Input stream was closed.
    exit /b 1
  )

  if "!CUSTOM_REF!"=="" (
    echo   [ERROR] Empty input.
    echo.
    goto :select_model_prompt
  )

  call :normalize_hf_ref
  if errorlevel 1 (
    echo.
    goto :select_model_prompt
  )

  call :select_context
  if errorlevel 1 (
    echo.
    goto :select_model
  )

  rem  If user did not specify :quant, ask them to pick a file from the repo.
  set "_HAS_QUANT="
  for /f "tokens=2 delims=:" %%Q in ("!CUSTOM_REF!") do set "_HAS_QUANT=1"
  if not defined _HAS_QUANT (
    call :pick_quant
    if errorlevel 1 (
      echo.
      goto :select_model_prompt
    )
  )

  set "MODEL_MODE=hf"
  set "MODEL_FLAG=-hf"
  set "MODEL_SOURCE=!CUSTOM_REF!"
  >> "%LOG_FILE%" echo [%DATE% %TIME%] Selected HF model: !CUSTOM_REF! file=!HF_FILE_NAME!
  exit /b 0
)

call :select_context
if errorlevel 1 (
  echo.
  goto :select_model
)

for %%N in (!SELECTED_MODEL!) do (
  set "MODEL_MODE=local"
  set "MODEL_FLAG=-m"
  set "MODEL_SOURCE=!MODEL_FILE_%%N!"
  >> "%LOG_FILE%" echo [%DATE% %TIME%] Selected local model: !MODEL_FILE_%%N!
)
exit /b 0

:select_context
echo.
echo  ------------------------------------------------------------
echo   Context size
echo  ------------------------------------------------------------
echo   1           4096 tokens
echo   2           20000 tokens
echo   3           64000 tokens
echo   4           96000 tokens
echo   5           128000 tokens
echo   0           Cancel
echo.

:select_context_prompt
set "CONTEXT_CHOICE="
set "_CONTEXT_SIZE="
ver >nul
set /p "CONTEXT_CHOICE=Select context size: "
if errorlevel 1 (
  echo   [ERROR] Input stream was closed.
  exit /b 1
)

if "!CONTEXT_CHOICE!"=="" (
  echo   [ERROR] Enter a number.
  echo.
  goto :select_context_prompt
)

if "!CONTEXT_CHOICE!"=="0" exit /b 1
if "!CONTEXT_CHOICE!"=="1" set "_CONTEXT_SIZE=4096"
if "!CONTEXT_CHOICE!"=="2" set "_CONTEXT_SIZE=20000"
if "!CONTEXT_CHOICE!"=="3" set "_CONTEXT_SIZE=64000"
if "!CONTEXT_CHOICE!"=="4" set "_CONTEXT_SIZE=96000"
if "!CONTEXT_CHOICE!"=="5" set "_CONTEXT_SIZE=128000"

if "!_CONTEXT_SIZE!"=="" (
  echo   [ERROR] Invalid number.
  echo.
  goto :select_context_prompt
)

set "CONTEXT_SIZE=!_CONTEXT_SIZE!"
>> "%LOG_FILE%" echo [%DATE% %TIME%] Selected context: !CONTEXT_SIZE! tokens
exit /b 0

:normalize_hf_ref
rem  Normalize CUSTOM_REF: strip scheme, host, and tail paths (/tree/, /blob/, /resolve/).
rem  Output: CUSTOM_REF as "user/repo" or "user/repo:quant", or errorlevel 1.
set "_NORM=!CUSTOM_REF!"

if /i "!_NORM:~0,8!"=="https://" set "_NORM=!_NORM:~8!"
if /i "!_NORM:~0,7!"=="http://"  set "_NORM=!_NORM:~7!"

if /i "!_NORM:~0,19!"=="www.huggingface.co/" set "_NORM=!_NORM:~19!"
if /i "!_NORM:~0,15!"=="huggingface.co/"     set "_NORM=!_NORM:~15!"

if "!_NORM:~-1!"=="/" set "_NORM=!_NORM:~0,-1!"

set "_USER="
set "_REPO="
for /f "tokens=1,2 delims=/" %%A in ("!_NORM!") do (
  set "_USER=%%A"
  set "_REPO=%%B"
)

if "!_USER!"=="" (
  echo   [ERROR] Could not parse user from input.
  exit /b 1
)
if "!_REPO!"=="" (
  echo   [ERROR] Could not parse repo from input.
  exit /b 1
)

set "CUSTOM_REF=!_USER!/!_REPO!"
exit /b 0

:pick_quant
rem  Fetch .gguf file list for CUSTOM_REF (which must be user/repo, no quant).
rem  Output: HF_FILE_NAME, HF_FILE_SIZE, HF_FILE; or errorlevel 1 on cancel/failure.
set "HF_FILE_NAME="
set "HF_FILE_SIZE="
set "HF_FILE="
set "FILE_COUNT=0"

set /a _VRAM_GB_DISP=VRAM_MB/1024
set /a _RAM_GB_DISP=RAM_MB/1024

echo.
echo  ------------------------------------------------------------
echo   Available .gguf files in !CUSTOM_REF!
echo   Context: !CONTEXT_SIZE! tokens  ^|  VRAM: !_VRAM_GB_DISP! GB  ^|  RAM: !_RAM_GB_DISP! GB
echo   Fit = model_size + KV(ctx, layers~size) + ~1.5 GB overhead
echo  ------------------------------------------------------------

set "_PS_FILE=%TEMP%\llama_quant_fetch.ps1"

rem  ---- KV cache formula (per HF / llama.cpp community) -------------------
rem    KV (FP16) = 2 * n_layers * n_kv_heads * head_dim * ctx * 2 bytes
rem  For modern GQA models (8 kv-heads, 128 head_dim, FP16) this collapses
rem  to ~4096 * n_layers bytes per token. We don't have GGUF metadata, so
rem  n_layers is bucketed from file size (7B~32, 13B~40, 30B~48, 70B~80).
rem  ----------------------------------------------------------------------

> "!_PS_FILE!" echo param([string]$Repo, [int]$VramMb, [int]$RamMb, [int]$CtxTokens)
>>"!_PS_FILE!" echo $ErrorActionPreference = 'Stop'
>>"!_PS_FILE!" echo [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
>>"!_PS_FILE!" echo $esc = [char]27
>>"!_PS_FILE!" echo try {
>>"!_PS_FILE!" echo   $tree = Invoke-RestMethod -Uri "https://huggingface.co/api/models/$Repo/tree/main?recursive=true"
>>"!_PS_FILE!" echo } catch { exit 1 }
>>"!_PS_FILE!" echo $files = @($tree ^| Where-Object { $_.type -eq 'file' -and $_.path -like '*.gguf' -and $_.path -notlike '*mmproj*' -and $_.path -notlike '*imatrix*' } ^| Sort-Object size)
>>"!_PS_FILE!" echo if ($files.Count -eq 0) { exit 2 }
>>"!_PS_FILE!" echo $nameWidth = ($files ^| ForEach-Object { $_.path.Length } ^| Measure-Object -Maximum).Maximum
>>"!_PS_FILE!" echo if ($nameWidth -gt 50) { $nameWidth = 50 }
>>"!_PS_FILE!" echo if ($nameWidth -lt 30) { $nameWidth = 30 }
>>"!_PS_FILE!" echo $fmt = "  [{0,2}] {1,-$nameWidth}  {2,7:N2} GB  [{3}]"
>>"!_PS_FILE!" echo $vramAvail  = [Math]::Floor($VramMb * 0.95)
>>"!_PS_FILE!" echo $totalAvail = $vramAvail + [Math]::Floor($RamMb * 0.70)
>>"!_PS_FILE!" echo $idx = 0
>>"!_PS_FILE!" echo foreach ($f in $files) {
>>"!_PS_FILE!" echo   $idx++
>>"!_PS_FILE!" echo   $sizeMb = [int]($f.size / 1MB)
>>"!_PS_FILE!" echo   $sizeGb = $f.size / 1GB
>>"!_PS_FILE!" echo   if     ($sizeGb -lt  5) { $layers = 28 } elseif ($sizeGb -lt 10) { $layers = 32 } elseif ($sizeGb -lt 20) { $layers = 40 } elseif ($sizeGb -lt 35) { $layers = 48 } elseif ($sizeGb -lt 60) { $layers = 64 } else { $layers = 80 }
>>"!_PS_FILE!" echo   $kvBytesPerToken = 4096 * $layers
>>"!_PS_FILE!" echo   $kvMb = [Math]::Floor($CtxTokens * $kvBytesPerToken / 1MB)
>>"!_PS_FILE!" echo   $neededMb = $sizeMb + $kvMb + 1500
>>"!_PS_FILE!" echo   if ($VramMb -gt 0 -and $neededMb -le $vramAvail) { $statusText='GPU OK '; $color=92 } elseif ($VramMb -gt 0 -and $neededMb -le $totalAvail) { $statusText='PARTIAL'; $color=93 } elseif ($neededMb -le $totalAvail) { $statusText='RAM OK '; $color=92 } else { $statusText='TOO BIG'; $color=91 }
>>"!_PS_FILE!" echo   $status = ("{0}[{1}m{2}{0}[0m" -f $esc, $color, $statusText)
>>"!_PS_FILE!" echo   $name = $f.path
>>"!_PS_FILE!" echo   if ($name.Length -gt $nameWidth) { $name = $name.Substring(0, $nameWidth - 3) + '...' }
>>"!_PS_FILE!" echo   $line = $fmt -f $idx, $name, $sizeGb, $status
>>"!_PS_FILE!" echo   Write-Output ("{0}^|{1}^|{2:N2}^|{3}" -f $idx, $f.path, $sizeGb, $line)
>>"!_PS_FILE!" echo }

for /f "tokens=1,2,3,* delims=|" %%I in ('powershell -NoProfile -ExecutionPolicy Bypass -File "!_PS_FILE!" -Repo "!CUSTOM_REF!" -VramMb !VRAM_MB! -RamMb !RAM_MB! -CtxTokens !CONTEXT_SIZE! 2^>nul') do (
  set "QFILE_%%I=%%J"
  set "QSIZE_%%I=%%K"
  echo %%L
  set "FILE_COUNT=%%I"
)

del "!_PS_FILE!" >nul 2>&1

if "!FILE_COUNT!"=="0" (
  echo.
  echo   [ERROR] No .gguf files found, or fetch failed.
  echo          Check the repo name and your internet connection.
  exit /b 1
)

echo.
:pick_quant_prompt
set "QUANT_CHOICE="
ver >nul
set /p "QUANT_CHOICE=Select file number (0 to cancel): "
if errorlevel 1 (
  echo   [ERROR] Input stream was closed.
  exit /b 1
)

if "!QUANT_CHOICE!"=="" goto :pick_quant_prompt
if "!QUANT_CHOICE!"=="0" exit /b 1

set "_INVALID="
for /f "delims=0123456789" %%A in ("!QUANT_CHOICE!") do set "_INVALID=1"
if defined _INVALID (
  echo   [ERROR] Invalid number.
  goto :pick_quant_prompt
)

if !QUANT_CHOICE! LSS 1 (
  echo   [ERROR] Invalid number.
  goto :pick_quant_prompt
)
if !QUANT_CHOICE! GTR !FILE_COUNT! (
  echo   [ERROR] Invalid number.
  goto :pick_quant_prompt
)

for %%N in (!QUANT_CHOICE!) do (
  set "HF_FILE_NAME=!QFILE_%%N!"
  set "HF_FILE_SIZE=!QSIZE_%%N!"
)
set "HF_FILE=--hf-file !HF_FILE_NAME!"
exit /b 0

:derive_model_label
if /i "%MODEL_MODE%"=="local" (
  for %%F in ("%MODEL_SOURCE%") do set "MODEL_LABEL=%%~nF"
  exit /b 0
)
if defined HF_FILE_NAME (
  set "MODEL_LABEL=%HF_FILE_NAME:.gguf=%"
  exit /b 0
)
set "MODEL_LABEL=%MODEL_SOURCE%"
for /f "tokens=2 delims=/" %%M in ("%MODEL_SOURCE%") do set "MODEL_LABEL=%%M"
for /f "tokens=1 delims=:" %%M in ("%MODEL_LABEL%") do set "MODEL_LABEL=%%M"
set "MODEL_LABEL=%MODEL_LABEL:-GGUF=%"
exit /b 0

:detect_mtp
rem  Auto-detect MTP-capable models by substring scan of MODEL_SOURCE + HF_FILE_NAME.
rem  Substitution :MTP= in cmd.exe is case-insensitive.
set "ENABLE_MTP=0"
set "MTP_STATUS=disabled - model has no MTP layers"
set "EXTRA_ARGS="

set "_MTP_SRC=!MODEL_SOURCE!!HF_FILE_NAME!"
set "_MTP_STRIPPED=!_MTP_SRC:MTP=!"
if not "!_MTP_SRC!"=="!_MTP_STRIPPED!" set "ENABLE_MTP=1"

if "!ENABLE_MTP!"=="1" (
  set "MTP_STATUS=enabled - !DRAFT_TOKENS! draft tokens"
  set "EXTRA_ARGS=--spec-type draft-mtp --spec-draft-n-max !DRAFT_TOKENS!"
  >> "%LOG_FILE%" echo [%DATE% %TIME%] MTP marker found in model source - speculative decoding enabled
) else (
  >> "%LOG_FILE%" echo [%DATE% %TIME%] No MTP marker in model source - speculative decoding disabled
)
exit /b 0

:detect_network
rem  0.0.0.0 is a listen address, not a connectable URL. Ask Windows which
rem  local IPv4 address it would use for outbound traffic and show that.
set "LAN_IP="
set "LAN_URL=unavailable"
for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "$u = [Net.Sockets.UdpClient]::new(); try { $u.Connect('8.8.8.8', 80); $u.Client.LocalEndPoint.Address.ToString() } finally { $u.Close() }" 2^>nul`) do (
  if not defined LAN_IP set "LAN_IP=%%I"
)
if defined LAN_IP set "LAN_URL=http://!LAN_IP!:%PORT%"
exit /b 0

:detect_hardware
rem  GPU name + total VRAM (MiB) via nvidia-smi.
rem  Some launch environments do not include nvidia-smi in PATH, so also
rem  check the common driver install locations before falling back to WMI.
for /f "delims=" %%S in ('where.exe nvidia-smi.exe 2^>nul') do (
  if not defined NVIDIA_SMI set "NVIDIA_SMI=%%~fS"
)
if not defined NVIDIA_SMI if exist "%SystemRoot%\System32\nvidia-smi.exe" set "NVIDIA_SMI=%SystemRoot%\System32\nvidia-smi.exe"
if not defined NVIDIA_SMI if exist "%ProgramFiles%\NVIDIA Corporation\NVSMI\nvidia-smi.exe" set "NVIDIA_SMI=%ProgramFiles%\NVIDIA Corporation\NVSMI\nvidia-smi.exe"

if defined NVIDIA_SMI for /f "tokens=1,2 delims=," %%G in ('""!NVIDIA_SMI!" --query-gpu=name,memory.total --format=csv,noheader,nounits" 2^>nul') do (
  set "_GCAND=%%G"
  set "_VCAND=%%H"
  if /i not "!_GCAND:~0,5!"=="ERROR" if not "!_GCAND!"=="" if "!GPU_NAME!"=="Unknown GPU" (
    set "GPU_NAME=!_GCAND!"
    for /f "tokens=* delims= " %%V in ("!_VCAND!") do set "VRAM_MB=%%V"
  )
)

rem  Fallback GPU name from WMI if nvidia-smi missing
if "%GPU_NAME%"=="Unknown GPU" (
  for /f "skip=1 tokens=* delims=" %%G in ('wmic path win32_VideoController get name 2^>nul') do (
    set "_GCAND=%%G"
    if not "!_GCAND!"=="" if "!GPU_NAME!"=="Unknown GPU" set "GPU_NAME=!_GCAND!"
  )
)

rem  CPU name
for /f "tokens=2,*" %%A in ('reg query "HKLM\HARDWARE\DESCRIPTION\System\CentralProcessor\0" /v ProcessorNameString 2^>nul') do set "CPU_NAME=%%B"

rem  Total system RAM (MiB) via PowerShell
for /f %%R in ('powershell -NoProfile -Command "[Math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB)" 2^>nul') do set "RAM_MB=%%R"

if not defined VRAM_MB set "VRAM_MB=0"
if not defined RAM_MB  set "RAM_MB=0"
exit /b 0
