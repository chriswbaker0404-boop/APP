#!/usr/bin/env python3
"""Wrap a built "Album Tracker.html" into one double-clickable Windows installer.

Usage: python3 tools/build_installer.py "Album Tracker.html" "Install Album Tracker.bat"

The .bat runs tools/installer.ps1, which unpacks the app and icon (stored as
base64 sections at the end of the .bat) into %LOCALAPPDATA%\\Album Tracker and
adds Desktop/Start Menu shortcuts that open it in its own Chrome/Edge window.
"""
import base64, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html_path, out_path = sys.argv[1], sys.argv[2]

header = r'''@echo off
setlocal
title Album Tracker setup
set "ALBUM_TRACKER_INSTALLER=%~f0"
echo.
echo Installing Album Tracker...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:ALBUM_TRACKER_INSTALLER); $m='@@'+'AT-PS'+'@@'; Invoke-Expression ($t.Split([string[]]@($m),[StringSplitOptions]::None)[1])"
if errorlevel 1 (
  echo.
  echo Setup did not finish - see the message above.
  pause
  exit /b 1
)
echo.
echo Done! Album Tracker is open, and its icon is on your Desktop and in the Start Menu.
echo You can delete this installer file now.
echo.
pause
exit /b 0
'''


def b64(path):
    return base64.encodebytes(open(path, "rb").read()).decode("ascii")


def section(name, body):
    marker = f"@@AT-{name}@@"
    return f"{marker}\n{body.rstrip()}\n{marker}\n"


ps = open(os.path.join(ROOT, "tools", "installer.ps1"), encoding="utf-8").read()
assert "@@AT-" not in ps
content = (header + section("PS", ps) + section("HTML", b64(html_path)) + section("ICO", b64(os.path.join(ROOT, "icon.ico"))))
with open(out_path, "w", encoding="ascii", newline="\r\n") as f:
    f.write(content)
print(f"wrote {out_path} ({os.path.getsize(out_path) // 1024} KB)")
