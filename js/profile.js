// Profile Management Module
class ProfileManager {
  constructor() {
    this.supabase = null;
    this.init();
  }

  init() {
    const checkSupabase = () => {
      this.supabase = window.SupabaseConfig?.getSupabase();
      if (this.supabase) {
        this.setupProfileHandlers();
      } else {
        setTimeout(checkSupabase, 100);
      }
    };
    checkSupabase();
  }

  setupProfileHandlers() {
    const saveProfileBtn = document.getElementById('saveProfileBtn');
    const signOutBtn = document.getElementById('signOutBtn');
    const uploadRouteInput = document.getElementById('uploadRouteInput');

    // Load profile data when page loads (for profile.html)
    if (window.location.pathname.includes('profile.html')) {
      this.loadProfile();
    }

    // Sign out
    signOutBtn.addEventListener('click', async () => {
      const success = await window.authManager.signOut();
      if (success) {
        notify('Signed out', 'info');
        // Redirect to main page after sign out
        window.location.href = 'index.html';
      } else {
        notify('Sign out failed', 'danger');
      }
    });

    // Save profile
    saveProfileBtn.addEventListener('click', async () => {
      await this.saveProfile();
    });

    // Live update hint when changing goal type/value or weight
    const weightInput = document.getElementById('weightInput');
    const weightUnit = document.getElementById('weightUnit');
    const goalType = document.getElementById('goalType');
    const goalValue = document.getElementById('goalValue');
    const goalHint = document.getElementById('goalHint');

    function updateCaloriesHint() {
      try {
        if (!goalHint) return;
        if (goalType.value === 'calories' && goalValue.value && weightInput.value) {
          const weightKg = weightUnit.value === 'lb' ? Number(weightInput.value) * 0.453592 : Number(weightInput.value);
          const kcalPerKm = weightKg ? (weightKg * 3) : 0;
          const requiredKm = kcalPerKm > 0 ? (Number(goalValue.value) / kcalPerKm) : 0;
          const requiredMeters = Math.round(requiredKm * 1000);
          goalHint.style.display = '';
          goalHint.textContent = 'You would need to ride ' + window.Utils.formatLengthForSettings(requiredMeters) + ' to burn ~' + goalValue.value + ' kcal.';
        } else {
          goalHint.style.display = 'none';
        }
      } catch (e) { console.warn('updateCaloriesHint failed', e); }
    }

    [weightInput, weightUnit, goalType, goalValue].forEach(el => {
      if (!el) return;
      el.addEventListener('input', updateCaloriesHint);
      el.addEventListener('change', updateCaloriesHint);
    });

    // Upload route
    uploadRouteInput.addEventListener('change', async (e) => {
      await this.uploadRoute(e.target.files?.[0]);
    });
  }

  async saveProfile() {
    if (!this.supabase) return notify('Auth not ready', 'warning');
    
    const user = await window.authManager.getCurrentUser();
    if (!user) return notify('Not signed in', 'warning');

    const weightInput = document.getElementById('weightInput');
    const weightUnit = document.getElementById('weightUnit');
    const goalType = document.getElementById('goalType');
    const goalValue = document.getElementById('goalValue');
    const showPreloaded = document.getElementById('showPreloaded');

    const profile = {
      weight: Number(weightInput.value) || null,
      weight_unit: weightUnit.value || 'kg',
      goal_type: goalType.value || 'none',
      goal_value: Number(goalValue.value) || null,
      show_preloaded: !!showPreloaded.checked
    };

    try {
      await this.supabase.from('profiles').upsert({ 
        id: user.id, 
        email: user.email, 
        profile 
      }, { onConflict: 'id' });
      
      notify('Profile saved', 'success');
      this.loadProfile();
    } catch (err) {
      console.error('Failed to save profile', err);
      notify('Failed to save profile', 'danger');
    }
  }

  async uploadRoute(file) {
    if (!file) return;
    if (!this.supabase) return notify('Auth not ready', 'warning');
    
    const user = await window.authManager.getCurrentUser();
    if (!user) return notify('Sign in first', 'warning');

    const storageKey = `routes/${user.id}/${Date.now()}_${file.name}`;
    try {
      const { error: uploadError } = await this.supabase.storage.from('gpx').upload(storageKey, file);
      if (uploadError) throw uploadError;
      
      const publicUrl = `${window.SupabaseConfig.SUPABASE_URL}/storage/v1/object/public/gpx/${encodeURIComponent(storageKey)}`;
      await this.supabase.from('user_routes').insert({ 
        user_id: user.id, 
        name: file.name, 
        path: storageKey, 
        public_url: publicUrl 
      });
      
      notify('Route uploaded', 'success');
      this.loadUserRoutes();
    } catch (err) {
      console.error('Upload failed', err);
      notify('Upload failed', 'danger');
    }
  }

  async loadProfile() {
    if (!this.supabase) return;
    
    const user = await window.authManager.getCurrentUser();
    const profileEmail = document.getElementById('profileEmail');
    
    if (!user) {
      profileEmail.textContent = 'Not signed in';
      return;
    }
    
    profileEmail.textContent = user.email || user.id;

    // Fetch profile data
    try {
      const { data } = await this.supabase.from('profiles').select('profile').eq('id', user.id).single();
      const p = data?.profile || {};
      
      const weightInput = document.getElementById('weightInput');
      const weightUnit = document.getElementById('weightUnit');
      const goalType = document.getElementById('goalType');
      const goalValue = document.getElementById('goalValue');
      const goalHint = document.getElementById('goalHint');
      const showPreloaded = document.getElementById('showPreloaded');
      
      weightInput.value = p.weight || '';
      weightUnit.value = p.weight_unit || 'kg';
      goalType.value = p.goal_type || 'none';
      goalValue.value = p.goal_value || '';
      showPreloaded.checked = (p.show_preloaded === undefined) ? true : !!p.show_preloaded;
      // Update hint if calories goal
      try {
        if (goalHint) {
          if ((p.goal_type || 'none') === 'calories' && p.goal_value && p.weight) {
            // convert weight to kg
            const weightKg = p.weight_unit === 'lb' ? Number(p.weight) * 0.453592 : Number(p.weight);
            const kcalPerKm = weightKg ? (weightKg * 3) : 0; // 3 kcal/kg/km heuristic
            const requiredKm = kcalPerKm > 0 ? (Number(p.goal_value) / kcalPerKm) : 0;
            const requiredMeters = Math.round(requiredKm * 1000);
            goalHint.style.display = '';
            goalHint.textContent = 'You would need to ride ' + window.Utils.formatLengthForSettings(requiredMeters) + ' to burn ~' + p.goal_value + ' kcal.';
          } else {
            goalHint.style.display = 'none';
          }
        }
      } catch (e) {
        console.warn('Failed to update goal hint', e);
      }
    } catch (err) {
      console.warn('No profile row', err);
    }

    this.loadUserRoutes();
    this.loadLeaderboard();
  }

  async loadUserRoutes() {
    const userRoutesList = document.getElementById('userRoutesList');
    if (!userRoutesList) return;
    
    userRoutesList.innerHTML = '';
    if (!this.supabase) return;
    
    const user = await window.authManager.getCurrentUser();
    if (!user) return;
    
    try {
      const { data } = await this.supabase.from('user_routes')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
        
      if (!data || data.length === 0) { 
        userRoutesList.innerHTML = '<div class="text-muted">No saved routes</div>'; 
        return; 
      }
      
      data.forEach(r => {
        const div = document.createElement('div');
        div.className = 'd-flex justify-content-between align-items-center border-bottom py-1';
        div.innerHTML = `<div class="small">${r.name}</div><div><button class="btn btn-sm btn-link" data-path="${r.path}">Load</button></div>`;
        userRoutesList.appendChild(div);
        
        div.querySelector('button').addEventListener('click', () => {
          const publicUrl = `${window.SupabaseConfig.SUPABASE_URL}/storage/v1/object/public/gpx/${encodeURIComponent(r.path)}`;
          window.mapManager.loadGPXRoute(publicUrl);
        });
      });
    } catch (err) { 
      console.error('Failed to load user routes', err); 
    }
  }

  async loadLeaderboard() {
    const leaderboardList = document.getElementById('leaderboardList');
    if (!leaderboardList) return;
    
    leaderboardList.innerHTML = '<div class="text-muted">Loading...</div>';
    if (!this.supabase) return;
    
    try {
      const { data } = await this.supabase.rpc('leaderboard_top5');
      leaderboardList.innerHTML = '';
      
      if (!data || data.length === 0) { 
        leaderboardList.innerHTML = '<div class="text-muted">No entries</div>'; 
        return; 
      }
      
      data.slice(0,5).forEach((row, idx) => {
        const div = document.createElement('div');
        div.className = 'd-flex justify-content-between';
        div.innerHTML = `<div>${idx+1}. ${row.email}</div><div>${row.score}</div>`;
        leaderboardList.appendChild(div);
      });
    } catch (err) { 
      console.error('Leaderboard failed', err); 
      leaderboardList.innerHTML = '<div class="text-muted">Error</div>'; 
    }
  }
}

// Initialize profile manager when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.profileManager = new ProfileManager();
});
