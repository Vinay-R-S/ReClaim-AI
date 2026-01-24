/**
 * Centralized Icon Exports
 * 
 * This file exports only the icons that are actually used in the application.
 * Import icons from this file instead of directly from 'lucide-react' to enable
 * better tree-shaking and reduce bundle size.
 * 
 * Before: ~959KB for entire lucide-react library
 * After: Only the icons you use are bundled
 * 
 * Usage:
 *   import { Package, Search } from '@/lib/icons';
 */

// ============================================================================
// GENERAL ICONS
// ============================================================================
export {
    // Navigation & Layout
    LayoutDashboard,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    ArrowDown,
    ArrowLeftRight,
    ChevronLeft,
    ChevronRight,
    X,
    Menu,

    // Actions
    Search,
    RefreshCw,
    Edit2,
    Eye,
    Save,
    Send,
    Upload,

    // Objects
    Package,
    MapPin,
    Calendar,
    Clock,
    Link2,
    Image,
    Paperclip,
    Camera,
    Video,

    // Users & Auth
    User,
    Users,
    UserCheck,
    LogOut,
    Lock,
    Mail,

    // Status & Feedback
    CheckCircle,
    AlertTriangle,
    Loader2,
    Activity,
    TrendingUp,
    Zap,
    Sparkles,
    Target,
    Plus,

    // Settings & UI
    Settings,
    Bell,
    HelpCircle,
    Bot,
    Construction,
    HandMetal,
    Award,
    MessageCircle,
} from 'lucide-react';

// Re-export types for TypeScript support
export type { LucideIcon } from 'lucide-react';
