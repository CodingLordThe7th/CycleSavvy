// Community features: Create leaderboard, search/invite users, custom leaderboard management
class CommunityManager {
  constructor() {
    this.supabase = null;
    this.pendingOpsKey = 'pending_leaderboard_ops';
    this.selectedLeaderboardId = null;
    this.init();
  }

  init() {
    const check = () => {
      this.supabase = window.SupabaseConfig?.getSupabase();
      if (this.supabase) {
        this.setupUI();
        this.loadCustomLeaderboards();
        this.checkUsernameOnLoad();

      } else {
        setTimeout(check, 100);
      }
    };
    check();
  }

  async checkUsernameOnLoad() {
    const user = await window.authManager.getCurrentUser();
    if (!user) return;
    
    const hasUsername = await this.checkUserHasUsername(user.id);
    if (!hasUsername) {
      const createBtn = document.getElementById('createLeaderboardBtn');
      if (createBtn) {
        createBtn.disabled = true;
        createBtn.title = 'Please set a username in your profile first';
        createBtn.textContent = 'Set Username First';
      }
    }
  }

  setupUI() {
    const createBtn = document.getElementById('createLeaderboardBtn');
    const form = document.getElementById('createLeaderboardForm');
    const submit = document.getElementById('leaderboardCreateSubmit');
    const cancel = document.getElementById('leaderboardCreateCancel');
    const nameInput = document.getElementById('leaderboardNameInput');
    const goalTypeSelect = document.getElementById('leaderboardGoalType');
    const goalValueInput = document.getElementById('leaderboardGoalValue');
    const searchInput = document.getElementById('searchUserInput');

    if (createBtn) {
      createBtn.addEventListener('click', () => {
        form.style.display = form.style.display === 'none' ? '' : 'none';
        if (form.style.display !== 'none') {
          nameInput.focus();
        }
      });
    }

    if (cancel) {
      cancel.addEventListener('click', () => {
        form.style.display = 'none';
        nameInput.value = '';
        goalValueInput.value = '';
        goalTypeSelect.value = 'total_distance';
      });
    }

    if (submit) {
      submit.addEventListener('click', async () => {
        const name = nameInput.value && nameInput.value.trim();
        const goalType = goalTypeSelect.value;
        const goalValue = goalValueInput.value ? Number(goalValueInput.value) : null;
        
        if (!name) return alert('Enter a leaderboard name');
        
        await this.createLeaderboard(name, goalType, goalValue);
        nameInput.value = '';
        goalValueInput.value = '';
        goalTypeSelect.value = 'total_distance';
        form.style.display = 'none';
        this.loadCustomLeaderboards();
      });
    }

    if (searchInput) {
      let timer = null;
      const resultsBox = document.getElementById('searchResults');
      
      // Real-time search with debouncing
      searchInput.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => this.searchUsers(searchInput.value), 200);
      });
      
      // Show dropdown on focus if there's text
      searchInput.addEventListener('focus', () => {
        if (searchInput.value.length >= 2) {
          this.searchUsers(searchInput.value);
        }
      });
      
      // Hide dropdown when input loses focus (with delay to allow clicking)
      searchInput.addEventListener('blur', () => {
        setTimeout(() => {
          if (resultsBox) {
            resultsBox.style.display = 'none';
          }
        }, 200);
      });
    }
    
    // Click outside to close dropdown
    document.addEventListener('click', (e) => {
      const searchInput = document.getElementById('searchUserInput');
      const resultsBox = document.getElementById('searchResults');
      
      if (!e.target.closest('#searchUserInput') && !e.target.closest('#searchResults')) {
        if (resultsBox) {
          resultsBox.style.display = 'none';
        }
      }
    });
  }



  async createLeaderboard(name, goalType, goalValue) {
    if (!this.supabase) return alert('Auth not ready');
    const user = await window.authManager.getCurrentUser();
    if (!user) return alert('Sign in first');

    // Check if user has a username
    const hasUsername = await this.checkUserHasUsername(user.id);
    if (!hasUsername) {
      alert('Please set a username in your profile before creating leaderboards.');
      window.location.href = 'profile.html';
      return;
    }

    try {
      const goal = {
        type: goalType,
        value: goalValue
      };

      const { data, error } = await this.supabase
        .from('leaderboards')
        .insert({ 
          name, 
          goal, 
          created_by: user.id 
        })
        .select()
        .single();
        
      if (error) throw error;
      
      // Add creator as first member
      await this.supabase
        .from('leaderboard_members')
        .insert({ 
          leaderboard_id: data.id, 
          user_id: user.id, 
          points: 0 
        });
      
      // Store pending op for offline sync
      await this.addPendingOp({ 
        type: 'create_leaderboard', 
        leaderboard: data, 
        created_at: new Date().toISOString() 
      });
      
      notify('Leaderboard created successfully!', 'success');
    } catch (err) {
      console.error('Create leaderboard failed', err);
      notify('Failed to create leaderboard: ' + (err.message || 'Unknown error'), 'danger');
    }
  }

  async loadCustomLeaderboards() {
    const list = document.getElementById('customLeaderboardsList');
    if (!list || !this.supabase) return;
    
    list.innerHTML = 'Loading...';
    try {
      const user = await window.authManager.getCurrentUser();
      if (!user) return;
      
      const { data } = await this.supabase
        .from('leaderboards')
        .select('*')
        .order('created_at', { ascending: false });
        
      list.innerHTML = '';
      if (!data || data.length === 0) { 
        list.innerHTML = '<div class="text-muted">No custom leaderboards yet</div>'; 
        return; 
      }
      
      data.forEach(lb => {
        const div = document.createElement('div');
        div.className = 'd-flex justify-content-between align-items-center py-2 border-bottom';
        
        const goalText = lb.goal ? 
          `${lb.goal.type.replace('_', ' ')}${lb.goal.value ? ` (${lb.goal.value})` : ''}` : 
          'No goal set';
        
        const isCreator = lb.created_by === user.id;
        
        // Different buttons based on whether user is creator
        const buttonsHtml = isCreator ? 
          `<button class="btn btn-sm btn-outline-primary me-1" data-id="${lb.id}" data-action="view">View</button>
           <button class="btn btn-sm btn-outline-success" data-id="${lb.id}" data-action="invite">Invite</button>` :
          `<button class="btn btn-sm btn-outline-primary" data-id="${lb.id}" data-action="view">View Only</button>`;
        
        div.innerHTML = `
          <div>
            <div class="fw-bold">${lb.name} ${isCreator ? '<span class="badge bg-primary ms-1">Your Leaderboard</span>' : ''}</div>
            <div class="text-muted small">Goal: ${goalText}</div>
          </div>
          <div>
            ${buttonsHtml}
          </div>
        `;
        
        list.appendChild(div);
        
        // Add event listeners
        div.querySelector('[data-action="view"]').addEventListener('click', () => {
          // Hide invite section when viewing members
          const inviteSection = document.getElementById('inviteSection');
          if (inviteSection) inviteSection.style.display = 'none';
          // Show members for this leaderboard
          this.showMembers(lb.id, lb.name);
        });
        
        // Only add invite listener if user is creator
        const inviteBtn = div.querySelector('[data-action="invite"]');
        if (inviteBtn) {
          inviteBtn.addEventListener('click', () => 
            this.showInviteSection(lb.id, lb.name));
        }
      });
    } catch (err) { 
      console.error('Load custom leaderboards failed', err); 
      list.innerHTML = '<div class="text-muted">Error loading leaderboards</div>'; 
    }
  }

  async showMembers(leaderboardId, leaderboardName) {
    const container = document.getElementById('leaderboardMembers');
    container.style.display = 'block';
    container.innerHTML = `
      <div class="mt-3 p-2 bg-light rounded">
        <h6 class="border-bottom pb-2 mb-3">${leaderboardName} - Members</h6>
        <div id="membersList">Loading...</div>
      </div>`;
    
    try {
      // First get the leaderboard members
      const { data: membersData, error: membersError } = await this.supabase
        .from('leaderboard_members')
        .select('user_id, points, joined_at')
        .eq('leaderboard_id', leaderboardId)
        .order('points', { ascending: false });
        
      if (membersError) {
        console.error('Error fetching members:', membersError);
        throw membersError;
      }

      const membersList = document.getElementById('membersList');
      
      if (!membersData || membersData.length === 0) { 
        membersList.innerHTML = '<div class="text-muted">No members yet</div>'; 
        return; 
      }

      // Fetch profiles for these members
      const { data: profilesData, error: profilesError } = await this.supabase
        .from('profiles')
        .select('id, email, profile')
        .in('id', membersData.map(m => m.user_id));
        
      if (profilesError) {
        console.error('Error fetching profiles:', profilesError);
        throw profilesError;
      }

      // Create a map of profiles by user ID
      const profilesMap = new Map();
        
      membersList.innerHTML = '';
      
      if (profilesData) {
        profilesData.forEach(profile => {
          profilesMap.set(profile.id, profile);
        });
      }
      
      // Display members with their profile information
      membersData.forEach((member, idx) => {
        const profile = profilesMap.get(member.user_id);
        if (!profile) {
          console.warn('No profile found for member:', member.user_id);
          return;
        }
        
        const displayName = profile.profile?.username || profile.email || member.user_id;
        
        const div = document.createElement('div');
        div.className = 'd-flex justify-content-between align-items-center py-2 border-bottom';
        div.innerHTML = `
          <div>
            <span class="badge bg-secondary me-2">${idx + 1}</span>
            <span class="fw-medium">${displayName}</span>
            ${profile.profile?.username ? `<small class="text-muted ms-2">${profile.email}</small>` : ''}
          </div>
          <div>
            <span class="badge bg-primary">${member.points || 0} pts</span>
          </div>
        `;
        membersList.appendChild(div);
      });
    } catch (err) { 
      console.error('Show members failed', err); 
      container.innerHTML = '<div class="text-muted">Error loading members</div>'; 
    }
  }

  showInviteSection(leaderboardId, leaderboardName) {
    this.selectedLeaderboardId = leaderboardId;
    const inviteSection = document.getElementById('inviteSection');
    const infoDiv = document.getElementById('selectedLeaderboardInfo');
    
    inviteSection.style.display = 'block';
    infoDiv.textContent = `Inviting users to: ${leaderboardName}`;
    
    // Clear search results
    document.getElementById('searchResults').innerHTML = '';
    document.getElementById('searchUserInput').value = '';
  }

  async searchUsers(query) {
    const resultsBox = document.getElementById('searchResults');
    resultsBox.innerHTML = '';
    
    if (!query || query.length < 2) {
      resultsBox.style.display = 'none';
      return;
    }
    
    if (!this.supabase) return;
    
    try {
      const q = query.trim();
      
      
      // Search in profiles table using username OR email
      // This query searches both:
      // 1. profile->>username (extracts username as text, then searches)
      // 2. email (searches email column)
    
      
      // Get current user to exclude from search results
      const user = await window.authManager.getCurrentUser();
      
      const { data, error } = await this.supabase
        .from('profiles')
        .select('id, email, profile')
        .or(`profile->>username.ilike.%${q}%,email.ilike.%${q}%`)
        .neq('id', user.id) // Exclude current user
        .limit(10);
        
      if (error) {
        console.error('Search query error details:', error);
      }
        
      
      

        
      if (!data || data.length === 0) { 
        resultsBox.innerHTML = '<div class="dropdown-item text-muted">No users found</div>'; 
        resultsBox.style.display = 'block';
        return; 
      }
      
      // Show dropdown
      resultsBox.style.display = 'block';
      resultsBox.className = 'dropdown-menu show w-100';
      
      data.forEach(u => {
        const row = document.createElement('div');
        row.className = 'dropdown-item d-flex justify-content-between align-items-center';
        const displayName = u.profile?.username || u.email;
        const email = u.email;
        
        row.innerHTML = `
          <div>
            <div class="fw-bold">${displayName}</div>
            <small class="text-muted">${email}</small>
          </div>
          <button class="btn btn-sm btn-outline-primary" data-id="${u.id}" data-name="${displayName}">
            Invite
          </button>
        `;
        
        resultsBox.appendChild(row);
        
        const inviteBtn = row.querySelector('button');
        inviteBtn.addEventListener('click', (e) => {
          console.log('Invite button clicked for user:', u.id, displayName);
          e.stopPropagation();
          e.preventDefault();
          this.inviteUserToLeaderboard(u.id, displayName);
        });
        
        // Also allow clicking on the row to invite
        row.addEventListener('click', (e) => {
          if (e.target.tagName !== 'BUTTON') {
            console.log('Row clicked for user:', u.id, displayName);
            this.inviteUserToLeaderboard(u.id, displayName);
          }
        });
      });
    } catch (err) { 
      console.error('Search users failed', err); 
      resultsBox.innerHTML = '<div class="dropdown-item text-muted">Error searching users</div>'; 
      resultsBox.style.display = 'block';
    }
  }

  async inviteUserToLeaderboard(userId, userName) {
    console.log('inviteUserToLeaderboard called with:', { userId, userName, selectedLeaderboardId: this.selectedLeaderboardId });
    
    if (!this.selectedLeaderboardId) {
      console.log('No leaderboard selected');
      return alert('Please select a leaderboard first');
    }
    
    try {
      const currentUser = await window.authManager.getCurrentUser();
      if (!currentUser) return alert('Please sign in first');
      
      // Check if user is already a member
      const { data: existingMember } = await this.supabase
        .from('leaderboard_members')
        .select('user_id')
        .eq('leaderboard_id', this.selectedLeaderboardId)
        .eq('user_id', userId)
        .single();
        
      if (existingMember) {
        return alert(`${userName} is already a member of this leaderboard`);
      }
      
      // Check if there's already a pending invitation
      const { data: existingInvite } = await this.supabase
        .from('pending_invitations')
        .select('id, status')
        .eq('leaderboard_id', this.selectedLeaderboardId)
        .eq('invited_user_id', userId)
        .single();
        
      if (existingInvite) {
        if (existingInvite.status === 'pending') {
          return alert(`${userName} already has a pending invitation`);
        } else if (existingInvite.status === 'declined') {
          // Allow re-inviting if previously declined
          await this.supabase
            .from('pending_invitations')
            .update({ 
              status: 'pending',
              invited_by_user_id: currentUser.id,
              updated_at: new Date().toISOString()
            })
            .eq('id', existingInvite.id);
        }
      } else {
        // Create new pending invitation
        await this.supabase
          .from('pending_invitations')
          .insert({ 
            leaderboard_id: this.selectedLeaderboardId, 
            invited_user_id: userId,
            invited_by_user_id: currentUser.id,
            status: 'pending'
          });
      }
      
      // Show success feedback
      const inviteBtn = event.target;
      inviteBtn.textContent = '✓ Invited!';
      inviteBtn.disabled = true;
      inviteBtn.classList.remove('btn-outline-primary');
      inviteBtn.classList.add('btn-success');
      
      // Show notification
      notify(`Invitation sent to ${userName}! They will see it in their profile.`, 'success');
      
      // Clear search and hide dropdown
      const searchInput = document.getElementById('searchUserInput');
      const resultsBox = document.getElementById('searchResults');
      if (searchInput) searchInput.value = '';
      if (resultsBox) {
        resultsBox.innerHTML = '';
        resultsBox.style.display = 'none';
      }
      
    } catch (err) {
      console.error('Invite user failed', err);
      notify('Failed to send invitation: ' + (err.message || 'Unknown error'), 'danger');
    }
  }

  // Check if user has a username
  async checkUserHasUsername(userId) {
    try {
      const { data } = await this.supabase
        .from('profiles')
        .select('profile')
        .eq('id', userId)
        .single();
      
      return data?.profile?.username && data.profile.username.trim().length > 0;
    } catch (err) {
      console.error('Error checking username', err);
      return false;
    }
  }

  // Localforage pending ops (for offline sync)
  async addPendingOp(op) {
    try {
      const existing = (await localforage.getItem(this.pendingOpsKey)) || [];
      existing.push(op);
      await localforage.setItem(this.pendingOpsKey, existing);
    } catch (e) { 
      console.warn('Failed to save pending op', e); 
    }
  }

  // Sync pending operations when online
  async syncPendingOps() {
    try {
      const pending = await localforage.getItem(this.pendingOpsKey) || [];
      if (pending.length === 0) return;
      
      console.log(`Syncing ${pending.length} pending operations...`);
      
      for (const op of pending) {
        try {
          if (op.type === 'create_leaderboard') {
            // Leaderboard already created, just add creator as member if not exists
            const { data: existing } = await this.supabase
              .from('leaderboard_members')
              .select('user_id')
              .eq('leaderboard_id', op.leaderboard.id)
              .eq('user_id', op.leaderboard.created_by)
              .single();
              
            if (!existing) {
              await this.supabase
                .from('leaderboard_members')
                .insert({ 
                  leaderboard_id: op.leaderboard.id, 
                  user_id: op.leaderboard.created_by, 
                  points: 0 
                });
            }
          } else if (op.type === 'invite_user') {
            // Check if invitation already exists
            const { data: existing } = await this.supabase
              .from('leaderboard_members')
              .select('user_id')
              .eq('leaderboard_id', op.leaderboard_id)
              .eq('user_id', op.user_id)
              .single();
              
            if (!existing) {
              await this.supabase
                .from('leaderboard_members')
                .insert({ 
                  leaderboard_id: op.leaderboard_id, 
                  user_id: op.user_id, 
                  points: 0 
                });
            }
          }
        } catch (err) {
          console.warn('Failed to sync operation:', op, err);
        }
      }
      
      // Clear pending ops after successful sync
      await localforage.removeItem(this.pendingOpsKey);
      console.log('Pending operations synced successfully');
      
    } catch (e) {
      console.warn('Failed to sync pending operations', e);
    }
  }
}

// Initialize community manager when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.communityManager = new CommunityManager();
  
  // Sync pending operations when page loads (if online)
  if (navigator.onLine) {
    setTimeout(() => {
      if (window.communityManager) {
        window.communityManager.syncPendingOps();
      }
    }, 2000); // Wait for supabase to be ready
  }
});
