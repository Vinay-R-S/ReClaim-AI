import { Link } from "react-router-dom";
import { Construction, ArrowLeft } from "lucide-react";

export function UnderConstruction() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 text-center">
      <div className="w-24 h-24 rounded-full bg-yellow-100 flex items-center justify-center mb-6">
        <Construction className="w-12 h-12 text-yellow-600" />
      </div>
      <h1 className="text-4xl font-bold text-text-primary mb-4">
        Under Construction
      </h1>
      <p className="text-lg text-text-secondary max-w-md mb-8">
        We're still building this part of the experience. Check back soon for
        updates!
      </p>
      <Link
        to="/"
        className="btn-pill btn-primary inline-flex items-center gap-2"
      >
        <ArrowLeft className="w-5 h-5" />
        Back to Home
      </Link>
    </div>
  );
}
