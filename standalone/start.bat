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
