"use client";
import { Component, type ReactNode } from "react";
import { ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";

export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error) {
    console.error(`[echospace] ${this.props.label ?? "view"} crashed`, error);
  }
  override render() {
    if (this.state.error) {
      return (
        <ErrorState title={`${this.props.label ?? "This view"} failed to render`}>
          <p className="num mb-3 break-all">{this.state.error.message}</p>
          <Button onClick={() => this.setState({ error: null })}>Retry</Button>
        </ErrorState>
      );
    }
    return this.props.children;
  }
}
