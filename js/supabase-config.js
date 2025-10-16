// Supabase Configuration
const SUPABASE_URL = 'https://apstcjrompnfzosazadg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwc3RjanJvbXBuZnpvc2F6YWRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAwNjM3MjYsImV4cCI6MjA3NTYzOTcyNn0.VQ2LszDUUU5eeJHTlQDxoskNIkCb-W_sTar7gpqMWrM';

// Initialize Supabase client
function initializeSupabase() {
  if (!window.supabase) {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    script.onload = () => {
      window.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      console.log('✅ Supabase loaded dynamically');
    };
    document.head.appendChild(script);
  } else {
    window.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
}

// Helper to get auth client once loaded
function getSupabase() {
  if (window.supabase) return window.supabase;
  if (window.createClient) {
    window.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return window.supabase;
  }
  return null;
}

// Export for use in other modules
window.SupabaseConfig = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  initializeSupabase,
  getSupabase
};
