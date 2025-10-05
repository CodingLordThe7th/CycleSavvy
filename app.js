// Initialize map
let map = L.map('map').setView([37.779, -121.984], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

let watchId = null;
let ridecoord = [];
let ridePolyline = null;
let currentMarker = null;
let activeHistoryPolyline = null;
let currentRouteLayer = null;
let currentRouteLabel = null;
let rideStartTime = null;

// Button references
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const historyBtn = document.getElementById("history");
const routeList = document.getElementById("routeList");
const resetBtn = document.getElementById("reset");
const fetchBtn = document.getElementById("fetchBtn");

// Fetch Route Card
const fetchCard = document.getElementById("fetchRouteCard");
const routeSelect = document.getElementById("routeSelect");
const loadRouteBtn = document.getElementById("loadRoute");
const cancelFetchBtn = document.getElementById("cancelFetch");

// Initial state
startBtn.disabled = false;
stopBtn.disabled = true;

// Start tracking
startBtn.addEventListener("click", () => {
  ridecoord = [];
  // record start time immediately so stop can reference it even if watchId behaves oddly
  rideStartTime = new Date().toISOString();
  if (navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const latlng = [position.coords.latitude, position.coords.longitude];

        if (ridePolyline) map.removeLayer(ridePolyline);
        if (currentMarker) map.removeLayer(currentMarker);

        currentMarker = L.marker(latlng).addTo(map);
        ridecoord.push(latlng);

        if (!ridePolyline) {
          ridePolyline = L.polyline(ridecoord, { color: "blue" }).addTo(map);
        } else {
          ridePolyline.setLatLngs(ridecoord);
        }

        map.panTo(latlng);
      },
      (error) => {
        console.error("Error getting location: ", error);
        showToast("Error getting location: " + error.message, "danger");
      }
    );

    startBtn.disabled = true;
    stopBtn.disabled = false;
    notify("Tracking started", "success");
  } else {
    notify("Geolocation is not supported by this browser.", "warning");
  }
});

// Stop tracking + save route
stopBtn.addEventListener("click", async () => {
  if (watchId !== null || rideStartTime) {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }

    if (ridecoord.length > 0) {
      const startTime = rideStartTime || new Date().toISOString();
      const endTime = new Date().toISOString();
      // compute distance in meters
      let totalMeters = 0;
      for (let i = 1; i < ridecoord.length; i++) {
        const a = L.latLng(ridecoord[i-1]);
        const b = L.latLng(ridecoord[i]);
        totalMeters += a.distanceTo(b);
      }
      const durationSeconds = (new Date(endTime).getTime() - new Date(startTime).getTime())/1000;
      const payload = { coords: ridecoord, meta: { startTime, endTime, durationSeconds, distanceMeters: totalMeters } };
      const key = startTime;
      await localforage.setItem(key, payload);
      notify("Route saved — " + formatLengthForSettings(totalMeters) + " • " + Math.round(durationSeconds/60) + " min", "success");
    }

    // clear start time after saving
    rideStartTime = null;
  } else {
    showToast("No active tracking to stop.", "info");
  }

  stopBtn.disabled = true;
  startBtn.disabled = false;
});

// Populate history list only when dropdown opens
historyBtn.addEventListener("shown.bs.dropdown", async () => {
  routeList.innerHTML = ""; // Clear list each time dropdown opens

  const keys = await localforage.keys();

  // Add "Exit history view" if a route is currently being displayed
  if (activeHistoryPolyline) {
    const li = document.createElement("li");
    li.innerHTML = `<button class="dropdown-item text-danger" id="exitHistory">Exit history view</button>`;
    routeList.appendChild(li);

    document.getElementById("exitHistory").addEventListener("click", () => {
      map.removeLayer(activeHistoryPolyline);
      activeHistoryPolyline = null;
      notify("Exited history view.", "secondary");
      routeList.innerHTML = ""; // Clear dropdown after exiting
    });

    // Divider
    const divider = document.createElement("li");
    divider.innerHTML = `<hr class="dropdown-divider">`;
    routeList.appendChild(divider);
  }

  // Populate saved routes
  if (keys.length === 0) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="dropdown-item-text text-muted">No saved routes</span>`;
    routeList.appendChild(li);
    return;
  }

  for (const key of keys) {
    try {
      const item = await localforage.getItem(key);
      const meta = (item && item.meta) ? item.meta : null;
      const date = new Date(key);
      let label = date.toLocaleDateString() + " " + date.toLocaleTimeString();
      if (meta) {
        const dist = formatLengthForSettings(meta.distanceMeters || 0);
        const d = Math.round((meta.durationSeconds || 0)/60);
        label = `${label} — ${dist} • ${d} min`;
      }
      const li = document.createElement("li");
      li.innerHTML = `<button class="dropdown-item" data-key="${key}">${label}</button>`;
      routeList.appendChild(li);
    } catch (err) {
      // fallback
      const date = new Date(key);
      const label = date.toLocaleDateString() + " " + date.toLocaleTimeString();
      const li = document.createElement("li");
      li.innerHTML = `<button class="dropdown-item" data-key="${key}">${label}</button>`;
      routeList.appendChild(li);
    }
  }

  // Attach click handlers to each route
  routeList.querySelectorAll("button[data-key]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const key = btn.getAttribute("data-key");
      const stored = await localforage.getItem(key);
      const coordinates = stored && stored.coords ? stored.coords : stored;

      if (activeHistoryPolyline) map.removeLayer(activeHistoryPolyline);
      activeHistoryPolyline = L.polyline(coordinates, { color: "red" }).addTo(map);

      map.fitBounds(activeHistoryPolyline.getBounds());
      // show more info if meta exists
      if (stored && stored.meta) {
        const meta = stored.meta;
        const distText = formatLengthForSettings(meta.distanceMeters || 0);
        const durationMin = Math.round((meta.durationSeconds || 0)/60);
        notify(`Showing route — ${distText} • ${durationMin} min`, "info");
      } else {
        notify("Showing route from " + btn.textContent, "info");
      }
    });
  });
});

// Optional: show toast when dropdown closes
// Removed generic closed history toast so the message only appears when user clicks the
// explicit "Exit history view" item in the dropdown. That item already shows a toast.

// Reset cache (guard if resetBtn exists)
if (resetBtn) {
  resetBtn.addEventListener("click", async () => {
    await localforage.clear();
    if (ridePolyline) {
      map.removeLayer(ridePolyline);
      ridePolyline = null;
    }
    if (currentMarker) {
      map.removeLayer(currentMarker);
      currentMarker = null;
    }
    if (activeHistoryPolyline) {
      map.removeLayer(activeHistoryPolyline);
      activeHistoryPolyline = null;
    }
    if (currentRouteLayer) {
      try { map.removeLayer(currentRouteLayer); } catch(e) {}
      currentRouteLayer = null;
    }
    showToast("Cache cleared and map reset!", "warning");
  });
}

// ✅ Toast function
function showToast(message, type = "primary") {
  const toastBox = document.getElementById("toastBox");
  const toastMessage = document.getElementById("toastMessage");

  toastMessage.textContent = message;
  toastBox.className = `toast align-items-center text-bg-${type} border-0`;

  const toast = new bootstrap.Toast(toastBox, { delay: 2000 });
  toast.show();
}

// notify respects user settings (default: enabled)
function notify(message, type = "primary") {
  try {
    const s = getUserSettings();
    const enabled = (s.notifications === undefined) ? true : !!s.notifications;
    if (!enabled) return; // user disabled notifications
  } catch (e) {
    // if settings parsing fails, default to enabled
  }
  showToast(message, type);
}

// Load user settings helper (fallback to metric)
function getUserSettings() {
  try {
    return JSON.parse(localStorage.getItem('cycleSavvySettings')) || {};
  } catch (e) {
    return {};
  }
}

/* ---------- Background tracking wrapper (plugin-agnostic) ----------
   These helpers attempt to call native background geolocation plugins when
   present (Capacitor/Cordova/TransistorSoft naming). When running in a browser
   they fall back to a no-op or an informative toast.
*/

function _findBgPlugin() {
  // Capacitor plugins (if Capacitor is installed)
  try {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BackgroundGeolocation) {
      return { type: 'capacitor', plugin: window.Capacitor.Plugins.BackgroundGeolocation };
    }
  } catch (e) {}

  // Common Cordova/TransistorSoft plugin global
  if (window.BackgroundGeolocation) return { type: 'cordova', plugin: window.BackgroundGeolocation };

  // Some setups expose a global named BackgroundGeolocation or bgGeo
  if (window.bgGeo) return { type: 'cordova', plugin: window.bgGeo };

  return null;
}

// startBackgroundTracking(options) -> returns Promise
async function startBackgroundTracking(options = {}) {
  const found = _findBgPlugin();
  if (!found) {
    notify('Background tracking not available in browser. Wrap the app with Capacitor and install a background geolocation plugin.', 'warning');
    return false;
  }

  try {
    if (found.type === 'capacitor') {
      // Capacitor plugin call pattern (plugin-specific)
      await found.plugin.configure({
        desiredAccuracy: options.desiredAccuracy || 10,
        distanceFilter: options.distanceFilter || 10,
        stopOnTerminate: false,
        startOnBoot: !!options.startOnBoot,
        notification: { title: 'CycleSavvy', text: 'Tracking your ride' }
      });
      await found.plugin.start();
      notify('Background tracking started', 'success');
      return true;
    } else if (found.type === 'cordova') {
      // TransistorSoft / cordova-plugin-background-geolocation API (common)
      if (found.plugin.configure) {
        found.plugin.configure({
          desiredAccuracy: options.desiredAccuracy || 10,
          distanceFilter: options.distanceFilter || 10,
          stopOnTerminate: false,
          startOnBoot: !!options.startOnBoot,
          notification: { title: 'CycleSavvy', text: 'Tracking your ride' }
        }, function(state) {
          if (!state.enabled) found.plugin.start();
        });
        notify('Background tracking started', 'success');
        return true;
      }
    }
  } catch (err) {
    console.error('Failed to start background tracking', err);
    notify('Failed to start background tracking: ' + (err && err.message ? err.message : err), 'danger');
    return false;
  }

  notify('Background tracking plugin detected but API not recognized.', 'warning');
  return false;
}

// stopBackgroundTracking()
async function stopBackgroundTracking() {
  const found = _findBgPlugin();
  if (!found) {
    notify('Background tracking not available in browser.', 'warning');
    return false;
  }

  try {
    if (found.type === 'capacitor') {
      await found.plugin.stop();
      notify('Background tracking stopped', 'info');
      return true;
    } else if (found.type === 'cordova') {
      if (found.plugin.stop) {
        found.plugin.stop();
        notify('Background tracking stopped', 'info');
        return true;
      }
    }
  } catch (err) {
    console.error('Failed to stop background tracking', err);
    notify('Failed to stop background tracking: ' + (err && err.message ? err.message : err), 'danger');
    return false;
  }

  notify('Background tracking plugin detected but stop API not recognized.', 'warning');
  return false;
}

// onBackgroundLocation(cb) -> subscribe to native location events
function onBackgroundLocation(cb) {
  const found = _findBgPlugin();
  if (!found) {
    console.warn('Background plugin not available; onBackgroundLocation is a no-op in browser.');
    return () => {};
  }

  if (found.type === 'capacitor') {
    if (found.plugin.addListener) {
      const subscription = found.plugin.addListener('location', (data) => {
        cb(data);
      });
      return () => { try { subscription.remove(); } catch(e) {} };
    }
  } else if (found.type === 'cordova') {
    if (found.plugin.on) {
      // TransistorSoft plugin: bgGeo.on('location', fn)
      found.plugin.on('location', cb, function(err) { console.error('bg on location err', err); });
      return () => { try { found.plugin.off && found.plugin.off('location'); } catch(e) {} };
    }
    if (found.plugin.watchPosition) {
      // fallback: watchPosition returns an id
      const id = found.plugin.watchPosition(cb);
      return () => { try { found.plugin.clearWatch(id); } catch(e) {} };
    }
  }

  console.warn('Background plugin detected but no compatible subscription API found.');
  return () => {};
}


function formatLengthForSettings(meters) {
  const settings = getUserSettings();
  const units = settings.units || 'metric';
  if (units === 'imperial') {
    // convert to miles
    const miles = meters / 1609.344;
    if (miles >= 0.1) {
      return miles.toFixed(2) + ' mi';
    } else {
      // show feet
      const feet = meters * 3.28084;
      return Math.round(feet) + ' ft';
    }
  } else if (units === 'both') {
    // show both km and miles, always show km with 2 decimals and miles with 2 decimals
    const km = (meters / 1000);
    const mi = (meters / 1609.344);
    return km.toFixed(2) + ' km / ' + mi.toFixed(2) + ' mi';
  } else {
    // metric
    if (meters >= 1000) {
      return (meters / 1000).toFixed(2) + ' km';
    } else {
      return Math.round(meters) + ' m';
    }
  }
}

// Show Fetch Route card
fetchBtn.addEventListener("click", () => {
  fetchCard.style.display = "block";
});

// Cancel Fetch
cancelFetchBtn.addEventListener("click", () => {
  fetchCard.style.display = "none";
});

// Load Route
loadRouteBtn.addEventListener("click", () => {
  const selectedFile = routeSelect.value;
  if (!selectedFile) {
    alert("Please select a route.");
    return;
  }
  // remove any existing route layer
  if (currentRouteLayer) {
    try { map.removeLayer(currentRouteLayer); } catch (e) {}
    currentRouteLayer = null;
  }

  try {
    currentRouteLayer = new L.GPX(selectedFile, {
      async: true,
      marker_options: { startIconUrl: null, endIconUrl: null, shadowUrl: null },
      polyline_options: { color: "purple", weight: 4 }
    })
      .on("loaded", (e) => {
        map.fitBounds(e.target.getBounds());
        const routeName = routeSelect.options[routeSelect.selectedIndex].text || selectedFile;

        // compute approximate length from polyline(s) in meters
        try {
          let totalMeters = 0;
          // Leaflet-GPX stores tracks as polylines inside the layer
          e.target.getLayers && e.target.getLayers().forEach(layer => {
            if (layer instanceof L.Polyline) {
              const latlngs = layer.getLatLngs();
              for (let i = 1; i < latlngs.length; i++) {
                totalMeters += latlngs[i-1].distanceTo(latlngs[i]);
              }
            }
          });

          // format length according to user settings (metric/imperial)
          const meters = totalMeters;
          const lengthText = formatLengthForSettings(meters);

          // determine midpoint for label placement (use first polyline midpoint)
          let midLatLng = null;
          e.target.getLayers && e.target.getLayers().some(layer => {
            if (layer instanceof L.Polyline) {
              const pts = layer.getLatLngs();
              if (pts.length) {
                midLatLng = pts[Math.floor(pts.length/2)];
                return true;
              }
            }
            return false;
          });

          // remove previous label if present
          if (currentRouteLabel) {
            try { map.removeLayer(currentRouteLabel); } catch (ex) {}
            currentRouteLabel = null;
          }

          if (midLatLng) {
            const html = `<div class="route-label">${routeName}<span class="small">${lengthText}</span></div>`;
            const icon = L.divIcon({ className: 'route-label-icon', html, iconSize: [120, 40] });
            currentRouteLabel = L.marker(midLatLng, { icon, interactive: false }).addTo(map);
          }

        } catch (err) {
          console.warn('Failed to compute route length/label', err);
        }

  notify("Route loaded: " + routeName + " — " + lengthText, "success");
      })
      .on("error", (err) => {
        console.error("GPX load error", err);
  notify("Failed to load GPX route.", "danger");
      })
      .addTo(map);

    // Hide card after initiating load
  fetchCard.style.display = "none";
  } catch (ex) {
    console.error("Error creating GPX layer", ex);
    showToast("Failed to add route to map.", "danger");
  }
});