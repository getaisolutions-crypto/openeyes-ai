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
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/assistant', label: 'Assistant', icon: MessageCircle },
  { to: '/explore', label: 'Explore', icon: ScanEye },
  { to: '/find', label: 'Find', icon: Search },
  { to: '/read', label: 'Read', icon: BookOpenText },
  { to: '/memory', label: 'Memory', icon: Brain },
  { to: '/devices', label: 'Devices', icon: Smartphone },
  { to: '/trusted-circle', label: 'Trusted Circle', icon: Users },
  { to: '/settings', label: 'Settings', icon: Settings },
];
