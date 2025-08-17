/**
 * HMR Fallback for WebSocket Connection Issues
 * Provides alternative update mechanisms when WebSocket HMR fails
 */

class HMRFallback {
  private pollingInterval: number | null = null;
  private lastModified: number = Date.now();
  
  constructor() {
    this.setupFallback();
  }

  private setupFallback() {
    if (import.meta.env.DEV) {
      // Monitor for HMR availability
      this.checkHMRStatus();
      
      // Set up polling fallback if needed
      setTimeout(() => {
        if (!this.isHMRWorking()) {
          this.startPollingFallback();
        }
      }, 5000); // Wait 5 seconds to see if HMR starts working
    }
  }

  private isHMRWorking(): boolean {
    // Check if HMR WebSocket is connected
    if (import.meta.hot) {
      try {
        // Try to check HMR status
        return import.meta.hot.data !== undefined;
      } catch {
        return false;
      }
    }
    return false;
  }

  private checkHMRStatus() {
    if (import.meta.hot) {
      import.meta.hot.on('vite:ws:disconnect', () => {
        console.warn('HMR WebSocket disconnected, switching to polling fallback...');
        this.startPollingFallback();
      });

      import.meta.hot.on('vite:ws:connect', () => {
        console.info('HMR WebSocket reconnected, stopping polling fallback.');
        this.stopPollingFallback();
      });
    }
  }

  private startPollingFallback() {
    if (this.pollingInterval) return;
    
    console.info('Starting HMR polling fallback...');
    
    this.pollingInterval = window.setInterval(() => {
      this.checkForUpdates();
    }, 2000); // Poll every 2 seconds
  }

  private stopPollingFallback() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.info('HMR polling fallback stopped.');
    }
  }

  private async checkForUpdates() {
    try {
      // Check if the page has been updated by checking a simple endpoint
      const response = await fetch('/__vite_ping', { 
        method: 'HEAD',
        cache: 'no-cache' 
      });
      
      const serverTime = response.headers.get('date');
      if (serverTime) {
        const serverTimestamp = new Date(serverTime).getTime();
        if (serverTimestamp > this.lastModified + 10000) { // 10 second buffer
          console.info('Updates detected, reloading page...');
          window.location.reload();
        }
      }
    } catch (error) {
      // Silently fail - server might be restarting
    }
  }

  public destroy() {
    this.stopPollingFallback();
  }
}

// Initialize HMR fallback in development
if (import.meta.env.DEV) {
  new HMRFallback();
}

export { HMRFallback };
