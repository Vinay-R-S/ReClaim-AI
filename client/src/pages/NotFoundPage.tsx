import { Link } from 'react-router-dom';
import { ArrowLeft, Compass } from 'lucide-react';

export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 text-center">
      <div className="w-24 h-24 rounded-full bg-blue-50 flex items-center justify-center mb-6">
        <Compass className="w-12 h-12 text-primary" />
      </div>
      <p className="text-sm font-medium text-text-secondary mb-2">Error 404</p>
      <h1 className="text-4xl font-bold text-text-primary mb-4">Page not found</h1>
      <p className="text-lg text-text-secondary max-w-md mb-8">
        This page does not exist, or it has moved. Check the address, or head back and start again.
      </p>
      <Link to="/" className="btn-pill btn-primary inline-flex items-center gap-2">
        <ArrowLeft className="w-5 h-5" />
        Back to Home
      </Link>
    </div>
  );
}
