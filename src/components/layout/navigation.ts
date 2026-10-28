import {
  BookOpenText,
  Brain,
  Home,
  MessageCircle,
  ScanEye,
  Search,
  Settings,
  Smartphone,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Shown in the mobile bottom bar. Everything is reachable from Home. */
  primary: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Home', icon: Home, primary: true },
  { to: '/assistant', label: 'Assistant', icon: MessageCircle, primary: true },
  { to: '/explore', label: 'Explore', icon: ScanEye, primary: false },
  { to: '/find', label: 'Find', icon: Search, primary: false },
  { to: '/read', label: 'Read', icon: BookOpenText, primary: false },
  { to: '/memory', label: 'Memory', icon: Brain, primary: true },
  { to: '/devices', label: 'Devices', icon: Smartphone, primary: true },
  { to: '/trusted-circle', label: 'Trusted Circle', icon: Users, primary: false },
  { to: '/settings', label: 'Settings', icon: Settings, primary: true },
];
