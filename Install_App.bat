@echo off
cd /d "%~dp0"
echo Starting Album Tracker locally so it can be installed as an app...
start "AlbumTrackerServer" /min powershell -NoProfile -WindowStyle Hidden -Command "$port=8080;$root=(Get-Location).Path;try{$listener=New-Object System.Net.HttpListener;$listener.Prefixes.Add('http://localhost:'+$port+'/');$listener.Start()}catch{exit};$mime=@{'.html'='text/html';'.css'='text/css';'.js'='application/javascript';'.json'='application/json';'.png'='image/png';'.webmanifest'='application/manifest+json'};while($listener.IsListening){$context=$listener.GetContext();$request=$context.Request;$response=$context.Response;try{$path=$request.Url.LocalPath;if($path -eq '/'){$path='/index.html'};$filePath=Join-Path $root ($path.TrimStart('/'));if(Test-Path $filePath -PathType Leaf){$ext=[System.IO.Path]::GetExtension($filePath);$contentType=$mime[$ext];if(-not $contentType){$contentType='application/octet-stream'};$bytes=[System.IO.File]::ReadAllBytes($filePath);$response.ContentType=$contentType;$response.ContentLength64=$bytes.Length;$response.OutputStream.Write($bytes,0,$bytes.Length)}else{$response.StatusCode=404}}catch{$response.StatusCode=500}finally{$response.OutputStream.Close()}}"
timeout /t 2 /nobreak >nul
start "" "http://localhost:8080/"
echo.
echo Once the page opens: click the install icon in the browser's address bar
echo (or the browser menu ... "Install Album Tracker" / "Apps ^> Install this site as an app").
echo After that, you can launch it from your Start Menu / desktop like any other app.
echo This window and the background server can be closed afterward.
pause
