/**
 * The two card shapes the landing page repeats.
 */

interface FeatureCardProps {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  description: string;
}

export function FeatureCard({ icon, iconBg, title, description }: FeatureCardProps) {
  return (
    <div className="card p-5 sm:p-6 hover:shadow-lg transition-shadow">
      <div
        className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl ${iconBg} text-white flex items-center justify-center mb-3 sm:mb-4`}
      >
        {icon}
      </div>
      <h3 className="font-medium text-text-primary mb-2 text-sm sm:text-base">{title}</h3>
      <p className="text-xs sm:text-sm text-text-secondary">{description}</p>
    </div>
  );
}

// Step Card Component
interface StepCardProps {
  number: string;
  title: string;
  description: string;
}

export function StepCard({ number, title, description }: StepCardProps) {
  return (
    <div className="text-center">
      <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-primary text-white text-xl sm:text-2xl font-medium flex items-center justify-center mx-auto mb-3 sm:mb-4">
        {number}
      </div>
      <h3 className="font-medium text-text-primary text-base sm:text-lg mb-2">{title}</h3>
      <p className="text-sm sm:text-base text-text-secondary">{description}</p>
    </div>
  );
}
