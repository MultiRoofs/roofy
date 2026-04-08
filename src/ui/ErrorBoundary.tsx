/**
 * React error boundary that prevents white-screen crashes.
 *
 * Catches render errors in the component tree below it and shows a
 * fallback UI with the error message and a reset button.
 */

import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface ErrorBoundaryProps {
  readonly children: ReactNode;
  readonly fallback?: "full-page" | "inline";
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  private handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    if (this.props.fallback === "inline") {
      return (
        <div className="error-inline">
          <span className="error-inline-msg">{this.state.error.message}</span>
          <button className="error-inline-btn" onClick={this.handleReset}>
            Retry
          </button>
        </div>
      );
    }

    return (
      <div className="error-fullpage">
        <div className="error-card">
          <h2>Something went wrong</h2>
          <p className="error-detail">{this.state.error.message}</p>
          <div className="error-actions">
            <button className="error-reset-btn" onClick={this.handleReset}>
              Try again
            </button>
            <button
              className="error-reload-btn"
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
