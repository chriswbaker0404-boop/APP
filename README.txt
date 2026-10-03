ALBUM TRACKER - how to update

Your albums are NOT stored in these files. They live in your browser's storage,
so replacing every file in this folder is safe. (Click "Export" first if you
want a backup anyway.)

1. Close the Album Tracker app/tab.
2. Delete everything in your Album Tracker folder and put all of these files in.
3. Double-click Install_App.bat (or open http://localhost:8080/index.html).
4. Press Ctrl+Shift+R once so the browser drops its old cached copy.

Do NOT use the browser's "Clear site data" / "Clear browsing data" options for
this site: that WOULD delete your albums.

Files
  index.html         the app
  app.js             all the app's logic
  styles.css         the look (dark theme)
  explore.html       the Rock Family Tree influence map
  influence-data.js  data for the map and "For You" recommendations
  sw.js              lets it install as an app and work offline; always loads
                     the newest files when you're online
  manifest.json      app name and icons for installing
  icon-192.png, icon-512.png   app icons
  Install_App.bat    starts the local server on port 8080 and opens the app
