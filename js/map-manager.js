// Map Management Module
class MapManager {
  constructor() {
    this.map = null;
    this.activeHistoryPolyline = null;
    this.currentRouteLayer = null;
    this.currentRouteLabel = null;
    this.init();
  }

  init() {
    this.initializeMap();
    this.setupMapHandlers();
  }

  initializeMap() {
    // Initialize map
    this.map = L.map('map').setView([37.779, -121.984], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(this.map);
  }

  setupMapHandlers() {
    const historyBtn = document.getElementById("history");
    const routeList = document.getElementById("routeList");
    const fetchBtn = document.getElementById("fetchBtn");
    const fetchCard = document.getElementById("fetchRouteCard");
    const routeSelect = document.getElementById("routeSelect");
    const loadRouteBtn = document.getElementById("loadRoute");
    const cancelFetchBtn = document.getElementById("cancelFetch");

    if (!historyBtn) return;

    // Populate history list only when dropdown opens
    historyBtn.addEventListener("shown.bs.dropdown", async () => {
      await this.populateHistoryList();
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
      this.loadPreloadedRoute();
    });
  }

  async populateHistoryList() {
    const routeList = document.getElementById("routeList");
    routeList.innerHTML = ""; // Clear list each time dropdown opens

    const keys = await localforage.keys();

    // Add "Exit history view" if a route is currently being displayed
    if (this.activeHistoryPolyline) {
      const li = document.createElement("li");
      li.innerHTML = `<button class="dropdown-item text-danger" id="exitHistory">Exit history view</button>`;
      routeList.appendChild(li);

      document.getElementById("exitHistory").addEventListener("click", () => {
        this.map.removeLayer(this.activeHistoryPolyline);
        this.activeHistoryPolyline = null;
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

        if (this.activeHistoryPolyline) this.map.removeLayer(this.activeHistoryPolyline);
        this.activeHistoryPolyline = L.polyline(coordinates, { color: "red" }).addTo(this.map);

        this.map.fitBounds(this.activeHistoryPolyline.getBounds());
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
  }

  loadPreloadedRoute() {
    const routeSelect = document.getElementById("routeSelect");
    const fetchCard = document.getElementById("fetchRouteCard");
    const selectedFile = routeSelect.value;
    
    if (!selectedFile) {
      alert("Please select a route.");
      return;
    }
    
    // Remove any existing route layer
    if (this.currentRouteLayer) {
      try { this.map.removeLayer(this.currentRouteLayer); } catch (e) {}
      this.currentRouteLayer = null;
    }

    try {
      this.currentRouteLayer = new L.GPX(selectedFile, {
        async: true,
        marker_options: { startIconUrl: null, endIconUrl: null, shadowUrl: null },
        polyline_options: { color: "purple", weight: 4 }
      })
        .on("loaded", (e) => {
          this.map.fitBounds(e.target.getBounds());
          const routeName = routeSelect.options[routeSelect.selectedIndex].text || selectedFile;

          // Compute approximate length from polyline(s) in meters
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

            // Format length according to user settings (metric/imperial)
            const meters = totalMeters;
            const lengthText = formatLengthForSettings(meters);

            // Determine midpoint for label placement (use first polyline midpoint)
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

            // Remove previous label if present
            if (this.currentRouteLabel) {
              try { this.map.removeLayer(this.currentRouteLabel); } catch (ex) {}
              this.currentRouteLabel = null;
            }

            if (midLatLng) {
              const html = `<div class="route-label">${routeName}<span class="small">${lengthText}</span></div>`;
              const icon = L.divIcon({ className: 'route-label-icon', html, iconSize: [120, 40] });
              this.currentRouteLabel = L.marker(midLatLng, { icon, interactive: false }).addTo(this.map);
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
        .addTo(this.map);

      // Hide card after initiating load
      fetchCard.style.display = "none";
    } catch (ex) {
      console.error("Error creating GPX layer", ex);
      showToast("Failed to add route to map.", "danger");
    }
  }

  loadGPXRoute(url) {
    if (this.currentRouteLayer) { 
      try { this.map.removeLayer(this.currentRouteLayer); } catch(e) {} 
      this.currentRouteLayer = null; 
    }
    
    this.currentRouteLayer = new L.GPX(url, { 
      async: true,
      marker_options: { startIconUrl: null, endIconUrl: null, shadowUrl: null },
      polyline_options: { color: "green", weight: 4 }
    })
    .on('loaded', e => { 
      this.map.fitBounds(e.target.getBounds()); 
      notify("User route loaded", "success");
    })
    .on('error', err => {
      console.error("GPX load error", err);
      notify("Failed to load user route", "danger");
    })
    .addTo(this.map);
  }
}

// Initialize map manager when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.mapManager = new MapManager();
});
