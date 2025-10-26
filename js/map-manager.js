// Map Management Module
class MapManager {
  constructor() {
    this.map = null;
    this.activeHistoryPolyline = null;
    this.currentRouteLayer = null;
    this.currentRoutePolylines = []; // array of arrays of LatLngs
    this.currentRouteName = null;
    this.tracing = false;
    this.tracePolyline = null;
    this.traceMarker = null;
    this._routePointCovered = new Set(); // store covered indices as strings 'polyIdx:ptIdx'
    this._routeTotalPoints = 0;
    this._progressPercent = 0;
    this.currentRouteLabel = null;
    this.positionWatchId = null;
    this.routePins = new Map(); // store route pins by filename
    // Intercept any attempts to load the default GPX waypoint image 'pin-icon-wpt.png'
    // and rewrite them to use the project's `images/trail_marker.png` instead.
    // This prevents 404s when external code/plugin tries to fetch the missing asset.
    try {
      const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      if (desc && desc.set) {
        const originalSetter = desc.set;
        Object.defineProperty(HTMLImageElement.prototype, 'src', {
          set: function(value) {
            try {
              if (typeof value === 'string' && value.indexOf('pin-icon-wpt.png') !== -1) {
                value = 'images/trail_marker.png';
              }
            } catch (e) { /* ignore */ }
            return originalSetter.call(this, value);
          },
          get: desc.get,
          configurable: true,
          enumerable: true
        });
      }
    } catch (e) { console.warn('Failed to patch Image.src to rewrite pin-icon-wpt.png', e); }

    this.init();
  }

  // Remove the currently loaded route from the map and reset related state
  exitCurrentRoute() {
    try {
      // Stop position monitoring first
      this.stopPositionMonitoring();
      
      // If a legacy routeLoadedModal exists, hide it (safe no-op if missing)
      try {
        const modalEl = document.getElementById('routeLoadedModal');
        if (modalEl) {
          const bs = bootstrap.Modal.getInstance(modalEl);
          if (bs) bs.hide();
        }
      } catch (e) {}

      // Clear route layers
      if (this.currentRouteLayer) {
        try { this.map.removeLayer(this.currentRouteLayer); } catch(e) {}
        this.currentRouteLayer = null;
      }
      if (this.currentRouteLabel) {
        try { this.map.removeLayer(this.currentRouteLabel); } catch(e) {}
        this.currentRouteLabel = null;
      }

      // Stop tracing and clear visualization
      this._stopTracing();

      // Reset all route state
      this.currentRoutePolylines = [];
      this.currentRouteName = null;
      this._routePointCovered = new Set();
      this._routeTotalPoints = 0;
      this._progressPercent = 0;
      this._updateProgressUI();

      // Hide the trail controls if they're visible
      const trailControls = document.getElementById('trailControls');
      if (trailControls) trailControls.style.display = 'none';

      // Make sure all route pins are visible
      this.addAllRoutePins();

    } catch (err) {
      console.warn('exitCurrentRoute failed', err);
    }
  }

  // Start tracing using the currently loaded route geometry
  startTracingFromLoadedRoute() {
    if (!this.currentRoutePolylines || this.currentRoutePolylines.length === 0) {
      notify('No route loaded to start tracing', 'warning');
      return;
    }
    this._startTracing();
  }

  // Populate routeSelect with user uploaded routes (from Supabase storage public URLs)
  async _populateRouteSelectWithUserRoutes() {
    const select = document.getElementById('routeSelect');
    if (!select) return;

    // First remove any previous user-uploaded optgroup
    const existing = select.querySelector('optgroup[data-userroutes]');
    if (existing) existing.remove();

    try {
      const sup = window.SupabaseConfig?.getSupabase && window.SupabaseConfig.getSupabase();
      if (!sup) return; // no supabase available, nothing to add

      const user = await window.authManager.getCurrentUser();
      if (!user) return; // not signed in

      const { data: rows, error } = await sup.from('user_routes').select('id,name,public_url').eq('user_id', user.id).order('created_at', { ascending: false });
      if (error || !rows || rows.length === 0) return;

      const og = document.createElement('optgroup');
      og.label = 'Your uploaded routes';
      og.setAttribute('data-userroutes', '1');

      for (const r of rows) {
        const opt = document.createElement('option');
        opt.value = r.public_url || r.path || '';
        opt.textContent = r.name || ('Uploaded route ' + r.id);
        og.appendChild(opt);
      }

      select.appendChild(og);
    } catch (err) {
      console.warn('Failed to load user routes', err);
    }
  }

  init() {
    this.initializeMap();
    this.setupMapHandlers();
  }

  initializeMap() {
    // Initialize map
    this.map = L.map('map').setView([37.779, -121.984], 13);

    // Add tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(this.map);

    // Add pins once the map is ready
    this.map.whenReady(() => {
      this.addAllRoutePins();
    });
  }

  // Calculate the midpoint between two coordinates
  _calculateMidpoint(coord1, coord2) {
    return [
      (coord1[0] + coord2[0]) / 2,
      (coord1[1] + coord2[1]) / 2
    ];
  }

  // Create a custom pin icon
  _createPinIcon() {
    return L.icon({
      iconUrl: 'images/route_pin.png',
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32],
      className: 'route-pin-icon'  // Add a custom class for styling
    });
  }

  // Create a custom trail marker icon with identical configuration to route pin
  _createTrailMarkerIcon() {
    return L.icon({
      iconUrl: 'images/trail_marker.png',
      iconSize: [32, 32],        // Width and height
      iconAnchor: [16, 32],      // Point of the icon which corresponds to marker's location (bottom center)
      popupAnchor: [0, -32],     // Point from which popups should open relative to iconAnchor
      className: 'route-pin-icon' // Use same class as route pin for consistent rendering
    });
  }

  // Add a pin for a route
  async addRoutePin(routeFile) {
    try {
      // Extract just the filename if a full path is provided
      const filename = routeFile.split('/').pop();
      
      const response = await fetch(`preloaded_routes/${filename}`);
      const gpxStr = await response.text();
      const parser = new DOMParser();
      const gpx = parser.parseFromString(gpxStr, 'text/xml');
      
      // Get all track points
      const points = Array.from(gpx.getElementsByTagName('trkpt'));
      
        if (points.length >= 2) {
          // Convert all points to coordinates
          const coords = points.map(point => [
            parseFloat(point.getAttribute('lat')),
            parseFloat(point.getAttribute('lon'))
          ]);
          
          // Use the starting point of the trail for the pin (first track point)
          const midpoint = coords[0];
          // Create pin marker
        const marker = L.marker(midpoint, {
          icon: this._createPinIcon()
        });
        
        // Add click handler
        marker.on('click', () => {
          // If the route is already loaded, remove it
          if (this.currentRouteLayer && this.currentRouteName === routeName) {
            this.exitCurrentRoute();
            return;
          }
          
          // Remove any existing different route first
          this.exitCurrentRoute();
          
          // Load the route directly without going through route selector
          if (this.currentRouteLayer) {
            try { this.map.removeLayer(this.currentRouteLayer); } catch (e) {}
            this.currentRouteLayer = null;
          }
          
          this.currentRouteLayer = new L.GPX(`preloaded_routes/${filename}`, {
            async: true,
            marker_options: { startIconUrl: null, endIconUrl: null, shadowUrl: null, wptIconUrl: 'images/trail_marker.png' },
            polyline_options: { color: "purple", weight: 4 }
          })
            .on("loaded", (e) => {
              this.map.fitBounds(e.target.getBounds());
              
              // Compute length from polyline(s) in meters
              let totalMeters = 0;
              e.target.getLayers().forEach(layer => {
                if (layer instanceof L.Polyline) {
                  const latlngs = layer.getLatLngs();
                  for (let i = 1; i < latlngs.length; i++) {
                    totalMeters += latlngs[i-1].distanceTo(latlngs[i]);
                  }
                }
              });

              // Format length and store for access
              window.lengthText = formatLengthForSettings(totalMeters);
              
              // Store route geometry for tracing/auto-join
              this.currentRoutePolylines = [];
              e.target.getLayers().forEach(layer => {
                if (layer instanceof L.Polyline) {
                  const latlngs = layer.getLatLngs();
                  const flat = [].concat(...latlngs.map(l => Array.isArray(l) ? l : [l]));
                  if (flat && flat.length) this.currentRoutePolylines.push(flat);
                }
              });
              
              this.currentRouteName = routeName;
              this._routePointCovered = new Set();
              this._routeTotalPoints = this.currentRoutePolylines.reduce((sum, p) => sum + (p ? p.length : 0), 0);
              this._progressPercent = 0;
              this._updateProgressUI();

              // Add route label
              if (this.currentRouteLabel) {
                try { this.map.removeLayer(this.currentRouteLabel); } catch (ex) {}
                this.currentRouteLabel = null;
              }

              // Get the starting point of the route (where the pin is)
              const startPoint = e.target.getLayers().find(layer => 
                layer instanceof L.Polyline
              )?.getLatLngs()[0];

              if (startPoint) {
                const html = `
                  <div class="route-label card">
                    <div class="card-body p-2 text-center">
                      <strong class="d-block">${routeName}</strong>
                      <span class="small text-body-secondary">${window.lengthText}</span>
                    </div>
                  </div>
                `;
                const icon = L.divIcon({ 
                  className: 'route-label-icon', 
                  html, 
                  iconSize: [200, 70],  // Size for the label
                  iconAnchor: [100, -35] // Center horizontally, place below pin (pin is 32px tall)
                });
                this.currentRouteLabel = L.marker(startPoint, { icon, interactive: false }).addTo(this.map);
              }

              notify("Route loaded: " + routeName + " — " + window.lengthText, "success");
            })
            .on("error", (err) => {
              console.error("GPX load error", err);
              notify("Failed to load GPX route.", "danger");
            })
            .addTo(this.map);
        });
        
        // Format the route name to be more descriptive
        const formatRouteName = (filename) => {
          // Remove .gpx extension
          let name = filename.replace('.gpx', '');
          
          // Special case mappings for known routes
          const routeMappings = {
            'artistpoint': 'Artist Point - Alpine Vista Trail',
            'blackhawkhikingloop': 'Blackhawk - Ridge Hiking Trail',
            'christianityspireloop': 'Christianity Spire - Scenic Loop',
            'coloradoriverloop': 'Colorado River - Scenic Loop Trail',
            'crescentglacierloop': 'Crescent Glacier - Alpine Loop',
            'devilsgardenloop': 'Devils Garden - Desert Loop Trail',
            'doughertyvalleyloop': 'Dougherty Valley - Valley View Trail',
            'doughtyfalls': 'Doughty Falls - Waterfall Trail',
            'gumbolimbo': 'Gumbo Limbo - Nature Trail',
            'ironhorse': 'Iron Horse - Historic Railway Trail',
            'laddercanyon': 'Ladder Canyon - Desert Adventure',
            'lafayetteloop': 'Lafayette - Rolling Hills Loop',
            'lastrampascorralcamp': 'Las Trampas - Corral Camp Loop',
            'livermoreloop': 'Livermore - Valley Vista Trail',
            'melakwalake': 'Melakwa Lake - Alpine Lake Trail',
            'middleteton': 'Middle Teton - Mountain Ascent',
            'mountdiabloloop': 'Mount Diablo - Summit Loop Trail',
            'pleasantonridge': 'Pleasanton Ridge - Bay Area Vista',
            'quandarypeak': 'Quandary Peak - Mountain Summit',
            'rockcityloop': 'Rock City - Boulder Trail Loop',
            'sentinelrock': 'Sentinel Rock - Overlook Trail',
            'tahoerimtrail': 'Tahoe Rim - Scenic Mountain Trail',
            'tassahararidge': 'Tassajara Ridge - Valley View Loop',
            'wallpointsummitstaircaseloop': 'Wall Point - Summit Staircase Loop',
            'washingtoncommonwealthtrail': 'Washington Commonwealth - Historic Trail'
          };

          // If we have a special mapping, use it
          if (routeMappings[name.toLowerCase()]) {
            return routeMappings[name.toLowerCase()];
          }

          // For other files, format nicely with categories based on name
          return name
            // Split on hyphens, underscores, and spaces
            .split(/[-_\s]/)
            // Capitalize each word
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ')
            // Add appropriate categories based on keywords
            .replace(/ Loop( Trail)?$/, ' - Scenic Loop Trail')
            .replace(/ Peak( Trail)?$/, ' - Mountain Summit Trail')
            .replace(/ Lake( Trail)?$/, ' - Lake View Trail')
            .replace(/ via /, ' via ')  // Keep "via" lowercase if not at start
            .replace(/^Via /, 'Via ');  // Keep "Via" capitalized at start
        };

        const routeName = formatRouteName(filename);
        const gpx = new L.GPX(`preloaded_routes/${filename}`, {
          async: true,
          marker_options: { startIconUrl: null, endIconUrl: null, shadowUrl: null, wptIconUrl: 'images/trail_marker.png' },
          polyline_options: { weight: 3, color: '#666', opacity: 0.75 }
        });
        
        gpx.once('loaded', (e) => {
          try {
            // Calculate route length
            let totalMeters = 0;
            e.target.getLayers().forEach(layer => {
              if (layer instanceof L.Polyline) {
                const latlngs = layer.getLatLngs();
                // Handle both flat and nested arrays of coordinates
                const flatLatLngs = latlngs.every(l => l instanceof L.LatLng) ? 
                  latlngs : 
                  [].concat(...latlngs);
                
                for (let i = 1; i < flatLatLngs.length; i++) {
                  const dist = L.latLng(flatLatLngs[i-1]).distanceTo(L.latLng(flatLatLngs[i]));
                  if (!isNaN(dist)) {
                    totalMeters += dist;
                  }
                }
              }
            });
            
            // Format length according to user settings
            const lengthText = formatLengthForSettings(totalMeters);
            
            // Update popup content with route details
            const popupContent = `
              <div class="route-popup">
                <h5>${routeName}</h5>
                <p>Length: ${lengthText}</p>
                <button class="btn btn-primary btn-sm" onclick="window.mapManager.loadRouteFromPin('${routeFile}')">Load Route</button>
              </div>
            `;
            marker.setPopupContent(popupContent);
          } catch (err) {
            console.warn('Failed to compute route details for popup', err);
            marker.setPopupContent(`${routeName}<br><button class="btn btn-primary btn-sm" onclick="window.mapManager.loadRouteFromPin('${routeFile}')">Load Route</button>`);
          }
        });

        // Initial popup content while calculating details
        marker.bindPopup(`${routeName}<br>Loading route details...`);
        
        // Add to map and store reference
        marker.addTo(this.map);
        this.routePins.set(routeFile, marker);
      }
    } catch (error) {
      console.warn(`Failed to add pin for route ${routeFile}:`, error);
    }
  }

  // Add pins for all preloaded routes
  async addAllRoutePins() {
    try {
      const preloadedRoutes = [
        'artistpoint.gpx',
        'blackhawkhikingloop.gpx',
        'christianityspireloop.gpx',
        'coloradoriverloop.gpx',
        'crescentglacierloop.gpx',
        'devilsgardenloop.gpx',
        'doughertyvalleyloop.gpx',
        'doughtyfalls.gpx',
        'gumbolimbo.gpx',
        'ironhorse.gpx',
        'laddercanyon.gpx',
        'lafayetteloop.gpx',
        'lastrampascorralcamp.gpx',
        'livermoreloop.gpx',
        'melakwalake.gpx',
        'middleteton.gpx',
        'mountdiabloloop.gpx',
        'pleasantonridge.gpx',
        'quandarypeak.gpx',
        'rockcityloop.gpx',
        'sentinelrock.gpx',
        'tahoerimtrail.gpx',
        'tassahararidge.gpx',
        'wallpointsummitstaircaseloop.gpx',
        'washingtoncommonwealthtrail.gpx'
      ];
      
      // Clear existing pins first
      this.clearRoutePins();
      
      // Add a pin for each preloaded route
      for (const route of preloadedRoutes) {
        await this.addRoutePin(route);
      }
    } catch (error) {
      console.warn('Failed to add route pins:', error);
    }
  }

  // Remove all route pins from the map
  clearRoutePins() {
    for (const marker of this.routePins.values()) {
      this.map.removeLayer(marker);
    }
    this.routePins.clear();
  }

  setupMapHandlers() {
    const historyBtn = document.getElementById("history");
    const routeList = document.getElementById("routeList");
    const fetchBtn = document.getElementById("fetchBtn");
    const fetchCard = document.getElementById("fetchRouteCard");
    const routeSelect = document.getElementById("routeSelect");
    const loadRouteBtn = document.getElementById("loadRoute");
    const cancelFetchBtn = document.getElementById("cancelFetch");
    const endTrailBtn = document.getElementById('endTrailBtn');

    if (!historyBtn) return;

    // Add route pins when map is loaded
    this.map.whenReady(() => {
      this.addAllRoutePins();
    });    // Populate history list only when dropdown opens
    historyBtn.addEventListener("shown.bs.dropdown", async () => {
      await this.populateHistoryList();
    });

    // Show Fetch Route card
    fetchBtn.addEventListener("click", async () => {
      // Populate uploaded/user routes into selector before showing
      try { await this._populateRouteSelectWithUserRoutes(); } catch(e) { console.warn('populate user routes failed', e); }
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

    if (endTrailBtn) {
      endTrailBtn.addEventListener('click', () => {
        // Stop tracing and clear the map
        this._stopTracing();
        
        // Hide controls
        const trailControls = document.getElementById('trailControls');
        if (trailControls) trailControls.style.display = 'none';

        // Clear route if it exists
        if (this.currentRouteLayer) {
          try { 
            this.map.removeLayer(this.currentRouteLayer);
            this.currentRouteLayer = null;
          } catch(e) {}
        }
        
        // Reset state
        this.currentRoutePolylines = [];
        this.currentRouteName = null;
        this._routePointCovered = new Set();
        this._routeTotalPoints = 0;
        this._progressPercent = 0;
        this._updateProgressUI();
      });
    }
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
        marker_options: { 
          startIconUrl: null, 
          endIconUrl: null, 
          shadowUrl: null,
          wptIcons: false  // Disable default waypoint icons
        },
        waypoints: true,  // Still parse waypoints
        polyline_options: { color: "purple", weight: 4 }
      })
        .on("loaded", (e) => {
          // Add custom markers for waypoints after GPX loads
          const trailIcon = this._createTrailMarkerIcon();
          e.target.getLayers().forEach(layer => {
            if (layer instanceof L.Marker) {
              layer.setIcon(trailIcon);
            }
          });
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
            window.lengthText = formatLengthForSettings(meters); // Store in window for access throughout the load handler

            // Get starting point for label placement (same as pin location)
            let startPoint = null;
            e.target.getLayers && e.target.getLayers().some(layer => {
              if (layer instanceof L.Polyline) {
                const pts = layer.getLatLngs();
                if (pts.length) {
                  startPoint = pts[0]; // Use the first point of the route
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

            if (startPoint) {
              // Use the globally-set window.lengthText (set above) as a reliable source
              const displayLength = (window.lengthText || '');
              // Use the same card markup used when loading via pin so CSS styles apply
              const html = `
                <div class="route-label card">
                  <div class="card-body p-2 text-center">
                    <strong class="d-block">${routeName}</strong>
                    <span class="small text-body-secondary">${displayLength}</span>
                  </div>
                </div>
              `;
              const icon = L.divIcon({ 
                className: 'route-label-icon', 
                html, 
                iconSize: [200, 70],
                iconAnchor: [100, -35] // Align with the other label positioning
              });
              this.currentRouteLabel = L.marker(startPoint, { icon, interactive: false }).addTo(this.map);
            }

            // Store route geometry for tracing/auto-join
            try {
              this.currentRoutePolylines = [];
              // Leaflet-GPX stores tracks as polylines inside the layer
              e.target.getLayers && e.target.getLayers().forEach(layer => {
                if (layer instanceof L.Polyline) {
                  const latlngs = layer.getLatLngs();
                  // Normalize nested latlng arrays (in case of multi-dimensional latlngs)
                  const flat = [].concat(...latlngs.map(l => Array.isArray(l) ? l : [l]));
                  if (flat && flat.length) this.currentRoutePolylines.push(flat);
                }
              });
              this.currentRouteName = routeName;
              // compute total points
              this._routePointCovered = new Set();
              this._routeTotalPoints = this.currentRoutePolylines.reduce((sum, p) => sum + (p ? p.length : 0), 0);
              this._progressPercent = 0;
              this._updateProgressUI();
            } catch (err) {
              console.warn('Failed to extract route geometry for tracing', err);
              this.currentRoutePolylines = [];
              this.currentRouteName = routeName;
            }

          } catch (err) {
            console.warn('Failed to compute route length/label', err);
          }

            // lengthText may be undefined in this scope; use window.lengthText as the canonical value
            const lengthStr = (window.lengthText || "Unknown length");
            notify("Route loaded: " + routeName + " — " + lengthStr, "success");

            // No interactive 'route loaded' modal in this build; notify only
            // (If legacy modal elements exist, ignore them.)
            try {
              // nothing to do here beyond notification
            } catch (err) { console.warn('routeLoaded cleanup failed', err); }
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

  // Load a route when clicking the button in a pin's popup
  loadRouteFromPin(routeFile) {
    // Remove any existing route first
    this.exitCurrentRoute();
    
    // Set the route selector value
    const routeSelect = document.getElementById('routeSelect');
    if (routeSelect) {
      routeSelect.value = routeFile;
    }
    
    // Load the route
    this.loadPreloadedRoute();
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
      // Start monitoring position as soon as route is loaded
      this.startPositionMonitoring();
    })
    .on('error', err => {
      console.error("GPX load error", err);
      notify("Failed to load user route", "danger");
      this.stopPositionMonitoring();
    })
    .addTo(this.map);
  }

  // Utility: compute nearest point on a polyline (array of LatLng) to given LatLng
  _nearestPointOnPolyline(latlng, latlngArray) {
    let best = { dist: Infinity, point: null, index: -1 };
    const p = L.latLng(latlng);
    for (let i = 0; i < latlngArray.length - 1; i++) {
      const a = L.latLng(latlngArray[i]);
      const b = L.latLng(latlngArray[i+1]);
      const proj = this._closestPointOnSegment(p, a, b);
      if (!proj) continue;
      const d = p.distanceTo(proj);
      if (d < best.dist) {
        best = { dist: d, point: proj, index: i };
      }
    }
    return best;
  }

  // Helper: compute closest point on segment AB to point P using map projection
  _closestPointOnSegment(p, a, b) {
    try {
      const pPt = this.map.latLngToLayerPoint(p);
      const aPt = this.map.latLngToLayerPoint(a);
      const bPt = this.map.latLngToLayerPoint(b);

      const abx = bPt.x - aPt.x;
      const aby = bPt.y - aPt.y;
      const apx = pPt.x - aPt.x;
      const apy = pPt.y - aPt.y;
      const ab2 = abx * abx + aby * aby;
      let t = 0;
      if (ab2 > 0) t = (apx * abx + apy * aby) / ab2;
      t = Math.max(0, Math.min(1, t));
      const projX = aPt.x + abx * t;
      const projY = aPt.y + aby * t;
      const projPoint = L.point(projX, projY);
      return this.map.layerPointToLatLng(projPoint);
    } catch (err) {
      // fallback: return closest endpoint
      const da = p.distanceTo(a);
      const db = p.distanceTo(b);
      return da < db ? a : b;
    }
  }

  // Check if position is near any route endpoint. thresholdMeters optional (default 30m)
  checkNearEndpoint(latlng, thresholdMeters = 30) {
    if (!this.currentRoutePolylines || this.currentRoutePolylines.length === 0) return null;
    
    try {
      const p = L.latLng(latlng);
      let closestMatch = null;
      let minDist = thresholdMeters;

      for (const poly of this.currentRoutePolylines) {
        if (!poly || poly.length === 0) continue;
        
        const start = L.latLng(poly[0]);
        const end = L.latLng(poly[poly.length - 1]);
        
        const startDist = p.distanceTo(start);
        const endDist = p.distanceTo(end);
        
        if (startDist <= minDist) {
          minDist = startDist;
          closestMatch = { which: 'start', routeName: this.currentRouteName, poly, distance: startDist };
        }
        if (endDist <= minDist) {
          minDist = endDist;
          closestMatch = { which: 'end', routeName: this.currentRouteName, poly, distance: endDist };
        }
      }
      
      // debug: log whether a close endpoint was found
      if (closestMatch) {
        console.debug('checkNearEndpoint: found', closestMatch.which, 'dist=', closestMatch.distance, 'route=', closestMatch.routeName);
      } else {
        console.debug('checkNearEndpoint: none within', thresholdMeters, 'm');
      }
      return closestMatch;
    } catch (err) {
      console.warn('checkNearEndpoint error:', err);
      return null;
    }
  }

  // Start monitoring position for nearby routes
  startPositionMonitoring() {
    if (this.positionWatchId) {
      return; // Already monitoring
    }

    if (navigator.geolocation) {
      const geoOptions = {
        enableHighAccuracy: true,
        maximumAge: 500,
        timeout: 2000
      };

      // Get initial position immediately
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const latlng = [position.coords.latitude, position.coords.longitude];
          const near = this.checkNearEndpoint(latlng, 100);
          if (near) {
            this.showJoinModal(near);
          }
        },
        (error) => console.warn('Error getting initial position:', error),
        geoOptions
      );

      // Then start watching position
      this.positionWatchId = navigator.geolocation.watchPosition(
        (position) => {
          const latlng = [position.coords.latitude, position.coords.longitude];
          if (!this.tracing) {
            const near = this.checkNearEndpoint(latlng, 100);
            if (near) {
              this.showJoinModal(near);
            }
          }
        },
        (error) => console.warn('Position watch error:', error),
        geoOptions
      );
    }
  }

  // Stop position monitoring
  stopPositionMonitoring() {
    if (this.positionWatchId) {
      navigator.geolocation.clearWatch(this.positionWatchId);
      this.positionWatchId = null;
    }
  }

  // Begin tracing: initialize trace polyline and marker
  _startTracing() {
    if (this.tracing) return;
    this.tracing = true;
    
    // Show trail controls
    const trailControls = document.getElementById('trailControls');
    if (trailControls) trailControls.style.display = 'block';
    
    // Initialize trace visualization
    if (this.tracePolyline) try { this.map.removeLayer(this.tracePolyline); } catch(e) {}
    this.tracePolyline = L.polyline([], { color: 'orange', weight: 5, opacity: 0.8 }).addTo(this.map);
    if (this.traceMarker) try { this.map.removeLayer(this.traceMarker); } catch(e) {}
    this.traceMarker = L.circleMarker([0,0], { 
      radius: 8, 
      color: '#ff6600', 
      weight: 2,
      fillColor: '#ff9933',
      fillOpacity: 0.8
    }).addTo(this.map);
    
    // Update progress display
    this._updateProgressUI();
  }

  // Show the Join Trail modal for a given `near` object (which, routeName, poly, distance)
  showJoinModal(near) {
    try {
      const joinModalEl = document.getElementById('joinTrailModal');
      if (!joinModalEl) {
        console.warn('showJoinModal: joinTrailModal element missing');
        return;
      }

      const now = Date.now();
      const lastShown = Number(joinModalEl.getAttribute('data-last-shown') || '0');
      if (now - lastShown < 10000) {
        console.debug('showJoinModal: debounce active');
        return;
      }

      const joinText = document.getElementById('joinTrailText');
      if (joinText) joinText.textContent = `You're close to the ${near.which} of "${near.routeName}". Would you like to join?`;

      try { const ex = bootstrap.Modal.getInstance(joinModalEl); if (ex) { ex.hide(); ex.dispose(); } } catch(e){}
      const modal = new bootstrap.Modal(joinModalEl, { 
        backdrop: true, 
        keyboard: true, 
        focus: false  // Disable automatic focus
      });

      const confirmBtn = document.getElementById('joinTrailConfirm');
      const cancelBtn = document.getElementById('joinTrailCancel');
      if (!confirmBtn || !cancelBtn) { this._startTracing(); return; }

      // Function to properly close modal
      const closeModal = () => {
        // Remove focus from any buttons before hiding
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        modal.hide();
      };

      confirmBtn.onclick = () => {
        try {
          closeModal();
          this._startTracing();
          const snapPoint = (near.which === 'start') ? near.poly[0] : near.poly[near.poly.length - 1];
          if (this.traceMarker) this.traceMarker.setLatLng(snapPoint);
          this.map.setView(snapPoint, 16);
        } catch (e) { console.warn('confirm handler failed', e); }
      };
      
      cancelBtn.onclick = () => { 
        try { 
          closeModal();
        } catch(e){} 
      };

      // Also handle modal hiding via Bootstrap events
      joinModalEl.addEventListener('hide.bs.modal', () => {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      });

      joinModalEl.setAttribute('data-last-shown', String(now));
      joinModalEl.addEventListener('shown.bs.modal', () => console.debug('showJoinModal: shown'), { once: true });
      modal.show();
    } catch (err) {
      console.warn('showJoinModal failed, starting tracing', err);
      this._startTracing();
    }
  }

  _stopTracing() {
    this.tracing = false;
    
    // Hide trail controls
    const trailControls = document.getElementById('trailControls');
    if (trailControls) trailControls.style.display = 'none';
    
    // Clear all trace visualizations
    if (this.tracePolyline) { try { this.map.removeLayer(this.tracePolyline); } catch(e) {} this.tracePolyline = null; }
    if (this.traceMarker) { try { this.map.removeLayer(this.traceMarker); } catch(e) {} this.traceMarker = null; }
    
    // Reset progress
    this._routePointCovered = new Set();
    this._progressPercent = 0;
    this._updateProgressUI();
  }

  // Process a live position update from ride-tracker
  processPosition(latlng) {
    try {
      console.debug('processPosition called with', latlng, 'tracing=', this.tracing, 'routePolylines=', (this.currentRoutePolylines && this.currentRoutePolylines.length) || 0);
      // If no active route geometry, nothing to auto-join
      if (!this.currentRoutePolylines || this.currentRoutePolylines.length === 0) {
        console.debug('processPosition: no currentRoutePolylines, skipping');
        return;
      }

      const p = L.latLng(latlng);

      // If not yet tracing, check for near-endpoint to prompt join
      if (!this.tracing) {
        const near = this.checkNearEndpoint(latlng, 100); // 100m threshold
        if (near) {
          // Show join modal with info (robust wiring + simple debounce)
          try {
            const joinModalEl = document.getElementById('joinTrailModal');
            if (!joinModalEl) return;  // Safety check

            // debounce: don't reshow if shown in last 10s
            const lastShown = Number(joinModalEl.getAttribute('data-last-shown') || '0');
            const now = Date.now();
            if (now - lastShown < 10000) {
              // recently shown; skip
              console.debug('joinTrailModal: skipped (debounce)');
              return;
            }

            // Update modal text
            const joinText = document.getElementById('joinTrailText');
            if (joinText) {
              joinText.textContent = `You're close to the ${near.which} of "${near.routeName}". Would you like to join?`;
            }

            // Dispose any existing bootstrap instance
            try {
              const existingModal = bootstrap.Modal.getInstance(joinModalEl);
              if (existingModal) {
                existingModal.hide();
                existingModal.dispose();
              }
            } catch (e) { /* ignore */ }

            // Create modal instance
            const modal = new bootstrap.Modal(joinModalEl, {
              backdrop: true,
              keyboard: true,
              focus: true
            });

            // Get control buttons
            const confirmBtn = document.getElementById('joinTrailConfirm');
            const cancelBtn = document.getElementById('joinTrailCancel');

            // Ensure elements exist
            if (!confirmBtn || !cancelBtn) {
              // If controls missing, fallback to auto-start tracing
              this._startTracing();
              return;
            }

            // Wire up handlers using onclick to avoid duplicate listeners
            confirmBtn.onclick = () => {
              try {
                modal.hide();
                this._startTracing();
                const snapPoint = (near.which === 'start') ? near.poly[0] : near.poly[near.poly.length - 1];
                if (this.traceMarker) this.traceMarker.setLatLng(snapPoint);
                this.map.setView(snapPoint, 16);
              } catch (e) { console.warn('join confirm handler failed', e); }
            };

            cancelBtn.onclick = () => {
              try { modal.hide(); } catch (e) {}
            };

            // mark shown time for debounce
            joinModalEl.setAttribute('data-last-shown', String(now));

            // debug hook
            joinModalEl.addEventListener('shown.bs.modal', () => console.debug('joinTrailModal: shown'), { once: true });

            // Show the modal
            modal.show();
          } catch (err) {
            console.warn('processPosition join modal failed, falling back to start tracing', err);
            this._startTracing();
          }
        }
      }

      // If tracing, compute nearest point on the entire route (all polylines)
      if (this.tracing) {
        let best = { dist: Infinity, point: null };
        for (const poly of this.currentRoutePolylines) {
          const found = this._nearestPointOnPolyline(latlng, poly);
          if (found && found.point && found.dist < best.dist) best = found;
        }

        if (best && best.point) {
          // Append to trace polyline
          const latlngPoint = [best.point.lat, best.point.lng];
          const existing = this.tracePolyline.getLatLngs() || [];
          // Only append when moved > 1m from last traced point
          if (existing.length === 0 || L.latLng(existing[existing.length-1]).distanceTo(latlngPoint) > 1) {
            existing.push(latlngPoint);
            this.tracePolyline.setLatLngs(existing);
          }
          // Move trace marker
          this.traceMarker.setLatLng(latlngPoint);
          // Mark nearby route point indices as covered for progress
          try {
            // find the closest poly and index
            for (let pi = 0; pi < this.currentRoutePolylines.length; pi++) {
              const poly = this.currentRoutePolylines[pi];
              const found = this._nearestPointOnPolyline(latlng, poly);
              if (found && found.point) {
                // mark the segment endpoints as covered (index and index+1)
                const idx = Math.max(0, Math.min(poly.length-1, found.index));
                this._routePointCovered.add(`${pi}:${idx}`);
                this._routePointCovered.add(`${pi}:${Math.min(poly.length-1, idx+1)}`);
                break;
              }
            }
          } catch (err) { console.warn('mark covered failed', err); }

          // Update progress UI
          this._updateProgressPercent();
          // Optionally pan map a little if user approaches edge
          // this.map.panTo(latlngPoint);
        }
      }
    } catch (err) {
      console.warn('processPosition error', err);
    }
  }

  _updateProgressPercent() {
    if (!this._routeTotalPoints || this._routeTotalPoints === 0) {
      this._progressPercent = 0;
    } else {
      const covered = this._routePointCovered.size;
      this._progressPercent = Math.min(100, Math.round((covered / this._routeTotalPoints) * 100));
    }
    this._updateProgressUI();

    // Auto-complete behavior: when >=50% marking, award completion
    if (this._progressPercent >= 50) {
      // Award once per route; set a flag
      if (!this._awardedForThisRoute) {
        this._awardedForThisRoute = true;
        this._awardPointsForCompletion(100); // example: 100 points for completing >=50%
        notify('Trail milestone reached — points awarded!', 'success');
      }
    }
  }

  _updateProgressUI() {
    try {
      const bar = document.getElementById('trailProgressBar');
      if (!bar) return;
      bar.style.width = this._progressPercent + '%';
      bar.setAttribute('aria-valuenow', this._progressPercent);
      // update both bar text and separate percent label
      bar.textContent = '';
      const pct = document.getElementById('trailProgressPercent');
      if (pct) pct.textContent = this._progressPercent + '%';
    } catch (err) { /* ignore DOM errors */ }
  }

  async _awardPointsForCompletion(points) {
    // If Supabase is configured and user is signed in, award points to their profile
    try {
      const sup = window.SupabaseConfig?.getSupabase && window.SupabaseConfig.getSupabase();
      if (!sup) return;
      const user = await window.authManager.getCurrentUser();
      if (!user) return;
      // simple upsert to add points to cumulative_score
      // fetch current profile
      let profileRow = null;
      try {
        const { data } = await sup.from('profiles').select('cumulative_score').eq('id', user.id).single();
        profileRow = data || null;
      } catch (e) {}

      const current = (profileRow && profileRow.cumulative_score) ? Number(profileRow.cumulative_score) : 0;
      await sup.from('profiles').upsert({ id: user.id, cumulative_score: current + points }, { onConflict: 'id' });
    } catch (err) {
      console.warn('Failed to award points', err);
    }
  }

  // End trail early: award partial credit proportional to progress
  async endTrail() {
    try {
      const percent = this._progressPercent || 0;
      const award = Math.round((percent / 100) * 100); // scale to 0-100 points
      await this._awardPointsForCompletion(award);
      notify('Trail ended — partial credit: ' + award + ' points', 'info');
      this._stopTracing();
      // reset awarded flag so next route can award again
      this._awardedForThisRoute = false;
      // clear progress
      this._routePointCovered = new Set();
      this._routeTotalPoints = 0;
      this._progressPercent = 0;
      this._updateProgressUI();
    } catch (err) {
      console.error('endTrail failed', err);
    }
  }
}

// Initialize map manager when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.mapManager = new MapManager();
});
