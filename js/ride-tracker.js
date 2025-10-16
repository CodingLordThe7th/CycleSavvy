// Ride Tracking Module
class RideTracker {
  constructor() {
    this.supabase = null;
    this.watchId = null;
    this.ridecoord = [];
    this.ridePolyline = null;
    this.currentMarker = null;
    this.rideStartTime = null;
    this.init();
  }

  init() {
    const checkSupabase = () => {
      this.supabase = window.SupabaseConfig?.getSupabase();
      if (this.supabase) {
        this.setupRideHandlers();
      } else {
        setTimeout(checkSupabase, 100);
      }
    };
    checkSupabase();
  }

  setupRideHandlers() {
    const startBtn = document.getElementById("start");
    const stopBtn = document.getElementById("stop");

    if (!startBtn || !stopBtn) return;

    // Initial state
    startBtn.disabled = false;
    stopBtn.disabled = true;

    startBtn.addEventListener("click", () => {
      this.startTracking();
    });

    stopBtn.addEventListener("click", () => {
      this.stopTracking();
    });
  }

  startTracking() {
    this.ridecoord = [];
    this.rideStartTime = new Date().toISOString();
    
    if (navigator.geolocation) {
      this.watchId = navigator.geolocation.watchPosition(
        (position) => {
          const latlng = [position.coords.latitude, position.coords.longitude];

          if (this.ridePolyline) window.mapManager.map.removeLayer(this.ridePolyline);
          if (this.currentMarker) window.mapManager.map.removeLayer(this.currentMarker);

          this.currentMarker = L.marker(latlng).addTo(window.mapManager.map);
          this.ridecoord.push(latlng);

          if (!this.ridePolyline) {
            this.ridePolyline = L.polyline(this.ridecoord, { color: "blue" }).addTo(window.mapManager.map);
          } else {
            this.ridePolyline.setLatLngs(this.ridecoord);
          }

          window.mapManager.map.panTo(latlng);
        },
        (error) => {
          console.error("Error getting location: ", error);
          showToast("Error getting location: " + error.message, "danger");
        }
      );

      document.getElementById("start").disabled = true;
      document.getElementById("stop").disabled = false;
      notify("Tracking started", "success");
    } else {
      notify("Geolocation is not supported by this browser.", "warning");
    }
  }

  async stopTracking() {
    if (this.watchId !== null || this.rideStartTime) {
      if (this.watchId !== null) {
        navigator.geolocation.clearWatch(this.watchId);
        this.watchId = null;
      }

      if (this.ridecoord.length > 0) {
        const startTime = this.rideStartTime || new Date().toISOString();
        const endTime = new Date().toISOString();
        
        // Compute distance in meters
        let totalMeters = 0;
        for (let i = 1; i < this.ridecoord.length; i++) {
          const a = L.latLng(this.ridecoord[i-1]);
          const b = L.latLng(this.ridecoord[i]);
          totalMeters += a.distanceTo(b);
        }
        
        const durationSeconds = (new Date(endTime).getTime() - new Date(startTime).getTime())/1000;
        const payload = { 
          coords: this.ridecoord, 
          meta: { startTime, endTime, durationSeconds, distanceMeters: totalMeters } 
        };
        
        const key = startTime;
        await localforage.setItem(key, payload);
        notify("Route saved — " + formatLengthForSettings(totalMeters) + " • " + Math.round(durationSeconds/60) + " min", "success");
        
        // Send ride to Supabase (if signed in)
        try { 
          await this.sendRideToSupabase(payload); 
        } catch(e) { 
          console.warn('sendRideToSupabase failed', e); 
        }
      }

      // Clear start time after saving
      this.rideStartTime = null;
    } else {
      showToast("No active tracking to stop.", "info");
    }

    document.getElementById("stop").disabled = true;
    document.getElementById("start").disabled = false;
  }

  async sendRideToSupabase(payload) {
    try {
      if (!this.supabase) return;
      
      const user = await window.authManager.getCurrentUser();
      if (!user) return; // not signed in

      // Compute metrics
      const meta = payload.meta || {};
      const totalMeters = meta.distanceMeters || 0;
      const durationSeconds = meta.durationSeconds || 0;
      const distanceKm = totalMeters / 1000;

      // Fetch profile (for weight and goal)
      let profileRow = null;
      try {
        const { data } = await this.supabase.from('profiles').select('profile, cumulative_score').eq('id', user.id).single();
        profileRow = data || null;
      } catch (err) {
        // ignore
      }

      const p = (profileRow && profileRow.profile) ? profileRow.profile : {};
      const weightKg = p.weight_unit === 'lb' && p.weight ? Number(p.weight) * 0.453592 : (p.weight ? Number(p.weight) : null);

      // Estimate calories (simple heuristic)
      let calories = null;
      if (weightKg && distanceKm) {
        // ~30 kcal per kg per 10 km for casual cycling approximated -> 3 kcal/kg/km
        calories = Math.round(weightKg * distanceKm * 3);
      }

      // Determine goal achievement
      let achieved = false;
      let points = 0;
      const goalType = p.goal_type || 'none';
      const goalValue = p.goal_value || null;
      
      if (goalType !== 'none' && goalValue) {
        let achievedValue = 0;
        if (goalType === 'distance') achievedValue = totalMeters;
        else if (goalType === 'time') achievedValue = Math.round(durationSeconds/60); // minutes
        else if (goalType === 'calories') achievedValue = calories || 0;

        const ratio = goalValue > 0 ? (achievedValue / goalValue) : 0;
        achieved = ratio >= 1;
        // Points: capped at 200; full completion => 200, else ratio*100
        points = achieved ? 200 : Math.round(Math.max(0, Math.min(100, ratio * 100)));
      }

      // Base points for distance if no goal
      if (!points) {
        points = Math.round(totalMeters / 100); // 1 point per 100m
      }

      // Insert ride
      try {
        await this.supabase.from('rides').insert({ 
          user_id: user.id, 
          coords: payload.coords, 
          meta: { ...meta, calories }, 
          points, 
          achieved_goal: achieved 
        });
      } catch (err) {
        console.warn('Failed to insert ride', err);
      }

      // Update cumulative score in profiles
      try {
        const currentScore = (profileRow && profileRow.cumulative_score) ? Number(profileRow.cumulative_score) : 0;
        await this.supabase.from('profiles').upsert({ 
          id: user.id, 
          email: user.email, 
          cumulative_score: currentScore + points, 
          profile: profileRow ? profileRow.profile : p 
        }, { onConflict: 'id' });
      } catch (err) {
        console.warn('Failed to update score', err);
      }

    } catch (err) {
      console.error('sendRideToSupabase error', err);
    }
  }
}

// Initialize ride tracker when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.rideTracker = new RideTracker();
});
