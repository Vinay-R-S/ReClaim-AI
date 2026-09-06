/**
 * Dashboard building blocks.
 *
 * These were six components and a hook living inside `MainDashboard.tsx`,
 * which made the file 800 lines of which the dashboard itself was the last
 * 270. Nothing here knows where its data comes from.
 */

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export interface KPIData {
  totalItems: number;
  activeLost: number;
  activeFound: number;
  totalMatches: number;
  pendingReview: number;
  claimed: number;
  matched: number;
  matchSuccessRate: number;
}

export interface ScoreDistribution {
  range: string;
  count: number;
  color: string;
}

export interface TrendData {
  date: string;
  matches: number;
}

export function useCountUp(end: number, duration: number = 1000) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (end === 0) {
      setCount(0);
      return;
    }

    let startTime: number;
    let animationFrame: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      setCount(Math.floor(progress * end));

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [end, duration]);

  return count;
}

interface KPICardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  subtext: string;
  gradient: string;
  isPercentage?: boolean;
}

export function KPICard({ title, value, icon, subtext, gradient, isPercentage }: KPICardProps) {
  const animatedValue = useCountUp(value);

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl p-5 transition-all duration-300',
        'hover:scale-[1.02] hover:shadow-xl cursor-pointer',
        'border border-white/20',
        gradient,
      )}
    >
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-3">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
            {icon}
          </div>
        </div>

        <p className="text-3xl font-bold text-white mb-1">
          {animatedValue.toLocaleString()}
          {isPercentage ? '%' : ''}
        </p>
        <p className="text-white/90 font-medium text-sm">{title}</p>
        <p className="text-white/70 text-xs mt-1">{subtext}</p>
      </div>
    </div>
  );
}

// ============================================================================
// SKELETON LOADER
// ============================================================================
export function SkeletonCard() {
  return (
    <div className="rounded-2xl p-5 bg-gray-100 animate-pulse">
      <div className="w-10 h-10 bg-gray-200 rounded-xl mb-3" />
      <div className="h-8 bg-gray-200 rounded w-20 mb-2" />
      <div className="h-4 bg-gray-200 rounded w-32" />
    </div>
  );
}

export function SkeletonChart() {
  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 animate-pulse">
      <div className="h-6 bg-gray-200 rounded w-40 mb-4" />
      <div className="h-64 bg-gray-100 rounded-xl" />
    </div>
  );
}
