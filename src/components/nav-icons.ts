import {
  BookOpen,
  BotMessageSquare,
  BriefcaseBusiness,
  CalendarDays,
  Camera,
  ChartColumn,
  FlaskConical,
  Inbox,
  Kanban,
  ListChecks,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  Settings,
  Sparkles,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ModuleIcon } from "@/lib/modules/registry";

/**
 * 030 (PR 4) — Los íconos del registro de módulos (`src/lib/modules/registry.ts`
 * los nombra; aquí se pintan). Los usan el menú lateral, el editor de
 * Ajustes → Navegación y (039) el encabezado de cada pilar (`PageShell`).
 */
export const NAV_ICONS: Record<ModuleIcon, LucideIcon> = {
  Inbox,
  MessagesSquare,
  CalendarDays,
  Kanban,
  Users,
  BookOpen,
  Megaphone,
  ChartColumn,
  Sparkles,
  FlaskConical,
  Settings,
  Target,
  Camera,
  MessageCircle,
  BriefcaseBusiness,
  ListChecks,
  BotMessageSquare,
};
