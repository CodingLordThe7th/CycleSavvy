// Authentication Module
class AuthManager {
  constructor() {
    this.supabase = null;
    this.init();
  }

  init() {
    // Wait for Supabase to be available
    const checkSupabase = () => {
      this.supabase = window.SupabaseConfig?.getSupabase();
      if (this.supabase) {
        this.setupAuthHandlers();
        this.setupAuthStateListener();
      } else {
        setTimeout(checkSupabase, 100);
      }
    };
    checkSupabase();
  }

  setupAuthHandlers() {
    const openAuthBtn = document.getElementById('openAuthBtn');
    const authCard = document.getElementById('authCard');
    const closeAuth = document.getElementById('closeAuth');
    const signupBtn = document.getElementById('signupBtn');
    const loginBtn = document.getElementById('loginBtn');
    const showLogin = document.getElementById('showLogin');
    const showSignup = document.getElementById('showSignup');
    const signupForm = document.getElementById('signupForm');
    const loginForm = document.getElementById('loginForm');
    const authError = document.getElementById('authError');

    if (!openAuthBtn) return;

    const showError = (msg) => {
      authError.textContent = msg;
      authError.classList.remove('d-none');
    };
    
    const hideError = () => { 
      authError.classList.add('d-none'); 
    };

    openAuthBtn.addEventListener('click', () => { 
      authCard.style.display = 'block'; 
    });
    
    closeAuth.addEventListener('click', () => { 
      authCard.style.display = 'none'; 
      hideError(); 
    });

    showLogin.addEventListener('click', (e) => { 
      e.preventDefault(); 
      signupForm.style.display = 'none'; 
      loginForm.style.display = 'block'; 
      hideError(); 
    });
    
    showSignup.addEventListener('click', (e) => { 
      e.preventDefault(); 
      signupForm.style.display = 'block'; 
      loginForm.style.display = 'none'; 
      hideError(); 
    });

    signupBtn.addEventListener('click', async () => {
      hideError();
      const email = document.getElementById('signupEmail').value;
      const password = document.getElementById('signupPassword').value;
      
      if (!this.supabase) return showError('Auth not ready. Try again.');
      
      try {
        const { data, error } = await this.supabase.auth.signUp({ email, password });
        if (error) return showError(error.message || 'Signup failed');
        
        // After successful signup, switch to login form
        signupForm.style.display = 'none';
        loginForm.style.display = 'block';
        document.getElementById('loginEmail').value = email;
        notify('Signup successful — please log in', 'success');
      } catch (err) {
        showError(err.message || 'Signup error');
      }
    });

    loginBtn.addEventListener('click', async () => {
      hideError();
      const email = document.getElementById('loginEmail').value;
      const password = document.getElementById('loginPassword').value;
      
      if (!this.supabase) return showError('Auth not ready. Try again.');
      
      try {
        const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
        if (error) return showError(error.message || 'Login failed');
        
        notify('Logged in', 'success');
        authCard.style.display = 'none';
      } catch (err) {
        showError(err.message || 'Login error');
      }
    });
  }

  setupAuthStateListener() {
    if (this.supabase && this.supabase.auth && this.supabase.auth.onAuthStateChange) {
      this.supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN') {
          notify('Signed in', 'success');
        } else if (event === 'SIGNED_OUT') {
          notify('Signed out', 'info');
        }
      });
    }
  }

  async signOut() {
    if (!this.supabase) return false;
    try {
      await this.supabase.auth.signOut();
      return true;
    } catch (err) {
      console.error('Sign out error:', err);
      return false;
    }
  }

  async getCurrentUser() {
    if (!this.supabase) return null;
    try {
      const { data } = await this.supabase.auth.getUser();
      return data?.user || null;
    } catch (err) {
      console.error('Get user error:', err);
      return null;
    }
  }
}

// Initialize auth manager when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.authManager = new AuthManager();
});
