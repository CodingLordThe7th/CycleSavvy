// Profile Management Module
class ProfileManager {
  constructor() {
    this.supabase = null;
    this.handlersSetup = false;
    this.init();
  }

  init() {
    console.log('ProfileManager init() called');
    let retryCount = 0;
    const maxRetries = 50; // 10 seconds max wait time
    
    const checkSupabase = () => {
      this.supabase = window.SupabaseConfig?.getSupabase();
      if (this.supabase) {
        this.setupProfileHandlers();
        // Wait for auth to be ready before loading profile
        this.waitForAuthAndLoad();
        
        // Also set up handlers after a delay to ensure DOM is ready
        if (window.location.pathname.includes('profile.html')) {
          setTimeout(() => {
            console.log('Delayed profile handlers setup');
            this.setupProfileHandlers();
          }, 1000);
        }
      } else if (retryCount < maxRetries) {
        retryCount++;
        console.log('Supabase not ready yet, retrying in 200ms (attempt', retryCount, '/', maxRetries, ')');
        setTimeout(checkSupabase, 200);
      } else {
        console.error('Supabase failed to load after', maxRetries, 'attempts');
      }
    };
    checkSupabase();
  }

  async waitForAuthAndLoad() {
    // Wait for auth manager to be ready
    const checkAuth = async () => {
      if (window.authManager && window.authManager.supabase) {
        // Check if there's an existing session first
        const session = await window.authManager.getSession();
        console.log('Existing session:', session);
        
        // Load profile data when page loads (for profile.html)
        if (window.location.pathname.includes('profile.html')) {
          await this.loadProfile();
        }
      } else {
        setTimeout(checkAuth, 100);
      }
    };
    checkAuth();
    
    // Also try loading profile after a delay to catch any missed auth state
    setTimeout(async () => {
      if (window.location.pathname.includes('profile.html')) {
        console.log('Delayed profile load attempt');
        await this.loadProfile();
      }
    }, 2000);
  }

  setupProfileHandlers() {
    // Only set up profile handlers if we're on the profile page
    if (!window.location.pathname.includes('profile.html')) {
      console.log('Not on profile page, skipping profile handlers setup');
      return;
    }

    const saveProfileBtn = document.getElementById('saveProfileBtn');
    const signOutBtn = document.getElementById('signOutBtn');
    const uploadRouteInput = document.getElementById('uploadRouteInput');

    // Profile loading is now handled in waitForAuthAndLoad()

    // Sign out
    if (signOutBtn) {
      console.log('Adding sign out event listener');
      signOutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        console.log('Sign out button clicked');
        try {
      const success = await window.authManager.signOut();
          console.log('Sign out result:', success);
      if (success) {
        notify('Signed out', 'info');
            // Force reload profile after a short delay to ensure UI updates
            setTimeout(() => {
              console.log('Force reloading profile after sign out');
              this.loadProfile();
            }, 1000);
      } else {
            notify('Sign out failed', 'danger');
          }
        } catch (err) {
          console.error('Sign out error:', err);
        notify('Sign out failed', 'danger');
      }
    });
    } else {
      console.log('Sign out button not found on profile page');
    }

    // Save profile
    if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', async () => {
      await this.saveProfile();
    });
    }

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
    if (uploadRouteInput) {
    uploadRouteInput.addEventListener('change', async (e) => {
      await this.uploadRoute(e.target.files?.[0]);
    });
    }
  }

  async saveProfile() {
    if (!this.supabase) return notify('Auth not ready', 'warning');
    
    const user = await window.authManager.getCurrentUser();
    if (!user) return notify('Not signed in', 'warning');

    const usernameInput = document.getElementById('usernameInput');
    const weightInput = document.getElementById('weightInput');
    const weightUnit = document.getElementById('weightUnit');
    const goalType = document.getElementById('goalType');
    const goalValue = document.getElementById('goalValue');
    const showPreloaded = document.getElementById('showPreloaded');

    // Check if we're on the profile page
    if (!usernameInput || !weightInput || !weightUnit || !goalType || !goalValue || !showPreloaded) {
      console.log('Not on profile page, skipping save');
      return;
    }

    const username = usernameInput.value && usernameInput.value.trim();
    if (!username) {
      return notify('Please enter a username', 'warning');
    }

    const profile = {
      username: username,
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
    if (!this.supabase) {
      console.log('Supabase not ready');
      return;
    }
    
    const user = await window.authManager.getCurrentUser();
    const profileEmail = document.getElementById('profileEmail');
    const openAuthBtn = document.getElementById('openAuthBtn');
    
    console.log('Current user:', user);
    
    // Check if we're on the profile page
    if (!profileEmail) {
      console.log('Not on profile page, skipping profile load');
      return;
    }
    
    if (!user) {
      profileEmail.textContent = 'Not signed in';
      if (openAuthBtn) {
        openAuthBtn.style.display = 'block';
      }
      // Hide profile fields when not signed in
      this.toggleProfileFields(false);
      return;
    }
    
    profileEmail.textContent = user.email || user.id;
    if (openAuthBtn) {
      openAuthBtn.style.display = 'none';
    }
    // Show profile fields when signed in
    this.toggleProfileFields(true);

    // Fetch profile data
    try {
      const { data } = await this.supabase.from('profiles').select('profile').eq('id', user.id).single();
      const p = data?.profile || {};
      
      const usernameInput = document.getElementById('usernameInput');
      const weightInput = document.getElementById('weightInput');
      const weightUnit = document.getElementById('weightUnit');
      const goalType = document.getElementById('goalType');
      const goalValue = document.getElementById('goalValue');
      const goalHint = document.getElementById('goalHint');
      const showPreloaded = document.getElementById('showPreloaded');
      
      usernameInput.value = p.username || '';
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
    this.loadInvitations();
  }

  async loadInvitations() {
    const invitationsList = document.getElementById('invitationsList');
    if (!invitationsList || !this.supabase) return;
    
    try {
      const user = await window.authManager.getCurrentUser();
      if (!user) return;
      
      // Get pending invitations for this user
      const { data: invitations, error } = await this.supabase
        .from('pending_invitations')
        .select(`
          id,
          leaderboard_id,
          status,
          created_at,
          invited_by_user_id
        `)
        .eq('invited_user_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Error loading invitations:', error);
        console.error('Error details:', error.message, error.code, error.details);
        
        // Check if it's a table not found error
        if (error.code === 'PGRST116' || error.message?.includes('relation "pending_invitations" does not exist')) {
          invitationsList.innerHTML = `
            <div class="text-muted">
              <small>Invitation system not set up yet. Please create the pending_invitations table in your database.</small>
            </div>
          `;
        } else {
          invitationsList.innerHTML = '<div class="text-muted">Error loading invitations: ' + (error.message || 'Unknown error') + '</div>';
        }
        return;
      }
      
      invitationsList.innerHTML = '';
      
      if (!invitations || invitations.length === 0) {
        invitationsList.innerHTML = '<div class="text-muted">No pending invitations</div>';
        return;
      }
      
      // Process each invitation
      for (const invitation of invitations) {
        const div = document.createElement('div');
        div.className = 'border rounded p-2 mb-2';
        
        // Fetch leaderboard details
        let leaderboardName = 'Unknown Leaderboard';
        let goalText = 'No goal set';
        
        try {
          const { data: leaderboard } = await this.supabase
            .from('leaderboards')
            .select('name, goal')
            .eq('id', invitation.leaderboard_id)
            .single();
          
          if (leaderboard) {
            leaderboardName = leaderboard.name;
            if (leaderboard.goal) {
              goalText = `${leaderboard.goal.type.replace('_', ' ')}${leaderboard.goal.value ? ` (${leaderboard.goal.value})` : ''}`;
            }
          }
        } catch (err) {
          console.warn('Failed to fetch leaderboard details:', err);
        }
        
        // Fetch inviter details
        let inviterName = 'Unknown User';
        try {
          const { data: inviterProfile } = await this.supabase
            .from('profiles')
            .select('email, profile')
            .eq('id', invitation.invited_by_user_id)
            .single();
          
          if (inviterProfile) {
            inviterName = inviterProfile.profile?.username || inviterProfile.email;
          }
        } catch (err) {
          console.warn('Failed to fetch inviter details:', err);
        }
        
        div.innerHTML = `
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <div class="fw-bold">${leaderboardName}</div>
              <div class="text-muted small">Invited by: ${inviterName}</div>
              <div class="text-muted small">Goal: ${goalText}</div>
            </div>
            <div class="btn-group-vertical btn-group-sm">
              <button class="btn btn-success btn-sm" data-invitation-id="${invitation.id}" data-action="accept">
                Accept
              </button>
              <button class="btn btn-outline-danger btn-sm" data-invitation-id="${invitation.id}" data-action="decline">
                Decline
              </button>
            </div>
          </div>
        `;
        
        invitationsList.appendChild(div);
        
        // Add event listeners
        div.querySelector('[data-action="accept"]').addEventListener('click', () => 
          this.handleInvitation(invitation.id, 'accepted', invitation.leaderboard_id));
        div.querySelector('[data-action="decline"]').addEventListener('click', () => 
          this.handleInvitation(invitation.id, 'declined'));
      }
      
    } catch (err) {
      console.error('Load invitations failed', err);
      invitationsList.innerHTML = '<div class="text-muted">Error loading invitations</div>';
    }
  }

  async handleInvitation(invitationId, action, leaderboardId = null) {
    try {
      if (!this.supabase) return;
      
      // Update invitation status
      await this.supabase
        .from('pending_invitations')
        .update({ 
          status: action,
          updated_at: new Date().toISOString()
        })
        .eq('id', invitationId);
      
      if (action === 'accepted' && leaderboardId) {
        // Add user to leaderboard members
        const user = await window.authManager.getCurrentUser();
        await this.supabase
          .from('leaderboard_members')
          .insert({
            leaderboard_id: leaderboardId,
            user_id: user.id,
            points: 0
          });
        
        notify('Invitation accepted! You are now a member of the leaderboard.', 'success');
      } else {
        notify('Invitation declined.', 'info');
      }
      
      // Reload invitations
      this.loadInvitations();
      
    } catch (err) {
      console.error('Handle invitation failed', err);
      notify('Failed to process invitation: ' + (err.message || 'Unknown error'), 'danger');
    }
  }

  showRenameModal(routeId, currentName) {
    const modal = document.getElementById('renameRouteModal');
    const nameInput = document.getElementById('newRouteName');
    const routeIdInput = document.getElementById('renameRouteId');
    const saveBtn = document.getElementById('saveRouteNameBtn');

    if (!modal || !nameInput || !routeIdInput || !saveBtn) return;

    // Set up the modal
    nameInput.value = currentName;
    routeIdInput.value = routeId;

    // Show the modal
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();

    // Handle save button click
    const saveHandler = async () => {
      const newName = nameInput.value.trim();
      if (!newName) return;

      try {
        const { error } = await this.supabase
          .from('user_routes')
          .update({ name: newName })
          .eq('id', routeId);

        if (error) throw error;

        notify('Route renamed successfully', 'success');
        bsModal.hide();
        this.loadUserRoutes(); // Refresh the list
      } catch (err) {
        console.error('Rename route failed', err);
        notify('Failed to rename route', 'danger');
      }

      // Clean up
      saveBtn.removeEventListener('click', saveHandler);
    };

    // Add save button handler
    saveBtn.addEventListener('click', saveHandler);

    // Clean up when modal is hidden
    modal.addEventListener('hidden.bs.modal', () => {
      saveBtn.removeEventListener('click', saveHandler);
    }, { once: true });
  }

  toggleProfileFields(show) {
    const fields = [
      'usernameInput',
      'weightInput', 
      'weightUnit',
      'goalType',
      'goalValue',
      'showPreloaded',
      'uploadRouteInput',
      'saveProfileBtn',
      'signOutBtn'
    ];
    
    fields.forEach(fieldId => {
      const field = document.getElementById(fieldId);
      if (field) {
        field.style.display = show ? '' : 'none';
        if (field.parentElement) {
          field.parentElement.style.display = show ? '' : 'none';
        }
      }
    });
    
    // Show/hide sections
    const sections = document.querySelectorAll('hr, h5');
    sections.forEach(section => {
      section.style.display = show ? '' : 'none';
    });
  }

  async loadUserRoutes() {
    const userRoutesList = document.getElementById('userRoutesList');
    if (!userRoutesList || !this.supabase) return;
    
    userRoutesList.innerHTML = '';
    
    try {
      const user = await window.authManager.getCurrentUser();
      if (!user) return;
      
      const { data: routes, error } = await this.supabase
        .from('user_routes')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
        
      if (error) throw error;
      
      if (!routes || routes.length === 0) {
        userRoutesList.innerHTML = '<div class="text-muted">No saved routes</div>';
        return;
      }
      
      for (const route of routes) {
        const div = document.createElement('div');
        div.className = 'd-flex justify-content-between align-items-center border-bottom py-2';
        div.innerHTML = `
          <div class="text-truncate me-2">${route.name}</div>
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-secondary btn-sm" title="Rename route" data-route-id="${route.id}" data-route-name="${route.name}">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pencil-square" viewBox="0 0 16 16">
                <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/>
                <path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5v11z"/>
              </svg>
            </button>
          </div>
        `;
        
        userRoutesList.appendChild(div);
        
        // Add rename button click handler
        const renameBtn = div.querySelector('[data-route-id]');
        if (renameBtn) {
          renameBtn.addEventListener('click', () => this.showRenameModal(route.id, route.name));
        }
      }
    } catch (err) {
      console.error('Load user routes failed', err);
      userRoutesList.innerHTML = '<div class="text-muted">Error loading routes</div>';
    }
  }
  
  async initializeCumulativeScores() {
    try {
      // Get all profiles and check which ones need cumulative_score initialized
      const { data: allProfiles, error } = await this.supabase
        .from('profiles')
        .select('id, profile, cumulative_score');
      
      if (error) {
        console.warn('Error fetching profiles for cumulative_score check:', error);
        return;
      }
      
      if (!allProfiles || allProfiles.length === 0) {
        console.log('No profiles found');
        return;
      }
      
      // Find profiles that don't have cumulative_score set
      const profilesToUpdate = allProfiles.filter(profile => {
        return profile.cumulative_score === undefined || profile.cumulative_score === null;
      });
      
      if (profilesToUpdate.length > 0) {
        console.log(`Initializing cumulative_score for ${profilesToUpdate.length} profiles`);
        
        // Initialize cumulative_score to 0 for profiles that don't have it
        for (const profile of profilesToUpdate) {
          await this.supabase
            .from('profiles')
            .update({ cumulative_score: 0 })
            .eq('id', profile.id);
        }
        
        console.log('Cumulative scores initialized');
      } else {
        console.log('All profiles already have cumulative_score set');
      }
    } catch (err) {
      console.warn('Failed to initialize cumulative scores:', err);
    }
  }

 

  async loadGlobalLeaderboard() {
    const leaderboardList = document.getElementById('globalLeaderboardList');
    if (!leaderboardList) return;
    
    leaderboardList.innerHTML = '<div class="text-muted">Loading...</div>';
    if (!this.supabase) return;
    
    // First, ensure all profiles have cumulative_score initialized
    await this.initializeCumulativeScores();
    
    // Test functions removed - leaderboard working with real data
    
    try {
      console.log('Loading global leaderboard...');
      
      // Get all profiles first, then sort in JavaScript
      console.log('Querying profiles table...');
      const { data, error } = await this.supabase
        .from('profiles')
        .select('id, email, profile, cumulative_score');
      
      if (error) {
        console.error('Error fetching profiles:', error);
        leaderboardList.innerHTML = '<div class="text-muted">Error loading leaderboard</div>';
        return;
      }
     
      
      // Let's also check if there are any profiles at all
      const { count, error: countError } = await this.supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });
      
      console.log('Total profiles in database:', count);
      if (countError) console.error('Count error:', countError);
      
      // Check if RLS is blocking us from seeing other profiles
      if (count > 1 && data?.length === 1) {
        console.warn('⚠️ RLS Issue: Database has', count, 'profiles but query only returned', data?.length);
        console.warn('This suggests Row Level Security is blocking access to other profiles');
        
        // Try to get all profiles without any filters
        const { data: allData, error: allError } = await this.supabase
          .from('profiles')
          .select('id, email, profile, cumulative_score');
        
      }
      
      // Log each profile's details for debugging
      data.forEach((profile, idx) => {
        console.log(`Profile ${idx + 1}:`, {
          id: profile.id,
          email: profile.email,
          username: profile.profile?.username,
          cumulative_score: profile.cumulative_score,
          full_profile: profile.profile
        });
      });
      
      leaderboardList.innerHTML = '';
      
      if (!data || data.length === 0) { 
        leaderboardList.innerHTML = '<div class="text-muted">No profiles found</div>'; 
        return; 
      }
      
      // Sort by cumulative_score in JavaScript
      const sortedData = data
        .map(row => ({
          ...row,
          points: row.cumulative_score || 0
        }))
        .sort((a, b) => b.points - a.points)
        .slice(0, 10);
      
      console.log('Sorted leaderboard data:', sortedData);
      
      // Show what will be displayed
      sortedData.forEach((row, idx) => {
        console.log(`Leaderboard entry ${idx + 1}:`, {
          rank: idx + 1,
          displayName: row.profile?.username || row.email || row.id,
          points: row.points
        });
      });
      
      sortedData.forEach((row, idx) => {
        const div = document.createElement('div');
        div.className = 'd-flex justify-content-between align-items-center py-1 border-bottom';
        const displayName = row.profile?.username || row.email || row.id;
        const points = row.points;
        
        div.innerHTML = `
          <div>
            <span class="badge bg-secondary me-2">${idx + 1}</span>
            ${displayName}
          </div>
          <div>
            <span class="badge bg-primary">${points} pts</span>
          </div>
        `;
        leaderboardList.appendChild(div);
      });
    } catch (err) { 
      console.error('Global leaderboard failed', err); 
      leaderboardList.innerHTML = '<div class="text-muted">Error loading leaderboard</div>'; 
    }
  }
}

// Initialize profile manager when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.profileManager = new ProfileManager();
});
