CycleSavvy — Installing GPX routes

This document explains three ways to add GPX routes to CycleSavvy depending on how you run the app.

Options

1) Add a preloaded GPX (hosted web app)
--------------------------------------
When you host the web app (static server), you can add GPX files into the `preloaded_routes/` folder. These will appear in the "Fetch Preloaded Routes" selector in the app.

Steps:
- Copy your `.gpx` file into the `preloaded_routes/` folder at the project root.
- Use a short, URL-friendly filename (lowercase, underscores) — e.g. `iron_horse_trail.gpx`.
- Update `index.html` (if you want a friendlier label) by editing the `<option>` text and `value` path. Example:

    <option value="/preloaded_routes/iron_horse_trail.gpx">Iron Horse Trail — 22 km</option>

- If you use a service worker (the project includes `service-worker.js`), add the new path to the pre-cache array so it is available offline. Open `service-worker.js` and add the entry:

    '/preloaded_routes/iron_horse_trail.gpx',

- Redeploy or restart the dev server. The GPX should now be selectable via the Fetch Route control.

Notes:
- Filenames referenced in HTML or the service worker must match exactly (case-sensitive on many hosts).
- If you edit `index.html` references, be careful to keep the value pointing to the file path.

2) Upload GPX via the Profile page (user uploads)
-------------------------------------------------
CycleSavvy already supports uploading GPX routes from the Profile page (authenticated users). Uploaded routes are stored in Supabase storage and appear under the "Saved Routes" list.

Steps for a user:
- Sign in and open Profile.
- Under "Upload GPX Route", choose the `.gpx` file and the app will upload it to the user's route storage.
- After upload, the route appears under "Saved Routes"; click "Load" to display it on the map.

Implementation notes for maintainers:
- The upload flow uses the `user_routes` table and Supabase storage bucket `gpx`.
- If you want to make uploaded routes discoverable in the community search, add indexing and metadata (length, name) to `user_routes` when storing.

3) Native / Capacitor packaged app (mobile)
-------------------------------------------
If you wrap the PWA with Capacitor and ship a native app, you can include GPX assets in the native bundle or provide an in-app import flow.

Bundled assets:
- Place GPX files under the app's `android/app/src/main/assets/public/preloaded_routes` (Android) or include them in the iOS bundle under `Resources`.
- When bundling, ensure the web `index.html` references the same `/preloaded_routes/...` path so the running webview can load them.

In-app import (recommended for users):
- Use the Capacitor Filesystem and File Picker plugins to let users pick a GPX from device storage and copy it into app data.
- After importing, call the same web code path that handles user-uploaded GPX (save to storage / register meta and show in UI).

Advanced: computing and storing route metadata
---------------------------------------------
To provide better discovery and sorting (length, difficulty, bounding box), compute metadata when you add routes:
- Calculate route length (meters) and store as `length_meters`.
- Store a short `summary` or `display_name` extracted from GPX metadata.
- Store bounding box for proximity searches: `min_lat, min_lon, max_lat, max_lon`.

You can compute these server-side or client-side (on upload) and then persist the fields to `user_routes` or a `preloaded_routes` table.

Troubleshooting
---------------
- If the route doesn't appear, open Developer Tools (browser) and check Network panel for the `.gpx` GET.
- If the service worker served a cached manifest without your new file, update the service worker cache list and reload the app (or clear site data).
- GPX parsing errors are logged to console by Leaflet-GPX — check console for parsing errors.

Example: add an asset and update service-worker.js

1. Copy file:

    cp ~/Downloads/iron_horse_trail.gpx preloaded_routes/iron_horse_trail.gpx

2. Edit `service-worker.js` and add:

    '/preloaded_routes/iron_horse_trail.gpx',

3. Deploy / restart dev server and open the site. Then open Fetch Routes and verify the new option is shown.

If you'd like, I can:
- Add an "Install GPX" modal or page in the app that lists the three methods and provides a one-click checklist.
- Hook uploaded routes into the community search index and compute metadata automatically on upload.

Tell me if you want the in-app modal or if this README is sufficient and I should move to the next feature (Trail follow UI).