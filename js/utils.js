// Utility Functions
function showToast(message, type = "primary") {
  const toastBox = document.getElementById("toastBox");
  const toastMessage = document.getElementById("toastMessage");

  if (!toastBox || !toastMessage) return;

  toastMessage.textContent = message;
  toastBox.className = `toast align-items-center text-bg-${type} border-0`;

  const toast = new bootstrap.Toast(toastBox, { delay: 2000 });
  toast.show();
}

// Notify respects user settings (default: enabled)
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

// Background tracking wrapper (plugin-agnostic)
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

  notify('Background plugin detected but stop API not recognized.', 'warning');
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

// Export utilities to global scope
window.Utils = {
  showToast,
  notify,
  getUserSettings,
  formatLengthForSettings,
  startBackgroundTracking,
  stopBackgroundTracking,
  onBackgroundLocation
};
