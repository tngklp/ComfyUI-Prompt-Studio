@echo off
setlocal
cd /d "%~dp0"

rem A future portable release can place a self-contained Python runtime here.
if exist "runtime\python\python.exe" (
  "runtime\python\python.exe" -m prompt_studio %*
  goto :done
)

if not exist ".venv\Scripts\python.exe" (
  echo Preparing Prompt Studio for the first launch...
  where uv >nul 2>nul
  if not errorlevel 1 (
    uv venv ".venv" || goto :setup_failed
  ) else (
    where py >nul 2>nul
    if not errorlevel 1 (
      py -3 -m venv ".venv" || goto :python_missing
    ) else (
      where python >nul 2>nul || goto :python_missing
      python -m venv ".venv" || goto :python_missing
    )
  )
)

rem Check existing environments too, including upgrades and interrupted setup.
".venv\Scripts\python.exe" -c "import aiohttp, av, PIL, numpy" >nul 2>nul
if errorlevel 1 (
  echo Installing required dependencies...
  where uv >nul 2>nul
  if not errorlevel 1 (
    uv pip install --python ".venv\Scripts\python.exe" -r requirements.txt || goto :setup_failed
  ) else (
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt || goto :setup_failed
  )
)

rem Fetch the Anima character catalogue on the first run.
rem
rem This is deliberately here rather than in the app: the download is 9 MB and has to
rem happen once, and doing it in the launcher means the console can show progress and
rem the wait happens before the window opens, rather than in the background behind a
rem picker that appears to be missing characters. The script itself is idempotent -
rem it exits immediately when the cache is already present - so repeat launches are
rem unaffected, and a failure is a warning rather than an error: the studio runs
rem without characters.
echo Checking character data...
".venv\Scripts\python.exe" "scripts\fetch_characters.py"
if errorlevel 1 echo Character data will be fetched on the next launch.

".venv\Scripts\python.exe" -m prompt_studio %*
goto :done

:python_missing
echo.
echo Python 3.10 or newer was not found.
echo Install Python once, or use a release that includes runtime\python.
goto :failed

:setup_failed
echo.
echo The local environment could not be prepared.
goto :failed

:failed
pause
exit /b 1

:done
endlocal
