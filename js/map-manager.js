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
    this.init();
  }

  // Remove the currently loaded route from the map and reset related state
  exitCurrentRoute() {
    try {
      // Hide any open routeLoadedModal
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
  const endTrailBtn = document.getElementById('endTrailBtn');

    if (!historyBtn) return;

    // Populate history list only when dropdown opens
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
            window.lengthText = formatLengthForSettings(meters); // Store in window for access throughout the load handler

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

            const lengthStr = lengthText || "Unknown length";
            notify("Route loaded: " + routeName + " — " + lengthStr, "success");

            // Show route loaded notification
            try {
              const modalEl = document.getElementById('routeLoadedModal');
              const modalText = document.getElementById('routeLoadedText');
              const startBtn = document.getElementById('routeLoadedStartBtn');
              const showBtn = document.getElementById('routeLoadedShowBtn');
              const exitBtn = document.getElementById('routeLoadedExitBtn');
              
              if (modalEl && modalText && startBtn && exitBtn) {
                modalText.textContent = `Route "${routeName}" loaded (${lengthStr}). Choose an action from the menu in the top right.`;
                const modal = new bootstrap.Modal(modalEl, { backdrop: true });

                const onStart = () => {
                  modal.hide();
                  this._startTracing();
                  // Center map on route start
                  if (this.currentRoutePolylines && this.currentRoutePolylines[0] && this.currentRoutePolylines[0][0]) {
                    this.map.setView(this.currentRoutePolylines[0][0], 16);
                  }
                  startBtn.removeEventListener('click', onStart);
                  exitBtn.removeEventListener('click', onExit);
                };

                const onExit = () => {
                  modal.hide();
                  this.exitCurrentRoute();
                  // cleanup listeners
                  exitBtn.removeEventListener('click', onExit);
                  startBtn.removeEventListener('click', onStart);
                };

                startBtn.addEventListener('click', onStart);
                exitBtn.addEventListener('click', onExit);

                // Listen for modal shown/hidden events
                const onShown = () => {
                  // Focus the start button by default when modal shows
                  startBtn.focus();
                };

                const onHidden = () => {
                  // Clean up listeners when modal is hidden
                  modalEl.removeEventListener('shown.bs.modal', onShown);
                  modalEl.removeEventListener('hidden.bs.modal', onHidden);
                  startBtn.removeEventListener('click', onStart);
                  exitBtn.removeEventListener('click', onExit);
                };

                modalEl.addEventListener('shown.bs.modal', onShown);
                modalEl.addEventListener('hidden.bs.modal', onHidden);
                modal.show();
              }
            } catch (err) { console.warn('routeLoaded modal failed', err); }
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
      
      return closestMatch;
    } catch (err) {
      console.warn('checkNearEndpoint error:', err);
      return null;
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
      // If no active route geometry, nothing to auto-join
      if (!this.currentRoutePolylines || this.currentRoutePolylines.length === 0) return;

      const p = L.latLng(latlng);

      // If not yet tracing, check for near-endpoint to prompt join
      if (!this.tracing) {
        const near = this.checkNearEndpoint(latlng, 25); // 25m threshold
        if (near) {
          // Show join modal with info
          try {
            const joinModalEl = document.getElementById('joinTrailModal');
            if (!joinModalEl) return;  // Safety check

            // Update modal text
            const joinText = document.getElementById('joinTrailText');
            if (joinText) {
              joinText.textContent = `You're close to the ${near.which} of "${near.routeName}". Would you like to join?`;
            }

            // First, hide any existing modal
            const existingModal = bootstrap.Modal.getInstance(joinModalEl);
            if (existingModal) {
              existingModal.hide();
              existingModal.dispose();
            }

            // Create new modal instance
            // Create modal with backdrop for better visibility
            const modal = new bootstrap.Modal(joinModalEl, {
              backdrop: true,    // Add semi-transparent backdrop
              keyboard: true,    // Allow ESC key to close
              focus: true       // Ensure modal gets focus
            });

            // Get control buttons
            const confirmBtn = document.getElementById('joinTrailConfirm');
            const cancelBtn = document.getElementById('joinTrailCancel');

            // Setup event handlers
            const onConfirm = () => {
              modal.hide();
              this._startTracing();
              // Get the endpoint we're joining at
              const snapPoint = (near.which === 'start') ? near.poly[0] : near.poly[near.poly.length - 1];
              // Update marker position and map view
              if (this.traceMarker) {
                this.traceMarker.setLatLng(snapPoint);
              }
              this.map.setView(snapPoint, 16);
            };

            const onCancel = () => {
              modal.hide();
            };

            // Clean up old handlers if any
            confirmBtn.replaceWith(confirmBtn.cloneNode(true));
            cancelBtn.replaceWith(cancelBtn.cloneNode(true));
            
            // Add fresh handlers
            document.getElementById('joinTrailConfirm').addEventListener('click', onConfirm);
            document.getElementById('joinTrailCancel').addEventListener('click', onCancel);

            // Auto-cleanup on hide
            joinModalEl.addEventListener('hidden.bs.modal', () => {
              try {
                modal.dispose();
              } catch(e) { 
                console.warn('Modal cleanup error:', e);
              }
            }, { once: true });

            // Show the modal
            modal.show();
          } catch (err) {
            // fallback: start tracing
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
