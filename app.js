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

// Button references
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const historyBtn = document.getElementById("history");
const routeList = document.getElementById("routeList");
const resetBtn = document.getElementById("reset");

// Initial state
startBtn.disabled = false;
stopBtn.disabled = true;

// Start tracking
startBtn.addEventListener("click", () => {
  ridecoord = [];
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
    showToast("Started tracking!", "success");
  } else {
    showToast("Geolocation is not supported by this browser.", "warning");
  }
});

// Stop tracking + save route
stopBtn.addEventListener("click", async () => {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;

    if (ridecoord.length > 0) {
      const timestamp = new Date().toISOString();
      await localforage.setItem(timestamp, ridecoord);
      showToast("Route saved at " + timestamp, "success");
    }
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
      showToast("Exited history view.", "secondary");
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

  keys.forEach((key) => {
    const date = new Date(key);
    const label = date.toLocaleDateString() + " " + date.toLocaleTimeString();

    const li = document.createElement("li");
    li.innerHTML = `<button class="dropdown-item" data-key="${key}">${label}</button>`;
    routeList.appendChild(li);
  });

  // Attach click handlers to each route
  routeList.querySelectorAll("button[data-key]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const key = btn.getAttribute("data-key");
      const coordinates = await localforage.getItem(key);

      if (activeHistoryPolyline) map.removeLayer(activeHistoryPolyline);
      activeHistoryPolyline = L.polyline(coordinates, { color: "red" }).addTo(map);

      map.fitBounds(activeHistoryPolyline.getBounds());
      showToast("Showing route from " + btn.textContent, "info");
    });
  });
});

// Optional: show toast when dropdown closes
historyBtn.addEventListener("hidden.bs.dropdown", () => {
  showToast("Closed history view.", "secondary");
});

  routeList.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const key = btn.getAttribute("data-key");
      const coordinates = await localforage.getItem(key);

      if (activeHistoryPolyline) map.removeLayer(activeHistoryPolyline);
      activeHistoryPolyline = L.polyline(coordinates, { color: "red" }).addTo(map);

      map.fitBounds(activeHistoryPolyline.getBounds());
      showToast("Showing route from " + btn.textContent, "info");
    });
  });

// Reset cache
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
  showToast("Cache cleared and map reset!", "warning");
});

// ✅ Toast function
function showToast(message, type = "primary") {
  const toastBox = document.getElementById("toastBox");
  const toastMessage = document.getElementById("toastMessage");

  toastMessage.textContent = message;
  toastBox.className = `toast align-items-center text-bg-${type} border-0`;

  const toast = new bootstrap.Toast(toastBox, { delay: 2000 });
  toast.show();
}
