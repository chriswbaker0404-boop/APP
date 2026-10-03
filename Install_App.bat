@echo off
cd /d "%~dp0"
title Album Tracker
echo Starting Album Tracker from: %cd%

rem An Album Tracker server from an earlier run may still be running in the
rem background, serving files from an OLD copy of this folder. Stop it so the
rem files in THIS folder are the ones you see. (Album Tracker 2 on port 8091
rem is not affected.) Your albums are stored in the browser, not in the server,
rem so this doesn't touch them.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter 'Name=''powershell.exe''' | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*HttpListener*' -and $_.CommandLine -like '*$port=8080;*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
timeout /t 1 /nobreak >nul

start "AlbumTrackerServer" /min powershell -NoProfile -WindowStyle Hidden -Command "$port=8080;$root=(Get-Location).Path;try{$listener=New-Object System.Net.HttpListener;$listener.Prefixes.Add('http://localhost:'+$port+'/');$listener.Start()}catch{exit};$mime=@{'.html'='text/html';'.css'='text/css';'.js'='application/javascript';'.json'='application/json';'.png'='image/png';'.webmanifest'='application/manifest+json'};while($listener.IsListening){$context=$listener.GetContext();$request=$context.Request;$response=$context.Response;try{$path=$request.Url.LocalPath;if($path -eq '/'){$path='/index.html'};$filePath=Join-Path $root ($path.TrimStart('/'));if(Test-Path $filePath -PathType Leaf){$ext=[System.IO.Path]::GetExtension($filePath);$contentType=$mime[$ext];if(-not $contentType){$contentType='application/octet-stream'};$bytes=[System.IO.File]::ReadAllBytes($filePath);$response.ContentType=$contentType;$response.ContentLength64=$bytes.Length;$response.OutputStream.Write($bytes,0,$bytes.Length)}else{$response.StatusCode=404}}catch{$response.StatusCode=500}finally{$response.OutputStream.Close()}}"
timeout /t 2 /nobreak >nul

netstat -ano | findstr /r /c:":8080 .*LISTENING" >nul
if not %errorlevel%==0 (
  echo.
  echo Could not start Album Tracker on port 8080.
  echo Restart your PC and run this file again.
  pause
  exit /b 1
)

start "" "http://localhost:8080/index.html"
echo.
echo Album Tracker is open at http://localhost:8080/index.html
echo If it still looks like the old version, press Ctrl+Shift+R in the browser once.
echo.
echo To install it as an app: click the install icon in the browser's address bar
echo (or the browser menu ... "Install Album Tracker" / "Apps ^> Install this site as an app").
echo After restarting your PC, run this file again before opening the app.
pause
