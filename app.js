let map = L.map('map').setView([37.779, -121.984], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

let watchId = null;
let ridecoord = [];
let ridePolyline = null;
let currentMarker = null;
let currentRouteLayer = null;

// Buttons
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const historyBtn = document.getElementById("history");
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
        alert("Error getting location: " + error.message);
      }
    );

    startBtn.disabled = true;
    stopBtn.disabled = false;
  } else {
    alert("Geolocation is not supported by this browser.");
  }
});

// Stop tracking + save
stopBtn.addEventListener("click", async () => {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;

    if (ridecoord.length > 0) {
      const timestamp = new Date().toISOString();
      await localforage.setItem(timestamp, ridecoord);
      alert("Route saved: " + timestamp);
    }
  }
  stopBtn.disabled = true;
  startBtn.disabled = false;
});

// History toggle
historyBtn.addEventListener("click", async () => {
  const dropdown = document.getElementById("routeList");

  // Toggle open/close
  if (dropdown.childElementCount > 0) {
    dropdown.innerHTML = "";
    return;
  }

  const keys = await localforage.keys();
  if (keys.length === 0) {
    alert("No saved routes found.");
    return;
  }

  for (const key of keys) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "dropdown-item";
    // Format timestamp into a readable label
    const date = new Date(key);
    const formatted = date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
    btn.textContent = formatted;
    btn.onclick = async () => {
      if (currentRouteLayer) map.removeLayer(currentRouteLayer);
      const coordinates = await localforage.getItem(key);
      currentRouteLayer = L.polyline(coordinates, { color: "red" }).addTo(map);
      map.fitBounds(currentRouteLayer.getBounds());
    };
    li.appendChild(btn);
    dropdown.appendChild(li);
  }
});

// Reset cache
resetBtn.addEventListener("click", async () => {
  await localforage.clear();
  if (currentRouteLayer) {
    map.removeLayer(currentRouteLayer);
    currentRouteLayer = null;
  }
  if (ridePolyline) {
    map.removeLayer(ridePolyline);
    ridePolyline = null;
  }
  if (currentMarker) {
    map.removeLayer(currentMarker);
    currentMarker = null;
  }
  alert("Cache cleared and map reset!");
});

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

  if (currentRouteLayer) map.removeLayer(currentRouteLayer);

  currentRouteLayer = new L.GPX(selectedFile, {
    async: true,
    marker_options: { startIconUrl: null, endIconUrl: null, shadowUrl: null },
    polyline_options: { color: "purple", weight: 4 }
  }).on("loaded", (e) => {
    map.fitBounds(e.target.getBounds());
  }).addTo(map);

  // Hide card after loading
  fetchCard.style.display = "none";
});
