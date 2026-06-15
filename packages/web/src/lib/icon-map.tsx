// Canonical icon registry. Ported from fluid-functionalism's icon-map, trimmed
// to a single library (Lucide). FF ships Tabler/Phosphor/HugeIcons adapters too;
// we keep the registry shape (IconLibrary, per-library maps) so they can be
// added later, but an ops dashboard does not justify bundling four icon packs.
//
// Screens reference icons by semantic name ("chevron-right") via useIcon, never
// by importing a concrete icon component — that indirection is the discipline.
import {
	ArrowLeft,
	ArrowRight,
	ArrowUp,
	Bell,
	Brain,
	Check,
	ChevronDown,
	ChevronRight,
	Circle,
	Clock,
	Copy,
	CornerDownRight,
	Dot,
	Globe,
	Heart,
	Home,
	ImageIcon,
	Inbox,
	Lightbulb,
	Link,
	Loader,
	Lock,
	Mail,
	Menu,
	MessageCircle,
	Monitor,
	Moon,
	Paintbrush,
	Palette,
	Pause,
	Pencil,
	Pipette,
	Play,
	Plus,
	RectangleHorizontal,
	Rocket,
	RotateCcw,
	Search,
	Settings,
	Shield,
	SkipForward,
	SquareLibrary,
	Star,
	Sun,
	User,
	Users,
	X,
} from "lucide-react";

import type { IconComponent } from "@/lib/icon";

export type { IconComponent } from "@/lib/icon";

export type IconLibrary = "lucide";

export type IconName =
	| "chevron-right"
	| "chevron-down"
	| "x"
	| "copy"
	| "menu"
	| "dot"
	| "monitor"
	| "sun"
	| "moon"
	| "rectangle-horizontal"
	| "circle"
	| "square-library"
	| "clock"
	| "star"
	| "settings"
	| "plus"
	| "arrow-left"
	| "arrow-right"
	| "arrow-up"
	| "search"
	| "loader"
	| "users"
	| "lock"
	| "mail"
	| "bell"
	| "shield"
	| "palette"
	| "lightbulb"
	| "rocket"
	| "heart"
	| "paintbrush"
	| "brain"
	| "globe"
	| "user"
	| "image"
	| "link"
	| "check"
	| "rotate-ccw"
	| "play"
	| "pause"
	| "pipette"
	| "home"
	| "message-circle"
	| "inbox"
	| "pencil"
	| "skip-forward"
	| "corner-down-right";

export const iconLibraryOrder: IconLibrary[] = ["lucide"];

export const iconLibraryLabels: Record<IconLibrary, string> = {
	lucide: "Lucide",
};

const lucideMap: Record<IconName, IconComponent> = {
	"chevron-right": ChevronRight,
	"chevron-down": ChevronDown,
	pipette: Pipette,
	x: X,
	copy: Copy,
	menu: Menu,
	dot: Dot,
	monitor: Monitor,
	sun: Sun,
	moon: Moon,
	"rectangle-horizontal": RectangleHorizontal,
	circle: Circle,
	"square-library": SquareLibrary,
	clock: Clock,
	star: Star,
	settings: Settings,
	plus: Plus,
	"arrow-left": ArrowLeft,
	"arrow-right": ArrowRight,
	"arrow-up": ArrowUp,
	search: Search,
	loader: Loader,
	users: Users,
	lock: Lock,
	mail: Mail,
	bell: Bell,
	shield: Shield,
	palette: Palette,
	lightbulb: Lightbulb,
	rocket: Rocket,
	heart: Heart,
	paintbrush: Paintbrush,
	brain: Brain,
	globe: Globe,
	user: User,
	image: ImageIcon,
	link: Link,
	check: Check,
	"rotate-ccw": RotateCcw,
	play: Play,
	pause: Pause,
	home: Home,
	"message-circle": MessageCircle,
	inbox: Inbox,
	pencil: Pencil,
	"skip-forward": SkipForward,
	"corner-down-right": CornerDownRight,
};

export const iconMap: Record<IconLibrary, Record<IconName, IconComponent>> = {
	lucide: lucideMap,
};
