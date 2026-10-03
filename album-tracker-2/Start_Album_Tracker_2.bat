@echo off
cd /d "%~dp0"
title Album Tracker 2
rem Album Tracker 2 runs on its own port (8091), so it is a completely separate
rem app from the original Album Tracker on port 8080: separate albums, separate
rem settings, separate install. Neither one can see or change the other.

netstat -ano | findstr /r /c:":8091 .*LISTENING" >nul
if %errorlevel%==0 (
  echo Album Tracker 2 is already running - opening it.
  goto open
)

echo Starting Album Tracker 2...
start "AlbumTracker2Server" /min powershell -NoProfile -WindowStyle Hidden -Command "$port=8091;$root=(Get-Location).Path;try{$listener=New-Object System.Net.HttpListener;$listener.Prefixes.Add('http://localhost:'+$port+'/');$listener.Start()}catch{exit};$mime=@{'.html'='text/html';'.css'='text/css';'.js'='application/javascript';'.json'='application/json';'.png'='image/png';'.webmanifest'='application/manifest+json'};while($listener.IsListening){$context=$listener.GetContext();$request=$context.Request;$response=$context.Response;try{$path=$request.Url.LocalPath;if($path -eq '/'){$path='/index.html'};$filePath=Join-Path $root ($path.TrimStart('/'));if(Test-Path $filePath -PathType Leaf){$ext=[System.IO.Path]::GetExtension($filePath);$contentType=$mime[$ext];if(-not $contentType){$contentType='application/octet-stream'};$bytes=[System.IO.File]::ReadAllBytes($filePath);$response.ContentType=$contentType;$response.ContentLength64=$bytes.Length;$response.OutputStream.Write($bytes,0,$bytes.Length)}else{$response.StatusCode=404}}catch{$response.StatusCode=500}finally{$response.OutputStream.Close()}}"
timeout /t 2 /nobreak >nul

netstat -ano | findstr /r /c:":8091 .*LISTENING" >nul
if not %errorlevel%==0 (
  echo.
  echo Could not start Album Tracker 2 on port 8091.
  echo Try closing other programs or restarting your PC, then run this again.
  pause
  exit /b 1
)

:open
start "" "http://localhost:8091/index.html"
echo.
echo Album Tracker 2 is open at http://localhost:8091/index.html
echo.
echo To install it as an app: click the install icon in the browser's address bar
echo (or the browser menu ... "Install Album Tracker 2" / "Apps ^> Install this site as an app").
echo.
echo You can close this window. The app keeps working until you restart your PC;
echo after a restart, double-click this file again (or open the installed app after running it).
pause
