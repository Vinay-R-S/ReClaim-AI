import { UserLayout } from "../../components/layout/UserLayout";
import { Package, Users, Shield, Zap, CheckCircle, Award } from "lucide-react";

export function HowItWorksPage() {
  return (
    <UserLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-4xl font-bold text-text-primary mb-4">
            How ReClaim AI Works
          </h1>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto">
            Our AI-powered platform makes reuniting lost items with their owners
            simple, secure, and rewarding.
          </p>
        </div>

        {/* Main Steps */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StepCard
            icon={<Package className="w-8 h-8" />}
            number={1}
            title="Report Your Item"
            description="Take a photo and provide details about lost or found items. Our AI analyzes the information for accurate matching."
          />
          <StepCard
            icon={<Zap className="w-8 h-8" />}
            number={2}
            title="AI Matching"
            description="Our advanced AI system automatically matches lost and found items using image recognition and natural language processing."
          />
          <StepCard
            icon={<CheckCircle className="w-8 h-8" />}
            number={3}
            title="Verify & Reunite"
            description="Verify ownership through secure codes and coordinate handover at verified collection points."
          />
        </div>

        {/* Features */}
        <div className="card p-8 mt-8">
          <h2 className="text-2xl font-semibold text-text-primary mb-6 text-center">
            Why Choose ReClaim AI?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FeatureCard
              icon={<Shield className="w-6 h-6 text-blue-600" />}
              title="Blockchain Security"
              description="All handovers are recorded immutably on the blockchain for transparency and security."
            />
            <FeatureCard
              icon={<Award className="w-6 h-6 text-yellow-600" />}
              title="Earn Credits"
              description="Get rewarded with credits for reporting items and successful reunions. 10 credits on signup, up to 30 per handover!"
            />
            <FeatureCard
              icon={<Zap className="w-6 h-6 text-purple-600" />}
              title="AI-Powered Matching"
              description="Advanced AI analyzes images and descriptions to find the best matches automatically."
            />
            <FeatureCard
              icon={<Users className="w-6 h-6 text-green-600" />}
              title="Community Driven"
              description="Join a community of helpful people making a difference by reuniting lost items."
            />
          </div>
        </div>

        {/* Credit System */}
        <div className="card p-8 bg-gradient-to-br from-yellow-50 to-yellow-100">
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            🪙 Credit System
          </h2>
          <div className="space-y-3">
            <CreditItem amount={10} reason="New user signup bonus" />
            <CreditItem
              amount={20}
              reason="Item successfully returned (finder)"
            />
            <CreditItem
              amount={10}
              reason="Item successfully claimed (owner)"
            />
          </div>
          <p className="text-sm text-text-secondary mt-4">
            Credits are tracked in your profile and serve as a reputation score
            in the community.
          </p>
        </div>

        {/* Getting Started */}
        <div className="card p-8 text-center">
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            Ready to Get Started?
          </h2>
          <p className="text-text-secondary mb-6">
            Start reporting lost or found items and help reunite people with
            their belongings!
          </p>
          <a
            href="/app"
            className="inline-block bg-primary text-white px-8 py-3 rounded-lg font-medium hover:bg-primary-hover transition-colors"
          >
            Go to Dashboard
          </a>
        </div>
      </div>
    </UserLayout>
  );
}

interface StepCardProps {
  icon: React.ReactNode;
  number: number;
  title: string;
  description: string;
}

function StepCard({ icon, number, title, description }: StepCardProps) {
  return (
    <div className="card p-6 text-center hover:shadow-lg transition-shadow">
      <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4">
        {icon}
      </div>
      <div className="w-10 h-10 rounded-full bg-primary text-white font-bold text-lg flex items-center justify-center mx-auto mb-3">
        {number}
      </div>
      <h3 className="font-semibold text-lg text-text-primary mb-2">{title}</h3>
      <p className="text-sm text-text-secondary">{description}</p>
    </div>
  );
}

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center">
        {icon}
      </div>
      <div>
        <h3 className="font-medium text-text-primary mb-1">{title}</h3>
        <p className="text-sm text-text-secondary">{description}</p>
      </div>
    </div>
  );
}

interface CreditItemProps {
  amount: number;
  reason: string;
}

function CreditItem({ amount, reason }: CreditItemProps) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-yellow-200 last:border-0">
      <span className="text-text-primary">{reason}</span>
      <span className="font-semibold text-primary">+{amount} credits</span>
    </div>
  );
}
