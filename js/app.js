// Main App Initialization
document.addEventListener('DOMContentLoaded', () => {
  console.log('✅ DOMContentLoaded - Initializing CycleSavvy');
  
  // Initialize Supabase
  window.SupabaseConfig.initializeSupabase();
  
  // Initialize all modules
  // (Modules are initialized automatically when their scripts load)
  
  // Setup reset button if it exists
  const resetBtn = document.getElementById("reset");
  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      await localforage.clear();
      if (window.mapManager) {
        // Clear map layers
        if (window.rideTracker && window.rideTracker.ridePolyline) {
          window.mapManager.map.removeLayer(window.rideTracker.ridePolyline);
          window.rideTracker.ridePolyline = null;
        }
        if (window.rideTracker && window.rideTracker.currentMarker) {
          window.mapManager.map.removeLayer(window.rideTracker.currentMarker);
          window.rideTracker.currentMarker = null;
        }
        if (window.mapManager.activeHistoryPolyline) {
          window.mapManager.map.removeLayer(window.mapManager.activeHistoryPolyline);
          window.mapManager.activeHistoryPolyline = null;
        }
        if (window.mapManager.currentRouteLayer) {
          try { window.mapManager.map.removeLayer(window.mapManager.currentRouteLayer); } catch(e) {}
          window.mapManager.currentRouteLayer = null;
        }
      }
      showToast("Cache cleared and map reset!", "warning");
    });
  }
  
  console.log('✅ CycleSavvy initialized');
});
