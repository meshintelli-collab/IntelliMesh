/**
 * WebSocket Error Handler for Development Environment
 * Handles HMR websocket connection issues gracefully
 */

class WebSocketErrorHandler {
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectInterval = 2000;

  constructor() {
    this.setupErrorHandlers();
  }

  private setupErrorHandlers() {
    // Handle websocket connection errors in development
    if (import.meta.env.DEV) {
      // Listen for HMR websocket errors
      window.addEventListener('error', (event) => {
        if (event.message && (
          event.message.includes('WebSocket') ||
          event.message.includes('closed without opened')
        )) {
          this.handleWebSocketError(event);
        }
      });

      // Listen for unhandled promise rejections that might be websocket related
      window.addEventListener('unhandledrejection', (event) => {
        if (event.reason && (
          event.reason.toString().includes('WebSocket') ||
          event.reason.toString().includes('closed without opened')
        )) {
          this.handleWebSocketError(event);
        }
      });

      // Intercept console errors for WebSocket issues
      const originalConsoleError = console.error;
      console.error = (...args) => {
        const message = args.join(' ');
        if (message.includes('WebSocket closed without opened')) {
          this.handleWebSocketError(new Error(message));
          return; // Don't log the error to console
        }
        originalConsoleError.apply(console, args);
      };
    }
  }

  private handleWebSocketError(event: Event | PromiseRejectionEvent) {
    console.warn('WebSocket connection issue detected, attempting recovery...');
    
    // Don't spam reconnection attempts
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('Max websocket reconnection attempts reached. Manual refresh may be needed.');
      return;
    }

    this.reconnectAttempts++;

    // Try to reconnect after a delay
    setTimeout(() => {
      try {
        // Force HMR reconnection by reloading if still having issues
        if (import.meta.hot) {
          import.meta.hot.invalidate();
        }
      } catch (error) {
        console.warn('HMR reconnection failed:', error);
      }
    }, this.reconnectInterval);
  }

  public reset() {
    this.reconnectAttempts = 0;
  }
}

// Initialize websocket error handler in development
if (import.meta.env.DEV) {
  new WebSocketErrorHandler();
}

export { WebSocketErrorHandler };
