let map = L.map('map').setView([37.779, -121.984], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

let watchId = null;
let ridecoord = [];
let ridePolyline = null;
let currentMarker = null;

// Button references
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const historyBtn = document.getElementById("history");

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

        // Remove old marker/polyline if needed
        if (ridePolyline) {
          map.removeLayer(ridePolyline);
        }
        if (currentMarker) {
          map.removeLayer(currentMarker);
        }

        // Add new marker + update route
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
        alert("Error getting location: " + error.message);
      }
    );

    // Toggle button states
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } else {
    alert("Geolocation is not supported by this browser.");
  }
});

// Stop tracking + save route
stopBtn.addEventListener("click", async () => {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    console.log("Tracking stopped.");

    if (ridecoord.length > 0) {
      const timestamp = new Date().toISOString();
      await localforage.setItem(timestamp, ridecoord);
      alert("Route saved with timestamp: " + timestamp);
    }
  } else {
    console.log("No active tracking to stop.");
  }

  // Toggle button states
  stopBtn.disabled = true;
  startBtn.disabled = false;
});

// Show history routes
historyBtn.addEventListener("click", async () => {
  const keys = await localforage.keys();

  if (keys.length === 0) {
    alert("No saved routes found.");
    return;
  }

  for (const key of keys) {
    const coordinates = await localforage.getItem(key);
    L.polyline(coordinates, { color: "red" }).addTo(map);
  }

  alert(keys.length + " routes loaded from history.");

  document.getElementById("reset").addEventListener("click", async () => {
    await localforage.clear();
    alert("All saved routes cleared!");
});

});
