let map = L.map('map').setView([37.779, -121.984], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

let tracking = false;
let watchId = null;
let route = [];
let routeLine = null;
let ridecoord = [];
let ridePolyline = null;
let currentMarker = null;

document.getElementById('start').onclick = () => {
    ridecoord = [];
    if (navigator.geolocation) {

        watchId = navigator.geolocation.watchPosition(position => {
            const latlng = [position.coords.latitude, position.coords.longitude];
            if (ridePolyline) {
                map.removeLayer(ridePolyline);
            }
            if (currentMarker) {
                map.removeLayer(currentMarker);
            }
            currentMarker = L.marker(latlng).addTo(map);
            ridecoord.push(latlng);
            if (!ridePolyline) {
                ridePolyline = L.polyline(ridecoord, { color: 'blue' }).addTo(map);

            } else {
                ridePolyline.setLatLngs(ridecoord);
            }
            map.panTo(latlng);
        }, error => {
            console.error("Error getting location: ", error);
            print("Error getting location: " + error.message);
        }
        );
    } else {
        alert("Geolocation is not supported by this browser.");
    }
}
document.getElementById('stop').addEventListener("click",async () => {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        console.log("Tracking stopped.");

        // Optionally, save the route to localForage for history
        if (ridecoord.length > 0) {
            const timestamp = new Date().toISOString();
            await localforage.setItem(timestamp, ridecoord);
            alert("Route saved with timestamp: ", timestamp);
        }
    } else {
        console.log("No active tracking to stop.");
    }
});
document.getElementById('history').addEventListener("click",async () => {
    const keys = await localforage.keys();
    console.log(keys);
    if (keys.length === 0) {
        alert("No saved routes found.");
        return;
    }
    keys.forEach(async key => {
        const coordinates = await localforage.getItem(key);
        const routeLine = L.polyline(coordinates, { color: 'red' }).addTo(map);
        
    });
    alert(keys.length + " routes loaded from history.");
});
