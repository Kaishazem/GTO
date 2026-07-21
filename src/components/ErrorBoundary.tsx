import { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /** Short label shown in the error UI, e.g. "Tasks" or "Wallet" */
  section?: string;
  /** If true, render a compact inline error instead of a full-screen panel */
  inline?: boolean;
}

interface State {
  error: Error | null;
}

/**
 * Granular error boundary that catches render-time throws inside a subtree
 * and shows a contained error panel instead of propagating to the root.
 *
 * Usage:
 *   <ErrorBoundary section="Tasks">
 *     <TasksPage />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error(
      `[ErrorBoundary] Uncaught error in "${this.props.section ?? "unknown"}" section:`,
      error,
      info.componentStack,
    );
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    const { children, section, inline } = this.props;

    if (!error) return children;

    if (inline) {
      return (
        <div className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            {section ? `${section} failed to load. ` : ""}
            {error.message}
          </span>
          <button
            onClick={this.handleRetry}
            className="shrink-0 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      );
    }

    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 border border-red-500/20">
          <AlertTriangle className="h-7 w-7 text-red-400" />
        </div>
        <div>
          <h3 className="font-semibold text-white">
            {section ? `${section} couldn't load` : "Something went wrong"}
          </h3>
          <p className="mt-1 text-sm text-white/50 max-w-sm leading-relaxed">
            {error.message || "An unexpected error occurred. Try refreshing or contact support if it persists."}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={this.handleRetry}
          className="border-white/20 text-white/70 hover:text-white hover:bg-white/10 rounded-xl gap-2"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Try again
        </Button>
      </div>
    );
  }
}
