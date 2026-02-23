import { Component } from 'react';

/**
 * React Error Boundary — catches render errors in child components
 * and shows a recovery UI instead of crashing the entire app.
 */
export default class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error('[ErrorBoundary] Caught render error:', error, errorInfo);
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            const label = this.props.label || 'Component';
            return (
                <div className="error-boundary">
                    <div className="error-boundary-content">
                        <span className="error-boundary-icon">⚠️</span>
                        <h4 className="error-boundary-title">{label} Error</h4>
                        <p className="error-boundary-message">
                            {this.state.error?.message || 'Something went wrong.'}
                        </p>
                        <button className="btn btn-secondary" onClick={this.handleReset}>
                            Try Again
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
