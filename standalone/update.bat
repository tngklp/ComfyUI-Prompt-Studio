@echo off
rem Prompt Studio Standalone - in-place updater.
rem
rem Downloads the latest Standalone release, replaces the application files, and
rem keeps everything that belongs to YOU: data\, models\, .venv\, and any
rem llama-server / CUDA files you placed next to the launcher.
rem
rem Run this instead of extracting a new ZIP by hand. Run start.bat afterwards.

setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "REPO=tngklp/ComfyUI-Prompt-Studio"
set "ASSET=Prompt-Studio-Standalone-Windows"
set "STAGING=%TEMP%\prompt-studio-update-%RANDOM%"
set "BACKUP=%TEMP%\prompt-studio-backup-%RANDOM%"

echo ===============================================
echo   Prompt Studio Standalone - Update
echo ===============================================
echo.

rem ---------------------------------------------------------------- preflight
if not exist "VERSION" (
  echo This folder does not look like a Prompt Studio Standalone install.
  echo update.bat must sit next to start.bat.
  goto :failed
)

if not exist "upstream\backend\routes.py" (
  echo The upstream\ checkout is missing or incomplete.
  echo Reinstall from the release ZIP instead of updating this copy.
  goto :failed
)

set "CURRENT="
for /f "usebackq delims=" %%v in ("VERSION") do if not defined CURRENT set "CURRENT=%%v"
echo Installed version: %CURRENT%

rem ---------------------------------------------------------------- check latest
set "LATEST="
for /f "delims=" %%v in ('powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $r = Invoke-RestMethod -UseBasicParsing -Uri 'https://api.github.com/repos/%REPO%/releases/latest' -Headers @{ 'User-Agent' = 'prompt-studio-updater' }; ($r.tag_name -replace '^standalone-v','') } catch { '' }"') do set "LATEST=%%v"

if not defined LATEST (
  echo Could not reach GitHub to check for an update.
  echo Check your internet connection and try again.
  goto :failed
)

echo Latest version:    %LATEST%
echo.

if /i "%LATEST%"=="%CURRENT%" (
  echo Already up to date. Nothing to do.
  goto :done
)

set "URL=https://github.com/%REPO%/releases/download/standalone-v%LATEST%/%ASSET%-v%LATEST%.zip"
echo Updating %CURRENT% ^-^> %LATEST%
echo Downloading %URL%
echo.

rem ---------------------------------------------------------------- download
if not exist "%STAGING%" mkdir "%STAGING%" >nul 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -UseBasicParsing -Uri '%URL%' -OutFile '%STAGING%\update.zip' } catch { exit 1 }"
if errorlevel 1 (
  echo The download failed.
  echo Download it manually from: %URL%
  goto :failed
)

echo Extracting...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { Expand-Archive -LiteralPath '%STAGING%\update.zip' -DestinationPath '%STAGING%\app' -Force } catch { exit 1 }"
if errorlevel 1 (
  echo The downloaded archive could not be extracted.
  goto :failed
)

rem ---------------------------------------------------------------- sanity check
rem A release ZIP has no wrapper folder. If it does not look like one, stop before
rem touching the working install.
if not exist "%STAGING%\app\upstream\backend\routes.py" (
  echo The downloaded archive is not a valid Standalone package.
  echo Nothing has been changed.
  goto :failed
)

set "NEW="
for /f "usebackq delims=" %%v in ("%STAGING%\app\VERSION") do if not defined NEW set "NEW=%%v"
if not defined NEW (
  echo The downloaded archive has no VERSION file.
  echo Nothing has been changed.
  goto :failed
)

rem ---------------------------------------------------------------- stop the app
rem The server holds no locks on its own Python sources, but a running copy would
rem keep serving the old code and confuse the next launch. Ask the user to close it.

tasklist /fi "imagename eq python.exe" 2>nul | find /i "python.exe" >nul
if not errorlevel 1 (
  echo.
  echo NOTE: Python is currently running.
  echo       If Prompt Studio is open, close it now - this script waits 10 seconds.
  timeout /t 10 /nobreak >nul
)

rem ---------------------------------------------------------------- back up
echo Backing up the current install...
if not exist "%BACKUP%" mkdir "%BACKUP%" >nul 2>nul
for %%d in (prompt_studio ui scripts upstream) do (
  if exist "%%d" xcopy "%%d" "%BACKUP%\%%d\" /e /i /q /h >nul 2>nul
)
for %%f in (VERSION README.md CHANGELOG.md RELEASE_NOTES.md start.bat requirements.txt) do (
  if exist "%%f" copy /y "%%f" "%BACKUP%\%%f" >nul 2>nul
)
echo Backup saved to %BACKUP%

rem ---------------------------------------------------------------- replace
rem Only application files are replaced. data\ (settings + character cache),
rem models\, .venv\, and any llama-server/CUDA files are left exactly as they are.
echo Replacing application files...
for %%d in (prompt_studio ui scripts upstream) do (
  if exist "%%d" rmdir /s /q "%%d"
  if exist "%STAGING%\app\%%d" xcopy "%STAGING%\app\%%d" "%%d\" /e /i /q /h >nul 2>nul
)
for %%f in (VERSION README.md CHANGELOG.md RELEASE_NOTES.md start.bat update.bat requirements.txt) do (
  if exist "%STAGING%\app\%%f" copy /y "%STAGING%\app\%%f" "%%f" >nul 2>nul
)

rem A new release may add empty directories that xcopy cannot carry.
if not exist "models" mkdir "models" >nul 2>nul

rem ---------------------------------------------------------------- verify
if not exist "upstream\backend\routes.py" (
  echo.
  echo The update did not complete cleanly. Restoring the backup...
  for %%d in (prompt_studio ui scripts upstream) do (
    if exist "%%d" rmdir /s /q "%%d"
    if exist "%BACKUP%\%%d" xcopy "%BACKUP%\%%d" "%%d\" /e /i /q /h >nul 2>nul
  )
  for %%f in (VERSION README.md CHANGELOG.md RELEASE_NOTES.md start.bat requirements.txt) do (
    if exist "%BACKUP%\%%f" copy /y "%BACKUP%\%%f" "%%f" >nul 2>nul
  )
  echo Restore complete. Your install is unchanged.
  goto :failed
)

rem ---------------------------------------------------------------- dependencies
rem requirements.txt can change between releases. Re-check by importing the same
rem modules start.bat does, and install only when something is genuinely missing.
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -c "import aiohttp, av, PIL, numpy" >nul 2>nul
  if errorlevel 1 (
    echo New dependencies are required. Installing...
    where uv >nul 2>nul
    if not errorlevel 1 (
      uv pip install --python ".venv\Scripts\python.exe" -r requirements.txt
    ) else (
      ".venv\Scripts\python.exe" -m pip install -r requirements.txt
    )
  )
)

echo.
echo ===============================================
echo   Updated %CURRENT% ^-^> %NEW%
echo ===============================================
echo.
echo Start Prompt Studio with start.bat.
echo The previous version is backed up at:
echo   %BACKUP%
if exist "%STAGING%" rmdir /s /q "%STAGING%" >nul 2>nul
goto :done

:failed
if exist "%STAGING%" rmdir /s /q "%STAGING%" >nul 2>nul
echo.
echo Update did not finish.
pause
exit /b 1

:done
endlocal
